import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../App.js";

const mockBootstrap = {
  app: {
    name: "AgentOS",
    tagline: "Intelligence that takes action.",
    version: "0.1.0",
    organization: "NGOPREK DIGITAL",
    author: "Dandi Setiawan",
    platform: "Darwin",
    arch: "x86_64",
    python_version: "3.12.16",
  },
  keychain: {
    backend: "keyring.backends.macOS.Keyring",
    persistent: true,
    warning: null,
  },
  settings: {
    theme: "system",
    default_provider_id: "mock",
    default_model: "mock-deterministic-v1",
    memory_enabled: true,
    memory_retention_days: 90,
    terminal_enabled: false,
    terminal_allowlist: ["ls", "pwd"],
    computer_use_enabled: false,
    computer_use_screen_capture: false,
    computer_use_approved_apps: ["Finder"],
    max_duration_sec: 300,
    max_tool_calls: 25,
    max_retries: 2,
    max_tokens: 64000,
    max_cost_usd: 1.0,
  },
  providers: [
    {
      id: "mock",
      display_name: "Offline Deterministic Test Mode",
      enabled: true,
      base_url: null,
      default_model: "mock-deterministic-v1",
      timeout_sec: 15,
      max_retries: 0,
      has_api_key: false,
      api_key_hint: null,
      ready: true,
      capabilities: {
        supports_tools: true,
        supports_streaming: true,
        supports_structured_output: true,
        supports_vision: false,
        requires_api_key: false,
        is_local: true,
        is_mock: true,
        max_context_tokens: 32768,
      },
    },
  ],
  counts: { workspaces: 0, tasks: 0 },
};

describe("AgentOS Desktop Shell", () => {
  beforeEach(() => {
    window.__AGENTOS_TEST_CONFIG__ = {
      base_url: "http://127.0.0.1:47821",
      session_token: "test-token",
      pid: null,
      managed_by_tauri: false,
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/api/v1/system/bootstrap")) {
          return new Response(JSON.stringify(mockBootstrap), { status: 200 });
        }
        if (url.endsWith("/api/v1/workspaces")) {
          return new Response(JSON.stringify({ workspaces: [] }), { status: 200 });
        }
        return new Response(JSON.stringify({}), { status: 200 });
      }),
    );
  });

  it("renders overview with real bootstrap data and navigates to Settings", async () => {
    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "AgentOS Workspace" })).toBeInTheDocument();
    });

    expect(screen.getByText("Offline Deterministic Test Mode")).toBeInTheDocument();
    expect(screen.getByText("OS Keychain active")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "Color theme" })).toBeInTheDocument();
  });
});
