// Record the Jira scenes as separate 1920x1080 clips, paced to the narration.
// Needs a signed-in profile (demo/login.mjs) and demo/out/audio/durations.json.
//
//   node demo/record.mjs [scene-id ...] [--post]
//
// --post really clicks "Post as comment" in scene 03 (adds a comment to PAY-2).

import { chromium } from 'playwright';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname;
const SITE = 'https://utexas-team-ren3ydwk.atlassian.net';
const OUT = `${root}demo/out/video`;
const RAW = `${OUT}/raw`;
mkdirSync(RAW, { recursive: true });

const args = process.argv.slice(2);
const post = args.includes('--post');
const only = args.filter((a) => !a.startsWith('--'));
const durations = JSON.parse(readFileSync(`${root}demo/out/audio/durations.json`, 'utf8'));
// A 1280x720 page fits a laptop screen in a visible window; 1.5x density records 1080p.
const W = 1280, H = 720, SCALE = 1.5;

// A visible cursor: Playwright videos don't draw the pointer.
const CURSOR = () => {
  const install = () => {
    if (document.getElementById('__demo_cursor')) return;
    const c = document.createElement('div');
    c.id = '__demo_cursor';
    Object.assign(c.style, {
      position: 'fixed', zIndex: 2147483647, width: '22px', height: '22px', borderRadius: '50%',
      background: 'rgba(255,86,48,0.85)', border: '3px solid white', boxShadow: '0 2px 8px rgba(0,0,0,.35)',
      pointerEvents: 'none', transform: 'translate(-50%,-50%)', left: '-50px', top: '-50px', transition: 'transform .08s',
    });
    document.documentElement.appendChild(c);
    addEventListener('mousemove', (e) => { c.style.left = `${e.clientX}px`; c.style.top = `${e.clientY}px`; }, true);
    addEventListener('mousedown', () => { c.style.transform = 'translate(-50%,-50%) scale(.7)'; }, true);
    addEventListener('mouseup', () => { c.style.transform = 'translate(-50%,-50%)'; }, true);
  };
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', install); else install();
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function moveTo(page, locator, { click = false } = {}) {
  await locator.scrollIntoViewIfNeeded();
  const b = await locator.boundingBox();
  if (!b) throw new Error(`no box for ${locator}`);
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 25 });
  if (click) {
    await sleep(250);
    await page.mouse.down();
    await page.mouse.up();
  }
}

