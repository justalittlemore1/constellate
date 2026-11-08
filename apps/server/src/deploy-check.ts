/**
 * Checks a deployed server end to end (the first Render run, H5). Manual tool, never run in CI:
 *
 *   pnpm --filter @constellate/server deploy-check https://<render-host> [--wav path.wav] [--keep]
 *
 * Without credentials it only checks GET /health. With TEST_USER_A_EMAIL/PASSWORD plus
 * VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY in the environment (repo .env) it also signs in and
 * runs one conversation: WAV → Live STT (v1beta) if --wav is given, otherwise transcript replay;
 * then stop → finalisation (live transcript kept when sttFile is unavailable) → POST /brain/rebuild.
 * The conversation is deleted afterwards unless --keep.
 */
import { readFileSync } from 'node:fs';
import { MODELS } from '@constellate/shared';
import { EMBED_DAILY_CAP } from './ai/gemini';

export interface Check {
  ok: boolean;
  label: string;
  detail?: string;
}

/** Pure: what a healthy production /health looks like after the API-budget work. */
export function checkHealth(h: Record<string, unknown>): Check[] {
  const g = (h.gemini ?? null) as null | {
    today?: { day?: string; requests?: Record<string, number> };
    caps?: Record<string, number>;
  };
  const keys = (h.keys ?? {}) as Record<string, boolean>;
  const checks: Check[] = [
    { ok: h.ok === true, label: 'server answers /health' },
    { ok: h.interpreter === 'anthropic', label: 'reasoning on Claude', detail: `interpreter=${String(h.interpreter)}` },
    { ok: keys.gemini === true, label: 'GEMINI_API_KEY set' },
    { ok: keys.anthropic === true, label: 'ANTHROPIC_API_KEY set' },
    { ok: keys.supabase === true, label: 'Supabase service role set' },
    {
      ok: Boolean(g?.today?.day && g.today.requests),
      label: 'gemini.today reported (per Pacific day)',
      detail: g?.today ? `${g.today.day}: ${JSON.stringify(g.today.requests)}` : 'missing',
    },
    {
      ok: g?.caps?.[MODELS.embed] === EMBED_DAILY_CAP,
      label: `embedding cap ${EMBED_DAILY_CAP}/day`,
      detail: g?.caps ? JSON.stringify(g.caps) : 'missing',
    },
    {
      ok: h.embeddings === 'gemini',
      label: 'real embeddings',
      detail:
        h.embeddings === 'gemini'
          ? undefined
          : `embeddings=${String(h.embeddings)}: set NODE_ENV=production (or EMBEDDINGS=gemini) on Render`,
    },
    {
      ok: h.sttFile === 'available' || h.sttFile === 'unavailable',
      label: 'file-transcription probe finished',
      detail: `sttFile=${String(h.sttFile)}${h.sttFile === 'checking' ? ' (still checking; run again)' : ''}`,
    },
  ];
  return checks;
}

