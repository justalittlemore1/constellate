/**
 * Record/replay wrappers so the eval is free to repeat and deterministic in CI with no API keys
 * (AGENTS.md › API budget). Responses are keyed by a SHA-256 of everything that determines them and
 * kept in one JSONL file per kind under the recordings directory:
 *
 *   llm-<model>.jsonl   {"key", "data", "ms", "inTok", "outTok"}
 *   embeddings.jsonl    {"key", "q", "s"}  — int8-quantised vector (base64) and its scale
 *
 * Embeddings are quantised BEFORE they are returned in the recording run too, so a replay sees
 * exactly the vectors the recording run saw (same similarities, same prompts, same cache keys).
 *
 *   mode 'replay'  read only; a miss throws LlmError('replay_miss') and is counted
 *   mode 'record'  always call the inner client and overwrite
 *   mode 'auto'    read if present, otherwise call and append
 */
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LlmError } from './errors';
import type { LlmClient, LlmJsonArgs } from './types';

/**
 * 'defer' (embeddings only): serve cached vectors; collect misses in `rs.deferred` and fail the call
 * (callers degrade). `flushDeferred` then embeds all collected texts in one batched request.
 */
export type ReplayMode = 'replay' | 'record' | 'auto' | 'defer';

export function requestKey(parts: unknown): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 32);
}

const safe = (s: string) => s.replace(/[^a-zA-Z0-9._-]/g, '_');

interface Entry {
  key: string;
}

