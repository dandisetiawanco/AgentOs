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

describe("AgentOS Desktop Shell and Views", () => {
  beforeEach(() => {
    window.__AGENTOS_TEST_CONFIG__ = {
      base_url: "http://127.0.0.1:47821",
      session_token: "test-token",
      pid: null,
      managed_by_tauri: false,
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (url.endsWith("/api/v1/system/bootstrap")) {
          return new Response(JSON.stringify(mockBootstrap), { status: 200 });
        }
        if (url.endsWith("/api/v1/workspaces")) {
          return new Response(JSON.stringify({ workspaces: [] }), { status: 200 });
        }
        if (url.endsWith("/api/v1/tasks") && method === "GET") {
          return new Response(JSON.stringify({ tasks: [] }), { status: 200 });
        }
        if (url.endsWith("/api/v1/conversations") && method === "GET") {
          return new Response(JSON.stringify({ conversations: [] }), { status: 200 });
        }
        if (url.endsWith("/api/v1/workflows")) {
          return new Response(JSON.stringify({ workflows: [] }), { status: 200 });
        }
        if (url.endsWith("/api/v1/workflow-runs")) {
          return new Response(JSON.stringify({ runs: [] }), { status: 200 });
        }
        if (url.endsWith("/api/v1/tools")) {
          return new Response(
            JSON.stringify({
              tools: [
                {
                  id: "system.health",
                  name: "Inspect System Health",
                  category: "system",
                  description: "Inspect OS and memory usage.",
                  input_schema: { type: "object", properties: {} },
                  output_schema: { type: "object" },
                  required_permissions: ["system.read"],
                  risk_level: "READ_ONLY",
                  timeout_sec: 30,
                  has_side_effects: false,
                  supports_rollback: false,
                  verification_procedure: "Check metrics returned.",
                  platforms: ["darwin"],
                },
              ],
            }),
            { status: 200 },
          );
        }
        if (url.includes("/api/v1/memory")) {
          return new Response(JSON.stringify({ entries: [] }), { status: 200 });
        }
        if (url.includes("/api/v1/audit")) {
          return new Response(JSON.stringify({ events: [] }), { status: 200 });
        }
        if (url.endsWith("/api/v1/mcp/servers")) {
          return new Response(JSON.stringify({ servers: [] }), { status: 200 });
        }
        if (url.endsWith("/api/v1/computer-use/capabilities")) {
          return new Response(
            JSON.stringify({
              platform: "Darwin",
              arch: "x86_64",
              supported: true,
              accessibility_granted: false,
              screen_recording_granted: false,
              enabled_in_settings: false,
              screen_capture_enabled: false,
              continuous_recording: false,
              approved_apps: ["Finder"],
              emergency_stop_active: false,
              notes: [],
            }),
            { status: 200 },
          );
        }
        if (url.endsWith("/api/v1/settings") && method === "PUT") {
          return new Response(String(init?.body ?? JSON.stringify(mockBootstrap.settings)), {
            status: 200,
          });
        }
        return new Response(JSON.stringify({}), { status: 200 });
      }),
    );
  });

  it("navigates across all 8 views and toggles themes cleanly", async () => {
    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "AgentOS Workspace" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Assistant" }));
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Assistant" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Tasks" }));
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Tasks" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Workflows" }));
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Workflows" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Tools" }));
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Tool Registry" })).toBeInTheDocument();
      expect(screen.getByText("Inspect System Health")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Memory" }));
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Local Memory" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Activity" }));
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Activity & Audit Log" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Settings" }));
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    });

    // Switch to Dark theme and confirm meta color-scheme updates
    await user.click(screen.getByRole("radio", { name: "Dark" }));
    const meta = document.querySelector('meta[name="color-scheme"]');
    expect(meta?.getAttribute("content")).toBe("dark");
  });
});
