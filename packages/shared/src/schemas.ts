/**
 * zod schemas for every type that crosses a process boundary. Each schema is annotated with its
 * TypeScript type, so a mismatch between this file and domain.ts / ops.ts / ws.ts fails typecheck.
 */
import { z } from 'zod';
import type {
  Annotation,
  Commitment,
  Conversation,
  Flag,
  GraphState,
  TopicEdge,
  TopicNode,
  Utterance,
} from './domain';
import type { GraphOp, OpBatch } from './ops';
import type { ClientMsg, ServerMsg } from './ws';
import type { TranscriptFixture } from './interpreter';

const id = z.string().min(1);
const ms = z.number().finite().nonnegative();
const iso = z.string().min(1);

export const NodeKindSchema = z.enum(['topic', 'pending', 'parked']);
export const NodeStatusSchema = z.enum(['provisional', 'active', 'closed', 'unexplored', 'resolved']);
export const LevelSchema = z.union([z.literal(0), z.literal(1), z.literal(2)]);
export const EdgeKindSchema = z.enum(['flow', 'revisit', 'tether', 'user']);
export const FlagSourceSchema = z.enum(['button', 'key', 'media', 'tap']);

export const TopicNodeSchema: z.ZodType<TopicNode> = z.object({
  id,
  conversationId: id,
  kind: NodeKindSchema,
  status: NodeStatusSchema,
  level: LevelSchema,
  label: z.string().min(1),
  summary: z.string(),
  details: z.string().nullable(),
  parentId: id.nullable(),
  threadId: id,
  seq: z.number().int().positive(),
  startMs: ms,
  endMs: ms.nullable(),
  mentionedAtMs: ms.nullable(),
  utteranceIds: z.array(z.string()),
  speakers: z.array(z.number().int().nonnegative()),
  highlighted: z.boolean(),
  createdBy: z.enum(['ai', 'user']),
  x: z.number().finite(),
  y: z.number().finite(),
});

export const TopicEdgeSchema: z.ZodType<TopicEdge> = z.object({
  id,
  conversationId: id,
  sourceId: id,
  targetId: id,
  kind: EdgeKindSchema,
});

export const UtteranceSchema: z.ZodType<Utterance> = z.object({
  id,
  conversationId: id,
  speaker: z.number().int().nonnegative().nullable(),
  startMs: ms,
  endMs: ms,
  text: z.string(),
});

export const FlagSchema: z.ZodType<Flag> = z.object({
  id,
  conversationId: id,
  atMs: ms,
  nodeId: id.nullable(),
  note: z.string().nullable(),
  source: FlagSourceSchema,
});

export const CommitmentSchema: z.ZodType<Commitment> = z.object({
  id,
  conversationId: id,
  nodeId: id.nullable(),
  text: z.string().min(1),
  speaker: z.number().int().nonnegative().nullable(),
  atMs: ms,
  done: z.boolean(),
});

export const AnnotationSchema: z.ZodType<Annotation> = z.object({
  id,
  conversationId: id,
  nodeId: id.nullable(),
  text: z.string(),
  x: z.number().finite(),
  y: z.number().finite(),
});

export const ConversationSchema: z.ZodType<Conversation> = z.object({
  id,
  userId: id,
  folderId: id.nullable(),
  title: z.string(),
  summary: z.string().nullable(),
  macroAnchor: z.string().nullable(),
  status: z.enum(['live', 'processing', 'ready', 'failed']),
  isSolo: z.boolean(),
  isFavorite: z.boolean(),
  location: z.string().nullable(),
  reflection: z.string().nullable(),
  startedAt: iso,
  endedAt: iso.nullable(),
  durationMs: ms.nullable(),
  audioPath: z.string().nullable(),
});

export const GraphStateSchema: z.ZodType<GraphState> = z.object({
  conversation: ConversationSchema,
  nodes: z.record(z.string(), TopicNodeSchema),
  edges: z.record(z.string(), TopicEdgeSchema),
  activeNodeId: id.nullable(),
  flags: z.array(FlagSchema),
  commitments: z.array(CommitmentSchema),
  annotations: z.array(AnnotationSchema),
  lastSeq: z.number().int().nonnegative(),
});

