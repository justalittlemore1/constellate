import { describe, expect, it } from 'vitest';
import { computeLinks, meanEmbedding, planConcepts, recomputeConcepts, type ConceptState } from './build';
import {
  buildMergeUserMessage,
  heuristicDecisions,
  MERGE_RESPONSE_JSON_SCHEMA,
  MergeResponseSchema,
  normalizeDecisions,
  type MergeRequest,
} from './merge';

const req: MergeRequest = {
  conversationTitle: 'Coffee with Sam',
  nodes: [
    {
      id: 'n1',
      level: 1,
      label: 'Existentialism',
      summary: 'Sartre and freedom.',
      candidates: [{ id: 'c1', name: 'Existentialism', description: null, similarity: 0.95 }],
    },
    {
      id: 'n2',
      level: 2,
      label: 'Java Island Trip',
      summary: 'Travel plans to Java.',
      candidates: [{ id: 'c2', name: 'Java Programming', description: 'The language', similarity: 0.8 }],
    },
    { id: 'n3', level: 1, label: 'Morning Runs', summary: 'Running before work.', candidates: [] },
  ],
};

describe('merge decisions', () => {
  it('maps short ids back, keeps valid answers and repairs invalid ones, one decision per node', () => {
    // aliases: n1/n2/n3 → n1/n2/n3 ids; c1 → 'c1' (first candidate seen), c2 → 'c2'
    const raw = MergeResponseSchema.parse({
      decisions: [
        { node: 'n1', same_as: 'c1', new_concept: null },
        // same_as outside this node's candidates → rejected, falls back to its new concept
        {
          node: 'n2',
          same_as: 'c1',
          new_concept: {
            name: 'Java (Island) Travel Plans Indonesia',
            description: 'Travel to Java.',
            broader_than: null,
            narrower_than: 'c9',
            related_to: [],
          },
        },
        // n3 skipped by the model; unknown node ignored
        { node: 'ghost', same_as: 'c1', new_concept: null },
      ],
    });
    expect(normalizeDecisions(raw, req)).toEqual([
      { nodeId: 'n1', sameAs: 'c1' },
      { nodeId: 'n2', newConcept: { name: 'Java (Island) Travel Plans', description: 'Travel to Java.' } },
      { nodeId: 'n3', newConcept: { name: 'Morning Runs', description: 'Running before work.' } },
    ]);
  });

  it('never shows UUIDs to the model and translates aliases back', () => {
    const uuidReq: MergeRequest = {
      conversationTitle: 'Run | club',
      conversationDate: '2026-11-07T20:00:00.000Z',
      nodes: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          level: 1,
          label: 'Jogging',
          summary: 'Morning jogs.',
          candidates: [
            {
              id: '22222222-2222-4222-8222-222222222222',
              name: 'Running',
              description: 'Going for runs',
              similarity: 0.88,
            },
          ],
        },
      ],
    };
    const msg = buildMergeUserMessage(uuidReq);
    expect(msg).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
    expect(msg).toContain('n1 | L1 | Jogging | Morning jogs.');
    expect(msg).toContain('  c1 | Running | Going for runs | similarity 0.88');
    expect(msg).toContain('Run / club | 2026-11-07');
    const decisions = normalizeDecisions(
      MergeResponseSchema.parse({ decisions: [{ node: 'n1', same_as: 'c1', new_concept: null }] }),
      uuidReq,
    );
    expect(decisions).toEqual([
      { nodeId: '11111111-1111-4111-8111-111111111111', sameAs: '22222222-2222-4222-8222-222222222222' },
    ]);
  });

  it('the heuristic fallback only joins near-identical candidates', () => {
    expect(heuristicDecisions(req).map((d) => ('sameAs' in d ? d.sameAs : d.newConcept.name))).toEqual([
      'c1',
      'Java Island Trip',
      'Morning Runs',
    ]);
  });

  it('the user message lists every topic and candidate id; the schema is strict', () => {
    const msg = buildMergeUserMessage(req);
    for (const id of ['n1 |', 'n2 |', 'n3 |', 'c1 |', 'c2 |']) expect(msg).toContain(id);
    expect(msg).toContain('no candidates: must be a new concept');
    expect(MERGE_RESPONSE_JSON_SCHEMA.additionalProperties).toBe(false);
    expect(MERGE_RESPONSE_JSON_SCHEMA.properties.decisions.items.required).toEqual(['node', 'same_as', 'new_concept']);
  });
});

