import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { acquirePidFile, AlreadyRunningError, isAlive } from './guard';

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'guard-'));
  dirs.push(d);
  return d;
};
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

describe('eval run guard', () => {
  it('writes the PID file and removes it on release', () => {
    const file = join(tmp(), 'eval.pid');
    const g = acquirePidFile(file);
    expect(readFileSync(file, 'utf8').trim()).toBe(String(process.pid));
    g.release();
    expect(existsSync(file)).toBe(false);
  });

  it('refuses to start while another live process holds the file', () => {
    const file = join(tmp(), 'eval.pid');
    // the parent of this test process is alive and is not us
    writeFileSync(file, `${process.ppid}\n`);
    expect(isAlive(process.ppid)).toBe(true);
    expect(() => acquirePidFile(file)).toThrow(AlreadyRunningError);
    expect(readFileSync(file, 'utf8').trim()).toBe(String(process.ppid));
  });

  it('replaces a stale PID file left by a dead process', () => {
    const file = join(tmp(), 'eval.pid');
    writeFileSync(file, '999999999\n');
    expect(isAlive(999999999)).toBe(false);
    const g = acquirePidFile(file);
    expect(readFileSync(file, 'utf8').trim()).toBe(String(process.pid));
    g.release();
  });
});
