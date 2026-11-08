export type LlmErrorCode = 'timeout' | 'refusal' | 'truncated' | 'invalid_json' | 'empty' | 'replay_miss';

export class LlmError extends Error {
  constructor(
    public readonly code: LlmErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

/** Reject after `ms` with an LlmError('timeout') unless `p` settles first. */
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new LlmError('timeout', `no response within ${ms} ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}
