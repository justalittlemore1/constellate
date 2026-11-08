import { applyOps, type GraphOp, type GraphState, type OpBatch, type OpSource } from '@constellate/shared';
import type { Store } from '../store/types';

type Log = (event: string, data?: Record<string, unknown>) => void;

export interface CellListener {
  onBatch?(batch: OpBatch): void;
  onPersistError?(message: string): void;
}

const RETRY_DELAYS_MS = [200, 1_000, 3_000];

/**
 * The single in-process owner of one conversation's GraphState. Live sessions and REST calls both
 * commit through it, so batch seqs never collide. `commit` applies synchronously (the interpreter
 * reads `getState()` right after `emit`) and persists asynchronously, strictly in seq order.
 */
export class GraphCell {
  private queue: Promise<void> = Promise.resolve();
  private listeners = new Set<CellListener>();
  refs = 0;
  /** a batch could not be persisted after retries; the cell is evicted on release */
  broken = false;

  constructor(
    public state: GraphState,
    public readonly userId: string,
    private readonly store: Store,
    private readonly log: Log,
  ) {}

  get conversationId(): string {
    return this.state.conversation.id;
  }

  /** Apply now, persist in order. Throws OpError (state untouched) if the reducer rejects the batch. */
  commit(ops: GraphOp[], source: OpSource): { batch: OpBatch; persisted: Promise<void> } {
    const prev = this.state;
    const batch: OpBatch = {
      conversationId: this.conversationId,
      seq: prev.lastSeq + 1,
      at: new Date().toISOString(),
      source,
      ops,
    };
    const next = applyOps(prev, batch);
    this.state = next;
    for (const l of this.listeners) l.onBatch?.(batch);
    const persisted = this.enqueue(`batch ${batch.seq}`, () => this.store.appendBatch(this.userId, batch, prev, next));
    return { batch, persisted };
  }

  /** Run a write after every batch committed so far is persisted (e.g. a node's embedding). */
  enqueue(what: string, write: () => Promise<void>): Promise<void> {
    const run = async () => {
      for (let attempt = 0; ; attempt++) {
        try {
          await write();
          return;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (attempt >= RETRY_DELAYS_MS.length) {
            this.broken = true;
            this.log('db.persist_failed', { conversationId: this.conversationId, what, message });
            for (const l of this.listeners) l.onPersistError?.(message);
            throw err;
          }
          await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
        }
      }
    };
    const p = this.queue.then(run);
    this.queue = p.catch(() => {});
    return p;
  }

  /** resolves when everything enqueued so far has been written (or has failed) */
  flush(): Promise<void> {
    return this.queue;
  }

  subscribe(l: CellListener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
}

export class GraphHub {
  private cells = new Map<string, GraphCell>();
  private loading = new Map<string, Promise<GraphCell | null>>();

  constructor(
    private readonly store: Store,
    private readonly log: Log = () => {},
  ) {}

  peek(conversationId: string): GraphCell | undefined {
    return this.cells.get(conversationId);
  }

  /** Load (or reuse) the cell; null if the conversation does not exist. Pair with `release`. */
  async acquire(conversationId: string): Promise<GraphCell | null> {
    let cell = this.cells.get(conversationId);
    if (!cell) {
      let pending = this.loading.get(conversationId);
      if (!pending) {
        pending = (async () => {
          const conv = await this.store.getConversation(conversationId);
          if (!conv) return null;
          const state = await this.store.loadGraph(conversationId);
          if (!state) return null;
          const c = new GraphCell(state, conv.conversation.userId, this.store, this.log);
          this.cells.set(conversationId, c);
          return c;
        })().finally(() => this.loading.delete(conversationId));
        this.loading.set(conversationId, pending);
      }
      cell = (await pending) ?? undefined;
      if (!cell) return null;
    }
    cell.refs++;
    return cell;
  }

  release(cell: GraphCell): void {
    cell.refs--;
    if (cell.refs > 0) return;
    // keep it until pending writes land, then drop it so the next load reads the database
    void cell.flush().then(() => {
      if (cell.refs <= 0 && this.cells.get(cell.conversationId) === cell) this.cells.delete(cell.conversationId);
    });
  }

  /** drop a cell immediately (conversation deleted) */
  evict(conversationId: string): void {
    this.cells.delete(conversationId);
  }
}
