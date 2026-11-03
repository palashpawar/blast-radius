// Pure blast-radius analysis. Takes a context bundle gathered from Jira and/or the
// Teamwork Graph and returns a scored, explained report. No I/O here, so it is
// fully unit-tested against fixtures.

const DAY_MS = 86_400_000;

// Incidents fade from relevance with a ~4 month half-life-ish decay.
const RECENCY_DAYS = 120;

const SEVERITY_WEIGHT = {
  critical: 1.0,
  high: 0.6,
  medium: 0.3,
  low: 0.15,
};

const LEVELS = [
  { max: 25, level: 'low' },
  { max: 50, level: 'medium' },
  { max: 75, level: 'high' },
  { max: Infinity, level: 'critical' },
];

// Link types (by outward/inward description) that mean "other work depends on this".
const DEPENDENT_LINK = /\b(blocks|is depended on by|is required by|is a dependency of)\b/i;

const norm = (s) => String(s ?? '').trim().toLowerCase();

export function severityOf(priorityName) {
  const p = norm(priorityName);
  if (/^(p1|sev ?1|highest|critical|blocker)/.test(p)) return 'critical';
  if (/^(p2|sev ?2|high|major)/.test(p)) return 'high';
  if (/^(p3|sev ?3|medium)/.test(p)) return 'medium';
  return 'low';
}

const isOpen = (statusCategory) => norm(statusCategory) !== 'done';

/**
 * The "surface" of a change: the set of things a failure would propagate through.
 * Components and labels come from Jira; services and repositories from the graph.
 */
export function surfaceOf(bundle) {
  const { issue, services = [], repos = [] } = bundle;
  return {
    components: [...new Set((issue.components ?? []).map(norm))].filter(Boolean),
    labels: [...new Set((issue.labels ?? []).map(norm))].filter(Boolean),
    services: [...new Set(services.map((s) => norm(s.name)))].filter(Boolean),
    repos: [...new Set(repos.map((r) => norm(r.name)))].filter(Boolean),
  };
}

function overlapWith(surface, item) {
  const hits = [];
  for (const c of item.components ?? []) if (surface.components.includes(norm(c))) hits.push(`component ${c}`);
  for (const l of item.labels ?? []) if (surface.labels.includes(norm(l))) hits.push(`label ${l}`);
  for (const s of item.services ?? []) if (surface.services.includes(norm(s))) hits.push(`service ${s}`);
  return hits;
}

export function rankIncidents(bundle, now) {
  const surface = surfaceOf(bundle);
  const ranked = [];
  for (const inc of bundle.incidents ?? []) {
    // Graph-linked incidents (via a service the change touches) carry their own match reason.
    const matches = inc.linkedVia ? [inc.linkedVia, ...overlapWith(surface, inc)] : overlapWith(surface, inc);
    if (matches.length === 0) continue;
    const severity = severityOf(inc.priority);
    const ageDays = Math.max(0, (now - Date.parse(inc.created)) / DAY_MS);
    const recency = Math.exp(-ageDays / RECENCY_DAYS);
    const breadth = Math.min(1, 0.5 + 0.25 * matches.length);
    const relevance = SEVERITY_WEIGHT[severity] * recency * breadth;
    ranked.push({
      key: inc.key,
      summary: inc.summary,
      created: inc.created,
      ageDays: Math.round(ageDays),
      severity,
      open: isOpen(inc.statusCategory),
      assignee: inc.assignee ?? null,
      matches: [...new Set(matches)],
      relevance: Math.round(relevance * 1000) / 1000,
    });
  }
  return ranked.sort((a, b) => b.relevance - a.relevance);
}

export function dependentsOf(bundle) {
  return (bundle.links ?? [])
    .filter((l) => DEPENDENT_LINK.test(l.relation))
    .map((l) => ({ ...l, open: isOpen(l.statusCategory) }));
}

export function concurrentWork(bundle) {
  const surface = surfaceOf(bundle);
  return (bundle.siblings ?? [])
    .filter((s) => s.key !== bundle.issue.key && norm(s.statusCategory) === 'indeterminate')
    .map((s) => ({ ...s, matches: overlapWith(surface, s) }))
    .filter((s) => s.matches.length > 0);
}

export function atRiskParents(bundle, now) {
  return (bundle.parents ?? []).map((p) => {
    const dueInDays = p.duedate ? Math.round((Date.parse(p.duedate) - now) / DAY_MS) : null;
    const reasons = [];
    if (dueInDays !== null && dueInDays >= 0 && dueInDays <= 21) reasons.push(`due in ${dueInDays}d`);
    if (dueInDays !== null && dueInDays < 0 && isOpen(p.statusCategory)) reasons.push(`overdue by ${-dueInDays}d`);
    if (['critical', 'high'].includes(severityOf(p.priority))) reasons.push(`${p.priority} priority`);
    return { ...p, dueInDays, reasons };
  });
}

function addPerson(map, person, reason, weight) {
  if (!person?.accountId) return;
  const cur = map.get(person.accountId) ?? { ...person, reasons: [], weight: 0 };
  if (!cur.reasons.includes(reason)) cur.reasons.push(reason);
  cur.weight += weight;
  map.set(person.accountId, cur);
}

