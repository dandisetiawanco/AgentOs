export type RiskLevel = "READ_ONLY" | "LOW" | "MEDIUM" | "HIGH" | "BLOCKED";

export type TaskStatus =
  | "created"
  | "planning"
  | "awaiting_approval"
  | "approved"
  | "running"
  | "paused"
  | "verifying"
  | "completed"
  | "failed"
  | "cancelled";

export type StepStatus =
  | "pending"
  | "running"
  | "verifying"
  | "completed"
  | "failed"
  | "skipped"
  | "cancelled";

export type ApprovalStatus = "not_required" | "pending" | "approved" | "denied";

export type ThemePreference = "system" | "light" | "dark";

export type MemoryCategory =
  | "preference"
  | "task_history"
  | "workspace_context"
  | "workflow"
  | "tool_result"
  | "user_instruction";

export interface BackendConnectionConfig {
  base_url: string;
  session_token: string;
  pid: number | null;
  managed_by_tauri: boolean;
}

export interface ApiErrorPayload {
  error: {
    code: string;
    message: string;
    recoverable: boolean;
    details: Record<string, unknown>;
  };
}

export interface HealthResponse {
  status: "ok";
  app: string;
  version: string;
  uptime_sec: number;
  database: {
    ok: boolean;
    journal_mode: string;
    db_path: string;
  };
}

export interface AppSettings {
  theme: ThemePreference;
  default_provider_id: string;
  default_model: string;
  memory_enabled: boolean;
  memory_retention_days: number;
  terminal_enabled: boolean;
  terminal_allowlist: string[];
  computer_use_enabled: boolean;
  computer_use_screen_capture: boolean;
  computer_use_approved_apps: string[];
  max_duration_sec: number;
  max_tool_calls: number;
  max_retries: number;
  max_tokens: number;
  max_cost_usd: number;
}

export interface ProviderCapabilities {
  supports_tools: boolean;
  supports_streaming: boolean;
  supports_structured_output: boolean;
  supports_vision: boolean;
  requires_api_key: boolean;
  is_local: boolean;
  is_mock: boolean;
  max_context_tokens: number;
}

export interface ProviderStatus {
  id: string;
  display_name: string;
  enabled: boolean;
  base_url: string | null;
  default_model: string;
  timeout_sec: number;
  max_retries: number;
  has_api_key: boolean;
  api_key_hint: string | null;
  ready: boolean;
  capabilities: ProviderCapabilities;
}

export interface ProviderModel {
  id: string;
  name: string;
  context_window: number | null;
  input_cost_per_1m_usd: number | null;
  output_cost_per_1m_usd: number | null;
}

export interface ProviderTestResult {
  ok: boolean;
  provider_id: string;
  latency_ms: number;
  message: string;
  discovered_models: string[];
}

export interface Workspace {
  id: string;
  name: string;
  path: string;
  read_only: boolean;
  allow_delete: boolean;
  exists: boolean;
  created_at: string | null;
}

export interface BootstrapResponse {
  app: {
    name: string;
    tagline: string;
    version: string;
    organization: string;
    author: string;
    platform: string;
    arch: string;
    python_version: string;
  };
  keychain: {
    backend: string;
    persistent: boolean;
    warning: string | null;
  };
  settings: AppSettings;
  providers: ProviderStatus[];
  counts: {
    workspaces: number;
    tasks: number;
  };
}

export interface ToolDefinition {
  id: string;
  name: string;
  category: string;
  description: string;
  input_schema: Record<string, unknown>;
  output_schema: Record<string, unknown>;
  required_permissions: string[];
  risk_level: RiskLevel;
  timeout_sec: number;
  has_side_effects: boolean;
  supports_rollback: boolean;
  verification_procedure: string;
  platforms: string[];
}

export interface TaskStep {
  id: string;
  task_id: string;
  step_index: number;
  title: string;
  description: string;
  tool_id: string;
  arguments: Record<string, unknown>;
  risk_level: RiskLevel;
  requires_approval: boolean;
  approval_status: ApprovalStatus;
  status: StepStatus;
  preview: Record<string, unknown>;
  result: Record<string, unknown> | null;
  verification: Record<string, unknown> | null;
  rollback: Record<string, unknown> | null;
  error_message: string | null;
  attempt_count: number;
  duration_ms: number | null;
  started_at: string | null;
  completed_at: string | null;
}

export interface TaskBudget {
  max_duration_sec: number;
  max_tool_calls: number;
  max_retries: number;
  max_tokens: number;
  max_cost_usd: number;
}

export interface TaskUsage {
  tool_calls: number;
  retries: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  estimated_cost_usd: number | null;
  elapsed_sec: number;
}

export interface TaskRecord {
  id: string;
  conversation_id: string | null;
  workspace_id: string | null;
  instruction: string;
  intent: Record<string, unknown>;
  status: TaskStatus;
  provider_id: string;
  model: string;
  plan: Record<string, unknown>;
  budget: TaskBudget;
  usage: TaskUsage;
  result_summary: string | null;
  verification: Record<string, unknown>;
  error: Record<string, unknown> | null;
  steps: TaskStep[];
  created_at: string | null;
  updated_at: string | null;
  started_at: string | null;
  completed_at: string | null;
}

export interface ConversationMessage {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  task_id: string | null;
  attachments: Array<{ name: string; path?: string; size_bytes?: number }>;
  created_at: string | null;
}

export interface ConversationRecord {
  id: string;
  title: string;
  workspace_id: string | null;
  provider_id: string;
  model: string;
  created_at: string | null;
  updated_at: string | null;
  messages?: ConversationMessage[];
}

export interface MemoryItem {
  id: string;
  category: MemoryCategory;
  title: string;
  content: string;
  tags: string[];
  source_task_id: string | null;
  workspace_id: string | null;
  pinned: boolean;
  expires_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface WorkflowRecord {
  id: string;
  name: string;
  description: string;
  template_key: string | null;
  instruction_template: string;
  workspace_id: string | null;
  provider_id: string | null;
  model: string | null;
  schedule_enabled: boolean;
  schedule_interval_minutes: number | null;
  retry_max_attempts: number;
  output_destination: string | null;
  is_builtin: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
  created_at: string | null;
}

export interface WorkflowRunRecord {
  id: string;
  workflow_id: string;
  task_id: string | null;
  trigger: "manual" | "scheduled";
  status: string;
  summary: string | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
}

export interface AuditEvent {
  id: string;
  timestamp: string | null;
  category: string;
  action: string;
  actor: string;
  task_id: string | null;
  tool_id: string | null;
  risk_level: RiskLevel;
  outcome: string;
  summary: string;
  details: Record<string, unknown>;
}

export interface McpServerRecord {
  id: string;
  name: string;
  transport: "stdio" | "sse" | "streamable_http";
  command: string[];
  url: string | null;
  enabled: boolean;
  allowed_tools: string[];
  status: string;
  last_error: string | null;
  last_checked_at: string | null;
}

export interface ComputerUseCapabilities {
  platform: string;
  arch: string;
  supported: boolean;
  accessibility_granted: boolean | null;
  screen_recording_granted: boolean | null;
  enabled_in_settings: boolean;
  screen_capture_enabled: boolean;
  continuous_recording: boolean;
  approved_apps: string[];
  emergency_stop_active: boolean;
  notes: string[];
}
