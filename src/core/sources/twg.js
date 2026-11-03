// Teamwork Graph adapter: walks work item -> PRs -> repositories -> services ->
// incidents, plus linked deployments. Apps may only run persisted Cypher, so the
// query texts below are registered once (scripts/register-queries.mjs) and executed
// by key. Any failure degrades to the Jira-only analysis with a warning.
//
// `requestGraph(query, variables)` is injected (Forge: asUser().requestTeamworkGraph).

import QUERY_KEYS from '../queryKeys.js';

export const issueAri = (cloudId, issueId) => `ari:cloud:jira:${cloudId}:issue/${issueId}`;

// Pull the numeric Jira issue id out of an issue ARI; null for non-Jira nodes.
export const issueIdFromAri = (ari) => /:issue\/(\d+)$/.exec(ari ?? '')?.[1] ?? null;

export const CODE_CYPHER = `
MATCH (wi:JiraWorkItem {ari: $ari})
OPTIONAL MATCH (wi)-[:jira_work_item_links_external_pull_request]->(pr:ExternalPullRequest)
OPTIONAL MATCH (repo:ExternalRepository)-[:external_repository_has_external_pull_request]->(pr)
OPTIONAL MATCH (svc:ExternalService)-[:external_service_links_external_repository]->(repo)
OPTIONAL MATCH (wi)-[:jira_work_item_links_external_deployment]->(dep:ExternalDeployment)
OPTIONAL MATCH (rev:AtlassianUser)-[:atlassian_user_reviewed_pull_requests]->(pr)
RETURN collect(distinct pr) as prs,
       collect(distinct svc) as services, collect(distinct dep) as deployments,
       collect(distinct rev) as reviewers`;

export const INCIDENT_CYPHER = `
MATCH (inc)-[:jsm_incident_links_external_service]->(svc:ExternalService)
WHERE svc.ari IN $serviceAris
RETURN collect(distinct inc) as incidents`;

const NODE_FIELDS = `
  id
  data {
    __typename
    ... on ExternalPullRequest { displayName url status }
    ... on ExternalRepository { name url }
    ... on ExternalService { name description }
    ... on ExternalDeployment { displayName url state }
    ... on AtlassianUser { accountId name }
  }`;

// Registered by scripts/register-queries.mjs; keys land in src/core/queryKeys.js.
export const QUERIES = {
  code: { cypher: CODE_CYPHER, params: [{ name: 'ari', type: 'ARI', required: true }] },
  incidents: { cypher: INCIDENT_CYPHER, params: [{ name: 'serviceAris', type: 'JSON', required: true }] },
};

export const GRAPHQL = `
query blastRadius_customQuery($queryKey: String!, $queryParams: CypherRequestParams) {
  customQuery(queryKey: $queryKey, queryParams: $queryParams, first: 25) {
    edges { node { columns { key value {
      __typename
      ... on CypherQueryResultListNode { nodes { ${NODE_FIELDS} } }
      ... on CypherQueryResultNode { ${NODE_FIELDS} }
    } } } }
  }
}`;

/** Flatten a customQuery/cypherQuery response into { columnKey: [node, ...] }. */
export function columnsOf(json) {
  if (json?.errors?.length) throw new Error(`TWG: ${json.errors.map((e) => e.message).join('; ')}`);
  const out = {};
  const conn = json?.data?.customQuery ?? json?.data?.cypherQuery;
  // A query key that hasn't propagated yet comes back as a null connection with no errors.
  if (!conn) throw new Error('TWG: empty response (query key not active yet?)');
  for (const edge of conn?.edges ?? []) {
    for (const col of edge.node?.columns ?? []) {
      const v = col.value ?? {};
      const nodes = v.nodes ?? (v.id ? [v] : []);
      out[col.key] = [...(out[col.key] ?? []), ...nodes];
    }
  }
  return out;
}

const shape = {
  pr: (n) => ({ id: n.id, name: n.data?.displayName, url: n.data?.url, status: n.data?.status }),
  repo: (n) => ({ id: n.id, name: n.data?.name ?? n.data?.displayName, url: n.data?.url }),
  service: (n) => ({ id: n.id, name: n.data?.name, description: n.data?.description }),
  deployment: (n) => ({ id: n.id, name: n.data?.displayName, url: n.data?.url, state: n.data?.state }),
  user: (n) => ({ accountId: n.data?.accountId, displayName: n.data?.name }),
};

export async function graphContext(requestGraph, { cloudId, issueId }, keys = QUERY_KEYS) {
  const run = async (name, queryParams) => {
    if (!keys[name]) throw new Error(`persisted query "${name}" not registered (run npm run register-queries)`);
    return columnsOf(await requestGraph(GRAPHQL, { queryKey: keys[name], queryParams }));
  };

  const code = await run('code', { ari: issueAri(cloudId, issueId) });
  const services = (code.services ?? []).map(shape.service);

  let incidentIssueIds = [];
  const linkedVia = {};
  if (services.length) {
    const inc = await run('incidents', { serviceAris: services.map((s) => s.id) });
    for (const n of inc.incidents ?? []) {
      const id = issueIdFromAri(n.id);
      if (id) {
        incidentIssueIds.push(id);
        linkedVia[id] = 'linked service (Teamwork Graph)';
      }
    }
  }

  return {
    prs: (code.prs ?? []).map(shape.pr),
    repos: (code.repos ?? []).map(shape.repo),
    services,
    deployments: (code.deployments ?? []).map(shape.deployment),
    prReviewers: (code.reviewers ?? []).map(shape.user).filter((u) => u.accountId),
    incidentIssueIds,
    linkedVia,
  };
}
