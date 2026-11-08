/**
 * packages/shared/fixtures/audio/SCRIPTS.md is what humans read aloud for the speech tests; the STT
 * runner scores each WAV against the fixture JSON. This keeps the two in sync: if a fixture's text
 * changes, regenerate SCRIPTS.md in the same PR.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { TranscriptFixture } from '@constellate/shared';

const audio = fileURLToPath(new URL('../../shared/fixtures/audio/', import.meta.url));
const transcripts = fileURLToPath(new URL('../../shared/fixtures/transcripts/', import.meta.url));
const SPOKEN = ['01-simple-shift', '02-drill-down', '03-return', '05-deferred-resolved', '08-java', '09-promise'];

describe('spoken-test scripts', () => {
  const md = readFileSync(`${audio}SCRIPTS.md`, 'utf8');
  for (const id of SPOKEN) {
    it(`${id}: SCRIPTS.md lists every line of the fixture, in order, with the WAV name`, () => {
      const f = JSON.parse(readFileSync(`${transcripts}${id}.json`, 'utf8')) as TranscriptFixture;
      const section = md.split(`## ${id}.wav:`)[1]?.split('\n## ')[0];
      expect(section, `no section for ${id}.wav`).toBeDefined();
      const lines = [...section!.matchAll(/^\d+\. \*\*([AB]):\*\* (.*)$/gm)].map((m) => [m[1], m[2]]);
      expect(lines).toEqual(f.utterances.map((u) => [u.speaker === 0 ? 'A' : 'B', u.text]));
      expect(md).toContain(`\`${id}.wav\``);
    });
  }
});
