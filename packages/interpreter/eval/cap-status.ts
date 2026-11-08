/** Print today's eval embedding usage against the cap (no API call). */
import { MODELS } from '@constellate/shared';
import { createDailyCap, EVAL_EMBED_CAP_PER_DAY, pacificDay } from '../src/llm/cap';
const cap = createDailyCap({ limit: EVAL_EMBED_CAP_PER_DAY });
console.log(
  `[cap] Pacific ${pacificDay()}: ${cap.used(MODELS.embed)}/${cap.limit} embedding requests used by the eval`,
);
