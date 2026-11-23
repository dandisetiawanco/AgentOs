import React, { useState } from "react";
import { Check, FolderPlus, KeyRound, Trash2 } from "lucide-react";
import { Button, ErrorState, LoadingState } from "@agentos/ui";
import type { ThemePreference } from "@agentos/shared";
import { useApp } from "../stores/AppContext.js";
import { pickWorkspaceDirectory } from "../services/bridge.js";

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
    notify,
  } = useApp();

  const [apiKeyDrafts, setApiKeyDrafts] = useState<Record<string, string>>({});
  const [testingId, setTestingId] = useState<string | null>(null);
  const [wsName, setWsName] = useState<string>("");
  const [wsPath, setWsPath] = useState<string>("");
  const [wsReadOnly, setWsReadOnly] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string | null>(null);

  if (loading && !settings) {
    return <LoadingState label="Loading settings..." />;
  }

  if (error && !settings) {
    return <ErrorState message={error} onRetry={() => void refreshAll()} />;
  }

  if (!settings || !client) {
    return <ErrorState message="Backend connection is not ready." onRetry={() => void refreshAll()} />;
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

  const themeOptions: Array<{ value: ThemePreference; label: string }> = [
    { value: "system", label: `System (Currently ${systemThemeMode})` },
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
  ];

  return (
    <div className="flex flex-col gap-7">
      <div className="border-b border-[var(--border-hairline)] pb-4">
        <h1 className="text-[24px] font-semibold tracking-tight">Settings</h1>
        <p className="text-[14px] text-[var(--ink-secondary)] mt-1">
          Configure AI providers, OS Keychain credentials, authorized workspaces, security limits, and appearance.
        </p>
      </div>

      {actionError && <ErrorState message={actionError} />}

      {/* Appearance */}
      <section
        aria-labelledby="appearance-heading"
        className="rounded-[8px] border border-[var(--border-hairline)] bg-[var(--surface-elevated)] p-5"
      >
        <h2 id="appearance-heading" className="text-[16px] font-semibold">
          Appearance
        </h2>
        <p className="text-[13px] text-[var(--ink-secondary)] mt-1">
          Follow macOS appearance or pin an explicit color scheme.
        </p>
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
                  "px-3.5 py-2 rounded-[6px] text-[13px] border font-medium transition-colors",
                  active
                    ? "bg-[var(--accent-fill)] text-white border-transparent"
                    : "bg-[var(--surface-elevated)] text-[var(--ink-primary)] border-[var(--border-control)] hover:bg-[var(--surface-recessed)]",
                ].join(" ")}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </section>

      {/* AI Providers & Credentials */}
      <section
        aria-labelledby="providers-heading"
        className="rounded-[8px] border border-[var(--border-hairline)] bg-[var(--surface-elevated)] p-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 id="providers-heading" className="text-[16px] font-semibold">
              AI Providers & Keychain Credentials
            </h2>
            <p className="text-[13px] text-[var(--ink-secondary)] mt-0.5">
              Supply your own API keys. Keys are stored via {bootstrap?.keychain.backend ?? "OS Keychain"}, never in SQLite or browser storage.
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-3">
          {providers.map((provider) => {
            const isDefault = settings.default_provider_id === provider.id;
            return (
              <div
                key={provider.id}
                className="rounded-[6px] border border-[var(--border-hairline)] bg-[var(--canvas)] p-4 flex flex-col gap-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-[14px] font-semibold">{provider.display_name}</span>
                      {provider.capabilities.is_mock && (
                        <span className="text-[11px] px-2 py-0.5 rounded-[4px] border border-[var(--warning-border)] bg-[var(--warning-tint)] text-[var(--warning-ink)]">
                          Offline Test Mode
                        </span>
                      )}
                      {isDefault && (
                        <span className="text-[11px] px-2 py-0.5 rounded-[4px] border border-[var(--accent-border)] bg-[var(--accent-tint)] text-[var(--accent-ink)]">
                          Default
                        </span>
                      )}
                    </div>
                    <p className="text-[12px] font-mono text-[var(--ink-secondary)] mt-0.5">
                      Model: {provider.default_model}
                      {provider.base_url ? ` | Endpoint: ${provider.base_url}` : ""}
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
                  <div className="flex flex-wrap items-end gap-2 pt-2 border-t border-[var(--border-hairline)]">
                    <div className="flex-1 min-w-[220px]">
                      <label
                        htmlFor={`key-${provider.id}`}
                        className="block text-[12px] font-medium text-[var(--ink-secondary)] mb-1"
                      >
                        API Key {provider.has_api_key ? `(Stored: ${provider.api_key_hint ?? "present"})` : "(Not stored)"}
                      </label>
                      <input
                        id={`key-${provider.id}`}
                        type="password"
                        autoComplete="off"
                        value={apiKeyDrafts[provider.id] ?? ""}
                        onChange={(e) =>
                          setApiKeyDrafts((prev) => ({ ...prev, [provider.id]: e.target.value }))
                        }
                        placeholder="Paste your API key"
                        className="w-full rounded-[6px] border border-[var(--border-control)] bg-[var(--surface-elevated)] px-3 py-1.5 text-[13px]"
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
      </section>

      {/* Workspaces */}
      <section
        aria-labelledby="workspaces-heading"
        className="rounded-[8px] border border-[var(--border-hairline)] bg-[var(--surface-elevated)] p-5"
      >
        <h2 id="workspaces-heading" className="text-[16px] font-semibold">
          Authorized Workspaces
        </h2>
        <p className="text-[13px] text-[var(--ink-secondary)] mt-1">
          AgentOS denies filesystem access by default. Only explicitly listed folders can be accessed by tools.
        </p>

        <form onSubmit={(e) => void handleAddWorkspace(e)} className="mt-4 grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
          <div className="md:col-span-3">
            <label htmlFor="ws-name" className="block text-[12px] font-medium text-[var(--ink-secondary)] mb-1">
              Label
            </label>
            <input
              id="ws-name"
              type="text"
              required
              value={wsName}
              onChange={(e) => setWsName(e.target.value)}
              placeholder="Project Docs"
              className="w-full rounded-[6px] border border-[var(--border-control)] bg-[var(--canvas)] px-3 py-1.5 text-[13px]"
            />
          </div>
          <div className="md:col-span-6">
            <label htmlFor="ws-path" className="block text-[12px] font-medium text-[var(--ink-secondary)] mb-1">
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
                className="flex-1 rounded-[6px] border border-[var(--border-control)] bg-[var(--canvas)] px-3 py-1.5 text-[13px] font-mono"
              />
              <Button variant="secondary" size="sm" onClick={() => void handleBrowseWorkspace()}>
                Browse
              </Button>
            </div>
          </div>
          <div className="md:col-span-3 flex items-center justify-between gap-2">
            <label htmlFor="ws-readonly" className="inline-flex items-center gap-2 text-[13px]">
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
            <p className="text-[13px] text-[var(--ink-secondary)]">
              No workspaces authorized yet. Add a folder above to enable File and Document tools.
            </p>
          ) : (
            workspaces.map((ws) => (
              <div
                key={ws.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-[6px] border border-[var(--border-hairline)] bg-[var(--canvas)] px-3.5 py-2.5"
              >
                <div className="min-w-0">
                  <p className="text-[14px] font-medium">{ws.name}</p>
                  <p className="text-[12px] font-mono text-[var(--ink-secondary)] truncate">
                    {ws.path} {ws.read_only ? "(Read-only)" : "(Read/Write with approval)"}
                  </p>
                </div>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => void handleRevokeWorkspace(ws.id)}
                >
                  <Trash2 className="w-3.5 h-3.5" aria-hidden={true} />
                  Revoke
                </Button>
              </div>
            ))
          )}
        </div>
      </section>

      {/* About */}
      <section
        aria-labelledby="about-heading"
        className="rounded-[8px] border border-[var(--border-hairline)] bg-[var(--surface-elevated)] p-5 text-[13px]"
      >
        <h2 id="about-heading" className="text-[16px] font-semibold">
          About AgentOS
        </h2>
        <p className="text-[var(--ink-secondary)] mt-1">
          AgentOS v{bootstrap?.app.version ?? "0.1.0"} by {bootstrap?.app.author ?? "Dandi Setiawan"} ({bootstrap?.app.organization ?? "NGOPREK DIGITAL"}). Licensed under Apache License 2.0.
        </p>
      </section>
    </div>
  );
}
