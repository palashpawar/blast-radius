// Open a visible Chromium on the Jira site with a persistent profile so you can sign
// in once; the recorder reuses the session. Closes itself once PAY-2 has loaded.
//
//   NODE_PATH=<dir with playwright> node demo/login.mjs

import { chromium } from 'playwright';

const root = new URL('..', import.meta.url).pathname;
const SITE = 'https://utexas-team-ren3ydwk.atlassian.net';

const ctx = await chromium.launchPersistentContext(`${root}demo/.profile`, {
  headless: false,
  viewport: { width: 1280, height: 720 },
});
const page = ctx.pages()[0] ?? (await ctx.newPage());
await page.goto(`${SITE}/browse/PAY-2`);
console.log('Sign in in the Chromium window. Waiting up to 10 minutes for PAY-2 to load…');
await page.waitForSelector('text=Retry payment authorization on gateway timeout', { timeout: 600_000 });
console.log('Signed in. Session saved.');
await page.waitForTimeout(2000);
await ctx.close();
