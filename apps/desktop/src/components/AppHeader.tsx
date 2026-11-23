import React from "react";
import { FolderLock, Menu, ShieldCheck } from "lucide-react";
import { AgentOSLogo, StatusIndicator } from "@agentos/ui";
import { useApp, type RouteId } from "../stores/AppContext.js";

const ROUTE_META: Record<RouteId, { label: string; section: string }> = {
  overview: { label: "Overview", section: "Operate" },
  assistant: { label: "Assistant", section: "Operate" },
  tasks: { label: "Tasks", section: "Operate" },
  workflows: { label: "Workflows", section: "Automate" },
  tools: { label: "Tool Registry", section: "Automate" },
  memory: { label: "Local Memory", section: "Govern" },
  activity: { label: "Activity & Audit", section: "Govern" },
  settings: { label: "Settings", section: "Govern" },
};

export interface AppHeaderProps {
  drawerOpen: boolean;
  onOpenDrawer: () => void;
}

export function AppHeader({ drawerOpen, onOpenDrawer }: AppHeaderProps): React.JSX.Element {
  const { route, bootstrap, providers, workspaces, error } = useApp();
  const meta = ROUTE_META[route];
  const activeProvider = providers.find((p) => p.id === bootstrap?.settings.default_provider_id);

  return (
    <header className="sticky top-0 z-20 h-[52px] px-4 md:px-7 border-b glass-header flex items-center justify-between gap-3 shrink-0">
      <div className="flex items-center gap-2.5 min-w-0">
        <button
          type="button"
          onClick={onOpenDrawer}
          aria-expanded={drawerOpen}
          aria-label="Open navigation menu"
          className="md:hidden inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-[8px] border border-[var(--border-control)] bg-[var(--glass-panel)] text-[12.5px] font-medium text-[var(--ink-primary)]"
        >
          <Menu className="w-4 h-4" aria-hidden={true} />
          <span>Menu</span>
        </button>

        <div className="md:hidden">
          <AgentOSLogo size={20} showWordmark={true} compact={true} />
        </div>

        <div className="hidden md:flex items-center gap-2 text-[12.5px] min-w-0">
          <span className="text-[var(--ink-secondary)]">{meta.section}</span>
          <span aria-hidden="true" className="text-[var(--border-control)]">
            /
          </span>
          <span className="font-medium text-[var(--ink-primary)] truncate">{meta.label}</span>
        </div>
      </div>

      <div className="hidden sm:flex items-center gap-2 shrink-0">
        {activeProvider && (
          <StatusIndicator
            tone={activeProvider.ready ? "ready" : "warning"}
            label={
              activeProvider.capabilities.is_mock
                ? "Offline Test Mode"
                : activeProvider.display_name
            }
          />
        )}
        <span className="hidden lg:inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border border-[var(--border-hairline)] bg-[var(--glass-panel)] text-[12px] text-[var(--ink-secondary)]">
          <FolderLock className="w-3.5 h-3.5 shrink-0" aria-hidden={true} />
          <span>
            {workspaces.length} {workspaces.length === 1 ? "workspace" : "workspaces"}
          </span>
        </span>
        {!error && bootstrap?.keychain.persistent && (
          <span className="hidden xl:inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border border-[var(--border-hairline)] bg-[var(--glass-panel)] text-[12px] text-[var(--ink-secondary)]">
            <ShieldCheck
              className="w-3.5 h-3.5 text-[var(--success-ink)] shrink-0"
              aria-hidden={true}
            />
            <span>Keychain</span>
          </span>
        )}
      </div>
    </header>
  );
}
