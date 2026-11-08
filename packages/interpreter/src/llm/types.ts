/** Provider-neutral structured-output client (docs/PLAN.md → Provider interfaces and config). */
export interface LlmJsonArgs {
  system: string;
  user: string;
  /** JSON schema (subset accepted by both Gemini responseJsonSchema and Claude output_config.format) */
  schema: object;
  model: string;
  timeoutMs: number;
}

export interface LlmJsonResult<T> {
  data: T;
  ms: number;
  inTok: number;
  outTok: number;
}

export interface LlmClient {
  json<T>(args: LlmJsonArgs): Promise<LlmJsonResult<T>>;
}
