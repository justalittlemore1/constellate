import { buildApp } from './app';
import { loadEnv } from './env';

const env = loadEnv();
const app = await buildApp(env);

try {
  await app.listen({ port: env.PORT, host: env.HOST });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
