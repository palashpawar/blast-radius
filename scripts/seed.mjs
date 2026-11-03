// Seed a Jira + JSM test site with the Blast Radius demo story.
//
// Prereqs (do these in the Jira UI first):
//   1. A company-managed software project with key PAY.
//   2. A Jira Service Management project with key INC (IT service management template,
//      which provides the "[System] Incident" work type).
//
// Run with your own site credentials in the environment (never commit them):
//   JIRA_SITE=https://your-site.atlassian.net JIRA_EMAIL=you@example.com JIRA_API_TOKEN=... npm run seed

const { JIRA_SITE, JIRA_EMAIL, JIRA_API_TOKEN } = process.env;
if (!JIRA_SITE || !JIRA_EMAIL || !JIRA_API_TOKEN) {
  console.error('Set JIRA_SITE, JIRA_EMAIL and JIRA_API_TOKEN.');
  process.exit(1);
}

const auth = `Basic ${Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString('base64')}`;

async function jira(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${JIRA_SITE}${path}`, {
    method,
    headers: { Authorization: auth, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

const adf = (t) => ({ type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] });
const daysAhead = (d) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);

async function typeId(projectKey, pattern) {
  const { issueTypes } = await jira(`/rest/api/3/issue/createmeta/${projectKey}/issuetypes`);
  const t = issueTypes.find((x) => pattern.test(x.name));
  if (!t) throw new Error(`${projectKey} has no work type matching ${pattern}`);
  return t.id;
}

async function ensureComponents(projectKey, names) {
  const existing = await jira(`/rest/api/3/project/${projectKey}/components`);
  const me = await jira('/rest/api/3/myself');
  for (const name of names) {
    if (existing.some((c) => c.name === name)) continue;
    await jira('/rest/api/3/component', {
      method: 'POST',
      body: { project: projectKey, name, ...(name === 'Checkout' ? { leadAccountId: me.accountId } : {}) },
    });
  }
}

async function create(fields) {
  const { key } = await jira('/rest/api/3/issue', { method: 'POST', body: { fields } });
  console.log(`  created ${key}  ${fields.summary}`);
  return key;
}

async function moveTo(key, category) {
  const { transitions } = await jira(`/rest/api/3/issue/${key}/transitions`);
  const t = transitions.find((x) => x.to?.statusCategory?.key === category);
  if (t) await jira(`/rest/api/3/issue/${key}/transitions`, { method: 'POST', body: { transition: { id: t.id } } });
}

// "fromKey <type.outward> toKey", e.g. link('Blocks', A, B) => A blocks B. Jira's
// issueLink body is counter-intuitive: the issue that reads with the outward phrase
// goes in inwardIssue.
async function link(type, fromKey, toKey) {
  await jira('/rest/api/3/issueLink', { method: 'POST', body: { type: { name: type }, inwardIssue: { key: fromKey }, outwardIssue: { key: toKey } } });
}

const COMPONENTS = ['Checkout', 'Payments Gateway', 'Search', 'Docs'];
const comps = (...names) => names.map((name) => ({ name }));

console.log('Components…');
await ensureComponents('PAY', COMPONENTS);
await ensureComponents('INC', COMPONENTS);

const [epicT, taskT, incT] = await Promise.all([typeId('PAY', /^epic$/i), typeId('PAY', /^(task|story)$/i), typeId('INC', /incident/i)]);
const PAY = { key: 'PAY' };

console.log('Work items…');
const epic = await create({ project: PAY, issuetype: { id: epicT }, summary: 'Black Friday readiness', priority: { name: 'Highest' }, duedate: daysAhead(10) });
const demo = await create({
  project: PAY, issuetype: { id: taskT }, parent: { key: epic },
  summary: 'Retry payment authorization on gateway timeout',
  description: adf('When the payments gateway times out, retry authorization up to 3 times with backoff.'),
  components: comps('Checkout', 'Payments Gateway'), labels: ['payments'], priority: { name: 'High' },
});
const sibling = await create({ project: PAY, issuetype: { id: taskT }, parent: { key: epic }, summary: 'Refactor payments gateway client', components: comps('Payments Gateway') });
const dependent = await create({ project: PAY, issuetype: { id: taskT }, summary: 'Enable payment retries in prod config', components: comps('Checkout') });
const quiet = await create({ project: PAY, issuetype: { id: taskT }, summary: 'Fix typo in API docs', components: comps('Docs') });

console.log('Incidents…');
const inc1 = await create({ project: { key: 'INC' }, issuetype: { id: incT }, summary: 'Double charges after payments gateway timeout', priority: { name: 'Highest' }, components: comps('Payments Gateway'), labels: ['payments'] });
const inc2 = await create({ project: { key: 'INC' }, issuetype: { id: incT }, summary: 'Checkout latency spike during peak', priority: { name: 'High' }, components: comps('Checkout') });
const inc3 = await create({ project: { key: 'INC' }, issuetype: { id: incT }, summary: 'Search results empty for 20 minutes', priority: { name: 'Highest' }, components: comps('Search') });

console.log('Statuses and links…');
await moveTo(epic, 'indeterminate');
await moveTo(demo, 'indeterminate');
await moveTo(sibling, 'indeterminate');
await moveTo(inc1, 'done');
await moveTo(inc3, 'done');
await link('Blocks', demo, dependent);

console.log(`\nDone. Open ${JIRA_SITE}/browse/${demo} for the high-risk demo, ${JIRA_SITE}/browse/${quiet} for the low-risk contrast.`);
console.log(`Still open on purpose: ${inc2}.`);
