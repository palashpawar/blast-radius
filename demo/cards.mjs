// Render the static title/explainer cards to 1920x1080 PNGs.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname;
mkdirSync(`${root}demo/out/cards`, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
for (const id of ['01-title', '07-how', '08-close']) {
  await page.goto(`file://${root}demo/cards.html?card=${id}`);
  await page.screenshot({ path: `${root}demo/out/cards/${id}.png` });
}
await browser.close();
console.log('cards rendered');
