import { Map as MapIcon } from 'lucide-react';
import { useMemo } from 'react';
import { Link } from 'react-router';
import type { BrainPayload, Concept } from '../../lib/api';
import { formatClock, formatDate } from '../../lib/format';
import { routes } from '../../lib/routes';
import { Sheet } from '../../ui';
import { PlayMomentButton } from '../library/PlayMomentButton';
import { useParticipants } from '../library/queries';
import { neighbours, RELATION_WORDS } from './brainLayout';

/**
 * Drill-down for one concept: name, mention count, related concepts, then every occurrence —
 * date, conversation, participants, what was said, play from that moment, open in the map.
 */
export function ConceptSheet({
  payload,
  concept,
  onClose,
  onSelect,
}: {
  payload: BrainPayload;
  concept: Concept | null;
  onClose: () => void;
  onSelect: (id: string) => void;
}) {
  return (
    <Sheet open={concept !== null} onClose={onClose} title={concept?.name ?? ''} testId="concept-sheet">
      {concept && <ConceptBody payload={payload} concept={concept} onSelect={onSelect} />}
    </Sheet>
  );
}

function ConceptBody({
  payload,
  concept,
  onSelect,
}: {
  payload: BrainPayload;
  concept: Concept;
  onSelect: (id: string) => void;
}) {
  const occurrences = useMemo(() => payload.occurrences[concept.id] ?? [], [payload.occurrences, concept.id]);
  const conversationIds = useMemo(() => [...new Set(occurrences.map((o) => o.conversationId))], [occurrences]);
  const participants = useParticipants(conversationIds);
  const namesFor = (conversationId: string) =>
    (participants.data ?? []).filter((p) => p.conversationId === conversationId).map((p) => p.displayName);

  const byId = new Map(payload.concepts.map((c) => [c.id, c]));
  const related = [...neighbours(payload, concept.id)]
    .map((id) => {
      const c = byId.get(id);
      const link = payload.links.find(
        (l) => (l.sourceId === concept.id && l.targetId === id) || (l.targetId === concept.id && l.sourceId === id),
      );
      return c && link ? { concept: c, relation: link.relation } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => b.concept.mentionCount - a.concept.mentionCount);

  const conversations = conversationIds.length;
  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="text-sm text-ink-2">
          Mentioned {concept.mentionCount} {concept.mentionCount === 1 ? 'time' : 'times'} across {conversations}{' '}
          {conversations === 1 ? 'conversation' : 'conversations'}
        </p>
        {concept.description && <p className="mt-2">{concept.description}</p>}
      </div>

      {related.length > 0 && (
        <section aria-labelledby="related-h">
          <h3 id="related-h" className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-2">
            Connected concepts
          </h3>
          <ul className="flex flex-wrap gap-2">
            {related.map(({ concept: c, relation }) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => onSelect(c.id)}
                  className="hover-wash min-h-11 border border-line px-3 text-left text-sm"
                >
                  <span className="font-semibold">{c.name}</span>
                  <span className="text-ink-2"> · {RELATION_WORDS[relation]}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="occ-h">
        <h3 id="occ-h" className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-2">
          Where it came up
        </h3>
        {occurrences.length === 0 ? (
          <p className="text-sm text-ink-2">No moments are linked to this concept any more.</p>
        ) : (
          <ul className="hairline-list flex flex-col border-y border-line">
            {occurrences.map((o) => {
              const names = namesFor(o.conversationId);
              return (
                <li key={o.nodeId} className="flex items-center gap-2 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-ink-2">
                      {formatDate(o.startedAt)} · {formatClock(o.startMs)}
                    </p>
                    <p className="truncate font-semibold">{o.conversationTitle}</p>
                    {names.length > 0 && <p className="text-xs text-ink-2">With {names.join(', ')}</p>}
                    <p className="text-sm text-ink-2">
                      <span className="text-ink">{o.label}</span>
                      {o.summary ? ` — ${o.summary}` : ''}
                    </p>
                  </div>
                  <PlayMomentButton
                    momentKey={`occ-${o.nodeId}`}
                    audioPath={o.audioPath}
                    atMs={o.startMs}
                    label={`${o.label} in ${o.conversationTitle}`}
                  />
                  <Link
                    to={routes.conversation(o.conversationId, { node: o.nodeId, at: o.startMs })}
                    aria-label={`Open ${o.label} in the map of ${o.conversationTitle}`}
                    className="hover-wash inline-flex size-11 shrink-0 items-center justify-center rounded-full text-ink"
                  >
                    <MapIcon aria-hidden size={18} />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
