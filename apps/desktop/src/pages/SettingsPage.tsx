import React, { useCallback, useEffect, useState } from "react";
import {
  Check,
  Download,
  FolderPlus,
  KeyRound,
  Plug,
  RefreshCw,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import type { ComputerUseCapabilities, McpServerRecord, ThemePreference } from "@agentos/shared";
import {
  Button,
  ErrorState,
  GlassPanel,
  LoadingState,
  SectionHeader,
  StatusIndicator,
} from "@agentos/ui";
import { useApp } from "../stores/AppContext.js";
import { pickWorkspaceDirectory } from "../services/bridge.js";

const SETTINGS_SECTIONS = [
  { id: "sec-providers", label: "AI Providers & Keys" },
  { id: "sec-appearance", label: "Appearance" },
  { id: "sec-workspaces", label: "Workspace Permissions" },
  { id: "sec-memory-budgets", label: "Memory & Budgets" },
  { id: "sec-security", label: "Security & Terminal" },
  { id: "sec-computer-use", label: "Computer Use" },
  { id: "sec-mcp", label: "MCP Integrations" },
  { id: "sec-diagnostics", label: "Diagnostics & About" },
];

export function SettingsPage(): React.JSX.Element {
  const {
    client,
    bootstrap,
    settings,
    providers,
    workspaces,
    loading,
    error,
    themePreference,
    systemThemeMode,
    setThemePreference,
    updateSettings,
    refreshAll,
    restartBackend,
    notify,
  } = useApp();

  const [apiKeyDrafts, setApiKeyDrafts] = useState<Record<string, string>>({});
  const [testingId, setTestingId] = useState<string | null>(null);
  const [wsName, setWsName] = useState<string>("");
  const [wsPath, setWsPath] = useState<string>("");
  const [wsReadOnly, setWsReadOnly] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [allowlistText, setAllowlistText] = useState<string>("");
  const [approvedAppsText, setApprovedAppsText] = useState<string>("");

  const [mcpServers, setMcpServers] = useState<McpServerRecord[]>([]);
  const [mcpName, setMcpName] = useState<string>("");
  const [mcpTransport, setMcpTransport] = useState<"stdio" | "sse" | "streamable_http">("stdio");
  const [mcpCommand, setMcpCommand] = useState<string>("");
  const [mcpUrl, setMcpUrl] = useState<string>("");
  const [discoveredTools, setDiscoveredTools] = useState<
    Record<string, Array<{ name: string; description: string }>>
  >({});

  const [cuCaps, setCuCaps] = useState<ComputerUseCapabilities | null>(null);

  useEffect(() => {
    if (settings) {
      setAllowlistText(settings.terminal_allowlist.join(", "));
      setApprovedAppsText(settings.computer_use_approved_apps.join(", "));
    }
  }, [settings]);

  const loadAdvanced = useCallback(async () => {
    if (!client) return;
    try {
      const [servers, caps] = await Promise.all([
        client.listMcpServers(),
        client.getComputerUseCapabilities(),
      ]);
      setMcpServers(servers);
      setCuCaps(caps);
    } catch {
      // Ignore if bootstrapping.
    }
  }, [client]);

  useEffect(() => {
    void loadAdvanced();
  }, [loadAdvanced]);

  if (loading && !settings) {
    return <LoadingState label="Loading settings..." />;
  }
  if (error && !settings) {
    return <ErrorState message={error} onRetry={() => void refreshAll()} />;
  }
  if (!settings || !client) {
    return (
      <ErrorState message="Backend connection is not ready." onRetry={() => void refreshAll()} />
    );
  }

  const handleSaveKey = async (providerId: string) => {
    const value = (apiKeyDrafts[providerId] ?? "").trim();
    if (!value) return;
    setActionError(null);
    try {
      await client.setProviderCredential(providerId, value);
      setApiKeyDrafts((prev) => ({ ...prev, [providerId]: "" }));
      await refreshAll();
      notify(`Stored API key for ${providerId} in OS credential vault.`, "success");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleRemoveKey = async (providerId: string) => {
    setActionError(null);
    try {
      await client.deleteProviderCredential(providerId);
      await refreshAll();
      notify(`Removed stored API key for ${providerId}.`, "info");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleTestProvider = async (providerId: string) => {
    setTestingId(providerId);
    setActionError(null);
    try {
      const result = await client.testProvider(providerId);
      notify(`${result.message} (${result.latency_ms} ms)`, "success");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setActionError(msg);
      notify(msg, "error");
    } finally {
      setTestingId(null);
    }
  };

  const handleBrowseWorkspace = async () => {
    const picked = await pickWorkspaceDirectory();
    if (picked) {
      setWsPath(picked);
      if (!wsName.trim()) {
        const segments = picked.split(/[/\\]/).filter(Boolean);
        setWsName(segments[segments.length - 1] ?? "Workspace");
      }
    }
  };

  const handleAddWorkspace = async (event: React.FormEvent) => {
    event.preventDefault();
    setActionError(null);
    try {
      await client.createWorkspace({
        name: wsName.trim() || "Authorized Workspace",
        path: wsPath.trim(),
        read_only: wsReadOnly,
      });
      setWsName("");
      setWsPath("");
      setWsReadOnly(false);
      await refreshAll();
      notify("Workspace authorized.", "success");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleRevokeWorkspace = async (workspaceId: string) => {
    setActionError(null);
    try {
      await client.deleteWorkspace(workspaceId);
      await refreshAll();
      notify("Workspace authorization revoked.", "info");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleAddMcp = async (event: React.FormEvent) => {
    event.preventDefault();
    setActionError(null);
    try {
      const command = mcpCommand
        .split(/\s+/)
        .map((s) => s.trim())
        .filter(Boolean);
      await client.createMcpServer({
        name: mcpName.trim(),
        transport: mcpTransport,
        command: mcpTransport === "stdio" ? command : [],
        url: mcpTransport !== "stdio" ? mcpUrl.trim() : null,
        enabled: true,
      });
      setMcpName("");
      setMcpCommand("");
      setMcpUrl("");
      await loadAdvanced();
      notify("Registered external MCP server (tools untrusted by default).", "success");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleTestMcp = async (serverId: string) => {
    setActionError(null);
    try {
      const res = await client.testMcpServer(serverId);
      setDiscoveredTools((prev) => ({ ...prev, [serverId]: res.tools }));
      await loadAdvanced();
      notify(res.message, res.ok ? "success" : "error");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleToggleMcpTool = async (server: McpServerRecord, toolName: string) => {
    const exists = server.allowed_tools.includes(toolName);
    const next = exists
      ? server.allowed_tools.filter((t) => t !== toolName)
      : [...server.allowed_tools, toolName];
    await client.authorizeMcpTools(server.id, next);
    await loadAdvanced();
    notify(
      exists ? `Revoked MCP tool '${toolName}'.` : `Authorized MCP tool '${toolName}'.`,
      "info",
    );
  };

  const handleExportDiagnostics = async () => {
    try {
      const diag = await client.exportDiagnostics();
      const blob = new Blob([JSON.stringify(diag, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "agentos-diagnostics-redacted.json";
      a.click();
      URL.revokeObjectURL(url);
      notify("Exported redacted diagnostics report.", "success");
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "error");
    }
  };

  const themeOptions: Array<{ value: ThemePreference; label: string }> = [
    { value: "system", label: `System (Currently ${systemThemeMode})` },
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
  ];

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        as="h1"
        title="Settings"
        description="Configure AI providers, OS Keychain credentials, appearance, workspace boundaries, execution budgets, security policies, and diagnostics."
      />

      {actionError && <ErrorState message={actionError} />}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Sticky section index on desktop */}
        <nav
          aria-label="Settings sections"
          className="hidden lg:block lg:col-span-3 sticky top-[72px]"
        >
          <GlassPanel variant="surface" padding="sm">
            <ul className="m-0 p-0 list-none flex flex-col gap-0.5">
              {SETTINGS_SECTIONS.map((sec) => (
                <li key={sec.id}>
                  <a
                    href={`#${sec.id}`}
                    className="block px-3 py-2 rounded-[8px] text-[13px] text-[var(--ink-secondary)] hover:bg-[var(--surface-elevated)] hover:text-[var(--ink-primary)] transition-colors duration-150 no-underline"
                  >
                    {sec.label}
                  </a>
                </li>
              ))}
            </ul>
          </GlassPanel>
        </nav>

        <div className="lg:col-span-9 flex flex-col gap-5">
          {/* AI Providers & Credentials */}
          <GlassPanel
            as="section"
            id="sec-providers"
            aria-labelledby="providers-heading"
            variant="surface"
            padding="md"
            className="flex flex-col gap-4 scroll-mt-[72px]"
          >
            <SectionHeader
              id="providers-heading"
              title="AI Providers & API Credentials"
              description={`Bring your own API keys. Credentials are stored via ${bootstrap?.keychain.backend ?? "OS Keychain"} and never exposed in plaintext, SQLite, or logs.`}
            />

            <div className="flex flex-col gap-3">
              {providers.map((provider) => {
                const isDefault = settings.default_provider_id === provider.id;
                return (
                  <div
                    key={provider.id}
                    className="rounded-[10px] border border-[var(--border-hairline)] bg-[var(--surface-elevated)]/80 p-4 flex flex-col gap-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[14px] font-semibold text-[var(--ink-primary)]">
                            {provider.display_name}
                          </span>
                          {provider.capabilities.is_mock && (
                            <StatusIndicator tone="warning" label="Offline Test Mode" />
                          )}
                          {isDefault && <StatusIndicator tone="running" label="Default" />}
                        </div>
                        <p className="text-[12px] font-mono text-[var(--ink-secondary)] mt-1 mb-0">
                          Model: {provider.default_model}
                          {provider.base_url ? ` · Endpoint: ${provider.base_url}` : ""}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          loading={testingId === provider.id}
                          onClick={() => void handleTestProvider(provider.id)}
                        >
                          Test connection
                        </Button>
                        {!isDefault && (
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={() =>
                              void updateSettings({
                                ...settings,
                                default_provider_id: provider.id,
                                default_model: provider.default_model,
                              })
                            }
                          >
                            <Check className="w-3.5 h-3.5" aria-hidden={true} />
                            Set as default
                          </Button>
                        )}
                      </div>
                    </div>

                    {provider.capabilities.requires_api_key && (
                      <div className="flex flex-wrap items-end gap-2 pt-3 border-t border-[var(--border-hairline)]">
                        <div className="flex-1 min-w-[220px]">
                          <label
                            htmlFor={`key-${provider.id}`}
                            className="block text-[11.5px] font-medium text-[var(--ink-secondary)] mb-1"
                          >
                            API Key{" "}
                            {provider.has_api_key
                              ? `(Stored: ${provider.api_key_hint ?? "present"})`
                              : "(Not stored)"}
                          </label>
                          <input
                            id={`key-${provider.id}`}
                            type="password"
                            autoComplete="off"
                            value={apiKeyDrafts[provider.id] ?? ""}
                            onChange={(e) =>
                              setApiKeyDrafts((prev) => ({
                                ...prev,
                                [provider.id]: e.target.value,
                              }))
                            }
                            placeholder="Paste your API key"
                            className="glass-input w-full px-3 py-1.5 text-[13px]"
                          />
                        </div>
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={!(apiKeyDrafts[provider.id] ?? "").trim()}
                          onClick={() => void handleSaveKey(provider.id)}
                        >
                          <KeyRound className="w-3.5 h-3.5" aria-hidden={true} />
                          Save to Keychain
                        </Button>
                        {provider.has_api_key && (
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={() => void handleRemoveKey(provider.id)}
                          >
                            Remove key
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </GlassPanel>

          {/* Appearance */}
          <GlassPanel
            as="section"
            id="sec-appearance"
            aria-labelledby="appearance-heading"
            variant="surface"
            padding="md"
            className="scroll-mt-[72px]"
          >
            <SectionHeader
              id="appearance-heading"
              title="Appearance"
              description="Follow macOS system appearance or pin an explicit light or dark scheme."
            />
            <div role="radiogroup" aria-label="Color theme" className="mt-4 flex flex-wrap gap-2">
              {themeOptions.map((opt) => {
                const active = themePreference === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setThemePreference(opt.value)}
                    className={[
                      "px-3.5 py-2 rounded-[9px] text-[13px] border font-medium transition-colors duration-150",
                      active
                        ? "bg-[var(--accent-fill)] text-white border-transparent shadow-sm"
                        : "bg-[var(--surface-elevated)] text-[var(--ink-primary)] border-[var(--border-control)] hover:bg-[var(--surface-recessed)]",
                    ].join(" ")}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </GlassPanel>

          {/* Workspace Permissions */}
          <GlassPanel
            as="section"
            id="sec-workspaces"
            aria-labelledby="workspaces-heading"
            variant="surface"
            padding="md"
            className="scroll-mt-[72px]"
          >
            <SectionHeader
              id="workspaces-heading"
              title="Workspace Permissions"
              description="Default-deny filesystem boundary. System paths, credential folders, and symlink escapes are permanently blocked."
            />

            <form
              onSubmit={(e) => void handleAddWorkspace(e)}
              className="mt-4 grid grid-cols-1 md:grid-cols-12 gap-3 items-end"
            >
              <div className="md:col-span-3">
                <label
                  htmlFor="ws-name"
                  className="block text-[11.5px] font-medium text-[var(--ink-secondary)] mb-1"
                >
                  Label
                </label>
                <input
                  id="ws-name"
                  type="text"
                  required
                  value={wsName}
                  onChange={(e) => setWsName(e.target.value)}
                  placeholder="Project Docs"
                  className="glass-input w-full px-3 py-1.5 text-[13px]"
                />
              </div>
              <div className="md:col-span-6">
                <label
                  htmlFor="ws-path"
                  className="block text-[11.5px] font-medium text-[var(--ink-secondary)] mb-1"
                >
                  Directory path
                </label>
                <div className="flex gap-2">
                  <input
                    id="ws-path"
                    type="text"
                    required
                    value={wsPath}
                    onChange={(e) => setWsPath(e.target.value)}
                    placeholder="/Users/name/Documents/project"
                    className="glass-input flex-1 px-3 py-1.5 text-[13px] font-mono"
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void handleBrowseWorkspace()}
                  >
                    Browse
                  </Button>
                </div>
              </div>
              <div className="md:col-span-3 flex items-center justify-between gap-2">
                <label
                  htmlFor="ws-readonly"
                  className="inline-flex items-center gap-2 text-[12.5px]"
                >
                  <input
                    id="ws-readonly"
                    type="checkbox"
                    checked={wsReadOnly}
                    onChange={(e) => setWsReadOnly(e.target.checked)}
                  />
                  Read-only
                </label>
                <Button type="submit" variant="primary" size="sm">
                  <FolderPlus className="w-3.5 h-3.5" aria-hidden={true} />
                  Authorize
                </Button>
              </div>
            </form>

            <div className="mt-4 flex flex-col gap-2">
              {workspaces.length === 0 ? (
                <p className="text-[13px] text-[var(--ink-secondary)] m-0">
                  No workspaces authorized yet. Add a folder above to enable File and Document
                  tools.
                </p>
              ) : (
                workspaces.map((ws) => (
                  <div
                    key={ws.id}
                    className="flex items-center justify-between gap-3 rounded-[10px] border border-[var(--border-hairline)] bg-[var(--surface-elevated)]/80 px-3.5 py-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-[13.5px] font-semibold m-0 text-[var(--ink-primary)]">
                        {ws.name}
                      </p>
                      <p className="text-[12px] font-mono text-[var(--ink-secondary)] truncate m-0">
                        {ws.path} {ws.read_only ? "(Read-only)" : "(Read/Write with approval)"}
                      </p>
                    </div>
                    <Button
                      variant="danger"
                      size="sm"
                      className="shrink-0"
                      onClick={() => void handleRevokeWorkspace(ws.id)}
                    >
                      <Trash2 className="w-3.5 h-3.5" aria-hidden={true} />
                      Revoke
                    </Button>
                  </div>
                ))
              )}
            </div>
          </GlassPanel>

          {/* Memory & Execution Budgets */}
          <GlassPanel
            as="section"
            id="sec-memory-budgets"
            aria-labelledby="memory-budgets-heading"
            variant="surface"
            padding="md"
            className="flex flex-col gap-4 scroll-mt-[72px]"
          >
            <SectionHeader
              id="memory-budgets-heading"
              title="Memory & Execution Budgets"
              description="Hard limits enforced deterministically on every task regardless of model output."
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label htmlFor="sec-dur" className="block text-[11.5px] font-medium mb-1">
                  Max duration (sec)
                </label>
                <input
                  id="sec-dur"
                  type="number"
                  min={10}
                  max={3600}
                  value={settings.max_duration_sec}
                  onChange={(e) =>
                    void updateSettings({
                      ...settings,
                      max_duration_sec: Number(e.target.value) || 300,
                    })
                  }
                  className="glass-input w-full px-2.5 py-1.5 text-[13px]"
                />
              </div>
              <div>
                <label htmlFor="sec-calls" className="block text-[11.5px] font-medium mb-1">
                  Max tool calls
                </label>
                <input
                  id="sec-calls"
                  type="number"
                  min={1}
                  max={100}
                  value={settings.max_tool_calls}
                  onChange={(e) =>
                    void updateSettings({
                      ...settings,
                      max_tool_calls: Number(e.target.value) || 25,
                    })
                  }
                  className="glass-input w-full px-2.5 py-1.5 text-[13px]"
                />
              </div>
              <div>
                <label htmlFor="sec-tokens" className="block text-[11.5px] font-medium mb-1">
                  Max tokens / task
                </label>
                <input
                  id="sec-tokens"
                  type="number"
                  min={1000}
                  max={500000}
                  value={settings.max_tokens}
                  onChange={(e) =>
                    void updateSettings({
                      ...settings,
                      max_tokens: Number(e.target.value) || 64000,
                    })
                  }
                  className="glass-input w-full px-2.5 py-1.5 text-[13px]"
                />
              </div>
              <div>
                <label htmlFor="sec-ret" className="block text-[11.5px] font-medium mb-1">
                  Memory retention (days)
                </label>
                <input
                  id="sec-ret"
                  type="number"
                  min={1}
                  max={3650}
                  value={settings.memory_retention_days}
                  onChange={(e) =>
                    void updateSettings({
                      ...settings,
                      memory_retention_days: Number(e.target.value) || 90,
                    })
                  }
                  className="glass-input w-full px-2.5 py-1.5 text-[13px]"
                />
              </div>
            </div>

            <label htmlFor="sec-mem-en" className="inline-flex items-center gap-2 text-[13px]">
              <input
                id="sec-mem-en"
                type="checkbox"
                checked={settings.memory_enabled}
                onChange={(e) =>
                  void updateSettings({ ...settings, memory_enabled: e.target.checked })
                }
              />
              Enable optional local SQLite memory
            </label>
          </GlassPanel>

          {/* Security & Restricted Terminal */}
          <GlassPanel
            as="section"
            id="sec-security"
            aria-labelledby="security-heading"
            variant="surface"
            padding="md"
            className="flex flex-col gap-3.5 scroll-mt-[72px]"
          >
            <SectionHeader
              id="security-heading"
              title="Security & Restricted Terminal"
              description="Structured argv execution with command allowlists, sanitized environment variables, and permanent destructive blocklists."
            />

            <label htmlFor="sec-term-en" className="inline-flex items-center gap-2 text-[13px]">
              <input
                id="sec-term-en"
                type="checkbox"
                checked={settings.terminal_enabled}
                onChange={(e) =>
                  void updateSettings({ ...settings, terminal_enabled: e.target.checked })
                }
              />
              Enable restricted allowlisted terminal execution (disabled by default; still requires
              HIGH approval per command)
            </label>

            <div className="flex flex-wrap items-end gap-2">
              <div className="flex-1 min-w-[240px]">
                <label
                  htmlFor="sec-allow"
                  className="block text-[11.5px] font-medium text-[var(--ink-secondary)] mb-1"
                >
                  Terminal command allowlist (comma separated)
                </label>
                <input
                  id="sec-allow"
                  type="text"
                  value={allowlistText}
                  onChange={(e) => setAllowlistText(e.target.value)}
                  className="glass-input w-full px-3 py-1.5 text-[13px] font-mono"
                />
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  void updateSettings({
                    ...settings,
                    terminal_allowlist: allowlistText
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
              >
                Save allowlist
              </Button>
            </div>
          </GlassPanel>

          {/* Computer Use */}
          <GlassPanel
            as="section"
            id="sec-computer-use"
            aria-labelledby="cu-heading"
            variant="surface"
            padding="md"
            className="flex flex-col gap-3.5 scroll-mt-[72px]"
          >
            <SectionHeader
              id="cu-heading"
              title="Computer Use & Desktop Capabilities"
              description="Separate opt-in authorization for desktop window inspection and single-frame screenshots. Continuous recording is permanently disabled."
              action={
                cuCaps && (
                  <Button
                    variant={cuCaps.emergency_stop_active ? "primary" : "danger"}
                    size="sm"
                    onClick={async () => {
                      await client.triggerEmergencyStop(!cuCaps.emergency_stop_active);
                      await loadAdvanced();
                      notify(
                        cuCaps.emergency_stop_active
                          ? "Emergency stop cleared."
                          : "Emergency stop activated.",
                        cuCaps.emergency_stop_active ? "success" : "error",
                      );
                    }}
                  >
                    <ShieldAlert className="w-3.5 h-3.5" aria-hidden={true} />
                    {cuCaps.emergency_stop_active ? "Clear emergency stop" : "Emergency stop"}
                  </Button>
                )
              }
            />

            {cuCaps && (
              <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-[12.5px] rounded-[10px] bg-[var(--surface-recessed)]/80 border border-[var(--border-hairline)] p-3 m-0">
                <div>
                  <dt className="text-[var(--ink-secondary)]">Platform adapter</dt>
                  <dd className="font-mono mt-0.5 m-0">
                    {cuCaps.platform} ({cuCaps.arch}) ·{" "}
                    {cuCaps.supported ? "Supported" : "Unavailable"}
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--ink-secondary)]">macOS Accessibility</dt>
                  <dd className="font-mono mt-0.5 m-0">
                    {cuCaps.accessibility_granted === null
                      ? "Unknown"
                      : cuCaps.accessibility_granted
                        ? "Granted"
                        : "Not granted"}
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--ink-secondary)]">macOS Screen Recording</dt>
                  <dd className="font-mono mt-0.5 m-0">
                    {cuCaps.screen_recording_granted === null
                      ? "Unknown"
                      : cuCaps.screen_recording_granted
                        ? "Granted"
                        : "Not granted"}
                  </dd>
                </div>
              </dl>
            )}

            <label htmlFor="cu-en" className="inline-flex items-center gap-2 text-[13px]">
              <input
                id="cu-en"
                type="checkbox"
                checked={settings.computer_use_enabled}
                onChange={(e) =>
                  void updateSettings({ ...settings, computer_use_enabled: e.target.checked }).then(
                    () => void loadAdvanced(),
                  )
                }
              />
              Authorize desktop inspection and approved app launching
            </label>

            <label htmlFor="cu-sc" className="inline-flex items-center gap-2 text-[13px]">
              <input
                id="cu-sc"
                type="checkbox"
                checked={settings.computer_use_screen_capture}
                onChange={(e) =>
                  void updateSettings({
                    ...settings,
                    computer_use_screen_capture: e.target.checked,
                  }).then(() => void loadAdvanced())
                }
              />
              Separately authorize single-frame desktop screenshots (excludes password and keychain
              apps)
            </label>

            <div className="flex flex-wrap items-end gap-2">
              <div className="flex-1 min-w-[240px]">
                <label
                  htmlFor="cu-apps"
                  className="block text-[11.5px] font-medium text-[var(--ink-secondary)] mb-1"
                >
                  Approved applications (comma separated)
                </label>
                <input
                  id="cu-apps"
                  type="text"
                  value={approvedAppsText}
                  onChange={(e) => setApprovedAppsText(e.target.value)}
                  className="glass-input w-full px-3 py-1.5 text-[13px]"
                />
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  void updateSettings({
                    ...settings,
                    computer_use_approved_apps: approvedAppsText
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
              >
                Save approved apps
              </Button>
            </div>
          </GlassPanel>

          {/* External MCP Servers */}
          <GlassPanel
            as="section"
            id="sec-mcp"
            aria-labelledby="mcp-heading"
            variant="surface"
            padding="md"
            className="flex flex-col gap-4 scroll-mt-[72px]"
          >
            <SectionHeader
              id="mcp-heading"
              title="External MCP Servers (Optional)"
              description="External MCP servers are treated as untrusted by default. Discovered tools are never executed automatically until explicitly allowlisted."
            />

            <form
              onSubmit={(e) => void handleAddMcp(e)}
              className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end"
            >
              <div className="md:col-span-3">
                <label htmlFor="mcp-name" className="block text-[11.5px] font-medium mb-1">
                  Server name
                </label>
                <input
                  id="mcp-name"
                  type="text"
                  required
                  value={mcpName}
                  onChange={(e) => setMcpName(e.target.value)}
                  placeholder="local-docs-mcp"
                  className="glass-input w-full px-3 py-1.5 text-[13px]"
                />
              </div>
              <div className="md:col-span-2">
                <label htmlFor="mcp-trans" className="block text-[11.5px] font-medium mb-1">
                  Transport
                </label>
                <select
                  id="mcp-trans"
                  value={mcpTransport}
                  onChange={(e) =>
                    setMcpTransport(e.target.value as "stdio" | "sse" | "streamable_http")
                  }
                  className="glass-input w-full px-2.5 py-1.5 text-[13px]"
                >
                  <option value="stdio">stdio</option>
                  <option value="sse">sse</option>
                  <option value="streamable_http">streamable_http</option>
                </select>
              </div>
              <div className="md:col-span-5">
                {mcpTransport === "stdio" ? (
                  <>
                    <label htmlFor="mcp-cmd" className="block text-[11.5px] font-medium mb-1">
                      Command & args
                    </label>
                    <input
                      id="mcp-cmd"
                      type="text"
                      required
                      value={mcpCommand}
                      onChange={(e) => setMcpCommand(e.target.value)}
                      placeholder="python3 /path/to/mcp_server.py"
                      className="glass-input w-full px-3 py-1.5 text-[13px] font-mono"
                    />
                  </>
                ) : (
                  <>
                    <label htmlFor="mcp-url" className="block text-[11.5px] font-medium mb-1">
                      Endpoint URL
                    </label>
                    <input
                      id="mcp-url"
                      type="url"
                      required
                      value={mcpUrl}
                      onChange={(e) => setMcpUrl(e.target.value)}
                      placeholder="http://127.0.0.1:8088/mcp"
                      className="glass-input w-full px-3 py-1.5 text-[13px] font-mono"
                    />
                  </>
                )}
              </div>
              <div className="md:col-span-2">
                <Button type="submit" variant="primary" size="sm" className="w-full">
                  <Plug className="w-3.5 h-3.5" aria-hidden={true} />
                  Register
                </Button>
              </div>
            </form>

            {mcpServers.length === 0 ? (
              <p className="text-[13px] text-[var(--ink-secondary)] m-0">
                No external MCP servers configured.
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                {mcpServers.map((srv) => {
                  const tools = discoveredTools[srv.id] ?? [];
                  return (
                    <div
                      key={srv.id}
                      className="rounded-[10px] border border-[var(--border-hairline)] bg-[var(--surface-elevated)]/80 p-3.5 flex flex-col gap-2"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <span className="font-semibold text-[14px]">{srv.name}</span>
                          <span className="ml-2 font-mono text-[12px] text-[var(--ink-secondary)]">
                            {srv.transport} · status: {srv.status}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => void handleTestMcp(srv.id)}
                          >
                            Test & inspect tools
                          </Button>
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={async () => {
                              await client.deleteMcpServer(srv.id);
                              await loadAdvanced();
                            }}
                          >
                            Remove
                          </Button>
                        </div>
                      </div>
                      {srv.last_error && (
                        <p className="text-[12px] text-[var(--danger-ink)] m-0">{srv.last_error}</p>
                      )}
                      {tools.length > 0 && (
                        <div className="pt-2 border-t border-[var(--border-hairline)] flex flex-col gap-1.5">
                          <p className="text-[12px] font-medium m-0">
                            Discovered tools (check to authorize):
                          </p>
                          {tools.map((t) => (
                            <label
                              key={t.name}
                              className="inline-flex items-center gap-2 text-[12px]"
                            >
                              <input
                                type="checkbox"
                                checked={srv.allowed_tools.includes(t.name)}
                                onChange={() => void handleToggleMcpTool(srv, t.name)}
                              />
                              <span className="font-mono font-medium">{t.name}</span>
                              <span className="text-[var(--ink-secondary)]">{t.description}</span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </GlassPanel>

          {/* Diagnostics & About AgentOS */}
          <GlassPanel
            as="section"
            id="sec-diagnostics"
            aria-labelledby="diag-heading"
            variant="surface"
            padding="md"
            className="flex flex-col gap-3 scroll-mt-[72px]"
          >
            <SectionHeader id="diag-heading" title="Diagnostics & About AgentOS" />
            <p className="text-[13px] text-[var(--ink-secondary)] m-0">
              AgentOS v{bootstrap?.app.version ?? "0.1.0"} by{" "}
              {bootstrap?.app.author ?? "Dandi Setiawan"} (
              {bootstrap?.app.organization ?? "NGOPREK DIGITAL"}). Open-source under Apache License
              2.0.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={() => void handleExportDiagnostics()}>
                <Download className="w-3.5 h-3.5" aria-hidden={true} />
                Export redacted diagnostics
              </Button>
              <Button variant="secondary" size="sm" onClick={() => void restartBackend()}>
                <RefreshCw className="w-3.5 h-3.5" aria-hidden={true} />
                Restart local backend
              </Button>
            </div>
          </GlassPanel>
        </div>
      </div>
    </div>
  );
}
