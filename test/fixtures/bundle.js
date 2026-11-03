// A checkout-service change with real history: two past incidents (one still open),
// a dependent ticket, a sibling touching the same component, and an epic due soon.
export const NOW = Date.parse('2026-11-02T12:00:00Z');
const daysAgo = (d) => new Date(NOW - d * 86_400_000).toISOString();
const daysAhead = (d) => new Date(NOW + d * 86_400_000).toISOString().slice(0, 10);

export const alice = { accountId: 'a-1', displayName: 'Alice Lead' };
export const bob = { accountId: 'b-2', displayName: 'Bob Responder' };
export const cara = { accountId: 'c-3', displayName: 'Cara Downstream' };
export const dev = { accountId: 'd-4', displayName: 'Dev Author' };
export const eve = { accountId: 'e-5', displayName: 'Eve EpicOwner' };

export const bundle = () => ({
  source: 'jira',
  issue: {
    id: '10042', key: 'PAY-142', summary: 'Retry payment authorization on gateway timeout',
    components: ['Checkout', 'Payments Gateway'], labels: ['payments'], assignee: dev,
    priority: 'High', statusCategory: 'indeterminate', project: { id: '1', key: 'PAY' }, parentKey: 'PAY-100',
  },
  parents: [{ key: 'PAY-100', summary: 'Black Friday readiness', issuetype: 'Epic', priority: 'Highest', duedate: daysAhead(10), statusCategory: 'indeterminate', assignee: eve }],
  links: [
    { key: 'OPS-7', summary: 'Enable retries in prod config', relation: 'blocks', statusCategory: 'new', assignee: cara },
    { key: 'PAY-90', summary: 'Old spike', relation: 'relates to', statusCategory: 'done', assignee: null },
  ],
  siblings: [
    { key: 'PAY-150', summary: 'Refactor gateway client', statusCategory: 'indeterminate', components: ['Payments Gateway'], labels: [], assignee: cara },
    { key: 'PAY-151', summary: 'Copy tweaks', statusCategory: 'indeterminate', components: ['Marketing'], labels: [], assignee: alice },
  ],
  incidents: [
    { key: 'INC-88', summary: 'Double charges after gateway timeout', created: daysAgo(40), priority: 'P1', statusCategory: 'done', assignee: bob, components: ['Payments Gateway'], labels: ['payments'] },
    { key: 'INC-203', summary: 'Checkout latency spike', created: daysAgo(5), priority: 'P2', statusCategory: 'indeterminate', assignee: bob, components: ['Checkout'], labels: [] },
    { key: 'INC-12', summary: 'Search outage', created: daysAgo(30), priority: 'P1', statusCategory: 'done', assignee: alice, components: ['Search'], labels: [] },
  ],
  componentLeads: [{ name: 'Checkout', lead: alice }],
  prs: [], repos: [], services: [], deployments: [], prReviewers: [], warnings: [],
});
