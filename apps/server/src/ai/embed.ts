/**
 * Embeddings with a budget (AGENTS.md → API budget): every text is looked up in an in-memory +
 * on-disk cache keyed by a hash of (model, dims, text); misses from calls made close together are
 * batched into one request (up to `maxBatch` texts). Vectors are L2-normalised.
 */
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODELS } from '@constellate/shared';

/**
 * One unit vector per text, or `[]` when embeddings are unavailable right now (daily cap reached):
 * callers then degrade (no revisit candidates; the Brain merges by name). Never partial.
 */
export type Embedder = (texts: string[]) => Promise<number[][]>;
type Log = (event: string, data?: Record<string, unknown>) => void;

export function l2normalize(v: number[]): number[] {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return n === 0 ? v.map(() => 0) : v.map((x) => x / n);
}

export function embeddingKey(text: string): string {
  return createHash('sha256').update(`${MODELS.embed}|${MODELS.embedDims}|${text}`).digest('hex');
}

const encode = (v: number[]) => Buffer.from(new Float32Array(v).buffer).toString('base64');
const decode = (s: string) => {
  const b = Buffer.from(s, 'base64');
  return Array.from(new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)));
};

/**
 * Memory cache, optionally persisted as JSON lines `{"k": key, "v": base64 float32}` so restarts
 * and repeat runs cost nothing. A corrupt line is skipped, never fatal.
 */
export class EmbeddingCache {
  private readonly mem = new Map<string, number[]>();
  private loaded = false;

  constructor(private readonly file: string | null = null) {}

  get size(): number {
    this.load();
    return this.mem.size;
  }

  get(text: string): number[] | undefined {
    this.load();
    return this.mem.get(embeddingKey(text));
  }

  set(text: string, v: number[]): void {
    this.load();
    const k = embeddingKey(text);
    if (this.mem.has(k)) return;
    this.mem.set(k, v);
    if (!this.file) return;
    try {
      mkdirSync(path.dirname(this.file), { recursive: true });
      appendFileSync(this.file, `${JSON.stringify({ k, v: encode(v) })}\n`);
    } catch {
      // the disk cache is best effort
    }
  }

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    if (!this.file || !existsSync(this.file)) return;
    for (const line of readFileSync(this.file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const { k, v } = JSON.parse(line) as { k: string; v: string };
        const vec = decode(v);
        if (vec.length === MODELS.embedDims) this.mem.set(k, vec);
      } catch {
        // skip a corrupt line
      }
    }
  }
}

export interface CachedEmbedderOptions {
  /** one provider request for many texts; raw vectors in input order */
  fetch: (texts: string[]) => Promise<number[][]>;
  cache: EmbeddingCache;
  /** texts per provider request */
  maxBatch?: number;
  /** wait this long to gather texts from concurrent callers into one request */
  windowMs?: number;
  log?: Log;
}

interface Pending {
  texts: string[];
  resolve: (v: number[][]) => void;
  reject: (e: unknown) => void;
}

/**
 * Cache first, then batched provider requests for the misses. Errors reach only the affected
 * callers; if the provider returns nothing (cap reached) those callers get `[]`. Cache hits are
 * always served, even past the cap.
 */
export function cachedEmbedder(opts: CachedEmbedderOptions): Embedder {
  const maxBatch = opts.maxBatch ?? 100;
  const windowMs = opts.windowMs ?? 25;
  let queue: Pending[] = [];
  let timer: NodeJS.Timeout | null = null;

  async function flush(): Promise<void> {
    timer = null;
    const batch = queue;
    queue = [];
    const misses = [...new Set(batch.flatMap((p) => p.texts).filter((t) => !opts.cache.get(t)))];
    const failed = new Map<string, unknown>();
    const unavailable = new Set<string>();
    for (let i = 0; i < misses.length; i += maxBatch) {
      const chunk = misses.slice(i, i + maxBatch);
      try {
        const vectors = await opts.fetch(chunk);
        if (vectors.length === 0) {
          // provider declined (daily cap): nothing to cache, callers degrade
          for (const t of chunk) unavailable.add(t);
          continue;
        }
        if (vectors.length !== chunk.length || vectors.some((v) => v.length !== MODELS.embedDims)) {
          throw new Error(`embedding response has ${vectors.length} vectors for ${chunk.length} texts`);
        }
        chunk.forEach((t, j) => opts.cache.set(t, l2normalize(vectors[j]!)));
      } catch (err) {
        for (const t of chunk) failed.set(t, err);
      }
    }
    opts.log?.('embed.batch', { texts: batch.reduce((n, p) => n + p.texts.length, 0), requested: misses.length });
    for (const p of batch) {
      const err = p.texts.map((t) => failed.get(t)).find((e) => e !== undefined);
      if (err !== undefined) p.reject(err);
      else if (p.texts.some((t) => unavailable.has(t))) p.resolve([]);
      else p.resolve(p.texts.map((t) => opts.cache.get(t)!));
    }
  }

  return (texts) => {
    if (texts.length === 0) return Promise.resolve([]);
    const hits = texts.map((t) => opts.cache.get(t));
    if (hits.every((v) => v !== undefined)) return Promise.resolve(hits as number[][]);
    return new Promise((resolve, reject) => {
      queue.push({ texts, resolve, reject });
      timer ??= setTimeout(() => void flush(), windowMs);
    });
  };
}

export const noEmbedder: Embedder = async () => {
  throw new Error('GEMINI_API_KEY is not set: embeddings unavailable');
};

/** `apps/server/.cache/embeddings.jsonl` unless EMBED_CACHE_FILE says otherwise ("off" disables). */
export function embedCacheFile(setting: string | undefined): string | null {
  if (setting === 'off') return null;
  if (setting) return path.resolve(setting);
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.cache/embeddings.jsonl');
}

/**
 * Offline stand-in for development (EMBEDDINGS=local): a deterministic hashed bag of words, so
 * shared words give similar vectors. No network, no quota. Not for production quality.
 */
export const localEmbedder: Embedder = async (texts) =>
  texts.map((text) => {
    const v = new Array<number>(MODELS.embedDims).fill(0);
    for (const word of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
      const h = createHash('sha256').update(word).digest();
      v[h.readUInt16BE(0) % MODELS.embedDims]! += h[2]! & 1 ? 1 : -1;
    }
    return l2normalize(v);
  });
