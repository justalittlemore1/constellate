import type { Conversation } from '@constellate/shared';
import { Check, FolderPlus, MoreHorizontal, Pencil, Settings, Sparkles, Star, Trash2, X } from 'lucide-react';
import { useId, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import type { Folder } from '../../lib/api';
import { formatDate, formatDuration } from '../../lib/format';
import { routes } from '../../lib/routes';
import { Button, Chip, cx, IconButton, Sheet, TextField } from '../../ui';
import { useConversations, useFolderMutations, useFolders, useUpdateConversation } from './queries';

type Filter = { kind: 'all' } | { kind: 'folder'; id: string };

/**
 * The library drawer: Generate Brain (pinned), search by title, Favourites, folders (create /
 * rename / delete, move a conversation), and recent conversations with Solo / Group tags.
 */
export function LibraryDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  return (
    <Sheet
      open={open}
      onClose={onClose}
      side="left"
      title="Library"
      testId="library-drawer"
      header={
        <Button
          variant="brain"
          block
          icon={<Sparkles aria-hidden size={18} />}
          onClick={() => navigate(routes.brain, { state: { rebuild: true } })}
        >
          Generate Brain
        </Button>
      }
    >
      <LibraryContent />
    </Sheet>
  );
}

function LibraryContent() {
  const conversations = useConversations();
  const folders = useFolders();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>({ kind: 'all' });

  const folderList = useMemo(() => folders.data ?? [], [folders.data]);
  const activeFolder = filter.kind === 'folder' ? folderList.find((f) => f.id === filter.id) : undefined;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (conversations.data ?? []).filter(
      (c) => (!q || c.title.toLowerCase().includes(q)) && (filter.kind === 'all' || c.folderId === filter.id),
    );
  }, [conversations.data, query, filter]);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of conversations.data ?? []) if (c.folderId) m.set(c.folderId, (m.get(c.folderId) ?? 0) + 1);
    return m;
  }, [conversations.data]);

  return (
    <div className="flex flex-col gap-5">
      <TextField
        label="Search conversations"
        hideLabel
        type="search"
        placeholder="Search by title"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <nav aria-label="Library sections" className="flex flex-col">
        <DrawerLink to={routes.favorites} icon={<Star aria-hidden size={18} className="text-highlight" />}>
          Favourites
        </DrawerLink>
        <DrawerLink to={routes.settings} icon={<Settings aria-hidden size={18} />}>
          Settings
        </DrawerLink>
      </nav>

      <FolderSection folders={folderList} counts={counts} filter={filter} onFilter={setFilter} />

      <section aria-labelledby="recent-h">
        <h3 id="recent-h" className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-2">
          {activeFolder ? activeFolder.name : 'Recent conversations'}
        </h3>
        {conversations.isPending ? (
          <p className="text-ink-2 text-sm">Loading…</p>
        ) : conversations.isError ? (
          <p role="alert" className="text-sm text-flag">
            Couldn’t load your conversations.
          </p>
        ) : visible.length === 0 ? (
          <p className="text-ink-2 text-sm">
            {query
              ? 'No conversations match that title.'
              : activeFolder
                ? 'This folder is empty.'
                : 'No conversations yet. Tap the microphone to start one.'}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {visible.map((c) => (
              <ConversationRow key={c.id} conversation={c} folders={folderList} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function DrawerLink({ to, icon, children }: { to: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <Link to={to} className="flex min-h-11 items-center gap-3 rounded-xl px-2 hover:bg-white/5">
      {icon}
      <span className="font-semibold">{children}</span>
    </Link>
  );
}

function FolderSection({
  folders,
  counts,
  filter,
  onFilter,
}: {
  folders: Folder[];
  counts: Map<string, number>;
  filter: Filter;
  onFilter: (f: Filter) => void;
}) {
  const { create, rename, remove } = useFolderMutations();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  return (
    <section aria-labelledby="folders-h">
      <div className="mb-1 flex items-center justify-between">
        <h3 id="folders-h" className="text-sm font-semibold uppercase tracking-wide text-ink-2">
          Folders
        </h3>
        <IconButton label="New folder" aria-expanded={creating} onClick={() => setCreating((v) => !v)}>
          <FolderPlus aria-hidden size={20} />
        </IconButton>
      </div>

      {creating && (
        <NameForm
          label="New folder name"
          submitLabel="Create folder"
          onCancel={() => setCreating(false)}
          onSubmit={(name) => {
            create.mutate(name);
            setCreating(false);
          }}
        />
      )}

      <ul className="flex flex-col">
        <li>
          <FilterButton pressed={filter.kind === 'all'} onClick={() => onFilter({ kind: 'all' })}>
            All conversations
          </FilterButton>
        </li>
        {folders.map((f) => (
          <li key={f.id}>
            {editing === f.id ? (
              <NameForm
                label={`Rename folder ${f.name}`}
                submitLabel="Save name"
                initial={f.name}
                onCancel={() => setEditing(null)}
                onSubmit={(name) => {
                  rename.mutate({ id: f.id, name });
                  setEditing(null);
                }}
              />
            ) : confirmDelete === f.id ? (
              <div
                role="group"
                aria-label={`Delete folder ${f.name}?`}
                className="rounded-xl border border-flag/40 p-3"
              >
                <p className="mb-2 text-sm">
                  Delete <strong>{f.name}</strong>? Its conversations stay in your library.
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="danger"
                    onClick={() => {
                      remove.mutate(f.id);
                      setConfirmDelete(null);
                      if (filter.kind === 'folder' && filter.id === f.id) onFilter({ kind: 'all' });
                    }}
                  >
                    Delete folder
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirmDelete(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center">
                <FilterButton
                  pressed={filter.kind === 'folder' && filter.id === f.id}
                  onClick={() => onFilter({ kind: 'folder', id: f.id })}
                >
                  {f.name}
                  <span className="ml-auto text-sm text-ink-2" aria-label={`${counts.get(f.id) ?? 0} conversations`}>
                    {counts.get(f.id) ?? 0}
                  </span>
                </FilterButton>
                <IconButton label={`Rename folder ${f.name}`} onClick={() => setEditing(f.id)}>
                  <Pencil aria-hidden size={18} />
                </IconButton>
                <IconButton label={`Delete folder ${f.name}`} onClick={() => setConfirmDelete(f.id)}>
                  <Trash2 aria-hidden size={18} />
                </IconButton>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function FilterButton({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cx(
        'flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-xl px-2 text-left',
        pressed ? 'bg-topic/15 font-semibold text-topic' : 'hover:bg-white/5',
      )}
    >
      {children}
    </button>
  );
}

function NameForm({
  label,
  submitLabel,
  initial = '',
  onSubmit,
  onCancel,
}: {
  label: string;
  submitLabel: string;
  initial?: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial);
  function submit(e: FormEvent) {
    e.preventDefault();
    const v = name.trim();
    if (v) onSubmit(v.slice(0, 60));
  }
  return (
    <form onSubmit={submit} data-own-escape className="my-1 flex items-end gap-1">
      <TextField
        label={label}
        hideLabel
        placeholder="Folder name"
        maxLength={60}
        autoFocus
        className="flex-1"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel();
        }}
      />
      <IconButton type="submit" label={submitLabel} disabled={!name.trim()}>
        <Check aria-hidden size={20} />
      </IconButton>
      <IconButton label="Cancel" onClick={onCancel}>
        <X aria-hidden size={20} />
      </IconButton>
    </form>
  );
}

function ConversationRow({ conversation: c, folders }: { conversation: Conversation; folders: Folder[] }) {
  const update = useUpdateConversation();
  const [expanded, setExpanded] = useState(false);
  const selectId = useId();
  return (
    <li className="rounded-xl border border-line bg-white/[0.03]">
      <div className="flex items-center gap-1 pl-3">
        <Link to={routes.conversation(c.id)} className="min-h-11 min-w-0 flex-1 py-2">
          <span className="block truncate font-semibold">{c.title}</span>
          <span className="flex items-center gap-2 text-xs text-ink-2">
            {formatDate(c.startedAt)} · {formatDuration(c.durationMs)}
            <Chip tone={c.isSolo ? 'revisit' : 'topic'}>{c.isSolo ? 'Solo' : 'Group'}</Chip>
            {c.status !== 'ready' && (
              <Chip tone="thread">
                {c.status === 'live' ? 'Live' : c.status === 'failed' ? 'Failed' : 'Processing'}
              </Chip>
            )}
          </span>
        </Link>
        <IconButton
          label={`Favourite ${c.title}`}
          aria-pressed={c.isFavorite}
          onClick={() => update.mutate({ id: c.id, patch: { isFavorite: !c.isFavorite } })}
        >
          <Star aria-hidden size={20} className={c.isFavorite ? 'fill-highlight text-highlight' : 'text-ink-2'} />
        </IconButton>
        <IconButton label={`Options for ${c.title}`} aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
          <MoreHorizontal aria-hidden size={20} />
        </IconButton>
      </div>
      {expanded && (
        <div className="border-t border-line px-3 py-2">
          <label htmlFor={selectId} className="mb-1 block text-sm font-semibold text-ink-2">
            Move to folder
          </label>
          <select
            id={selectId}
            value={c.folderId ?? ''}
            onChange={(e) => update.mutate({ id: c.id, patch: { folderId: e.target.value || null } })}
            className="min-h-11 w-full rounded-xl border border-line bg-bg px-3 text-ink"
          >
            <option value="">No folder</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </div>
      )}
    </li>
  );
}
