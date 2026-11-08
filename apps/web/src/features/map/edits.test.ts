import { applyOps } from '@constellate/shared';
import { describe, expect, it, vi } from 'vitest';
import { loadDemoGraph } from '../../lib/fixtures';
import { highlightOps, NOTE_MAX_CHARS, NOTE_OFFSET, noteOps } from './edits';
import { createPostOps, optimisticBatch } from './userOps';

const demo = loadDemoGraph();
const node = Object.values(demo.nodes).find((n) => n.label === 'Sunday Service')!;
const noted = demo.nodes[demo.annotations[0]!.nodeId!]!;

describe('edit ops', () => {
  it('highlight is a node.update the reducer accepts', () => {
    const ops = highlightOps(node, true);
    expect(ops).toEqual([{ op: 'node.update', id: node.id, patch: { highlighted: true } }]);
    const next = applyOps(demo, optimisticBatch(demo, ops));
    expect(next.nodes[node.id]!.highlighted).toBe(true);
    expect(next.lastSeq).toBe(demo.lastSeq + 1);
    // layout never moves
    expect([next.nodes[node.id]!.x, next.nodes[node.id]!.y]).toEqual([node.x, node.y]);
  });

  it('a new note sits beside its node in this conversation, trimmed and capped', () => {
    const ops = noteOps(demo, node, `  ${'a'.repeat(NOTE_MAX_CHARS + 20)}  `, undefined, 'n-1');
    expect(ops).toHaveLength(1);
    const op = ops[0]!;
    if (op.op !== 'annotation.upsert') throw new Error('wrong op');
    expect(op.annotation).toMatchObject({
      id: 'n-1',
      conversationId: demo.conversation.id,
      nodeId: node.id,
      x: Math.round(node.x + NOTE_OFFSET.x),
      y: Math.round(node.y + NOTE_OFFSET.y),
    });
    expect(op.annotation.text).toHaveLength(NOTE_MAX_CHARS);
    const next = applyOps(demo, optimisticBatch(demo, ops));
    expect(next.annotations.find((a) => a.id === 'n-1')).toBeTruthy();
  });

  it('a second note on the same node steps down instead of covering the first', () => {
    const [op] = noteOps(demo, noted, 'second', undefined, 'n-2');
    if (op?.op !== 'annotation.upsert') throw new Error('wrong op');
    expect(op.annotation.y).toBe(Math.round(noted.y + NOTE_OFFSET.y + NOTE_OFFSET.step));
  });

  it('editing keeps the note where it is', () => {
    const existing = demo.annotations[0]!;
    const [op] = noteOps(demo, noted, 'changed', existing);
    if (op?.op !== 'annotation.upsert') throw new Error('wrong op');
    expect(op.annotation).toEqual({ ...existing, text: 'changed' });
  });

  it('an empty note makes no op', () => {
    expect(noteOps(demo, node, '   ')).toEqual([]);
  });
});

describe('createPostOps', () => {
  it('POSTs { ops } with the bearer token to /conversations/:id/ops', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ batch: { seq: 9 } }), { status: 200 }));
    const post = createPostOps('http://srv/', 'tok', f as unknown as typeof fetch);
    const ops = highlightOps(node, true);
    await expect(post('c1', ops)).resolves.toEqual({ batch: { seq: 9 } });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://srv/conversations/c1/ops');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok');
    expect(JSON.parse(init.body as string)).toEqual({ ops });
  });

  it('throws the server message on refusal', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ message: 'nope' }), { status: 403 }));
    const post = createPostOps('http://srv', 'tok', f as unknown as typeof fetch);
    await expect(post('c1', [])).rejects.toThrow('nope');
  });
});
