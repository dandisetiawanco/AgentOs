import type {
  ApiErrorPayload,
  AppSettings,
  AuditEvent,
  BootstrapResponse,
  ComputerUseCapabilities,
  ConversationRecord,
  HealthResponse,
  McpServerRecord,
  MemoryCategory,
  MemoryItem,
  ProviderModel,
  ProviderStatus,
  ProviderTestResult,
  TaskRecord,
  ToolDefinition,
  WorkflowRecord,
  WorkflowRunRecord,
  Workspace,
} from "./types.js";

export class AgentOSApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly recoverable: boolean;
  readonly details: Record<string, unknown>;

  constructor(
    message: string,
    code: string,
    status: number,
    recoverable = true,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "AgentOSApiError";
    this.code = code;
    this.status = status;
    this.recoverable = recoverable;
    this.details = details;
  }
}

export class AgentOSClient {
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(baseUrl: string, sessionToken: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.token = sessionToken;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    if (this.token) {
      headers.set("Authorization", `Bearer ${this.token}`);
    }
    if (init.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers,
      });
    } catch (err) {
      throw new AgentOSApiError(
        `Cannot reach local AgentOS backend at ${this.baseUrl}. Verify that the backend service is running.`,
        "BACKEND_UNREACHABLE",
        0,
        true,
        { cause: err instanceof Error ? err.message : String(err) },
      );
    }

    if (!response.ok) {
      let parsed: ApiErrorPayload | null = null;
      try {
        parsed = (await response.json()) as ApiErrorPayload;
      } catch {
        parsed = null;
      }
      if (parsed?.error) {
        throw new AgentOSApiError(
          parsed.error.message,
          parsed.error.code,
          response.status,
          parsed.error.recoverable,
          parsed.error.details,
        );
      }
      throw new AgentOSApiError(
        `Request failed with HTTP ${response.status}.`,
        "HTTP_ERROR",
        response.status,
      );
    }

    return (await response.json()) as T;
  }

  health(): Promise<HealthResponse> {
    return this.request<HealthResponse>("/api/v1/health");
  }

  bootstrap(): Promise<BootstrapResponse> {
    return this.request<BootstrapResponse>("/api/v1/system/bootstrap");
  }

  getSettings(): Promise<AppSettings> {
    return this.request<AppSettings>("/api/v1/settings");
  }

  updateSettings(settings: AppSettings): Promise<AppSettings> {
    return this.request<AppSettings>("/api/v1/settings", {
      method: "PUT",
      body: JSON.stringify(settings),
    });
  }

  async listProviders(): Promise<ProviderStatus[]> {
    const res = await this.request<{ providers: ProviderStatus[] }>("/api/v1/providers");
    return res.providers;
  }

  async updateProvider(
    providerId: string,
    payload: Partial<Pick<ProviderStatus, "enabled" | "base_url" | "default_model" | "timeout_sec" | "max_retries">>,
  ): Promise<ProviderStatus> {
    const res = await this.request<{ provider: ProviderStatus }>(
      `/api/v1/providers/${encodeURIComponent(providerId)}`,
      { method: "PUT", body: JSON.stringify(payload) },
    );
    return res.provider;
  }

  setProviderCredential(
    providerId: string,
    apiKey: string,
  ): Promise<{ provider_id: string; has_api_key: boolean; api_key_hint: string | null }> {
    return this.request(`/api/v1/providers/${encodeURIComponent(providerId)}/credential`, {
      method: "PUT",
      body: JSON.stringify({ api_key: apiKey }),
    });
  }

  deleteProviderCredential(
    providerId: string,
  ): Promise<{ provider_id: string; has_api_key: boolean }> {
    return this.request(`/api/v1/providers/${encodeURIComponent(providerId)}/credential`, {
      method: "DELETE",
    });
  }

  testProvider(providerId: string): Promise<ProviderTestResult> {
    return this.request<ProviderTestResult>(
      `/api/v1/providers/${encodeURIComponent(providerId)}/test`,
      { method: "POST" },
    );
  }

  async listProviderModels(providerId: string): Promise<ProviderModel[]> {
    const res = await this.request<{ models: ProviderModel[] }>(
      `/api/v1/providers/${encodeURIComponent(providerId)}/models`,
    );
    return res.models;
  }

  async listWorkspaces(): Promise<Workspace[]> {
    const res = await this.request<{ workspaces: Workspace[] }>("/api/v1/workspaces");
    return res.workspaces;
  }

  async createWorkspace(payload: {
    name: string;
    path: string;
    read_only?: boolean;
    allow_delete?: boolean;
  }): Promise<Workspace> {
    const res = await this.request<{ workspace: Workspace }>("/api/v1/workspaces", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    return res.workspace;
  }

  async updateWorkspace(
    workspaceId: string,
    payload: { name?: string; read_only?: boolean; allow_delete?: boolean },
  ): Promise<Workspace> {
    const res = await this.request<{ workspace: Workspace }>(
      `/api/v1/workspaces/${encodeURIComponent(workspaceId)}`,
      { method: "PATCH", body: JSON.stringify(payload) },
    );
    return res.workspace;
  }

  deleteWorkspace(workspaceId: string): Promise<{ deleted: boolean }> {
    return this.request(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}`, {
      method: "DELETE",
    });
  }

  async listTools(): Promise<ToolDefinition[]> {
    const res = await this.request<{ tools: ToolDefinition[] }>("/api/v1/tools");
    return res.tools;
  }

  async listConversations(): Promise<ConversationRecord[]> {
    const res = await this.request<{ conversations: ConversationRecord[] }>("/api/v1/conversations");
    return res.conversations;
  }

  async createConversation(payload: {
    title?: string;
    workspace_id?: string | null;
    provider_id?: string;
    model?: string;
  }): Promise<ConversationRecord> {
    const res = await this.request<{ conversation: ConversationRecord }>("/api/v1/conversations", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    return res.conversation;
  }

  async getConversation(conversationId: string): Promise<ConversationRecord> {
    const res = await this.request<{ conversation: ConversationRecord }>(
      `/api/v1/conversations/${encodeURIComponent(conversationId)}`,
    );
    return res.conversation;
  }

  async listTasks(status?: string): Promise<TaskRecord[]> {
    const query = status ? `?status=${encodeURIComponent(status)}` : "";
    const res = await this.request<{ tasks: TaskRecord[] }>(`/api/v1/tasks${query}`);
    return res.tasks;
  }

  async createTask(payload: {
    instruction: string;
    conversation_id?: string | null;
    workspace_id?: string | null;
    provider_id?: string;
    model?: string;
    attachments?: Array<{ name: string; path?: string; size_bytes?: number }>;
    auto_execute_read_only?: boolean;
  }): Promise<TaskRecord> {
    const res = await this.request<{ task: TaskRecord }>("/api/v1/tasks", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    return res.task;
  }

  async getTask(taskId: string): Promise<TaskRecord> {
    const res = await this.request<{ task: TaskRecord }>(
      `/api/v1/tasks/${encodeURIComponent(taskId)}`,
    );
    return res.task;
  }

  async approveTask(
    taskId: string,
    decision: { approve: boolean; step_ids?: string[]; ttl_minutes?: number },
  ): Promise<TaskRecord> {
    const res = await this.request<{ task: TaskRecord }>(
      `/api/v1/tasks/${encodeURIComponent(taskId)}/approve`,
      { method: "POST", body: JSON.stringify(decision) },
    );
    return res.task;
  }

  async executeTask(taskId: string): Promise<TaskRecord> {
    const res = await this.request<{ task: TaskRecord }>(
      `/api/v1/tasks/${encodeURIComponent(taskId)}/execute`,
      { method: "POST" },
    );
    return res.task;
  }

  async cancelTask(taskId: string): Promise<TaskRecord> {
    const res = await this.request<{ task: TaskRecord }>(
      `/api/v1/tasks/${encodeURIComponent(taskId)}/cancel`,
      { method: "POST" },
    );
    return res.task;
  }

  async retryTask(taskId: string): Promise<TaskRecord> {
    const res = await this.request<{ task: TaskRecord }>(
      `/api/v1/tasks/${encodeURIComponent(taskId)}/retry`,
      { method: "POST" },
    );
    return res.task;
  }

  async rollbackTask(taskId: string): Promise<{ restored_count: number; details: unknown[] }> {
    return this.request(`/api/v1/tasks/${encodeURIComponent(taskId)}/rollback`, {
      method: "POST",
    });
  }

  exportTaskReport(taskId: string): Promise<{ markdown: string; filename: string }> {
    return this.request(`/api/v1/tasks/${encodeURIComponent(taskId)}/report`);
  }

  async listMemory(params?: { category?: string; query?: string }): Promise<MemoryItem[]> {
    const qs = new URLSearchParams();
    if (params?.category) qs.set("category", params.category);
    if (params?.query) qs.set("query", params.query);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    const res = await this.request<{ entries: MemoryItem[] }>(`/api/v1/memory${suffix}`);
    return res.entries;
  }

  async createMemory(payload: {
    category: MemoryCategory;
    title: string;
    content: string;
    tags?: string[];
    pinned?: boolean;
  }): Promise<MemoryItem> {
    const res = await this.request<{ entry: MemoryItem }>("/api/v1/memory", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    return res.entry;
  }

  async updateMemory(
    memoryId: string,
    payload: { title?: string; content?: string; tags?: string[]; pinned?: boolean },
  ): Promise<MemoryItem> {
    const res = await this.request<{ entry: MemoryItem }>(
      `/api/v1/memory/${encodeURIComponent(memoryId)}`,
      { method: "PATCH", body: JSON.stringify(payload) },
    );
    return res.entry;
  }

  deleteMemory(memoryId: string): Promise<{ deleted: boolean }> {
    return this.request(`/api/v1/memory/${encodeURIComponent(memoryId)}`, {
      method: "DELETE",
    });
  }

  clearMemory(): Promise<{ deleted_count: number }> {
    return this.request("/api/v1/memory", { method: "DELETE" });
  }

  exportMemory(): Promise<{ exported_at: string; entries: MemoryItem[] }> {
    return this.request("/api/v1/memory/export");
  }

  async listWorkflows(): Promise<WorkflowRecord[]> {
    const res = await this.request<{ workflows: WorkflowRecord[] }>("/api/v1/workflows");
    return res.workflows;
  }

  async createWorkflow(payload: {
    name: string;
    description: string;
    instruction_template: string;
    workspace_id?: string | null;
    provider_id?: string | null;
    model?: string | null;
    schedule_enabled?: boolean;
    schedule_interval_minutes?: number | null;
    retry_max_attempts?: number;
    output_destination?: string | null;
  }): Promise<WorkflowRecord> {
    const res = await this.request<{ workflow: WorkflowRecord }>("/api/v1/workflows", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    return res.workflow;
  }

  async updateWorkflow(
    workflowId: string,
    payload: Partial<WorkflowRecord>,
  ): Promise<WorkflowRecord> {
    const res = await this.request<{ workflow: WorkflowRecord }>(
      `/api/v1/workflows/${encodeURIComponent(workflowId)}`,
      { method: "PATCH", body: JSON.stringify(payload) },
    );
    return res.workflow;
  }

  deleteWorkflow(workflowId: string): Promise<{ deleted: boolean }> {
    return this.request(`/api/v1/workflows/${encodeURIComponent(workflowId)}`, {
      method: "DELETE",
    });
  }

  runWorkflow(workflowId: string): Promise<{ run: WorkflowRunRecord; task: TaskRecord }> {
    return this.request(`/api/v1/workflows/${encodeURIComponent(workflowId)}/run`, {
      method: "POST",
    });
  }

  async listWorkflowRuns(workflowId?: string): Promise<WorkflowRunRecord[]> {
    const suffix = workflowId ? `?workflow_id=${encodeURIComponent(workflowId)}` : "";
    const res = await this.request<{ runs: WorkflowRunRecord[] }>(`/api/v1/workflow-runs${suffix}`);
    return res.runs;
  }

  async listAuditLogs(params?: {
    category?: string;
    risk_level?: string;
    task_id?: string;
    limit?: number;
  }): Promise<AuditEvent[]> {
    const qs = new URLSearchParams();
    if (params?.category) qs.set("category", params.category);
    if (params?.risk_level) qs.set("risk_level", params.risk_level);
    if (params?.task_id) qs.set("task_id", params.task_id);
    if (params?.limit) qs.set("limit", String(params.limit));
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    const res = await this.request<{ events: AuditEvent[] }>(`/api/v1/audit${suffix}`);
    return res.events;
  }

  exportDiagnostics(): Promise<Record<string, unknown>> {
    return this.request("/api/v1/diagnostics/export");
  }

  async listMcpServers(): Promise<McpServerRecord[]> {
    const res = await this.request<{ servers: McpServerRecord[] }>("/api/v1/mcp/servers");
    return res.servers;
  }

  async createMcpServer(payload: {
    name: string;
    transport: "stdio" | "sse" | "streamable_http";
    command?: string[];
    url?: string | null;
    enabled?: boolean;
  }): Promise<McpServerRecord> {
    const res = await this.request<{ server: McpServerRecord }>("/api/v1/mcp/servers", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    return res.server;
  }

  deleteMcpServer(serverId: string): Promise<{ deleted: boolean }> {
    return this.request(`/api/v1/mcp/servers/${encodeURIComponent(serverId)}`, {
      method: "DELETE",
    });
  }

  testMcpServer(serverId: string): Promise<{
    ok: boolean;
    status: string;
    message: string;
    tools: Array<{ name: string; description: string; input_schema: Record<string, unknown> }>;
  }> {
    return this.request(`/api/v1/mcp/servers/${encodeURIComponent(serverId)}/test`, {
      method: "POST",
    });
  }

  authorizeMcpTools(serverId: string, allowedTools: string[]): Promise<{ server: McpServerRecord }> {
    return this.request(`/api/v1/mcp/servers/${encodeURIComponent(serverId)}/authorize`, {
      method: "PUT",
      body: JSON.stringify({ allowed_tools: allowedTools }),
    });
  }

  getComputerUseCapabilities(): Promise<ComputerUseCapabilities> {
    return this.request<ComputerUseCapabilities>("/api/v1/computer-use/capabilities");
  }

  triggerEmergencyStop(active: boolean): Promise<{ emergency_stop_active: boolean; cancelled_tasks: number }> {
    return this.request("/api/v1/computer-use/emergency-stop", {
      method: "POST",
      body: JSON.stringify({ active }),
    });
  }

  /**
   * Streams Server-Sent Events over authenticated fetch so session tokens never appear in URLs.
   */
  async subscribeTaskEvents(
    taskId: string,
    onEvent: (eventName: string, data: unknown) => void,
    signal: AbortSignal,
  ): Promise<void> {
    const response = await fetch(
      `${this.baseUrl}/api/v1/tasks/${encodeURIComponent(taskId)}/events`,
      {
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: "text/event-stream",
        },
        signal,
      },
    );
    if (!response.ok || !response.body) {
      throw new AgentOSApiError(
        `Failed to open task event stream (HTTP ${response.status}).`,
        "STREAM_ERROR",
        response.status,
      );
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() ?? "";
      for (const raw of chunks) {
        let eventName = "message";
        const dataLines: string[] = [];
        for (const line of raw.split("\n")) {
          if (line.startsWith("event:")) {
            eventName = line.slice(6).trim();
          } else if (line.startsWith("data:")) {
            dataLines.push(line.slice(5).trim());
          }
        }
        if (dataLines.length > 0) {
          const text = dataLines.join("\n");
          try {
            onEvent(eventName, JSON.parse(text));
          } catch {
            onEvent(eventName, text);
          }
        }
      }
    }
  }
}
