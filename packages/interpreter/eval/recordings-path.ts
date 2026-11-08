import { fileURLToPath } from 'node:url';

/** Committed LLM + embedding recordings for `pnpm eval:replay` (see src/llm/replay.ts). */
export const RECORDINGS = fileURLToPath(new URL('./recordings', import.meta.url));