export function peopleToNotify(bundle, { incidents, dependents, concurrent, parents }) {
  const people = new Map();
  const self = new Set([bundle.issue.assignee?.accountId].filter(Boolean));

  for (const c of bundle.componentLeads ?? []) addPerson(people, c.lead, `lead of component ${c.name}`, 3);
  for (const inc of incidents.slice(0, 5)) addPerson(people, inc.assignee, `responded to ${inc.key}`, 2 + inc.relevance);
  for (const d of dependents.filter((d) => d.open)) addPerson(people, d.assignee, `owns dependent ${d.key}`, 2);
  for (const s of concurrent) addPerson(people, s.assignee, `changing the same surface in ${s.key}`, 1.5);
  for (const p of parents) addPerson(people, p.assignee, `owns ${p.issuetype ?? 'parent'} ${p.key}`, p.reasons.length ? 2 : 1);
  for (const r of bundle.prReviewers ?? []) addPerson(people, r, 'reviewed linked PRs', 1);

  return [...people.values()]
    .filter((p) => !self.has(p.accountId))
    .sort((a, b) => b.weight - a.weight)
    .map(({ weight, ...p }) => ({ ...p, weight: Math.round(weight * 100) / 100 }));
}

/**
 * Score is the sum of capped factor contributions. Each factor carries its own
 * explanation so the UI and the agent can show *why*, not just a number.
 */
export function scoreFactors({ surface, incidents, dependents, concurrent, parents, bundle }) {
  const factors = [];
  const push = (id, label, points, detail) => {
    if (points > 0) factors.push({ id, label, points: Math.round(points), detail });
  };

  const incidentMass = incidents.reduce((s, i) => s + i.relevance, 0);
  push('incidents', 'Incident history on this surface', Math.min(40, 30 * incidentMass),
    incidents.length ? `${incidents.length} related incident(s); strongest ${incidents[0].key} (${incidents[0].severity}, ${incidents[0].ageDays}d ago)` : '');

  const openIncidents = incidents.filter((i) => i.open);
  push('open-incidents', 'Open incident on the same surface', Math.min(20, 15 * openIncidents.length),
    openIncidents.map((i) => i.key).join(', '));

  const openDeps = dependents.filter((d) => d.open);
  push('dependents', 'Work that depends on this', Math.min(15, 5 * openDeps.length),
    openDeps.map((d) => `${d.key} (${d.relation})`).join(', '));

  const riskyParents = parents.filter((p) => p.reasons.length);
  push('parents', 'Parent epic at risk', Math.min(15, riskyParents.reduce((s, p) => s + 5 * p.reasons.length, 0)),
    riskyParents.map((p) => `${p.key}: ${p.reasons.join(', ')}`).join('; '));

  push('concurrent', 'Concurrent changes to the same surface', Math.min(10, 4 * concurrent.length),
    concurrent.map((c) => c.key).join(', '));

  const breadth = surface.components.length + surface.services.length + surface.repos.length;
  push('breadth', 'Surface breadth', Math.min(15, 3 * Math.max(0, breadth - 1)),
    `${surface.services.length} service(s), ${surface.components.length} component(s), ${surface.repos.length} repo(s)`);

  const deploys = bundle.deployments ?? [];
  const failedDeploys = deploys.filter((d) => /fail|rolled ?back/i.test(d.state ?? ''));
  push('deploys', 'Recent failed deployments', Math.min(10, 5 * failedDeploys.length),
    failedDeploys.map((d) => `${d.name ?? d.id} (${d.state})`).join(', '));

  return factors.sort((a, b) => b.points - a.points);
}

export function levelOf(score) {
  return LEVELS.find((l) => score < l.max).level;
}

export function analyze(bundle, now = Date.now()) {
  const surface = surfaceOf(bundle);
  const incidents = rankIncidents(bundle, now);
  const dependents = dependentsOf(bundle);
  const concurrent = concurrentWork(bundle);
  const parents = atRiskParents(bundle, now);
  const factors = scoreFactors({ surface, incidents, dependents, concurrent, parents, bundle });
  const score = Math.min(100, factors.reduce((s, f) => s + f.points, 0));
  const level = levelOf(score);
  const notify = peopleToNotify(bundle, { incidents, dependents, concurrent, parents });

  return {
    issueKey: bundle.issue.key,
    summary: bundle.issue.summary,
    source: bundle.source,
    score,
    level,
    headline: headlineOf(level, score, factors),
    factors,
    surface,
    incidents,
    dependents,
    concurrent,
    parents,
    notify,
    code: {
      pullRequests: bundle.prs ?? [],
      repositories: bundle.repos ?? [],
      deployments: bundle.deployments ?? [],
    },
    warnings: bundle.warnings ?? [],
  };
}

function headlineOf(level, score, factors) {
  if (!factors.length) return `Low blast radius (${score}/100): nothing related has broken before and nothing depends on this.`;
  const top = factors[0];
  return `${level[0].toUpperCase()}${level.slice(1)} blast radius (${score}/100). Biggest driver: ${top.label.toLowerCase()}${top.detail ? ` — ${top.detail}` : ''}.`;
}
