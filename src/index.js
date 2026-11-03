import { asUser, assumeTrustedRoute } from '@forge/api';
import ResolverModule from '@forge/resolver';
import { analyze } from './core/analyze.js';
import { gatherBundle } from './core/gather.js';
import { forAgent, toAdf } from './core/report.js';
import { JiraSource } from './core/sources/jira.js';

const ISSUE_KEY = /^[A-Z][A-Z0-9_]+-\d+$/;

// The sources encode every path segment they interpolate, so the built paths are
// safe to hand to assumeTrustedRoute (route`` only accepts literal templates).
const jiraRequester = () => (path, init) => asUser().requestJira(assumeTrustedRoute(path), init);

const graphRequester = () => async (query, variables) =>
  (await asUser().requestTeamworkGraph(query, variables)).json();

// @forge/resolver is CommonJS; under "type": "module" the bundler hands back the
// namespace object, so unwrap the class from its default export.
const Resolver = ResolverModule.default ?? ResolverModule;

async function runAnalysis(issueKey, cloudId) {
  if (!ISSUE_KEY.test(issueKey ?? '')) throw new Error(`"${issueKey}" is not a Jira issue key`);
  const bundle = await gatherBundle({
    requestJira: jiraRequester(),
    requestGraph: graphRequester(),
    cloudId,
    issueKey,
  });
  return analyze(bundle);
}

// Rovo passes inputs at the top level and, inside Jira, the viewed issue under payload.context.
const keyFrom = (payload) => (payload?.issueKey ?? payload?.context?.jira?.issueKey ?? '').trim().toUpperCase();
const cloudFrom = (payload, context) => payload?.context?.cloudId ?? context?.cloudId;

const resolver = new Resolver();

resolver.define('analyze', async ({ payload, context }) => {
  const issueKey = payload.issueKey ?? context.extension?.issue?.key;
  return runAnalysis(issueKey, context.cloudId);
});

resolver.define('postComment', async ({ payload, context }) => {
  const issueKey = payload.issueKey ?? context.extension?.issue?.key;
  const result = await runAnalysis(issueKey, context.cloudId);
  await new JiraSource(jiraRequester()).addComment(issueKey, toAdf(result));
  return { posted: true, issueKey };
});

export const resolverHandler = resolver.getDefinitions();
export { resolverHandler as resolver };

export async function analyzeAction(payload, context) {
  return forAgent(await runAnalysis(keyFrom(payload), cloudFrom(payload, context)));
}

export async function incidentsAction(payload, context) {
  const r = forAgent(await runAnalysis(keyFrom(payload), cloudFrom(payload, context)));
  return { issueKey: r.issueKey, touches: r.touches, incidents: r.incidents, warnings: r.warnings };
}

export async function notifyAction(payload, context) {
  const r = forAgent(await runAnalysis(keyFrom(payload), cloudFrom(payload, context)));
  return { issueKey: r.issueKey, level: r.level, notify: r.notify };
}

export async function commentAction(payload, context) {
  const issueKey = keyFrom(payload);
  const result = await runAnalysis(issueKey, cloudFrom(payload, context));
  await new JiraSource(jiraRequester()).addComment(issueKey, toAdf(result));
  return { posted: true, issueKey, level: result.level, score: result.score };
}