/** Runs the checks; resolves to the process exit code. */
export async function runDeployCheck(args: string[]): Promise<number> {
  const base = args.find((a) => /^https?:\/\//.test(a))?.replace(/\/$/, '');
  if (!base) throw new Error('usage: deploy-check https://<host> [--wav file.wav] [--keep]');
  const wavPath = args.includes('--wav') ? args[args.indexOf('--wav') + 1] : undefined;
  const keep = args.includes('--keep');
  let failures = 0;
  const report = (c: Check) => {
    if (!c.ok) failures++;
    console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.label}${c.detail ? `  (${c.detail})` : ''}`);
  };

  const health = (await (await fetch(`${base}/health`)).json()) as Record<string, unknown>;
  checkHealth(health).forEach(report);

  const {
    VITE_SUPABASE_URL: url,
    VITE_SUPABASE_ANON_KEY: anon,
    TEST_USER_A_EMAIL: email,
    TEST_USER_A_PASSWORD: password,
  } = process.env;
  if (!url || !anon || !email || !password) {
    console.log('SKIP  conversation run: needs VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, TEST_USER_A_EMAIL/PASSWORD');
    return failures ? 1 : 0;
  }
  const { createClient } = await import('@supabase/supabase-js');
  const auth = await createClient(url, anon, { auth: { persistSession: false } }).auth.signInWithPassword({
    email,
    password,
  });
  const token = auth.data.session?.access_token;
  report({ ok: Boolean(token), label: 'test user signs in', detail: auth.error?.message });
  if (!token) return 1;
  const headers = { authorization: `Bearer ${token}` };

  // one conversation through the deployed gateway
  const ws = new WebSocket(`${base.replace(/^http/, 'ws')}/live`);
  const msgs: { t: string; [k: string]: unknown }[] = [];
  ws.onmessage = (e) => msgs.push(JSON.parse(String(e.data)));
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error('websocket failed to open'));
  });
  const until = async (pred: () => boolean, ms: number) => {
    const end = Date.now() + ms;
    while (!pred() && Date.now() < end) await new Promise((r) => setTimeout(r, 250));
    return pred();
  };
  const finals = () => msgs.filter((m) => m.t === 'caption' && m.final).length;
  ws.send(
    JSON.stringify(
      wavPath
        ? { t: 'hello', token, source: 'mic', consent: true }
        : { t: 'hello', token, source: 'replay-transcript', fixture: '01-simple-shift', consent: true },
    ),
  );
  report({ ok: await until(() => msgs.some((m) => m.t === 'ready'), 15_000), label: 'live session ready' });
  const conversationId = msgs.find((m) => m.t === 'ready')?.conversationId as string | undefined;
  if (!conversationId) return 1;

  if (wavPath) {
    const pcm = readFileSync(wavPath).subarray(44); // 16 kHz mono s16le WAV
    for (let i = 0; i < pcm.length + 32_000 * 3; i += 3_200) {
      ws.send(i < pcm.length ? pcm.subarray(i, i + 3_200) : Buffer.alloc(3_200));
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  report({
    ok: await until(() => finals() >= 2, 60_000),
    label: wavPath ? 'Live STT captions (v1beta)' : 'replay captions',
    detail: `${finals()} finals`,
  });
  const err = msgs.find((m) => m.t === 'error');
  if (err) report({ ok: false, label: 'no server error', detail: JSON.stringify(err) });
  ws.send(JSON.stringify({ t: 'stop' }));
  report({ ok: await until(() => msgs.some((m) => m.t === 'stopped'), 60_000), label: 'stop → stopped' });
  report({
    ok: msgs.some((m) => m.t === 'ops'),
    label: 'interpreter produced graph ops',
    detail: `${msgs.filter((m) => m.t === 'ops').length} batches`,
  });

  // finalisation waits up to 45 s for a recording upload this script does not make
  let status = '';
  for (let i = 0; i < 480 && status !== 'ready' && status !== 'failed'; i++) {
    const g = (await (await fetch(`${base}/conversations/${conversationId}`, { headers })).json()) as {
      conversation?: { status?: string; title?: string };
    };
    status = g.conversation?.status ?? '';
    if (status !== 'ready' && status !== 'failed') await new Promise((r) => setTimeout(r, 2_000));
    else console.log(`      title: ${g.conversation?.title}`);
  }
  report({ ok: status === 'ready', label: 'finalisation → ready (Claude refine)', detail: `status=${status}` });
  const utt = (await (await fetch(`${base}/conversations/${conversationId}/utterances`, { headers })).json()) as {
    utterances: { speaker: number | null }[];
  };
  report({
    ok:
      utt.utterances.length > 0 &&
      (health.sttFile !== 'unavailable' || utt.utterances.every((u) => u.speaker === null)),
    label: 'live transcript kept (speakers empty without sttFile)',
    detail: `${utt.utterances.length} utterances`,
  });

  const brain = await fetch(`${base}/brain/rebuild`, { method: 'POST', headers });
  report({ ok: brain.ok, label: 'POST /brain/rebuild on real data', detail: JSON.stringify(await brain.json()) });

  if (!keep) {
    const del = await fetch(`${base}/conversations/${conversationId}`, { method: 'DELETE', headers });
    report({ ok: del.status === 204, label: 'test conversation deleted' });
  }
  const after = (await (await fetch(`${base}/health`)).json()) as { gemini?: unknown };
  console.log('      gemini usage now:', JSON.stringify(after.gemini));
  ws.close();
  return failures ? 1 : 0;
}
