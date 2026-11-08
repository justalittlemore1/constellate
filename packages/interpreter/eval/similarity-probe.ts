/**
 * Offline (no API): rebuild node texts from the reports' outlines, look up their recorded embeddings
 * and print pairwise cosines per fixture, to choose thresholds from data.
 *   pnpm --filter @constellate/interpreter exec tsx eval/similarity-probe.ts
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dequantise, embeddingsFile, requestKey } from '../src/llm/replay';
import { RECORDINGS } from './recordings-path';

const reports = fileURLToPath(new URL('./reports', import.meta.url));
const vecs = new Map<string, number[]>();
for (const line of readFileSync(embeddingsFile(RECORDINGS), 'utf8').split('\n')) {
  if (!line.trim()) continue;
  const e = JSON.parse(line) as { key: string; q: string; s: number };
  vecs.set(e.key, dequantise(e));
}
const cos = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i]!, 0);
const pairs = new Map<string, number>();
for (const f of readdirSync(reports).filter((x) => x.startsWith('20261108-07'))) {
  const md = readFileSync(join(reports, f), 'utf8');
  for (const sec of md.split('\n## ').slice(1)) {
    const id = sec.split(' ')[0]!;
    const nodes = [...sec.matchAll(/^\s*- \[L\d\] (.+?) \((\d\d:\d\d), [^)]*\)(?: ↺ revisits "[^"]*")? — (.+)$/gm)].map(
      (m) => ({
        label: m[1]!,
        text: `${m[1]}. ${m[3]}`,
      }),
    );
    const found = nodes.map((n) => ({ ...n, v: vecs.get(requestKey({ embed: n.text })) })).filter((n) => n.v);
    for (let i = 0; i < found.length; i++)
      for (let j = i + 1; j < found.length; j++) {
        if (found[i]!.label === found[j]!.label) continue;
        pairs.set(`${id} | ${found[i]!.label} ~ ${found[j]!.label}`, cos(found[i]!.v!, found[j]!.v!));
      }
  }
}
const sorted = [...pairs].sort((a, b) => b[1] - a[1]);
for (const [k, v] of sorted.slice(0, 30)) console.log(v.toFixed(3), k);
console.log(`… ${sorted.length} pairs; 07/08 pairs:`);
for (const [k, v] of sorted.filter(([k]) => /^0[78]/.test(k))) console.log(v.toFixed(3), k);
