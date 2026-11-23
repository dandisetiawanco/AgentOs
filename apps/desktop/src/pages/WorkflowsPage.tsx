import React, { useCallback, useEffect, useState } from "react";
import { Clock, Play, Plus, Trash2 } from "lucide-react";
import type { WorkflowRecord, WorkflowRunRecord } from "@agentos/shared";
import { Button, EmptyState, ErrorState, LoadingState, ModalDialog } from "@agentos/ui";
import { useApp } from "../stores/AppContext.js";

export function WorkflowsPage(): React.JSX.Element {
  const { client, workspaces, notify, setRoute } = useApp();
  const [workflows, setWorkflows] = useState<WorkflowRecord[]>([]);
  const [runs, setRuns] = useState<WorkflowRunRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState<boolean>(false);

  const [draftName, setDraftName] = useState<string>("");
  const [draftDesc, setDraftDesc] = useState<string>("");
  const [draftInstruction, setDraftInstruction] = useState<string>("");
  const [draftWs, setDraftWs] = useState<string>("");
  const [draftSchedule, setDraftSchedule] = useState<boolean>(false);
  const [draftInterval, setDraftInterval] = useState<number>(60);

  const loadData = useCallback(async () => {
    if (!client) return;
    setLoading(true);
    setError(null);
    try {
      const [wfList, runList] = await Promise.all([
        client.listWorkflows(),
        client.listWorkflowRuns(),
      ]);
      setWorkflows(wfList);
      setRuns(runList);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleRun = async (workflowId: string) => {
    if (!client) return;
    setRunningId(workflowId);
    try {
      const res = await client.runWorkflow(workflowId);
      notify(`Workflow run finished with status: ${res.task.status}`, "success");
      await loadData();
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setRunningId(null);
    }
  };

  const handleAssignWorkspace = async (workflowId: string, workspaceId: string) => {
    if (!client) return;
    try {
      await client.updateWorkflow(workflowId, { workspace_id: workspaceId || null });
      await loadData();
      notify("Workflow workspace updated.", "success");
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "error");
    }
  };

  const handleToggleSchedule = async (wf: WorkflowRecord) => {
    if (!client) return;
    try {
      const enable = !wf.schedule_enabled;
      await client.updateWorkflow(wf.id, {
        schedule_enabled: enable,
        schedule_interval_minutes: wf.schedule_interval_minutes ?? 60,
      });
      await loadData();
      notify(
        enable ? "In-app schedule enabled (runs while AgentOS is open)." : "Schedule paused.",
        "info",
      );
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "error");
    }
  };

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!client) return;
    try {
      await client.createWorkflow({
        name: draftName.trim(),
        description: draftDesc.trim(),
        instruction_template: draftInstruction.trim(),
        workspace_id: draftWs || null,
        schedule_enabled: draftSchedule,
        schedule_interval_minutes: draftSchedule ? draftInterval : null,
      });
      setCreateOpen(false);
      setDraftName("");
      setDraftDesc("");
      setDraftInstruction("");
      setDraftSchedule(false);
      await loadData();
      notify("Workflow created.", "success");
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "error");
    }
  };

  const handleDelete = async (workflowId: string) => {
    if (!client) return;
    try {
      await client.deleteWorkflow(workflowId);
      await loadData();
      notify("Workflow deleted.", "info");
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "error");
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-hairline)] pb-4">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight">Workflows</h1>
          <p className="text-[13px] text-[var(--ink-secondary)] mt-0.5">
            Reusable task templates with manual execution and in-app interval scheduling (active
            only while AgentOS is running).
          </p>
        </div>
        <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="w-3.5 h-3.5" aria-hidden={true} />
          New workflow
        </Button>
      </div>

      {loading && <LoadingState label="Loading workflows..." />}
      {error && <ErrorState message={error} onRetry={() => void loadData()} />}

      {!loading && workflows.length === 0 && (
        <EmptyState
          title="No workflows configured"
          description="Create a reusable instruction template to run on demand or on an interval while AgentOS is open."
          actionLabel="Create workflow"
          onAction={() => setCreateOpen(true)}
        />
      )}

      {!loading && workflows.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {workflows.map((wf) => (
            <article
              key={wf.id}
              className="rounded-[8px] border border-[var(--border-hairline)] bg-[var(--surface-elevated)] p-4 flex flex-col justify-between gap-3"
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <h2 className="text-[15px] font-semibold">{wf.name}</h2>
                  {wf.is_builtin && (
                    <span className="text-[11px] px-2 py-0.5 rounded-[4px] border border-[var(--border-hairline)] bg-[var(--surface-recessed)] text-[var(--ink-secondary)]">
                      Template
                    </span>
                  )}
                </div>
                <p className="text-[13px] text-[var(--ink-secondary)] mt-1">{wf.description}</p>
                <p className="text-[12px] font-mono text-[var(--ink-secondary)] mt-2 bg-[var(--canvas)] border border-[var(--border-hairline)] rounded px-2.5 py-1.5">
                  {wf.instruction_template}
                </p>
              </div>

              <div className="flex flex-col gap-2.5 pt-2 border-t border-[var(--border-hairline)]">
                <div>
                  <label
                    htmlFor={`wf-ws-${wf.id}`}
                    className="block text-[11px] text-[var(--ink-secondary)] mb-1"
                  >
                    Target workspace
                  </label>
                  <select
                    id={`wf-ws-${wf.id}`}
                    value={wf.workspace_id ?? ""}
                    onChange={(e) => void handleAssignWorkspace(wf.id, e.target.value)}
                    className="w-full rounded-[6px] border border-[var(--border-control)] bg-[var(--canvas)] px-2.5 py-1 text-[12px]"
                  >
                    <option value="">No workspace bound</option>
                    {workspaces.map((ws) => (
                      <option key={ws.id} value={ws.id}>
                        {ws.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void handleToggleSchedule(wf)}
                  >
                    <Clock className="w-3.5 h-3.5" aria-hidden={true} />
                    {wf.schedule_enabled
                      ? `Every ${wf.schedule_interval_minutes}m (Active)`
                      : "Schedule off"}
                  </Button>
                  <div className="flex items-center gap-2">
                    {!wf.is_builtin && (
                      <Button
                        variant="danger"
                        size="sm"
                        aria-label={`Delete workflow ${wf.name}`}
                        onClick={() => void handleDelete(wf.id)}
                      >
                        <Trash2 className="w-3.5 h-3.5" aria-hidden={true} />
                      </Button>
                    )}
                    <Button
                      variant="primary"
                      size="sm"
                      loading={runningId === wf.id}
                      onClick={() => void handleRun(wf.id)}
                    >
                      <Play className="w-3.5 h-3.5" aria-hidden={true} />
                      Run now
                    </Button>
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {/* Execution History */}
      <section aria-labelledby="wf-runs-heading" className="flex flex-col gap-3">
        <h2 id="wf-runs-heading" className="text-[16px] font-semibold">
          Recent Workflow Runs
        </h2>
        {runs.length === 0 ? (
          <p className="text-[13px] text-[var(--ink-secondary)]">
            No workflow runs recorded yet. Select Run now on any workflow above.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-[8px] border border-[var(--border-hairline)] bg-[var(--surface-elevated)]">
            <table className="w-full text-left border-collapse text-[13px]">
              <caption className="visually-hidden">Workflow execution history</caption>
              <thead>
                <tr className="border-b border-[var(--border-hairline)] bg-[var(--surface-recessed)]">
                  <th scope="col" className="px-3.5 py-2.5 font-medium">
                    Run ID
                  </th>
                  <th scope="col" className="px-3.5 py-2.5 font-medium">
                    Trigger
                  </th>
                  <th scope="col" className="px-3.5 py-2.5 font-medium">
                    Status
                  </th>
                  <th scope="col" className="px-3.5 py-2.5 font-medium">
                    Summary
                  </th>
                  <th scope="col" className="px-3.5 py-2.5 font-medium">
                    Task
                  </th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} className="border-b border-[var(--border-hairline)] last:border-0">
                    <td className="px-3.5 py-2.5 font-mono text-[12px]">{r.id}</td>
                    <td className="px-3.5 py-2.5">{r.trigger}</td>
                    <td className="px-3.5 py-2.5 font-mono text-[12px]">{r.status}</td>
                    <td className="px-3.5 py-2.5 max-w-[360px] truncate">
                      {r.summary ?? r.error_message ?? ""}
                    </td>
                    <td className="px-3.5 py-2.5">
                      {r.task_id && (
                        <Button variant="ghost" size="sm" onClick={() => setRoute("tasks")}>
                          Inspect
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <ModalDialog
        open={createOpen}
        title="Create custom workflow"
        description="Define a reusable instruction template. Scheduled workflows run only while AgentOS is open."
        onClose={() => setCreateOpen(false)}
      >
        <form onSubmit={(e) => void handleCreate(e)} className="flex flex-col gap-3.5">
          <div>
            <label htmlFor="wf-name" className="block text-[12px] font-medium mb-1">
              Name
            </label>
            <input
              id="wf-name"
              type="text"
              required
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              placeholder="Daily Workspace Health Check"
              className="w-full rounded-[6px] border border-[var(--border-control)] bg-[var(--canvas)] px-3 py-1.5 text-[13px]"
            />
          </div>
          <div>
            <label htmlFor="wf-desc" className="block text-[12px] font-medium mb-1">
              Description
            </label>
            <input
              id="wf-desc"
              type="text"
              value={draftDesc}
              onChange={(e) => setDraftDesc(e.target.value)}
              placeholder="Checks large files and system health."
              className="w-full rounded-[6px] border border-[var(--border-control)] bg-[var(--canvas)] px-3 py-1.5 text-[13px]"
            />
          </div>
          <div>
            <label htmlFor="wf-inst" className="block text-[12px] font-medium mb-1">
              Instruction template
            </label>
            <textarea
              id="wf-inst"
              rows={3}
              required
              value={draftInstruction}
              onChange={(e) => setDraftInstruction(e.target.value)}
              placeholder="Inspect system health and find large files in the authorized workspace."
              className="w-full rounded-[6px] border border-[var(--border-control)] bg-[var(--canvas)] px-3 py-1.5 text-[13px]"
            />
          </div>
          <div>
            <label htmlFor="wf-ws-create" className="block text-[12px] font-medium mb-1">
              Authorized workspace
            </label>
            <select
              id="wf-ws-create"
              value={draftWs}
              onChange={(e) => setDraftWs(e.target.value)}
              className="w-full rounded-[6px] border border-[var(--border-control)] bg-[var(--canvas)] px-3 py-1.5 text-[13px]"
            >
              <option value="">None</option>
              {workspaces.map((ws) => (
                <option key={ws.id} value={ws.id}>
                  {ws.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label htmlFor="wf-sched" className="inline-flex items-center gap-2 text-[13px]">
              <input
                id="wf-sched"
                type="checkbox"
                checked={draftSchedule}
                onChange={(e) => setDraftSchedule(e.target.checked)}
              />
              Enable in-app schedule
            </label>
            {draftSchedule && (
              <div className="flex items-center gap-1.5">
                <label htmlFor="wf-int" className="text-[12px]">
                  Every (minutes):
                </label>
                <input
                  id="wf-int"
                  type="number"
                  min={1}
                  max={10080}
                  value={draftInterval}
                  onChange={(e) => setDraftInterval(Number(e.target.value) || 60)}
                  className="w-20 rounded-[6px] border border-[var(--border-control)] bg-[var(--canvas)] px-2 py-1 text-[13px]"
                />
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-[var(--border-hairline)]">
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary">
              Save workflow
            </Button>
          </div>
        </form>
      </ModalDialog>
    </div>
  );
}
