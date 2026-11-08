import { buildApp } from './app';
import { forceClaudeReasoning, loadEnv } from './env';

const env = loadEnv();
forceClaudeReasoning(env, (msg) => console.warn(msg));
const app = await buildApp(env);

try {
  await app.listen({ port: env.PORT, host: env.HOST });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