describe('concept planning', () => {
  const existing: ConceptState[] = [
    { id: 'c1', name: 'Existentialism', description: null, parentConceptId: null, mentionCount: 2, embedding: [1, 0] },
  ];

  it('dedupes new concepts by name and reuses existing names', () => {
    let k = 0;
    const plan = planConcepts(
      existing,
      [
        { nodeId: 'a', newConcept: { name: 'Running', description: 'x' } },
        { nodeId: 'b', newConcept: { name: 'running', description: 'y' } },
        { nodeId: 'c', newConcept: { name: 'existentialism', description: 'z' } },
        { nodeId: 'd', sameAs: 'c1' },
        { nodeId: 'e', newConcept: { name: 'Philosophy', description: 'p', broaderThan: 'c1' } },
      ],
      () => `new${++k}`,
    );
    expect(plan.created.map((c) => c.name)).toEqual(['Running', 'Philosophy']);
    expect(plan.assignments).toEqual([
      { nodeId: 'a', conceptId: 'new1' },
      { nodeId: 'b', conceptId: 'new1' },
      { nodeId: 'c', conceptId: 'c1' },
      { nodeId: 'd', conceptId: 'c1' },
      { nodeId: 'e', conceptId: 'new2' },
    ]);
    expect(plan.reparented).toEqual([{ id: 'c1', parentConceptId: 'new2' }]);
  });

  it('recomputes mention counts and mean embeddings from member nodes', () => {
    const out = recomputeConcepts(existing, [
      { id: 'n1', conversationId: 'x', conceptId: 'c1', embedding: [1, 0] },
      { id: 'n2', conversationId: 'y', conceptId: 'c1', embedding: [0, 1] },
      { id: 'n3', conversationId: 'y', conceptId: null, embedding: [0, 1] },
    ]);
    expect(out[0]!.mentionCount).toBe(2);
    expect(out[0]!.embedding![0]).toBeCloseTo(Math.SQRT1_2);
    expect(meanEmbedding([])).toBeNull();
  });
});

describe('links', () => {
  it('derives broader, co-discussed and related links with combined weights', () => {
    const concepts: ConceptState[] = [
      { id: 'a', name: 'Philosophy', description: null, parentConceptId: null, mentionCount: 1, embedding: [1, 0] },
      {
        id: 'b',
        name: 'Existentialism',
        description: null,
        parentConceptId: 'a',
        mentionCount: 2,
        embedding: [0.9, Math.sqrt(1 - 0.81)],
      },
      { id: 'c', name: 'Running', description: null, parentConceptId: null, mentionCount: 1, embedding: [0, 1] },
      { id: 'z', name: 'Orphan', description: null, parentConceptId: null, mentionCount: 0, embedding: [1, 0] },
    ];
    const nodes = [
      { id: '1', conversationId: 'x', conceptId: 'a', embedding: null },
      { id: '2', conversationId: 'x', conceptId: 'b', embedding: null },
      { id: '3', conversationId: 'y', conceptId: 'b', embedding: null },
      { id: '4', conversationId: 'y', conceptId: 'c', embedding: null },
    ];
    const links = computeLinks(concepts, nodes);
    const find = (s: string, t: string, r: string) =>
      links.find((l) => l.sourceId === s && l.targetId === t && l.relation === r);
    // a→b broader: S = 0.9, C = 1/2, R = 1 → 0.45 + 0.15 + 0.2
    expect(find('a', 'b', 'broader')?.weight).toBeCloseTo(0.8);
    expect(find('a', 'b', 'co_discussed')?.weight).toBeCloseTo(0.8);
    expect(find('b', 'c', 'co_discussed')).toBeDefined();
    expect(find('a', 'c', 'co_discussed')).toBeUndefined();
    expect(find('a', 'b', 'related')).toBeDefined(); // cosine 0.9 ≥ 0.6
    expect(find('a', 'c', 'related')).toBeUndefined(); // orthogonal
    expect(links.some((l) => l.sourceId === 'z' || l.targetId === 'z')).toBe(false); // no mentions → no links
  });
});