// Patches: every field optional, identity fields excluded.
const NodePatchSchema = z
  .object({
    kind: NodeKindSchema,
    status: NodeStatusSchema,
    level: LevelSchema,
    label: z.string().min(1),
    summary: z.string(),
    details: z.string().nullable(),
    parentId: id.nullable(),
    threadId: id,
    startMs: ms,
    endMs: ms.nullable(),
    mentionedAtMs: ms.nullable(),
    utteranceIds: z.array(z.string()),
    speakers: z.array(z.number().int().nonnegative()),
    highlighted: z.boolean(),
    createdBy: z.enum(['ai', 'user']),
    x: z.number().finite(),
    y: z.number().finite(),
  })
  .partial()
  .strict();

const ConversationPatchSchema = z
  .object({
    folderId: id.nullable(),
    title: z.string(),
    summary: z.string().nullable(),
    macroAnchor: z.string().nullable(),
    status: z.enum(['live', 'processing', 'ready', 'failed']),
    isSolo: z.boolean(),
    isFavorite: z.boolean(),
    location: z.string().nullable(),
    reflection: z.string().nullable(),
    startedAt: iso,
    endedAt: iso.nullable(),
    durationMs: ms.nullable(),
    audioPath: z.string().nullable(),
  })
  .partial()
  .strict();

export const GraphOpSchema: z.ZodType<GraphOp> = z.discriminatedUnion('op', [
  z.object({ op: z.literal('node.add'), node: TopicNodeSchema as z.ZodType<TopicNode> }),
  z.object({ op: z.literal('node.update'), id, patch: NodePatchSchema }),
  z.object({ op: z.literal('node.merge'), fromId: id, intoId: id }),
  z.object({ op: z.literal('node.remove'), id }),
  z.object({ op: z.literal('edge.add'), edge: TopicEdgeSchema }),
  z.object({ op: z.literal('edge.remove'), id }),
  z.object({ op: z.literal('active.set'), nodeId: id.nullable() }),
  z.object({ op: z.literal('flag.add'), flag: FlagSchema }),
  z.object({ op: z.literal('commitment.add'), commitment: CommitmentSchema }),
  z.object({
    op: z.literal('commitment.update'),
    id,
    patch: z.object({ text: z.string().min(1).optional(), done: z.boolean().optional() }).strict(),
  }),
  z.object({ op: z.literal('annotation.upsert'), annotation: AnnotationSchema }),
  z.object({ op: z.literal('conversation.update'), patch: ConversationPatchSchema }),
]);

export const OpBatchSchema: z.ZodType<OpBatch> = z.object({
  conversationId: id,
  seq: z.number().int().positive(),
  at: iso,
  source: z.enum(['live', 'finalize', 'user']),
  ops: z.array(GraphOpSchema),
});

export const ClientMsgSchema: z.ZodType<ClientMsg> = z.discriminatedUnion('t', [
  z.object({
    t: z.literal('hello'),
    token: z.string().min(1),
    source: z.enum(['mic', 'replay-transcript']),
    fixture: z.string().optional(),
    conversationId: id.optional(),
    resumeAtMs: ms.optional(),
    consent: z.literal(true),
  }),
  z.object({
    t: z.literal('flag'),
    atMs: ms,
    source: FlagSourceSchema,
    note: z.string().trim().min(1).max(140).optional(),
  }),
  z.object({ t: z.literal('park'), text: z.string().min(1).max(80), atMs: ms }),
  z.object({ t: z.literal('stop') }),
  z.object({ t: z.literal('ping') }),
]);

export const ServerMsgSchema: z.ZodType<ServerMsg> = z.discriminatedUnion('t', [
  z.object({ t: z.literal('ready'), conversationId: id }),
  z.object({
    t: z.literal('caption'),
    text: z.string(),
    final: z.boolean(),
    utteranceId: z.string().optional(),
    startMs: ms,
  }),
  z.object({ t: z.literal('ops'), batch: OpBatchSchema as z.ZodType<OpBatch> }),
  z.object({ t: z.literal('status'), stage: z.enum(['listening', 'thinking', 'reconnecting-stt', 'finalizing']) }),
  z.object({
    t: z.literal('error'),
    code: z.enum(['auth', 'stt', 'llm', 'db', 'protocol']),
    message: z.string(),
    fatal: z.boolean(),
  }),
  z.object({ t: z.literal('stopped'), conversationId: id }),
  z.object({ t: z.literal('pong') }),
]);

export const TranscriptFixtureSchema: z.ZodType<TranscriptFixture> = z.object({
  id,
  title: z.string(),
  description: z.string(),
  speakers: z.array(z.string()).min(1),
  utterances: z.array(
    z.object({ speaker: z.number().int().nonnegative(), startMs: ms, endMs: ms, text: z.string().min(1) }),
  ),
  expect: z.record(z.string(), z.unknown()).optional(),
});
