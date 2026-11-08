import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app';
import { loadEnv } from './env';
import { parseClientFrame } from './live/protocol';

describe('server skeleton', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildApp(loadEnv({ LOG_LEVEL: 'silent' }));
  });
  afterAll(async () => {
    await app.close();
  });

  it('GET /health reports providers without leaking keys', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.keys).toEqual({ gemini: false, anthropic: false, supabase: false });
    expect(JSON.stringify(body)).not.toMatch(/sk-|AIza/);
  });
});

describe('parseClientFrame', () => {
  it('accepts a valid hello', () => {
    const r = parseClientFrame(JSON.stringify({ t: 'hello', token: 't', source: 'mic', consent: true }));
    expect(r.ok).toBe(true);
  });

  it('rejects hello without consent as fatal', () => {
    const r = parseClientFrame(JSON.stringify({ t: 'hello', token: 't', source: 'mic' }));
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.t === 'error') {
      expect(r.error.fatal).toBe(true);
      expect(r.error.message).toMatch(/consent/);
    }
  });

  it('rejects non-JSON without closing', () => {
    const r = parseClientFrame('not json');
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.t === 'error') expect(r.error.fatal).toBe(false);
  });
});
