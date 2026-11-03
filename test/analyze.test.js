import { describe, expect, it } from 'vitest';
import { analyze, levelOf, rankIncidents, severityOf } from '../src/core/analyze.js';
import { forAgent, toAdf } from '../src/core/report.js';
import { NOW, bundle } from './fixtures/bundle.js';

describe('severityOf', () => {
  it.each([
    ['P1', 'critical'], ['Highest', 'critical'], ['Sev 2', 'high'], ['High', 'high'],
    ['Medium', 'medium'], ['Low', 'low'], [undefined, 'low'],
  ])('%s -> %s', (p, s) => expect(severityOf(p)).toBe(s));
});

describe('rankIncidents', () => {
  it('keeps only incidents overlapping the change surface', () => {
    const keys = rankIncidents(bundle(), NOW).map((i) => i.key);
    expect(keys).toContain('INC-88');
    expect(keys).toContain('INC-203');
    expect(keys).not.toContain('INC-12');
  });

  it('ranks the severe, double-matching incident first and explains the match', () => {
    const [top] = rankIncidents(bundle(), NOW);
    expect(top.key).toBe('INC-88');
    expect(top.matches).toEqual(['component Payments Gateway', 'label payments']);
  });

  it('decays old incidents', () => {
    const b = bundle();
    const fresh = rankIncidents(b, NOW).find((i) => i.key === 'INC-88').relevance;
    b.incidents[0].created = new Date(NOW - 400 * 86_400_000).toISOString();
    const stale = rankIncidents(b, NOW).find((i) => i.key === 'INC-88').relevance;
    expect(stale).toBeLessThan(fresh / 10);
  });

  it('accepts graph-linked incidents with no Jira overlap', () => {
    const b = bundle();
    b.incidents.push({ key: 'INC-300', summary: 'svc down', created: new Date(NOW).toISOString(), priority: 'P2', statusCategory: 'done', linkedVia: 'linked service (Teamwork Graph)' });
    expect(rankIncidents(b, NOW).map((i) => i.key)).toContain('INC-300');
  });
});

describe('analyze', () => {
  const r = analyze(bundle(), NOW);

  it('scores a risky change high with every factor explained', () => {
    expect(r.score).toBeGreaterThanOrEqual(50);
    expect(['high', 'critical']).toContain(r.level);
    expect(r.factors.map((f) => f.id)).toEqual(expect.arrayContaining(['incidents', 'open-incidents', 'dependents', 'parents', 'concurrent']));
    expect(r.factors.reduce((s, f) => s + f.points, 0)).toBeGreaterThanOrEqual(r.score);
    for (const f of r.factors) expect(f.detail).not.toBe('');
  });

  it('only counts open blocking links as dependents that score', () => {
    expect(r.dependents.map((d) => d.key)).toEqual(['OPS-7']);
  });

  it('finds concurrent work on the same surface only', () => {
    expect(r.concurrent.map((c) => c.key)).toEqual(['PAY-150']);
  });

  it('flags the epic due soon', () => {
    expect(r.parents[0].reasons).toEqual(['due in 10d', 'Highest priority']);
  });

  it('builds a deduped notify list with reasons, excluding the assignee', () => {
    const ids = r.notify.map((p) => p.accountId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain('d-4');
    const cara = r.notify.find((p) => p.accountId === 'c-3');
    expect(cara.reasons).toEqual(['owns dependent OPS-7', 'changing the same surface in PAY-150']);
    expect(r.notify.find((p) => p.accountId === 'b-2').reasons).toContain('responded to INC-88');
  });

  it('is low and says so for an isolated change', () => {
    const b = bundle();
    Object.assign(b, { parents: [], links: [], siblings: [], incidents: [], componentLeads: [] });
    b.issue.components = ['Docs'];
    b.issue.labels = [];
    const low = analyze(b, NOW);
    expect(low.score).toBe(0);
    expect(low.level).toBe('low');
    expect(low.headline).toMatch(/^Low blast radius/);
  });

  it('caps the score at 100', () => {
    const b = bundle();
    for (let i = 0; i < 20; i++) b.incidents.push({ ...b.incidents[0], key: `INC-${1000 + i}`, statusCategory: 'new' });
    expect(analyze(b, NOW).score).toBeLessThanOrEqual(100);
  });
});

describe('levelOf', () => {
  it.each([[0, 'low'], [24, 'low'], [25, 'medium'], [60, 'high'], [75, 'critical'], [100, 'critical']])('%i -> %s', (s, l) =>
    expect(levelOf(s)).toBe(l));
});

describe('report', () => {
  const r = analyze(bundle(), NOW);

  it('forAgent is compact and JSON-serialisable', () => {
    const a = forAgent(r);
    expect(a.incidents.length).toBeLessThanOrEqual(5);
    expect(JSON.stringify(a).length).toBeLessThan(6000);
    expect(a.notify[0]).toHaveProperty('reasons');
  });

  it('toAdf produces a valid-looking ADF doc with mentions', () => {
    const doc = toAdf(r);
    expect(doc).toMatchObject({ type: 'doc', version: 1 });
    const json = JSON.stringify(doc);
    expect(json).toContain('"type":"mention"');
    expect(json).toContain('INC-88');
    // ADF rejects empty text nodes.
    expect(json).not.toContain('"text":""');
  });
});
