import type { BackendConnectionConfig } from "@agentos/shared";

interface TauriInternals {
  invoke?: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
}

declare global {
  interface Window {
    __TAURI_INTERNALS__?: TauriInternals;
    __AGENTOS_TEST_CONFIG__?: BackendConnectionConfig;
  }
}

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__);
}

export async function getBackendConnectionConfig(): Promise<BackendConnectionConfig> {
  if (typeof window !== "undefined" && window.__AGENTOS_TEST_CONFIG__) {
    return window.__AGENTOS_TEST_CONFIG__;
  }

  if (isTauriRuntime()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<BackendConnectionConfig>("get_backend_config");
  }

  // Standalone browser dev/E2E fallback (connects strictly to localhost).
  const envUrl = import.meta.env.VITE_AGENTOS_API_URL as string | undefined;
  const envToken = import.meta.env.VITE_AGENTOS_SESSION_TOKEN as string | undefined;
  return {
    base_url: envUrl || "http://127.0.0.1:47821",
    session_token: envToken || "",
    pid: null,
    managed_by_tauri: false,
  };
}

export async function restartLocalBackend(): Promise<BackendConnectionConfig> {
  if (isTauriRuntime()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<BackendConnectionConfig>("restart_backend");
  }
  return getBackendConnectionConfig();
}

export async function pickWorkspaceDirectory(): Promise<string | null> {
  if (!isTauriRuntime()) {
    return null;
  }
  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({
    directory: true,
    multiple: false,
    title: "Select Workspace Folder to Authorize",
  });
  return typeof selected === "string" ? selected : null;
}