// Smoothly scroll so `locator` sits near the top of the viewport. Scrolls the element's
// own scroll container (Jira's main column), which mouse-wheel scrolling can miss.
async function glideTo(page, locator, offset = 120, ms = 1200) {
  await locator.evaluate((el, off) => {
    el.style.scrollMarginTop = `${off}px`;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, offset);
  await sleep(ms);
}

async function openIssue(page, key) {
  await page.goto(`${SITE}/browse/${key}`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { level: 1 }).first().waitFor({ timeout: 30_000 });
}

// The issue panel only shows once added from the Apps button; add it if missing.
async function ensurePanel(page) {
  const heading = page.getByText(/^(high|critical|medium|low) · \d+\/100$/).first();
  try {
    await heading.waitFor({ timeout: 12_000 });
  } catch {
    await page.getByTestId('issue-view-foundation.quick-add.quick-add-items-compact.apps-button-dropdown--trigger').click();
    await page.getByRole('menuitem', { name: 'Blast Radius' }).click();
    await heading.waitFor({ timeout: 30_000 });
  }
  return heading;
}

const scenes = {
  '02-panel': async (page, dur, mark) => {
    await openIssue(page, 'PAY-2');
    const badge = await ensurePanel(page);
    const t0 = mark();
    await sleep(1500);
    await glideTo(page, page.getByRole('heading', { name: /^Blast Radius/ }).first(), 90, 1500);
    await moveTo(page, badge);
    await sleep(4000);
    await moveTo(page, page.getByText('Why', { exact: true }).first());
    await sleep(3500);
    await moveTo(page, page.getByText('Incident history on this surface', { exact: false }).last());
    await sleep(3000);
    await glideTo(page, page.getByText('What broke here before', { exact: true }).first(), 110, 1200);
    await moveTo(page, page.getByText('INC-1', { exact: true }).first());
    await sleep(3500);
    await moveTo(page, page.getByText('INC-2', { exact: true }).first());
    await sleep(3000);
    await glideTo(page, page.getByText('What depends on it', { exact: true }).first(), 110, 1200);
    await moveTo(page, page.getByText('PAY-4', { exact: true }).last());
    await sleep(2500);
    await moveTo(page, page.getByText('PAY-3', { exact: true }).last());
    await sleep(2500);
    await moveTo(page, page.getByText('PAY-1', { exact: true }).last());
    await sleep(Math.max(1500, dur - (Date.now() - t0)));
  },

  '03-people': async (page, dur, mark) => {
    await openIssue(page, 'PAY-2');
    await ensurePanel(page);
    const t0 = mark();
    await glideTo(page, page.getByText('Loop in', { exact: true }).first(), 140, 1500);
    await moveTo(page, page.getByText(/^lead of component/).first());
    await sleep(4000);
    const button = page.getByRole('button', { name: /Post as comment|Posted to issue/ }).first();
    await moveTo(page, button);
    await sleep(2500);
    if (post) {
      await moveTo(page, button, { click: true });
      await page.getByRole('button', { name: 'Posted to issue' }).waitFor({ timeout: 60_000 });
      await sleep(1500);
    }
    // Show the posted report in the issue's activity (posted on an earlier run without --post).
    await glideTo(page, page.getByRole('heading', { name: 'Activity' }).first(), 120, 1500);
    const comment = page.getByText(/Blast radius: (HIGH|CRITICAL)/).first();
    await comment.waitFor({ timeout: 20_000 });
    await glideTo(page, comment, 160, 1500);
    await moveTo(page, comment);
    await sleep(Math.max(1500, dur - (Date.now() - t0)));
  },

  '04-contrast': async (page, dur, mark) => {
    await openIssue(page, 'PAY-5');
    const badge = await ensurePanel(page);
    const t0 = mark();
    await glideTo(page, page.getByRole('heading', { name: /^Blast Radius/ }).first(), 90, 1200);
    await moveTo(page, badge);
    await sleep(Math.max(1500, dur - (Date.now() - t0)));
  },

  '05-agent': async (page, dur, mark) => {
    await openIssue(page, 'PAY-2');
    const t0 = mark();
    await sleep(1200);
    // Chat (not the Agents menu, which starts an assignable-agent work session):
    // Ask Rovo -> Menu -> View all agents -> search -> Chat with Blast Radius.
    await moveTo(page, page.getByRole('button', { name: 'Ask Rovo' }).first(), { click: true });
    const menu = page.getByTestId('rovo-chat-header-menu-button');
    await menu.waitFor({ timeout: 20_000 });
    await sleep(800);
    await moveTo(page, menu, { click: true });
    const all = page.getByText('View all agents', { exact: true });
    await all.waitFor({ timeout: 15_000 });
    await moveTo(page, all, { click: true });
    const search = page.getByPlaceholder('Search agents').first();
    await search.waitFor({ timeout: 15_000 });
    await moveTo(page, search, { click: true });
    await page.keyboard.type('Blast', { delay: 80 });
    const pick = page.getByRole('button', { name: 'Chat with Blast Radius' }).first();
    await pick.waitFor({ timeout: 20_000 });
    await sleep(1200);
    await moveTo(page, pick, { click: true });
    const input = page.getByRole('textbox', { name: /Ask, @mention|Describe what you want/ }).last();
    await input.waitFor({ timeout: 20_000 });
    await moveTo(page, input, { click: true });
    await page.keyboard.type("What's the blast radius of PAY-2?", { delay: 45 });
    await sleep(500);
    await page.keyboard.press('Enter');
    await page.getByText(/De-risking step|de-risk/i).last().waitFor({ timeout: 90_000 });
    await sleep(1500);
    // Let the answer scroll through slowly.
    const remaining = Math.max(4000, dur - (Date.now() - t0));
    const panel = page.getByText(/What broke here before/i).last();
    await moveTo(page, panel);
    for (let i = 0; i < 6; i++) {
      await page.mouse.wheel(0, 110);
      await sleep(remaining / 7);
    }
    await sleep(remaining / 7);
  },
};

const wanted = Object.keys(scenes).filter((id) => !only.length || only.includes(id));
const ctx = await chromium.launchPersistentContext(`${root}demo/.profile`, {
  headless: false,
  viewport: { width: W, height: H },
  deviceScaleFactor: SCALE,
  recordVideo: { dir: RAW, size: { width: W * SCALE, height: H * SCALE } },
});
await ctx.addInitScript(CURSOR);
for (const p of ctx.pages()) await p.close().catch(() => {});

// Fail fast if the saved session has expired instead of recording login screens.
{
  const probe = await ctx.newPage();
  await probe.goto(`${SITE}/browse/PAY-2`, { waitUntil: 'domcontentloaded' });
  const ok = await probe.getByText('Retry payment authorization on gateway timeout').first()
    .waitFor({ timeout: 20_000 }).then(() => true, () => false);
  const v = probe.video();
  await probe.close();
  if (v) rmSync(await v.path(), { force: true });
  if (!ok) {
    console.error('Not signed in: run node demo/login.mjs and tick "Remember me".');
    await ctx.close();
    process.exit(1);
  }
}

// Seconds of page-loading at the start of each clip, trimmed off during assembly.
const leadsFile = `${OUT}/leads.json`;
const leads = existsSync(leadsFile) ? JSON.parse(readFileSync(leadsFile, 'utf8')) : {};

for (const id of wanted) {
  const page = await ctx.newPage();
  const opened = Date.now();
  const dur = (durations[id] ?? 10) * 1000;
  const mark = () => {
    leads[id] = Math.max(0, (Date.now() - opened) / 1000 - 0.3);
    return Date.now();
  };
  console.log(`▶ ${id} (${(dur / 1000).toFixed(1)}s narration)`);
  try {
    await scenes[id](page, dur, mark);
  } catch (e) {
    console.error(`✗ ${id}: ${e.message}`);
  }
  const video = page.video();
  await page.close();
  const src = await video.path();
  const dest = `${OUT}/${id}.webm`;
  if (existsSync(dest)) rmSync(dest);
  renameSync(src, dest);
  console.log(`  saved ${dest}`);
}
await ctx.close();
writeFileSync(leadsFile, JSON.stringify(leads, null, 2));
