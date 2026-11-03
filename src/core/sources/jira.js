// Jira / JSM REST adapter. Works on any site with no allowlisting, so it is the
// baseline source; the Teamwork Graph adapter layers code-level links on top.
//
// `request(path, init)` is injected: in Forge it wraps api.asUser().requestJira,
// in tests it is a fake. It must resolve to { ok, status, json() }.

const ISSUE_FIELDS = [
  'summary', 'components', 'labels', 'assignee', 'priority', 'status',
  'issuetype', 'parent', 'issuelinks', 'project', 'duedate', 'created',
];

export const jqlString = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

const person = (u) => (u ? { accountId: u.accountId, displayName: u.displayName, avatarUrl: u.avatarUrls?.['48x48'] } : null);

export function toIssue(raw) {
  const f = raw.fields ?? {};
  return {
    id: raw.id,
    key: raw.key,
    summary: f.summary,
    issuetype: f.issuetype?.name,
    components: (f.components ?? []).map((c) => c.name),
    labels: f.labels ?? [],
    assignee: person(f.assignee),
    priority: f.priority?.name,
    statusCategory: f.status?.statusCategory?.key,
    status: f.status?.name,
    duedate: f.duedate ?? null,
    created: f.created,
    project: f.project ? { id: f.project.id, key: f.project.key } : null,
    parentKey: f.parent?.key ?? null,
  };
}

export function toLinks(raw) {
  return (raw.fields?.issuelinks ?? []).map((l) => {
    const other = l.outwardIssue ?? l.inwardIssue;
    // "This issue <relation> other": outward uses the outward phrase, inward the inward phrase.
    const relation = l.outwardIssue ? l.type?.outward : l.type?.inward;
    return {
      key: other.key,
      summary: other.fields?.summary,
      relation,
      statusCategory: other.fields?.status?.statusCategory?.key,
      assignee: null,
    };
  });
}

export class JiraSource {
  constructor(request) {
    this.request = request;
    this.warnings = [];
  }

  async get(path) {
    const res = await this.request(path);
    if (!res.ok) throw new Error(`Jira ${path} -> ${res.status}`);
    return res.json();
  }

  async search(jql, max = 50) {
    const res = await this.request('/rest/api/3/search/jql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ jql, fields: ISSUE_FIELDS, maxResults: max }),
    });
    if (!res.ok) throw new Error(`JQL failed (${res.status}): ${jql}`);
    const body = await res.json();
    return (body.issues ?? []).map(toIssue);
  }

  // A clause that references a component or label that doesn't exist makes the whole
  // JQL query fail, so each signal is queried separately and failures are tolerated.
  async searchTolerant(jqls, max) {
    const results = await Promise.allSettled(jqls.map((q) => this.search(q, max)));
    const byKey = new Map();
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') r.value.forEach((x) => byKey.set(x.key, x));
      else this.warnings.push(`skipped query: ${jqls[i]}`);
    });
    return [...byKey.values()];
  }

  async issue(key) {
    const raw = await this.get(`/rest/api/3/issue/${encodeURIComponent(key)}?fields=${ISSUE_FIELDS.join(',')}`);
    return { issue: toIssue(raw), links: toLinks(raw) };
  }

  async parentChain(issue, depth = 2) {
    const parents = [];
    let key = issue.parentKey;
    while (key && parents.length < depth) {
      const { issue: p } = await this.issue(key);
      parents.push(p);
      key = p.parentKey;
    }
    return parents;
  }

  async enrichLinks(links) {
    if (!links.length) return links;
    const found = await this.searchTolerant([`key in (${links.map((l) => jqlString(l.key)).join(',')})`], links.length);
    const byKey = new Map(found.map((i) => [i.key, i]));
    return links.map((l) => ({ ...l, assignee: byKey.get(l.key)?.assignee ?? null }));
  }

  async siblings(issue) {
    if (!issue.parentKey) return [];
    return this.searchTolerant([`parent = ${jqlString(issue.parentKey)} AND key != ${jqlString(issue.key)}`], 50);
  }

  async incidentTypes() {
    const types = await this.get('/rest/api/3/issuetype');
    return [...new Set(types.filter((t) => /incident/i.test(t.name)).map((t) => t.name))];
  }

  async incidents(issue, { extraIds = [] } = {}) {
    const types = await this.incidentTypes();
    if (!types.length) {
      this.warnings.push('no incident issue type found on this site (is JSM installed?)');
      return [];
    }
    const typeClause = `issuetype in (${types.map(jqlString).join(',')}) AND created >= -365d`;
    const jqls = [];
    for (const c of issue.components) {
      jqls.push(`${typeClause} AND component = ${jqlString(c)}`);
      jqls.push(`${typeClause} AND summary ~ ${jqlString(c)}`);
    }
    if (issue.labels.length) jqls.push(`${typeClause} AND labels in (${issue.labels.map(jqlString).join(',')})`);
    if (extraIds.length) jqls.push(`id in (${extraIds.join(',')})`);
    if (!jqls.length) return [];
    return this.searchTolerant(jqls.map((q) => `${q} ORDER BY created DESC`), 30);
  }

  async componentLeads(issue) {
    if (!issue.project || !issue.components.length) return [];
    const comps = await this.get(`/rest/api/3/project/${encodeURIComponent(issue.project.key)}/components`);
    return comps
      .filter((c) => issue.components.includes(c.name) && c.lead)
      .map((c) => ({ name: c.name, lead: person(c.lead) }));
  }

  async addComment(key, adfBody) {
    const res = await this.request(`/rest/api/3/issue/${encodeURIComponent(key)}/comment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ body: adfBody }),
    });
    if (!res.ok) throw new Error(`comment failed (${res.status})`);
    return res.json();
  }
}
