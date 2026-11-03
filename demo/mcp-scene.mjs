// Scene 06: capture a real Claude Code -> Blast Radius MCP call, then render it as a
// terminal animation (1920x1080 video). Requires the blast-radius MCP server to be
// connected for this project (claude mcp get blast-radius).
//
//   node demo/mcp-scene.mjs            capture + render
//   node demo/mcp-scene.mjs --render   re-render from demo/out/mcp.txt

import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname;
const OUT = `${root}demo/out`;
mkdirSync(`${OUT}/video/raw`, { recursive: true });

const COMMAND = 'claude -p "What\'s the blast radius of PAY-2? Use the blast-radius MCP tools."';
const PROMPT = "Using only the blast-radius MCP server, call its analyze blast radius tool for PAY-2. Reply with exactly these lines and nothing else: 'tool: <exact tool name>', 'score: <score>/100', 'level: <level>', 'headline: <headline>', 'incidents: <comma-separated incident keys>', 'notify: <names with reasons>'.";

if (!process.argv.includes('--render') || !existsSync(`${OUT}/mcp.txt`)) {
  const text = execFileSync('claude', ['-p', PROMPT, '--allowedTools', 'mcp__blast-radius', '--max-turns', '4'], {
    cwd: root, encoding: 'utf8', timeout: 240_000,
  });
  if (!/score:\s*\d+/i.test(text)) {
    console.error(`MCP call did not return a score:\n${text}`);
    process.exit(1);
  }
  writeFileSync(`${OUT}/mcp.txt`, text.trim());
}

const lines = readFileSync(`${OUT}/mcp.txt`, 'utf8').split('\n');
console.log(lines.join('\n'));

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  recordVideo: { dir: `${OUT}/video/raw`, size: { width: 1920, height: 1080 } },
});
const page = await ctx.newPage();
await page.goto(`file://${root}demo/terminal.html`);
await page.evaluate((scene) => window.play(scene), { command: COMMAND, lines });
await page.waitForTimeout(2500);
const video = page.video();
await ctx.close();
await browser.close();
const dest = `${OUT}/video/06-mcp.webm`;
if (existsSync(dest)) rmSync(dest);
renameSync(await video.path(), dest);
console.log(`saved ${dest}`);
