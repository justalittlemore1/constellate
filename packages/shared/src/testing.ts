/**
 * Small builders for tests across the monorepo. Not used in production code.
 */
import type { Conversation, GraphState, TopicEdge, TopicNode } from './domain';
import { emptyGraph } from './domain';
import type { GraphOp, OpBatch, OpSource } from './ops';

export const TEST_CONVERSATION_ID = 'c0000000-0000-4000-8000-000000000001';
export const TEST_USER_ID = 'a0000000-0000-4000-8000-000000000001';

export function makeConversation(over: Partial<Conversation> = {}): Conversation {
  return {
    id: TEST_CONVERSATION_ID,
    userId: TEST_USER_ID,
    folderId: null,
    title: 'Untitled conversation',
    summary: null,
    macroAnchor: null,
    status: 'live',
    isSolo: false,
    isFavorite: false,
    location: null,
    reflection: null,
    startedAt: '2026-11-07T20:00:00.000Z',
    endedAt: null,
    durationMs: null,
    audioPath: null,
    ...over,
  };
}

export function makeGraph(over: Partial<Conversation> = {}): GraphState {
  return emptyGraph(makeConversation(over));
}

export function makeNode(id: string, over: Partial<TopicNode> = {}): TopicNode {
  return {
    id,
    conversationId: TEST_CONVERSATION_ID,
    kind: 'topic',
    status: 'active',
    level: 1,
    label: id,
    summary: '',
    details: null,
    parentId: null,
    threadId: id,
    seq: 1,
    startMs: 0,
    endMs: null,
    mentionedAtMs: null,
    utteranceIds: [],
    speakers: [],
    highlighted: false,
    createdBy: 'ai',
    x: 0,
    y: 0,
    ...over,
  };
}

export function makeEdge(id: string, sourceId: string, targetId: string, kind: TopicEdge['kind'] = 'flow'): TopicEdge {
  return { id, conversationId: TEST_CONVERSATION_ID, sourceId, targetId, kind };
}

export function batch(seq: number, ops: GraphOp[], source: OpSource = 'live'): OpBatch {
  return { conversationId: TEST_CONVERSATION_ID, seq, at: '2026-11-07T20:00:00.000Z', source, ops };
}
