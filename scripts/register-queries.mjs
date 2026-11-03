// Register the app's Teamwork Graph Cypher as persisted queries and write the
// returned keys to src/core/queryKeys.js. Re-running is safe: identical Cypher
// returns the original key. New keys take ~1 minute to become executable.
//
//   JIRA_SITE=https://<site>.atlassian.net JIRA_EMAIL=<you> JIRA_API_TOKEN=<token> npm run register-queries
//
// You must be a contributor on the app. Redeploy afterwards (forge deploy).

//
// The gateway may reject API-token auth (401). Then use the browser instead:
//   npm run register-queries -- --console    prints a snippet to paste into the devtools
//                                            console of a signed-in Jira tab
//   npm run register-queries -- --keys code=<key> incidents=<key>   writes the keys it printed

import { readFileSync, writeFileSync } from 'node:fs';
import { QUERIES } from '../src/core/sources/twg.js';

const appId = /^\s+id:\s*(ari:cloud:ecosystem::app\/[\w-]+)/m.exec(readFileSync('manifest.yml', 'utf8'))?.[1];
if (!appId || appId.endsWith('00000000-0000-0000-0000-000000000000')) {
  console.error('manifest.yml has no registered app id; run forge register first.');
  process.exit(1);
}

const writeKeys = (keys) => {
  writeFileSync('src/core/queryKeys.js',
    `// Written by scripts/register-queries.mjs: persisted Teamwork Graph query keys.\nexport default ${JSON.stringify(keys, null, 2)};\n`);
  console.log('\nWrote src/core/queryKeys.js. Wait ~1 minute, then forge deploy.');
};

const payloads = Object.entries(QUERIES).map(([name, q]) =>
  [name, { appId, name: `blast-radius-${name}`, cypher: q.cypher.trim(), paramsSchema: q.params }]);

const args = process.argv.slice(2);
if (args[0] === '--console') {
  console.log(`(async () => {
  const payloads = ${JSON.stringify(Object.fromEntries(payloads))};
  const keys = {};
  for (const [name, body] of Object.entries(payloads)) {
    const r = await fetch('/gateway/api/twg/cypher-queries', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const t = await r.text();
    console.log(name, r.status, t);
    if (r.ok) keys[name] = JSON.parse(t).queryKey;
  }
  console.log('npm run register-queries -- --keys ' + Object.entries(keys).map(([k, v]) => k + '=' + v).join(' '));
})();`);
  process.exit(0);
}
if (args[0] === '--keys') {
  writeKeys(Object.fromEntries(args.slice(1).map((a) => a.split('='))));
  process.exit(0);
}

const { JIRA_SITE, JIRA_EMAIL, JIRA_API_TOKEN } = process.env;
if (!JIRA_SITE || !JIRA_EMAIL || !JIRA_API_TOKEN) {
  console.error('Set JIRA_SITE, JIRA_EMAIL and JIRA_API_TOKEN (or use --console).');
  process.exit(1);
}

const auth = `Basic ${Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString('base64')}`;
const keys = {};

for (const [name, payload] of payloads) {
  const res = await fetch(`${JIRA_SITE.replace(/\/$/, '')}/gateway/api/twg/cypher-queries`, {
    method: 'POST',
    headers: { Authorization: auth, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`✗ ${name}: ${res.status} ${text}`);
    if (res.status === 401) console.error('Token auth rejected; use --console instead (see top of this file).');
    process.exit(1);
  }
  const body = JSON.parse(text);
  keys[name] = body.queryKey;
  console.log(`✓ ${name}: ${body.queryKey} (v${body.version}, ${body.status})`);
}

writeKeys(keys);