/** One JSONL file: loaded once, appended on write, rewritable to drop unused keys. */
class JsonlStore<T extends Entry> {
  private map: Map<string, T> | null = null;
  constructor(readonly file: string) {}
  private load(): Map<string, T> {
    if (this.map) return this.map;
    this.map = new Map();
    if (existsSync(this.file)) {
      for (const line of readFileSync(this.file, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        const e = JSON.parse(line) as T;
        this.map.set(e.key, e);
      }
    }
    return this.map;
  }
  get(key: string): T | undefined {
    return this.load().get(key);
  }
  put(e: T): void {
    const m = this.load();
    const existed = m.has(e.key);
    m.set(e.key, e);
    mkdirSync(join(this.file, '..'), { recursive: true });
    if (existed) this.rewrite([...m.keys()]);
    else appendFileSync(this.file, `${JSON.stringify(e)}\n`);
  }
  /** keep only `keys`, in their first-use order */
  rewrite(keys: string[]): void {
    const m = this.load();
    const kept = keys.filter((k) => m.has(k)).map((k) => m.get(k)!);
    this.map = new Map(kept.map((e) => [e.key, e]));
    mkdirSync(join(this.file, '..'), { recursive: true });
    writeFileSync(this.file, kept.map((e) => `${JSON.stringify(e)}\n`).join(''));
  }
  size(): number {
    return this.load().size;
  }
}

interface LlmEntry extends Entry {
  data: unknown;
  ms: number;
  inTok: number;
  outTok: number;
}
interface EmbedEntry extends Entry {
  q: string;
  s: number;
}

export interface ReplayStore {
  /** keys used this run, per JSONL file (lets a full eval drop stale entries) */
  used: Map<string, string[]>;
  /** replay-mode lookups that found no recording */
  misses: number;
  /** requests that went to the real API (cache misses outside replay mode) */
  calls: number;
  /** 'defer' mode: texts that missed the cache, embedded together by flushDeferred */
  deferred: Set<string>;
  stores: Map<string, JsonlStore<Entry>>;
}

export const newReplayStore = (): ReplayStore => ({
  used: new Map(),
  misses: 0,
  calls: 0,
  deferred: new Set(),
  stores: new Map(),
});

function storeFor<T extends Entry>(rs: ReplayStore, file: string): JsonlStore<T> {
  let s = rs.stores.get(file);
  if (!s) {
    s = new JsonlStore<Entry>(file);
    rs.stores.set(file, s);
  }
  return s as unknown as JsonlStore<T>;
}

function markUsed(rs: ReplayStore, file: string, key: string) {
  const keys = rs.used.get(file) ?? [];
  if (!keys.includes(key)) keys.push(key);
  rs.used.set(file, keys);
}

/**
 * Drop entries not used this run, for the files this run touched. Embeddings are kept unless asked:
 * they are keyed by text, cheap to keep, and re-requesting them would spend the Gemini quota when a
 * prompt change is reverted.
 */
export function pruneUnused(rs: ReplayStore, opts: { embeddings?: boolean } = {}): void {
  for (const [file, keys] of rs.used) {
    if (!opts.embeddings && file.endsWith('embeddings.jsonl')) continue;
    storeFor(rs, file).rewrite(keys);
  }
}

export function llmFile(dir: string, model: string): string {
  return join(dir, `llm-${safe(model)}.jsonl`);
}
export function embeddingsFile(dir: string): string {
  return join(dir, 'embeddings.jsonl');
}

export function createReplayClient(
  inner: LlmClient | null,
  dir: string,
  mode: ReplayMode,
  rs: ReplayStore = newReplayStore(),
  /** request settings that change answers without appearing in the args (thinking, effort) */
  settings: (model: string) => unknown = () => null,
): LlmClient {
  return {
    async json<T>(args: LlmJsonArgs) {
      const extra = settings(args.model);
      const key = requestKey({
        system: args.system,
        user: args.user,
        schema: args.schema,
        model: args.model,
        ...(extra === null ? {} : { settings: extra }),
      });
      const file = llmFile(dir, args.model);
      const store = storeFor<LlmEntry>(rs, file);
      const hit = mode !== 'record' ? store.get(key) : undefined;
      if (hit) {
        markUsed(rs, file, key);
        return { data: hit.data as T, ms: hit.ms, inTok: hit.inTok, outTok: hit.outTok };
      }
      if (mode === 'replay' || !inner) {
        rs.misses++;
        throw new LlmError('replay_miss', `no recording for ${args.model} ${key}`);
      }
      rs.calls++;
      const res = await inner.json<T>(args);
      store.put({ key, data: res.data, ms: Math.round(res.ms), inTok: res.inTok, outTok: res.outTok });
      markUsed(rs, file, key);
      return res;
    },
  };
}

/** int8 quantisation with a per-vector scale; cosine error is ~1e-3 at 768 dimensions. */
export function quantise(v: readonly number[]): { q: string; s: number } {
  const s = Math.max(1e-12, ...v.map(Math.abs));
  const bytes = Int8Array.from(v, (x) => Math.round((x / s) * 127));
  return { q: Buffer.from(bytes.buffer).toString('base64'), s: Number(s.toPrecision(9)) };
}

export function dequantise(e: { q: string; s: number }): number[] {
  const buf = Buffer.from(e.q, 'base64');
  const bytes = new Int8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  const v = Array.from(bytes, (b) => (b / 127) * e.s);
  const n = Math.hypot(...v);
  return n === 0 ? v : v.map((x) => x / n);
}

/** Embeddings with the same modes; misses go to `inner` as ONE batched request. */
export function createReplayEmbedder(
  inner: ((texts: string[]) => Promise<number[][]>) | null,
  dir: string,
  mode: ReplayMode,
  rs: ReplayStore = newReplayStore(),
): (texts: string[]) => Promise<number[][]> {
  const file = embeddingsFile(dir);
  const store = storeFor<EmbedEntry>(rs, file);
  return async (texts) => {
    const out: (number[] | null)[] = texts.map(() => null);
    const missing: number[] = [];
    texts.forEach((t, i) => {
      const key = requestKey({ embed: t });
      const hit = mode !== 'record' ? store.get(key) : undefined;
      if (hit) {
        markUsed(rs, file, key);
        out[i] = dequantise(hit);
      } else missing.push(i);
    });
    if (missing.length > 0) {
      const uniq = [...new Set(missing.map((i) => texts[i]!))];
      if (mode === 'defer') {
        uniq.forEach((t) => rs.deferred.add(t));
        throw new LlmError('replay_miss', `deferred ${uniq.length} text(s) to the next batched request`);
      }
      if (mode === 'replay' || !inner) {
        rs.misses += uniq.length;
        throw new LlmError('replay_miss', `no embedding recording for ${uniq.length} text(s)`);
      }
      rs.calls++;
      const got = await inner(uniq);
      uniq.forEach((t, j) => {
        const key = requestKey({ embed: t });
        store.put({ key, ...quantise(got[j]!) });
        markUsed(rs, file, key);
      });
      for (const i of missing) out[i] = dequantise(store.get(requestKey({ embed: texts[i] }))!);
    }
    return out as number[][];
  };
}

/**
 * Embed every text collected by a 'defer' embedder in one batched request (the inner embedder
 * chunks very large batches) and record the vectors. Returns how many texts were embedded.
 */
export async function flushDeferred(
  rs: ReplayStore,
  inner: (texts: string[]) => Promise<number[][]>,
  dir: string,
): Promise<number> {
  const texts = [...rs.deferred];
  if (texts.length === 0) return 0;
  rs.deferred.clear();
  const file = embeddingsFile(dir);
  const store = storeFor<EmbedEntry>(rs, file);
  rs.calls++;
  const got = await inner(texts);
  texts.forEach((t, j) => {
    const key = requestKey({ embed: t });
    store.put({ key, ...quantise(got[j]!) });
    markUsed(rs, file, key);
  });
  return texts.length;
}
