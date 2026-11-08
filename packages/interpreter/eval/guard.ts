/**
 * Run guard for anything that calls an API (AGENTS.md › API budget, PR #25): interrupting a command
 * kills only the shell wrapper, so the eval protects itself:
 *  - a PID file: a second run refuses to start while the first is alive (a stale file is replaced)
 *  - a hard timeout: the process exits on its own instead of running on unattended
 *  - the PID file is removed on exit, Ctrl-C and SIGTERM
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export function isAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export class AlreadyRunningError extends Error {
  constructor(readonly pid: number) {
    super(`another eval is already running (pid ${pid}); wait for it or stop it first`);
    this.name = 'AlreadyRunningError';
  }
}

export interface Guard {
  release(): void;
}

/** Take the PID file or throw AlreadyRunningError. */
export function acquirePidFile(file: string, pid = process.pid): Guard {
  if (existsSync(file)) {
    const other = Number(readFileSync(file, 'utf8').trim());
    if (other !== pid && isAlive(other)) throw new AlreadyRunningError(other);
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${pid}\n`);
  let released = false;
  return {
    release() {
      if (released) return;
      released = true;
      try {
        if (existsSync(file) && Number(readFileSync(file, 'utf8').trim()) === pid) rmSync(file);
      } catch {
        // best effort
      }
    },
  };
}

/** PID file + hard timeout + cleanup on exit/signals, for a CLI entry point. */
export function guardProcess(file: string, timeoutMs: number, log: (msg: string) => void = console.error): Guard {
  const guard = acquirePidFile(file);
  const timer = setTimeout(() => {
    log(`[eval] hard timeout after ${Math.round(timeoutMs / 60_000)} min: exiting`);
    guard.release();
    process.exit(2);
  }, timeoutMs);
  timer.unref();
  process.on('exit', () => guard.release());
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.on(sig, () => {
      log(`[eval] ${sig}: exiting`);
      guard.release();
      process.exit(130);
    });
  }
  return guard;
}
