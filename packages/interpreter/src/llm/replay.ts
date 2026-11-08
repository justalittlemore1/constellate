/**
 * Record/replay wrappers so the eval runs deterministically in CI with no API keys.
 * Each request is keyed by a SHA-256 of everything that determines its answer; one JSON file per
 * key under `<dir>/<model>/<key>.json`.
 *
 *   mode 'replay'  read only; a miss throws LlmError('replay_miss')
 *   mode 'record'  always call the inner client and (over)write the file
 *   mode 'auto'    read if present, otherwise call and write
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LlmClient, LlmJsonArgs } from './types';
import { LlmError } from './errors';

export type ReplayMode = 'replay' | 'record' | 'auto';

export interface Recording {
  key: string;
  model: string;
  data: unknown;
  ms: number;
  inTok: number;
  outTok: number;
}

export function requestKey(parts: unknown): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 32);
}

function safe(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export interface ReplayStore {
  /** every file path read or written in this process (lets the eval prune stale recordings) */
  used: Set<string>;
  /** replay-mode lookups that found no recording (the interpreter swallows embedding failures) */
  misses: number;
}

export const newReplayStore = (): ReplayStore => ({ used: new Set(), misses: 0 });

export function createReplayClient(
  inner: LlmClient | null,
  dir: string,
  mode: ReplayMode,
  store: ReplayStore = newReplayStore(),
): LlmClient {
  return {
    async json<T>(args: LlmJsonArgs) {
      const key = requestKey({ system: args.system, user: args.user, schema: args.schema, model: args.model });
      const folder = join(dir, safe(args.model));
      const file = join(folder, `${key}.json`);
      if (mode !== 'record' && existsSync(file)) {
        store.used.add(file);
        const r = JSON.parse(readFileSync(file, 'utf8')) as Recording;
        return { data: r.data as T, ms: r.ms, inTok: r.inTok, outTok: r.outTok };
      }
      if (mode === 'replay' || !inner) {
        store.misses++;
        throw new LlmError('replay_miss', `no recording for ${args.model} ${key}`);
      }
      const res = await inner.json<T>(args);
      mkdirSync(folder, { recursive: true });
      const rec: Recording = {
        key,
        model: args.model,
        data: res.data,
        ms: Math.round(res.ms),
        inTok: res.inTok,
        outTok: res.outTok,
      };
      writeFileSync(file, `${JSON.stringify(rec)}\n`);
      store.used.add(file);
      return res;
    },
  };
}

/** Same idea for embeddings: one file per text. Vectors are stored rounded to 6 decimals. */
export function createReplayEmbedder(
  inner: ((texts: string[]) => Promise<number[][]>) | null,
  dir: string,
  mode: ReplayMode,
  store: ReplayStore = newReplayStore(),
): (texts: string[]) => Promise<number[][]> {
  const folder = join(dir, 'embeddings');
  return async (texts) => {
    const out: (number[] | null)[] = texts.map(() => null);
    const missing: number[] = [];
    texts.forEach((t, i) => {
      const file = join(folder, `${requestKey({ embed: t })}.json`);
      if (mode !== 'record' && existsSync(file)) {
        store.used.add(file);
        out[i] = JSON.parse(readFileSync(file, 'utf8')) as number[];
      } else missing.push(i);
    });
    if (missing.length > 0) {
      if (mode === 'replay' || !inner) {
        store.misses += missing.length;
        throw new LlmError('replay_miss', `no embedding recording for ${missing.length} text(s)`);
      }
      const got = await inner(missing.map((i) => texts[i]!));
      mkdirSync(folder, { recursive: true });
      missing.forEach((i, j) => {
        const v = got[j]!.map((x) => Math.round(x * 1e6) / 1e6);
        const file = join(folder, `${requestKey({ embed: texts[i] })}.json`);
        writeFileSync(file, JSON.stringify(v));
        store.used.add(file);
        out[i] = v;
      });
    }
    return out as number[][];
  };
}
