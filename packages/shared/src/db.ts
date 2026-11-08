/**
 * camelCase (TypeScript) ↔ snake_case (Postgres) mapping. Every table carries `user_id`;
 * the server sets it from the verified token, never from client input.
 */
import type {
  Annotation,
  Commitment,
  Conversation,
  Flag,
  TopicEdge,
  TopicNode,
  Utterance,
} from './domain';

export const TABLES = {
  folders: 'folders',
  conversations: 'conversations',
  participants: 'participants',
  utterances: 'utterances',
  nodes: 'nodes',
  edges: 'edges',
  flags: 'flags',
  commitments: 'commitments',
  annotations: 'annotations',
  highlights: 'highlights',
  recallCards: 'recall_cards',
  opLog: 'op_log',
  concepts: 'concepts',
  conceptLinks: 'concept_links',
} as const;

export const RECORDINGS_BUCKET = 'recordings';

/** `{user_id}/{conversation_id}.webm` — matches the storage RLS policy. */
export function recordingPath(userId: string, conversationId: string): string {
  return `${userId}/${conversationId}.webm`;
}

export function toSnake(key: string): string {
  return key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

export function toCamel(key: string): string {
  return key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

export function snakeKeys(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [toSnake(k), v]));
}

export function camelKeys(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [toCamel(k), v]));
}

type Row = Record<string, unknown>;

/** Domain object → row for insert/upsert, with the owning user. */
export function toRow<T extends object>(obj: T, userId: string): Row {
  return { ...snakeKeys(obj as Row), user_id: userId };
}

/** Row → domain object. Drops columns that are not part of the domain type. */
function fromRowPicking<T>(row: Row, drop: readonly string[]): T {
  const out = camelKeys(row);
  for (const k of drop) delete out[k];
  return out as T;
}

const SERVER_ONLY = ['userId', 'embedding', 'conceptId'] as const;

export const fromRow = {
  conversation: (r: Row) => {
    const c = fromRowPicking<Conversation & { lastSeq?: number; brainBuiltAt?: string }>(r, []);
    delete c.lastSeq;
    delete c.brainBuiltAt;
    return c as Conversation;
  },
  node: (r: Row) => fromRowPicking<TopicNode>(r, SERVER_ONLY),
  edge: (r: Row) => fromRowPicking<TopicEdge>(r, ['userId']),
  utterance: (r: Row) => fromRowPicking<Utterance>(r, ['userId']),
  flag: (r: Row) => fromRowPicking<Flag>(r, ['userId']),
  commitment: (r: Row) => fromRowPicking<Commitment>(r, ['userId']),
  annotation: (r: Row) => fromRowPicking<Annotation>(r, ['userId', 'updatedAt']),
};
