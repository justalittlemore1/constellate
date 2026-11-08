// Entry point for `pnpm --filter @constellate/server deploy-check <url>`; see deploy-check.ts.
import { runDeployCheck } from './deploy-check';

runDeployCheck(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e) => {
    console.error('FAIL ', e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
