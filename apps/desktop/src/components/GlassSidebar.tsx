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
    <div className="flex flex-col gap-5 py-4">
      {NAV_GROUPS.map((group) => (
        <div key={group.label} className="flex flex-col gap-1">
          {!isCollapsed && (
            <div className="px-3 pb-1 type-meta uppercase tracking-[0.06em] text-[var(--ink-secondary)]">
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
                      "relative w-full flex items-center gap-2.5 rounded-[10px] min-h-[38px] type-body transition-[background-color,color,border-color] duration-150 text-left",
                      isCollapsed ? "justify-center px-2" : "px-3",
                      active
                        ? "bg-[var(--accent-tint)] text-[var(--accent-ink)] font-semibold border border-[var(--accent-border)] shadow-[inset_0_1px_0_var(--glass-highlight)]"
                        : "text-[var(--ink-secondary)] hover:bg-[var(--glass-surface)] hover:text-[var(--ink-primary)] border border-transparent",
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
      {/* Desktop frosted sidebar (224px expanded / 68px collapsed) */}
      <aside
        className={[
          "hidden md:flex flex-col shrink-0 border-r glass-sidebar transition-[width] duration-200 ease-out sticky top-0 h-screen",
          collapsed ? "w-[68px]" : "w-[224px]",
        ].join(" ")}
      >
        <div className="h-[56px] px-3.5 flex items-center justify-between border-b border-[var(--border-hairline)]">
          <AgentOSLogo size={22} showWordmark={!collapsed} />
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="p-1.5 rounded-[8px] text-[var(--ink-secondary)] hover:bg-[var(--glass-surface)] hover:text-[var(--ink-primary)] transition-colors duration-150"
          >
            {collapsed ? (
              <PanelLeftOpen className="w-4 h-4" aria-hidden={true} />
            ) : (
              <PanelLeftClose className="w-4 h-4" aria-hidden={true} />
            )}
          </button>
        </div>

        <nav aria-label="Primary" className="flex-1 overflow-y-auto px-2.5">
          {renderNavList(collapsed)}
        </nav>

        <footer className="px-3.5 py-3 border-t border-[var(--border-hairline)] type-meta text-[var(--ink-secondary)]">
          {collapsed ? (
            <span
              className="flex justify-center"
              aria-label={backendError ? "Backend offline" : "Local backend ready"}
              title={backendError ? "Backend offline" : "Local backend ready"}
            >
              <span
                aria-hidden="true"
                className="inline-block w-2 h-2 rounded-full"
                style={{
                  backgroundColor: backendError ? "var(--danger-ink)" : "var(--success-ink)",
                }}
              />
            </span>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 min-w-0">
                <span
                  aria-hidden="true"
                  className="inline-block w-2 h-2 rounded-full shrink-0"
                  style={{
                    backgroundColor: backendError ? "var(--danger-ink)" : "var(--success-ink)",
                  }}
                />
                <span className="truncate">
                  {backendError ? "Backend offline" : "Backend ready"}
                </span>
              </span>
              <span className="shrink-0">v{version}</span>
            </div>
          )}
        </footer>
      </aside>

      {/* Narrow-window frosted drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 md:hidden flex">
          <div
            className="fixed inset-0 bg-[#0a0f1a]/45"
            aria-hidden="true"
            onClick={onCloseDrawer}
          />
          <aside className="relative z-50 w-[256px] max-w-[82vw] glass-sidebar border-r flex flex-col h-full shadow-[var(--shadow-modal)]">
            <div className="h-[56px] px-4 flex items-center justify-between border-b border-[var(--border-hairline)]">
              <AgentOSLogo size={22} showWordmark={true} />
              <button
                type="button"
                onClick={onCloseDrawer}
                aria-label="Close navigation menu"
                className="p-2 rounded-[8px] text-[var(--ink-primary)] hover:bg-[var(--glass-surface)]"
              >
                <X className="w-4 h-4" aria-hidden={true} />
              </button>
            </div>
            <nav aria-label="Mobile primary" className="flex-1 overflow-y-auto px-2.5">
              {renderNavList(false)}
            </nav>
            <footer className="px-4 py-3 border-t border-[var(--border-hairline)] type-meta text-[var(--ink-secondary)] flex items-center justify-between">
              <span className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="inline-block w-2 h-2 rounded-full"
                  style={{
                    backgroundColor: backendError ? "var(--danger-ink)" : "var(--success-ink)",
                  }}
                />
                <span>{backendError ? "Backend offline" : "Backend ready"}</span>
              </span>
              <span>v{version}</span>
            </footer>
          </aside>
        </div>
      )}
    </>
  );
}
