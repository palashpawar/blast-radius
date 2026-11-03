// Assemble the analysis bundle for one issue from Jira, plus the Teamwork Graph when
// it is reachable. Kept separate from analyze.js so the scoring stays pure.

import { JiraSource } from './sources/jira.js';
import { graphContext } from './sources/twg.js';

export async function gatherBundle({ requestJira, requestGraph, cloudId, issueKey }) {
  const jira = new JiraSource(requestJira);
  const { issue, links } = await jira.issue(issueKey);

  let graph = null;
  const warnings = [];
  if (requestGraph && cloudId) {
    try {
      graph = await graphContext(requestGraph, { cloudId, issueId: issue.id });
    } catch (e) {
      warnings.push(`Teamwork Graph unavailable, using Jira only: ${e.message}`);
    }
  }

  const [parents, enrichedLinks, siblings, incidents, componentLeads] = await Promise.all([
    jira.parentChain(issue),
    jira.enrichLinks(links),
    jira.siblings(issue),
    jira.incidents(issue, { extraIds: graph?.incidentIssueIds ?? [] }),
    jira.componentLeads(issue).catch((e) => {
      warnings.push(`component leads: ${e.message}`);
      return [];
    }),
  ]);

  return {
    source: graph ? 'teamwork-graph' : 'jira',
    issue,
    parents,
    links: enrichedLinks,
    siblings,
    incidents: incidents
      .filter((i) => i.key !== issue.key)
      .map((i) => ({ ...i, linkedVia: graph?.linkedVia?.[i.id] })),
    componentLeads,
    prs: graph?.prs ?? [],
    repos: graph?.repos ?? [],
    services: graph?.services ?? [],
    deployments: graph?.deployments ?? [],
    prReviewers: graph?.prReviewers ?? [],
    warnings: [...warnings, ...jira.warnings],
  };
}
