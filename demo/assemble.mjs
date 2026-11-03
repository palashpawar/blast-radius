// Assemble the final demo: each scene = its narration clip over a card still or a
// recorded clip, then concatenated into demo/out/blast-radius-demo.mp4.
//
// Jira clips: the loading lead-in is trimmed, the gray strip below row 1040 (window
// taller than the screen) is cropped off, and a scene runs as long as the longer of
// its narration and its footage, so slow steps (the agent thinking) aren't cut short.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname;
const OUT = `${root}demo/out`;
const SEG = `${OUT}/segments`;
mkdirSync(SEG, { recursive: true });

const { scenes } = JSON.parse(readFileSync(`${root}demo/narration.json`, 'utf8'));
const leads = existsSync(`${OUT}/video/leads.json`) ? JSON.parse(readFileSync(`${OUT}/video/leads.json`, 'utf8')) : {};
const probe = (f) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString());
const ff = (args) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: 'inherit' });

const TAIL = 0.6; // breathing room after each line of narration
const ENC = ['-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', '30',
  '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2'];

const list = [];
for (const s of scenes) {
  const audio = `${OUT}/audio/${s.id}.mp3`;
  const a = probe(audio);
  const seg = `${SEG}/${s.id}.mp4`;
  const clip = `${OUT}/video/${s.id}.webm`;
  const card = `${OUT}/cards/${s.id}.png`;

  if (existsSync(clip)) {
    const lead = leads[s.id] ?? 0;
    const footage = probe(clip) - lead;
    const len = Math.max(a + TAIL, Math.min(footage, a + 8));
    const isJira = s.kind === 'jira';
    const vf = [
      isJira ? 'crop=1849:1040:0:0,scale=1920:1080:flags=lanczos' : 'scale=1920:1080',
      `tpad=stop_mode=clone:stop_duration=${len}`,
      `fade=t=in:st=0:d=0.3,fade=t=out:st=${(len - 0.3).toFixed(2)}:d=0.3`,
    ].join(',');
    // When footage outruns the narration (e.g. waiting on the agent), centre the voice
    // in the scene so the slack splits into short pauses instead of one long silence.
    const delayMs = Math.round(Math.max(0, (len - a - TAIL) / 2) * 1000);
    ff(['-ss', String(lead), '-i', clip, '-i', audio, '-t', len.toFixed(2),
      '-vf', vf, '-af', `adelay=${delayMs}:all=1,apad,atrim=0:${len.toFixed(2)}`, '-map', '0:v', '-map', '1:a', ...ENC, seg]);
    console.log(`${s.id}: footage ${footage.toFixed(1)}s, narration ${a.toFixed(1)}s -> ${len.toFixed(1)}s`);
  } else if (existsSync(card)) {
    const len = a + TAIL + 0.4;
    ff(['-loop', '1', '-i', card, '-i', audio, '-t', len.toFixed(2),
      '-vf', `scale=1920:1080,fade=t=in:st=0:d=0.4,fade=t=out:st=${(len - 0.4).toFixed(2)}:d=0.4`,
      '-af', `apad,atrim=0:${len.toFixed(2)}`, '-map', '0:v', '-map', '1:a', ...ENC, seg]);
    console.log(`${s.id}: card ${len.toFixed(1)}s`);
  } else {
    console.error(`${s.id}: no footage or card yet, skipping`);
    continue;
  }
  list.push(`file '${seg}'`);
}

writeFileSync(`${SEG}/list.txt`, list.join('\n'));
const final = `${OUT}/blast-radius-demo.mp4`;
ff(['-f', 'concat', '-safe', '0', '-i', `${SEG}/list.txt`, '-c', 'copy', '-movflags', '+faststart', final]);
console.log(`\n${final}: ${probe(final).toFixed(1)}s`);
