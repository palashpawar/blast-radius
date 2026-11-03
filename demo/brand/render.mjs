// Render brand assets: logo PNGs (512, 1024, transparent corners) and the 1280x720
// YouTube thumbnail, into demo/brand/out.
import { chromium } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';

const dir = new URL('.', import.meta.url).pathname;
mkdirSync(`${dir}out`, { recursive: true });
const svg = readFileSync(`${dir}logo.svg`, 'utf8');

const browser = await chromium.launch();
for (const size of [512, 1024]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: `${dir}out/logo-${size}.png`, omitBackground: true });
  await page.close();
}
const thumb = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await thumb.goto(`file://${dir}thumbnail.html`);
await thumb.screenshot({ path: `${dir}out/thumbnail.png` });
await browser.close();
console.log('rendered logo-512.png, logo-1024.png, thumbnail.png');
