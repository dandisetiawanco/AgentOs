import React, { useCallback, useEffect, useState } from "react";
import { Download, Pencil, Plus, Trash2 } from "lucide-react";
import type { MemoryCategory, MemoryItem } from "@agentos/shared";
import { Button, EmptyState, ErrorState, LoadingState, ModalDialog } from "@agentos/ui";
import { useApp } from "../stores/AppContext.js";

const CATEGORIES: MemoryCategory[] = [
  "preference",
  "user_instruction",
  "workspace_context",
  "workflow",
  "task_history",
  "tool_result",
];

export function MemoryPage(): React.JSX.Element {
  const { client, settings, notify, setRoute } = useApp();
  const [entries, setEntries] = useState<MemoryItem[]>([]);
  const [query, setQuery] = useState<string>("");
  const [category, setCategory] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [editorOpen, setEditorOpen] = useState<boolean>(false);
  const [editing, setEditing] = useState<MemoryItem | null>(null);
  const [clearConfirmOpen, setClearConfirmOpen] = useState<boolean>(false);

  const [title, setTitle] = useState<string>("");
  const [content, setContent] = useState<string>("");
  const [catDraft, setCatDraft] = useState<MemoryCategory>("preference");
  const [tagsDraft, setTagsDraft] = useState<string>("");
  const [pinned, setPinned] = useState<boolean>(false);

  const loadMemory = useCallback(async () => {
    if (!client) return;
    setLoading(true);
    setError(null);
    try {
      const items = await client.listMemory({
        category: category || undefined,
        query: query.trim() || undefined,
      });
      setEntries(items);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [client, category, query]);

  useEffect(() => {
    void loadMemory();
  }, [loadMemory]);

  const openCreate = () => {
    setEditing(null);
    setTitle("");
    setContent("");
    setCatDraft("preference");
    setTagsDraft("");
    setPinned(false);
    setEditorOpen(true);
  };

  const openEdit = (item: MemoryItem) => {
    setEditing(item);
    setTitle(item.title);
    setContent(item.content);
    setCatDraft(item.category);
    setTagsDraft(item.tags.join(", "));
    setPinned(item.pinned);
    setEditorOpen(true);
  };

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!client) return;
    const tags = tagsDraft
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    try {
      if (editing) {
        await client.updateMemory(editing.id, { title, content, tags, pinned });
        notify("Memory record updated.", "success");
      } else {
        await client.createMemory({ category: catDraft, title, content, tags, pinned });
        notify("Memory record saved.", "success");
      }
      setEditorOpen(false);
      await loadMemory();
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "error");
    }
  };

  const handleDelete = async (id: string) => {
    if (!client) return;
    try {
      await client.deleteMemory(id);
      await loadMemory();
      notify("Memory record deleted.", "info");
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "error");
    }
  };

  const handleClearAll = async () => {
    if (!client) return;
    try {
      const res = await client.clearMemory();
      setClearConfirmOpen(false);
      await loadMemory();
      notify(`Cleared ${res.deleted_count} memory record(s).`, "info");
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "error");
    }
  };

  const handleExport = async () => {
    if (!client) return;
    try {
      const payload = await client.exportMemory();
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "agentos-memory-export.json";
      a.click();
      URL.revokeObjectURL(url);
      notify("Exported local memory JSON.", "success");
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "error");
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-hairline)] pb-4">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight">Local Memory</h1>
          <p className="text-[13px] text-[var(--ink-secondary)] mt-0.5">
            Optional SQLite memory store. Retention: {settings?.memory_retention_days ?? 90} days. Credentials are automatically rejected.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => void handleExport()}>
            <Download className="w-3.5 h-3.5" aria-hidden={true} />
            Export JSON
          </Button>
          {entries.length > 0 && (
            <Button variant="danger" size="sm" onClick={() => setClearConfirmOpen(true)}>
              Clear all
            </Button>
          )}
          <Button
            variant="primary"
            size="sm"
            disabled={settings?.memory_enabled === false}
            onClick={openCreate}
          >
            <Plus className="w-3.5 h-3.5" aria-hidden={true} />
            Add memory
          </Button>
        </div>
      </div>

      {settings?.memory_enabled === false && (
        <div className="rounded-[6px] border border-[var(--warning-border)] bg-[var(--warning-tint)] text-[var(--warning-ink)] px-4 py-3 text-[13px] flex flex-wrap items-center justify-between gap-2">
          <span>Local memory is currently disabled in Settings. No new memories are saved or retrieved.</span>
          <Button variant="secondary" size="sm" onClick={() => setRoute("settings")}>
            Change in Settings
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[220px]">
          <label htmlFor="mem-search" className="block text-[12px] font-medium text-[var(--ink-secondary)] mb-1">
            Search memory
          </label>
          <input
            id="mem-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search titles, content, or tags"
            className="w-full rounded-[6px] border border-[var(--border-control)] bg-[var(--surface-elevated)] px-3 py-1.5 text-[13px]"
          />
        </div>
        <div>
          <label htmlFor="mem-cat" className="block text-[12px] font-medium text-[var(--ink-secondary)] mb-1">
            Category
          </label>
          <select
            id="mem-cat"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="rounded-[6px] border border-[var(--border-control)] bg-[var(--surface-elevated)] px-3 py-1.5 text-[13px]"
          >
            <option value="">All categories</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c.replace("_", " ")}</option>
            ))}
          </select>
        </div>
      </div>

      {loading && <LoadingState label="Searching local memory..." />}
      {error && <ErrorState message={error} onRetry={() => void loadMemory()} />}

      {!loading && entries.length === 0 && (
        <EmptyState
          title="No memory records found"
          description="Add a user preference or instruction, or complete verified tasks while memory is enabled."
          actionLabel={settings?.memory_enabled === false ? undefined : "Add memory record"}
          onAction={settings?.memory_enabled === false ? undefined : openCreate}
        />
      )}

      <div className="flex flex-col gap-3">
        {entries.map((item) => (
          <article
            key={item.id}
            className="rounded-[8px] border border-[var(--border-hairline)] bg-[var(--surface-elevated)] p-4 flex flex-col gap-2"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-mono px-2 py-0.5 rounded-[4px] bg-[var(--surface-recessed)] border border-[var(--border-hairline)]">
                    {item.category}
                  </span>
                  {item.pinned && (
                    <span className="text-[11px] px-2 py-0.5 rounded-[4px] bg-[var(--accent-tint)] text-[var(--accent-ink)] border border-[var(--accent-border)]">
                      Pinned
                    </span>
                  )}
                </div>
                <h2 className="text-[15px] font-semibold mt-1.5">{item.title}</h2>
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  variant="secondary"
                  size="sm"
                  aria-label={`Edit ${item.title}`}
                  onClick={() => openEdit(item)}
                >
                  <Pencil className="w-3.5 h-3.5" aria-hidden={true} />
                  Edit
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  aria-label={`Delete ${item.title}`}
                  onClick={() => void handleDelete(item.id)}
                >
                  <Trash2 className="w-3.5 h-3.5" aria-hidden={true} />
                </Button>
              </div>
            </div>
            <p className="text-[13px] whitespace-pre-wrap m-0">{item.content}</p>
            {item.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {item.tags.map((tag) => (
                  <span key={tag} className="text-[11px] font-mono text-[var(--ink-secondary)]">
                    #{tag}
                  </span>
                ))}
              </div>
            )}
          </article>
        ))}
      </div>

      <ModalDialog
        open={editorOpen}
        title={editing ? "Edit memory record" : "Add local memory record"}
        onClose={() => setEditorOpen(false)}
      >
        <form onSubmit={(e) => void handleSave(e)} className="flex flex-col gap-3.5">
          {!editing && (
            <div>
              <label htmlFor="m-cat" className="block text-[12px] font-medium mb-1">Category</label>
              <select
                id="m-cat"
                value={catDraft}
                onChange={(e) => setCatDraft(e.target.value as MemoryCategory)}
                className="w-full rounded-[6px] border border-[var(--border-control)] bg-[var(--canvas)] px-3 py-1.5 text-[13px]"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c.replace("_", " ")}</option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label htmlFor="m-title" className="block text-[12px] font-medium mb-1">Title</label>
            <input
              id="m-title"
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Preferred report format"
              className="w-full rounded-[6px] border border-[var(--border-control)] bg-[var(--canvas)] px-3 py-1.5 text-[13px]"
            />
          </div>
          <div>
            <label htmlFor="m-content" className="block text-[12px] font-medium mb-1">Content</label>
            <textarea
              id="m-content"
              rows={4}
              required
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Use concise Markdown bullet summaries with file paths."
              className="w-full rounded-[6px] border border-[var(--border-control)] bg-[var(--canvas)] px-3 py-1.5 text-[13px]"
            />
          </div>
          <div>
            <label htmlFor="m-tags" className="block text-[12px] font-medium mb-1">
              Tags (comma separated)
            </label>
            <input
              id="m-tags"
              type="text"
              value={tagsDraft}
              onChange={(e) => setTagsDraft(e.target.value)}
              placeholder="reports, markdown"
              className="w-full rounded-[6px] border border-[var(--border-control)] bg-[var(--canvas)] px-3 py-1.5 text-[13px]"
            />
          </div>
          <label htmlFor="m-pin" className="inline-flex items-center gap-2 text-[13px]">
            <input
              id="m-pin"
              type="checkbox"
              checked={pinned}
              onChange={(e) => setPinned(e.target.checked)}
            />
            Pin record (exempt from retention expiry)
          </label>
          <div className="flex justify-end gap-2 pt-2 border-t border-[var(--border-hairline)]">
            <Button variant="secondary" onClick={() => setEditorOpen(false)}>Cancel</Button>
            <Button type="submit" variant="primary">Save memory</Button>
          </div>
        </form>
      </ModalDialog>

      <ModalDialog
        open={clearConfirmOpen}
        title="Clear all local memory?"
        description="This permanently removes all stored memory records from SQLite. Audit logs and task history remain intact."
        onClose={() => setClearConfirmOpen(false)}
      >
        <div className="flex justify-end gap-2">
          <Button variant="secondary" autoFocus onClick={() => setClearConfirmOpen(false)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => void handleClearAll()}>
            Clear all records
          </Button>
        </div>
      </ModalDialog>
    </div>
  );
}
