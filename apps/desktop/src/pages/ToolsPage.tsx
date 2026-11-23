import React, { useEffect, useMemo, useState } from "react";
import { Plug, Search } from "lucide-react";
import type { McpServerRecord, ToolDefinition } from "@agentos/shared";
import {
  Button,
  EmptyState,
  ErrorState,
  GlassPanel,
  LoadingState,
  RiskBadge,
  SectionHeader,
  StatusIndicator,
} from "@agentos/ui";
import { useApp } from "../stores/AppContext.js";

const CATEGORY_LABELS: Record<string, string> = {
  file: "File Intelligence",
  document: "Document Intelligence",
  browser: "Browser Intelligence",
  system: "System Intelligence",
  terminal: "Restricted Terminal",
  computer_use: "Computer Use",
};

export function ToolsPage(): React.JSX.Element {
  const { client, settings, setRoute } = useApp();
  const [tools, setTools] = useState<ToolDefinition[]>([]);
  const [mcpServers, setMcpServers] = useState<McpServerRecord[]>([]);
  const [category, setCategory] = useState<string>("");
  const [query, setQuery] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!client) return;
    setLoading(true);
    setError(null);
    void Promise.all([client.listTools(), client.listMcpServers().catch(() => [])])
      .then(([items, servers]) => {
        setTools(items);
        setMcpServers(servers);
      })
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
      if (category && category !== "mcp" && t.category !== category) return false;
      if (category === "mcp") return false;
      if (!q) return true;
      return (
        t.id.toLowerCase().includes(q) ||
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q)
      );
    });
  }, [tools, category, query]);

  const getAvailability = (tool: ToolDefinition): { tone: "ready" | "warning"; label: string } => {
    if (tool.category === "terminal" && !settings?.terminal_enabled) {
      return { tone: "warning", label: "Opt-in disabled" };
    }
    if (tool.category === "computer_use" && !settings?.computer_use_enabled) {
      return { tone: "warning", label: "Opt-in disabled" };
    }
    return { tone: "ready", label: "Available" };
  };

  return (
    <div className="flex flex-col gap-5">
      <SectionHeader
        as="h1"
        title="Tool Registry"
        description="Strongly typed deterministic tools with declared schemas, risk tiers, timeouts, rollback support, and verification procedures."
      />

      {/* Search & Category pills */}
      <GlassPanel variant="surface" padding="sm" className="flex flex-col gap-3">
        <div className="relative">
          <label htmlFor="tool-search" className="visually-hidden">
            Search tools
          </label>
          <Search
            className="w-4 h-4 text-[var(--ink-secondary)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
            aria-hidden={true}
          />
          <input
            id="tool-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by tool ID, name, or capability..."
            className="glass-input w-full pl-9 pr-3 py-2 text-[13px]"
          />
        </div>

        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter tools by category">
          <button
            type="button"
            aria-pressed={category === ""}
            onClick={() => setCategory("")}
            className={[
              "px-3 py-1 rounded-full text-[12px] border transition-colors duration-150",
              category === ""
                ? "bg-[var(--accent-fill)] text-white border-transparent font-medium"
                : "bg-[var(--surface-elevated)]/80 text-[var(--ink-secondary)] border-[var(--border-hairline)] hover:text-[var(--ink-primary)]",
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
                "px-3 py-1 rounded-full text-[12px] border transition-colors duration-150",
                category === cat
                  ? "bg-[var(--accent-fill)] text-white border-transparent font-medium"
                  : "bg-[var(--surface-elevated)]/80 text-[var(--ink-secondary)] border-[var(--border-hairline)] hover:text-[var(--ink-primary)]",
              ].join(" ")}
            >
              {CATEGORY_LABELS[cat] ?? cat.replace("_", " ")}
            </button>
          ))}
          <button
            type="button"
            aria-pressed={category === "mcp"}
            onClick={() => setCategory("mcp")}
            className={[
              "px-3 py-1 rounded-full text-[12px] border transition-colors duration-150",
              category === "mcp"
                ? "bg-[var(--accent-fill)] text-white border-transparent font-medium"
                : "bg-[var(--surface-elevated)]/80 text-[var(--ink-secondary)] border-[var(--border-hairline)] hover:text-[var(--ink-primary)]",
            ].join(" ")}
          >
            MCP Integrations ({mcpServers.length})
          </button>
        </div>
      </GlassPanel>

      {loading && <LoadingState label="Loading registered tools..." />}
      {error && <ErrorState message={error} />}

      {!loading && category === "mcp" && (
        <section aria-label="MCP integrations" className="flex flex-col gap-3">
          {mcpServers.length === 0 ? (
            <EmptyState
              title="No external MCP servers connected"
              description="External MCP servers are untrusted by default and require explicit tool allowlisting. Register a local stdio or HTTP MCP server in Settings."
              actionLabel="Configure MCP"
              onAction={() => setRoute("settings")}
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              {mcpServers.map((srv) => (
                <GlassPanel
                  key={srv.id}
                  variant="surface"
                  padding="sm"
                  className="flex flex-col gap-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-2 font-semibold text-[14px]">
                      <Plug className="w-3.5 h-3.5 text-[var(--accent)]" aria-hidden={true} />
                      {srv.name}
                    </span>
                    <StatusIndicator
                      tone={srv.status === "connected" ? "ready" : "idle"}
                      label={srv.status}
                    />
                  </div>
                  <p className="text-[12px] font-mono text-[var(--ink-secondary)] m-0">
                    transport: {srv.transport} · {srv.allowed_tools.length} authorized tool(s)
                  </p>
                  <div className="pt-1">
                    <Button variant="ghost" size="sm" onClick={() => setRoute("settings")}>
                      Manage allowlist
                    </Button>
                  </div>
                </GlassPanel>
              ))}
            </div>
          )}
        </section>
      )}

      {!loading && category !== "mcp" && filtered.length === 0 && (
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

      {!loading && category !== "mcp" && filtered.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {filtered.map((tool) => {
            const avail = getAvailability(tool);
            return (
              <GlassPanel
                key={tool.id}
                as="article"
                variant="surface"
                padding="sm"
                className="flex flex-col gap-2.5"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="text-[14px] font-semibold text-[var(--ink-primary)] m-0">
                      {tool.name}
                    </h2>
                    <p className="font-mono text-[11.5px] text-[var(--ink-secondary)] mt-0.5 mb-0">
                      {tool.id}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                    <StatusIndicator tone={avail.tone} label={avail.label} />
                    <RiskBadge level={tool.risk_level} />
                  </div>
                </div>

                <p className="text-[12.5px] text-[var(--ink-secondary)] m-0">{tool.description}</p>

                <dl className="grid grid-cols-2 gap-2 text-[11.5px] pt-2 border-t border-[var(--border-hairline)] m-0">
                  <div>
                    <dt className="text-[var(--ink-secondary)]">Permissions</dt>
                    <dd className="font-mono text-[var(--ink-primary)] mt-0.5 m-0">
                      {tool.required_permissions.join(", ") || "none"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[var(--ink-secondary)]">Timeout / Rollback</dt>
                    <dd className="font-mono text-[var(--ink-primary)] mt-0.5 m-0">
                      {tool.timeout_sec}s / {tool.supports_rollback ? "Supported" : "N/A"}
                    </dd>
                  </div>
                </dl>

                <details className="text-[11.5px]">
                  <summary className="text-[var(--ink-secondary)] select-none">
                    Verification & input schema
                  </summary>
                  <p className="text-[12px] text-[var(--ink-primary)] mt-1.5 mb-1.5">
                    {tool.verification_procedure}
                  </p>
                  <pre className="p-2.5 rounded-[8px] bg-[var(--surface-recessed)] border border-[var(--border-hairline)] overflow-x-auto text-[11px] m-0">
                    {JSON.stringify(tool.input_schema, null, 2)}
                  </pre>
                </details>
              </GlassPanel>
            );
          })}
        </div>
      )}
    </div>
  );
}
