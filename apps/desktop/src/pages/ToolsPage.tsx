import React, { useEffect, useMemo, useState } from "react";
import type { ToolDefinition } from "@agentos/shared";
import { EmptyState, ErrorState, LoadingState, RiskBadge } from "@agentos/ui";
import { useApp } from "../stores/AppContext.js";

export function ToolsPage(): React.JSX.Element {
  const { client } = useApp();
  const [tools, setTools] = useState<ToolDefinition[]>([]);
  const [category, setCategory] = useState<string>("");
  const [query, setQuery] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!client) return;
    setLoading(true);
    setError(null);
    void client
      .listTools()
      .then((items) => setTools(items))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [client]);

  const categories = useMemo(
    () => Array.from(new Set(tools.map((t) => t.category))).sort(),
    [tools],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tools.filter((t) => {
      if (category && t.category !== category) return false;
      if (!q) return true;
      return (
        t.id.toLowerCase().includes(q) ||
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q)
      );
    });
  }, [tools, category, query]);

  return (
    <div className="flex flex-col gap-5">
      <div className="border-b border-[var(--border-hairline)] pb-4">
        <h1 className="text-[22px] font-semibold tracking-tight">Tool Registry</h1>
        <p className="text-[13px] text-[var(--ink-secondary)] mt-0.5">
          Deterministic, strongly typed tools with declared schemas, risk tiers, timeouts, rollback
          support, and verification procedures.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[220px]">
          <label
            htmlFor="tool-search"
            className="block text-[12px] font-medium text-[var(--ink-secondary)] mb-1"
          >
            Search tools
          </label>
          <input
            id="tool-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by tool ID, name, or capability"
            className="w-full rounded-[6px] border border-[var(--border-control)] bg-[var(--surface-elevated)] px-3 py-1.5 text-[13px]"
          />
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter tools by category">
          <button
            type="button"
            aria-pressed={category === ""}
            onClick={() => setCategory("")}
            className={[
              "px-3 py-1.5 rounded-[6px] text-[13px] border",
              category === ""
                ? "bg-[var(--accent-fill)] text-white border-transparent font-medium"
                : "bg-[var(--surface-elevated)] border-[var(--border-control)]",
            ].join(" ")}
          >
            All ({tools.length})
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              aria-pressed={category === cat}
              onClick={() => setCategory(cat)}
              className={[
                "px-3 py-1.5 rounded-[6px] text-[13px] border capitalize",
                category === cat
                  ? "bg-[var(--accent-fill)] text-white border-transparent font-medium"
                  : "bg-[var(--surface-elevated)] border-[var(--border-control)]",
              ].join(" ")}
            >
              {cat.replace("_", " ")}
            </button>
          ))}
        </div>
      </div>

      {loading && <LoadingState label="Loading registered tools..." />}
      {error && <ErrorState message={error} />}

      {!loading && filtered.length === 0 && (
        <EmptyState
          title="No tools match your filter"
          description="Clear the search term or choose another tool category."
          actionLabel="Show all tools"
          onAction={() => {
            setCategory("");
            setQuery("");
          }}
        />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
        {filtered.map((tool) => (
          <article
            key={tool.id}
            className="rounded-[8px] border border-[var(--border-hairline)] bg-[var(--surface-elevated)] p-4 flex flex-col gap-2"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-[15px] font-semibold">{tool.name}</h2>
                <p className="font-mono text-[12px] text-[var(--ink-secondary)]">{tool.id}</p>
              </div>
              <RiskBadge level={tool.risk_level} />
            </div>

            <p className="text-[13px] text-[var(--ink-secondary)] m-0">{tool.description}</p>

            <dl className="grid grid-cols-2 gap-2 text-[12px] pt-2 border-t border-[var(--border-hairline)] m-0">
              <div>
                <dt className="text-[var(--ink-secondary)]">Permissions</dt>
                <dd className="font-mono m-0">{tool.required_permissions.join(", ") || "none"}</dd>
              </div>
              <div>
                <dt className="text-[var(--ink-secondary)]">Timeout / Rollback</dt>
                <dd className="font-mono m-0">
                  {tool.timeout_sec}s / {tool.supports_rollback ? "Supported" : "N/A"}
                </dd>
              </div>
              <div className="col-span-2">
                <dt className="text-[var(--ink-secondary)]">Verification</dt>
                <dd className="m-0">{tool.verification_procedure}</dd>
              </div>
            </dl>

            <details className="text-[12px] pt-1">
              <summary className="text-[var(--ink-secondary)]">Inspect input schema</summary>
              <pre className="mt-1.5 p-2.5 rounded bg-[var(--surface-recessed)] overflow-x-auto text-[11px]">
                {JSON.stringify(tool.input_schema, null, 2)}
              </pre>
            </details>
          </article>
        ))}
      </div>
    </div>
  );
}
