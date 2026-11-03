import { describe, expect, it } from 'vitest';
import { JiraSource, jqlString, toLinks } from '../src/core/sources/jira.js';
import { columnsOf, graphContext, issueAri, issueIdFromAri } from '../src/core/sources/twg.js';
import { gatherBundle } from '../src/core/gather.js';

const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const fail = (status) => ({ ok: false, status, json: async () => ({}) });

const rawIssue = (key, fields = {}) => ({
  id: String(10000 + Number(key.split('-')[1])),
  key,
  fields: {
    summary: `${key} summary`, components: [], labels: [], status: { name: 'To Do', statusCategory: { key: 'new' } },
    project: { id: '1', key: key.split('-')[0] }, issuelinks: [], ...fields,
  },
});

describe('jira helpers', () => {
  it('escapes JQL strings', () => {
    expect(jqlString('a "b" \\c')).toBe('"a \\"b\\" \\\\c"');
  });

  it('reads link direction from the right phrase', () => {
    const links = toLinks({
      fields: {
        issuelinks: [
          { type: { inward: 'is blocked by', outward: 'blocks' }, outwardIssue: { key: 'X-1', fields: { status: { statusCategory: { key: 'new' } } } } },
          { type: { inward: 'is blocked by', outward: 'blocks' }, inwardIssue: { key: 'X-2', fields: {} } },
        ],
      },
    });
    expect(links.map((l) => [l.key, l.relation])).toEqual([['X-1', 'blocks'], ['X-2', 'is blocked by']]);
  });

  it('tolerates a failing JQL clause and records a warning', async () => {
    const src = new JiraSource(async (path, init) => {
      const { jql } = JSON.parse(init.body);
      return jql.includes('Nope') ? fail(400) : ok({ issues: [rawIssue('INC-1')] });
    });
    const out = await src.searchTolerant(['component = "Nope"', 'labels in ("x")']);
    expect(out.map((i) => i.key)).toEqual(['INC-1']);
    expect(src.warnings).toHaveLength(1);
  });
});

describe('teamwork graph', () => {
  it('builds and parses issue ARIs', () => {
    const ari = issueAri('cloud-1', '10042');
    expect(ari).toBe('ari:cloud:jira:cloud-1:issue/10042');
    expect(issueIdFromAri(ari)).toBe('10042');
    expect(issueIdFromAri('ari:cloud:identity::user/abc')).toBeNull();
  });

  it('flattens list and single-node columns', () => {
    const cols = columnsOf({
      data: { cypherQuery: { edges: [{ node: { columns: [
        { key: 'prs', value: { __typename: 'CypherQueryResultListNode', nodes: [{ id: 'p1' }, { id: 'p2' }] } },
        { key: 'one', value: { __typename: 'CypherQueryResultNode', id: 'x' } },
      ] } }] } },
    });
    expect(cols.prs.map((n) => n.id)).toEqual(['p1', 'p2']);
    expect(cols.one.map((n) => n.id)).toEqual(['x']);
  });

  it('refuses to run an unregistered persisted query', async () => {
    await expect(graphContext(async () => ({}), { cloudId: 'c', issueId: '1' }, {})).rejects.toThrow(/not registered/);
  });

  it('treats a null connection without errors as a failure', () => {
    expect(() => columnsOf({ data: { customQuery: null } })).toThrow(/empty response/);
  });

  it('throws on GraphQL errors so callers can fall back', () => {
    expect(() => columnsOf({ errors: [{ message: 'not allowlisted' }] })).toThrow(/not allowlisted/);
  });

  it('walks PRs -> services -> incidents', async () => {
    const calls = [];
    const fake = async (_q, { queryKey, queryParams }) => {
      calls.push(queryParams);
      const col = (key, nodes) => ({ key, value: { nodes } });
      if (queryKey === 'key-inc') {
        return { data: { customQuery: { edges: [{ node: { columns: [col('incidents', [{ id: 'ari:cloud:jira:c:issue/777' }])] } }] } } };
      }
      return { data: { customQuery: { edges: [{ node: { columns: [
        col('prs', [{ id: 'pr1', data: { displayName: 'Add retry', url: 'https://bb/pr/1', status: 'OPEN' } }]),
        col('repos', [{ id: 'r1', data: { name: 'checkout-api' } }]),
        col('services', [{ id: 'svc-ari-1', data: { name: 'checkout' } }]),
        col('deployments', []),
        col('reviewers', [{ id: 'u', data: { accountId: 'rev-1', name: 'Rhea Reviewer' } }]),
      ] } }] } } };
    };
    const g = await graphContext(fake, { cloudId: 'c', issueId: '10042' }, { code: 'key-code', incidents: 'key-inc' });
    expect(calls[0]).toEqual({ ari: 'ari:cloud:jira:c:issue/10042' });
    expect(calls[1]).toEqual({ serviceAris: ['svc-ari-1'] });
    expect(g.prs[0]).toMatchObject({ name: 'Add retry', status: 'OPEN' });
    expect(g.incidentIssueIds).toEqual(['777']);
    expect(g.prReviewers).toEqual([{ accountId: 'rev-1', displayName: 'Rhea Reviewer' }]);
  });
});

describe('gatherBundle', () => {
  // A tiny in-memory Jira: one issue with a component, an epic parent, one incident type.
  const site = async (path, init) => {
    if (path.startsWith('/rest/api/3/issue/PAY-142')) {
      return ok(rawIssue('PAY-142', { components: [{ name: 'Checkout' }], parent: { key: 'PAY-100' } }));
    }
    if (path.startsWith('/rest/api/3/issue/PAY-100')) return ok(rawIssue('PAY-100', { issuetype: { name: 'Epic' } }));
    if (path === '/rest/api/3/issuetype') return ok([{ name: 'Task' }, { name: '[System] Incident' }]);
    if (path === '/rest/api/3/project/PAY/components') return ok([{ name: 'Checkout', lead: { accountId: 'a-1', displayName: 'Alice' } }]);
    if (path === '/rest/api/3/search/jql') {
      const { jql } = JSON.parse(init.body);
      if (jql.startsWith('parent =')) return ok({ issues: [] });
      if (jql.includes('[System] Incident')) {
        return ok({ issues: [rawIssue('INC-9', { priority: { name: 'P1' }, components: [{ name: 'Checkout' }], created: new Date().toISOString() })] });
      }
      return ok({ issues: [] });
    }
    return fail(404);
  };

  it('falls back to Jira-only with a warning when the graph errors', async () => {
    const b = await gatherBundle({
      requestJira: site,
      requestGraph: async () => ({ errors: [{ message: 'app not allowlisted' }] }),
      cloudId: 'c',
      issueKey: 'PAY-142',
    });
    expect(b.source).toBe('jira');
    expect(b.warnings[0]).toMatch(/^Teamwork Graph unavailable, using Jira only: /);
    expect(b.parents.map((p) => p.key)).toEqual(['PAY-100']);
    expect(b.incidents.map((i) => i.key)).toEqual(['INC-9']);
    expect(b.componentLeads[0].lead.accountId).toBe('a-1');
  });
});
