import React from "react";
import {
  Activity,
  Database,
  LayoutGrid,
  ListChecks,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Workflow,
  Wrench,
  X,
} from "lucide-react";
import { AgentOSLogo } from "@agentos/ui";
import type { RouteId } from "../stores/AppContext.js";

interface NavItem {
  id: RouteId;
  label: string;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Operate",
    items: [
      { id: "overview", label: "Overview", icon: LayoutGrid },
      { id: "assistant", label: "Assistant", icon: MessageSquare },
      { id: "tasks", label: "Tasks", icon: ListChecks },
    ],
  },
  {
    label: "Automate",
    items: [
      { id: "workflows", label: "Workflows", icon: Workflow },
      { id: "tools", label: "Tools", icon: Wrench },
    ],
  },
  {
    label: "Govern",
    items: [
      { id: "memory", label: "Memory", icon: Database },
      { id: "activity", label: "Activity", icon: Activity },
      { id: "settings", label: "Settings", icon: Settings },
    ],
  },
];

export interface GlassSidebarProps {
  route: RouteId;
  onNavigate: (target: RouteId) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  drawerOpen: boolean;
  onCloseDrawer: () => void;
  backendError: string | null;
  version: string;
}

export function GlassSidebar({
  route,
  onNavigate,
  collapsed,
  onToggleCollapse,
  drawerOpen,
  onCloseDrawer,
  backendError,
  version,
}: GlassSidebarProps): React.JSX.Element {
  const renderNavList = (isCollapsed: boolean) => (
    <div className="flex flex-col gap-5 py-3">
      {NAV_GROUPS.map((group) => (
        <div key={group.label} className="flex flex-col gap-1">
          {!isCollapsed && (
            <div className="px-3 pb-0.5 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-[var(--ink-secondary)]">
              {group.label}
            </div>
          )}
          <ul className="m-0 p-0 list-none flex flex-col gap-0.5">
            {group.items.map((item) => {
              const Icon = item.icon;
              const active = route === item.id;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => onNavigate(item.id)}
                    aria-current={active ? "page" : undefined}
                    aria-label={isCollapsed ? item.label : undefined}
                    title={isCollapsed ? item.label : undefined}
                    className={[
                      "relative w-full flex items-center gap-2.5 rounded-[9px] min-h-[36px] text-[13.5px] transition-[background-color,color,border-color] duration-150 text-left",
                      isCollapsed ? "justify-center px-2" : "px-3",
                      active
                        ? "bg-[var(--accent-tint)] text-[var(--accent-ink)] font-semibold border border-[var(--accent-border)]"
                        : "text-[var(--ink-secondary)] hover:bg-[var(--surface-elevated)]/75 hover:text-[var(--ink-primary)] border border-transparent",
                    ].join(" ")}
                  >
                    <Icon className="w-4 h-4 shrink-0" aria-hidden={true} />
                    {!isCollapsed && <span className="truncate">{item.label}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );

  return (
    <>
      {/* Desktop glass sidebar */}
      <aside
        className={[
          "hidden md:flex flex-col shrink-0 border-r glass-sidebar transition-[width] duration-200 ease-out sticky top-0 h-screen",
          collapsed ? "w-[66px]" : "w-[216px]",
        ].join(" ")}
      >
        <div className="h-[52px] px-3 flex items-center justify-between border-b border-[var(--border-hairline)]">
          <AgentOSLogo size={22} showWordmark={!collapsed} />
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="p-1.5 rounded-[8px] text-[var(--ink-secondary)] hover:bg-[var(--surface-elevated)]/80 hover:text-[var(--ink-primary)] transition-colors duration-150"
          >
            {collapsed ? (
              <PanelLeftOpen className="w-4 h-4" aria-hidden={true} />
            ) : (
              <PanelLeftClose className="w-4 h-4" aria-hidden={true} />
            )}
          </button>
        </div>

        <nav aria-label="Primary" className="flex-1 overflow-y-auto px-2">
          {renderNavList(collapsed)}
        </nav>

        <footer className="px-3 py-3 border-t border-[var(--border-hairline)] text-[11.5px] text-[var(--ink-secondary)]">
          {collapsed ? (
            <span
              className="flex justify-center"
              aria-label={backendError ? "Backend offline" : "Local backend ready"}
              title={backendError ? "Backend offline" : "Local backend ready"}
            >
              <span
                aria-hidden="true"
                className={[
                  "inline-block w-2 h-2 rounded-full",
                  backendError ? "bg-[var(--danger-ink)]" : "bg-[var(--success-ink)]",
                ].join(" ")}
              />
            </span>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 min-w-0">
                <span
                  aria-hidden="true"
                  className={[
                    "inline-block w-2 h-2 rounded-full shrink-0",
                    backendError ? "bg-[var(--danger-ink)]" : "bg-[var(--success-ink)]",
                  ].join(" ")}
                />
                <span className="truncate">
                  {backendError ? "Backend offline" : "Local backend ready"}
                </span>
              </span>
              <span className="font-mono text-[11px] shrink-0">v{version}</span>
            </div>
          )}
        </footer>
      </aside>

      {/* Narrow-window glass slide-over drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 md:hidden flex">
          <div
            className="fixed inset-0 bg-[#0d111a]/45"
            aria-hidden="true"
            onClick={onCloseDrawer}
          />
          <aside className="relative z-50 w-[248px] max-w-[82vw] glass-sidebar border-r flex flex-col h-full shadow-[var(--shadow-lg)]">
            <div className="h-[52px] px-3.5 flex items-center justify-between border-b border-[var(--border-hairline)]">
              <AgentOSLogo size={22} showWordmark={true} />
              <button
                type="button"
                onClick={onCloseDrawer}
                aria-label="Close navigation menu"
                className="p-2 rounded-[8px] text-[var(--ink-primary)] hover:bg-[var(--surface-elevated)]/80"
              >
                <X className="w-4 h-4" aria-hidden={true} />
              </button>
            </div>
            <nav aria-label="Mobile primary" className="flex-1 overflow-y-auto px-2">
              {renderNavList(false)}
            </nav>
            <footer className="px-3.5 py-3 border-t border-[var(--border-hairline)] text-[11.5px] text-[var(--ink-secondary)] flex items-center justify-between">
              <span className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className={[
                    "inline-block w-2 h-2 rounded-full",
                    backendError ? "bg-[var(--danger-ink)]" : "bg-[var(--success-ink)]",
                  ].join(" ")}
                />
                <span>{backendError ? "Backend offline" : "Local backend ready"}</span>
              </span>
              <span className="font-mono text-[11px]">v{version}</span>
            </footer>
          </aside>
        </div>
      )}
    </>
  );
}
