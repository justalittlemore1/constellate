import { fileURLToPath } from 'node:url';

/**
 * Committed LLM + embedding recordings (src/llm/replay.ts), keyed by a hash of each request: repeat
 * `pnpm eval` runs cost nothing and `pnpm eval:replay` / CI need no API keys (AGENTS.md › API budget).
 */
export const RECORDINGS = fileURLToPath(new URL('./recordings', import.meta.url));
