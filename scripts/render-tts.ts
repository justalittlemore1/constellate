/**
 * Render transcript fixtures to synthetic WAV for the STT runner (A5). Needs GEMINI_API_KEY.
 *
 *   pnpm tsx --env-file-if-exists=.env scripts/render-tts.ts             six default scenarios, clean
 *   pnpm tsx --env-file-if-exists=.env scripts/render-tts.ts --noise     also a -20 dB noisy copy of each
 *   pnpm tsx --env-file-if-exists=.env scripts/render-tts.ts --only 03   one scenario
 *
 * Writes packages/shared/fixtures/audio/<id>.wav (+ <id>-noisy.wav) and a <id>.json sidecar with the
 * script text and rendered clip times. The WAVs are git-ignored; regenerate them locally.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TranscriptFixture } from '../packages/shared/src/interpreter';
import { geminiSynthesizer, renderFixture, toWav, TTS_FIXTURES } from '../packages/interpreter/src/tts/render';

const root = fileURLToPath(new URL('..', import.meta.url));
const transcripts = join(root, 'packages/shared/fixtures/transcripts');
const audio = join(root, 'packages/shared/fixtures/audio');

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const only = arg('only')?.split(',');
  const ids = only ? TTS_FIXTURES.filter((id) => only.some((o) => id.startsWith(o))) : TTS_FIXTURES;
  const synth = geminiSynthesizer();
  mkdirSync(audio, { recursive: true });
  for (const id of ids) {
    const fixture = JSON.parse(readFileSync(join(transcripts, `${id}.json`), 'utf8')) as TranscriptFixture;
    const r = await renderFixture(fixture, synth);
    writeFileSync(join(audio, `${id}.wav`), toWav(r));
    writeFileSync(join(audio, `${id}.json`), `${JSON.stringify(r.sidecar, null, 2)}\n`);
    console.log(`[tts] ${id}.wav  ${(r.sidecar.utterances.at(-1)!.endMs / 1000).toFixed(1)} s`);
    if (process.argv.includes('--noise')) {
      // same speech, steady background noise 20 dB below it
      writeFileSync(join(audio, `${id}-noisy.wav`), toWav(r, -20));
      console.log(`[tts] ${id}-noisy.wav`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
