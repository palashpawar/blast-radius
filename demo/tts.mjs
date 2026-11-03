// Generate one narration clip per scene with ElevenLabs text-to-speech.
// The SDK reads ELEVENLABS_API_KEY from the environment; load it from .env.local:
//
//   node --env-file=.env.local demo/tts.mjs [--force]
//
// Neighbouring scenes are passed as previousText/nextText (request stitching) so the
// separately generated clips keep one consistent delivery. Existing clips are kept
// unless --force.

import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';

const root = new URL('..', import.meta.url).pathname;
const out = `${root}demo/out/audio`;
mkdirSync(out, { recursive: true });

const { voice_id, model_id, scenes } = JSON.parse(readFileSync(`${root}demo/narration.json`, 'utf8'));
const force = process.argv.includes('--force');
const client = new ElevenLabsClient();

for (const [i, s] of scenes.entries()) {
  const file = `${out}/${s.id}.mp3`;
  if (existsSync(file) && !force) continue;
  const audio = await client.textToSpeech.convert(voice_id, {
    text: s.text,
    modelId: model_id,
    outputFormat: 'mp3_44100_128',
    previousText: scenes[i - 1]?.text,
    nextText: scenes[i + 1]?.text,
    voiceSettings: { stability: 0.5, similarityBoost: 0.75 },
  });
  await finished(Readable.fromWeb(audio).pipe(createWriteStream(file)));
  console.log(`✓ ${s.id}`);
}

let total = 0;
const durations = {};
for (const s of scenes) {
  const d = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', `${out}/${s.id}.mp3`]).toString());
  durations[s.id] = Math.round(d * 100) / 100;
  total += d;
}
writeFileSync(`${out}/durations.json`, JSON.stringify(durations, null, 2));
console.log(durations);
console.log(`total narration: ${total.toFixed(1)}s`);
