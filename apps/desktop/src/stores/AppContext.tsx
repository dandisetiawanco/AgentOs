import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  AgentOSApiError,
  AgentOSClient,
  type AppSettings,
  type BackendConnectionConfig,
  type BootstrapResponse,
  type ProviderStatus,
  type ThemePreference,
  type Workspace,
} from "@agentos/shared";
import { getBackendConnectionConfig, restartLocalBackend } from "../services/bridge.js";
import { useTheme } from "../hooks/useTheme.js";

export type RouteId =
  | "overview"
  | "assistant"
  | "tasks"
  | "workflows"
  | "tools"
  | "memory"
  | "activity"
  | "settings";

export interface ToastNotice {
  id: string;
  tone: "info" | "success" | "error";
  message: string;
}

interface AppContextValue {
  route: RouteId;
  setRoute: (next: RouteId) => void;
  client: AgentOSClient | null;
  connection: BackendConnectionConfig | null;
  bootstrap: BootstrapResponse | null;
  settings: AppSettings | null;
  providers: ProviderStatus[];
  workspaces: Workspace[];
  loading: boolean;
  error: string | null;
  themePreference: ThemePreference;
  systemThemeMode: "light" | "dark";
  resolvedThemeMode: "light" | "dark";
  setThemePreference: (pref: ThemePreference) => void;
  refreshAll: () => Promise<void>;
  restartBackend: () => Promise<void>;
  updateSettings: (next: AppSettings) => Promise<void>;
  toasts: ToastNotice[];
  notify: (message: string, tone?: ToastNotice["tone"]) => void;
  dismissToast: (id: string) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

const ROUTE_TITLES: Record<RouteId, string> = {
  overview: "Overview",
  assistant: "Assistant",
  tasks: "Tasks",
  workflows: "Workflows",
  tools: "Tools",
  memory: "Memory",
  activity: "Activity",
  settings: "Settings",
};

export function AppProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [route, setRouteState] = useState<RouteId>("overview");
  const [connection, setConnection] = useState<BackendConnectionConfig | null>(null);
  const [bootstrap, setBootstrap] = useState<BootstrapResponse | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastNotice[]>([]);

  const {
    preference: themePreference,
    systemMode: systemThemeMode,
    resolvedMode: resolvedThemeMode,
    setPreference: setLocalThemePreference,
  } = useTheme("system");

  const client = useMemo(() => {
    if (!connection) return null;
    return new AgentOSClient(connection.base_url, connection.session_token);
  }, [connection]);

  const setRoute = useCallback((next: RouteId) => {
    setRouteState(next);
    document.title = `${ROUTE_TITLES[next]} | AgentOS`;
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const notify = useCallback((message: string, tone: ToastNotice["tone"] = "info") => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts((prev) => [...prev.slice(-1), { id, tone, message }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((item) => item.id !== id));
    }, 3500);
  }, []);

  const loadWithClient = useCallback(
    async (activeClient: AgentOSClient) => {
      setLoading(true);
      setError(null);
      try {
        const [bootData, wsList] = await Promise.all([
          activeClient.bootstrap(),
          activeClient.listWorkspaces(),
        ]);
        setBootstrap(bootData);
        setSettings(bootData.settings);
        setProviders(bootData.providers);
        setWorkspaces(wsList);
        if (
          bootData.settings.theme === "light" ||
          bootData.settings.theme === "dark" ||
          bootData.settings.theme === "system"
        ) {
          setLocalThemePreference(bootData.settings.theme);
        }
      } catch (err) {
        const message =
          err instanceof AgentOSApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Could not initialize AgentOS backend.";
        setError(message);
      } finally {
        setLoading(false);
      }
    },
    [setLocalThemePreference],
  );

  const connectAndLoad = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const cfg = await getBackendConnectionConfig();
      setConnection(cfg);
      const nextClient = new AgentOSClient(cfg.base_url, cfg.session_token);
      await loadWithClient(nextClient);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    }
  }, [loadWithClient]);

  useEffect(() => {
    void connectAndLoad();
  }, [connectAndLoad]);

  const refreshAll = useCallback(async () => {
    if (!client) {
      await connectAndLoad();
      return;
    }
    await loadWithClient(client);
  }, [client, connectAndLoad, loadWithClient]);

  const restartBackend = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const cfg = await restartLocalBackend();
      setConnection(cfg);
      const nextClient = new AgentOSClient(cfg.base_url, cfg.session_token);
      await loadWithClient(nextClient);
      notify("Local backend restarted.", "success");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      notify(msg, "error");
      setLoading(false);
    }
  }, [loadWithClient, notify]);

  const updateSettings = useCallback(
    async (next: AppSettings) => {
      if (!client) return;
      const saved = await client.updateSettings(next);
      setSettings(saved);
      setLocalThemePreference(saved.theme);
      notify("Settings saved.", "success");
    },
    [client, notify, setLocalThemePreference],
  );

  const setThemePreference = useCallback(
    (pref: ThemePreference) => {
      setLocalThemePreference(pref);
      if (client && settings) {
        void client
          .updateSettings({ ...settings, theme: pref })
          .then((saved) => setSettings(saved))
          .catch(() => {
            // Local theme already applied; ignore transient save errors.
          });
      }
    },
    [client, setLocalThemePreference, settings],
  );

  const value: AppContextValue = {
    route,
    setRoute,
    client,
    connection,
    bootstrap,
    settings,
    providers,
    workspaces,
    loading,
    error,
    themePreference,
    systemThemeMode,
    resolvedThemeMode,
    setThemePreference,
    refreshAll,
    restartBackend,
    updateSettings,
    toasts,
    notify,
    dismissToast,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) {
    throw new Error("useApp must be used inside AppProvider");
  }
  return ctx;
}
