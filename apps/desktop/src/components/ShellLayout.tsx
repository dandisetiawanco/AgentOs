import React, { useEffect, useState } from "react";
import {
  Activity,
  Database,
  LayoutGrid,
  ListChecks,
  Menu,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Workflow,
  Wrench,
  X,
} from "lucide-react";
import { AgentOSLogo } from "@agentos/ui";
import { useApp, type RouteId } from "../stores/AppContext.js";

interface NavItem {
  id: RouteId;
  label: string;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
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

export function ShellLayout({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { route, setRoute, bootstrap, error, toasts, dismissToast } = useApp();
  const [collapsed, setCollapsed] = useState<boolean>(false);
  const [drawerOpen, setDrawerOpen] = useState<boolean>(false);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDrawerOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [drawerOpen]);

  const handleNavigate = (target: RouteId) => {
    setRoute(target);
    setDrawerOpen(false);
  };

  const renderNavList = (isCollapsed: boolean) => (
    <div className="flex flex-col gap-5 py-3">
      {NAV_GROUPS.map((group) => (
        <div key={group.label} className="flex flex-col gap-1">
          {!isCollapsed && (
            <div className="px-3 pb-1 text-[11px] font-medium text-[var(--ink-recessed)]">
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
                    onClick={() => handleNavigate(item.id)}
                    aria-current={active ? "page" : undefined}
                    aria-label={isCollapsed ? item.label : undefined}
                    className={[
                      "relative w-full flex items-center gap-2.5 rounded-[6px] min-h-[38px] text-[14px] transition-colors duration-100 text-left",
                      isCollapsed ? "justify-center px-2" : "px-3",
                      active
                        ? "bg-[var(--surface-elevated)] text-[var(--ink-primary)] font-semibold border border-[var(--border-hairline)]"
                        : "text-[var(--ink-recessed)] hover:bg-[var(--surface-elevated)]/70 hover:text-[var(--ink-primary)] border border-transparent",
                    ].join(" ")}
                  >
                    {active && (
                      <span
                        aria-hidden="true"
                        className="absolute left-0 top-1.5 bottom-1.5 w-[2.5px] rounded-r bg-[var(--accent)]"
                      />
                    )}
                    <Icon className="w-[17px] h-[17px] shrink-0" aria-hidden={true} />
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
    <div className="min-h-screen flex bg-[var(--canvas)] text-[var(--ink-primary)]">
      <a href="#main-content" className="visually-hidden skip-link">
        Skip to main content
      </a>

      {/* Desktop navigation rail */}
      <aside
        className={[
          "hidden md:flex flex-col shrink-0 border-r border-[var(--border-hairline)] bg-[var(--surface-recessed)] transition-[width] duration-150",
          collapsed ? "w-[68px]" : "w-[228px]",
        ].join(" ")}
      >
        <div className="h-[56px] px-3 flex items-center justify-between border-b border-[var(--border-hairline)]">
          <AgentOSLogo size={24} showWordmark={!collapsed} />
          <button
            type="button"
            onClick={() => setCollapsed((prev) => !prev)}
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="p-1.5 rounded-[6px] text-[var(--ink-recessed)] hover:bg-[var(--surface-elevated)] hover:text-[var(--ink-primary)]"
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

        <footer className="px-3 py-3 border-t border-[var(--border-hairline)] text-[12px] text-[var(--ink-recessed)]">
          {collapsed ? (
            <span
              className="block text-center font-mono"
              aria-label={error ? "Backend offline" : "Backend online"}
            >
              {error ? "OFF" : "OK"}
            </span>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className={[
                    "inline-block w-2 h-2 rounded-full",
                    error ? "bg-[var(--danger-ink)]" : "bg-[var(--success-ink)]",
                  ].join(" ")}
                />
                <span>{error ? "Backend offline" : "Local backend ready"}</span>
              </span>
              <span className="font-mono text-[11px]">v{bootstrap?.app.version ?? "0.1.0"}</span>
            </div>
          )}
        </footer>
      </aside>

      {/* Mobile / narrow drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 md:hidden flex">
          <div
            className="fixed inset-0 bg-black/45"
            aria-hidden="true"
            onClick={() => setDrawerOpen(false)}
          />
          <aside className="relative z-50 w-[250px] max-w-[82vw] bg-[var(--surface-recessed)] border-r border-[var(--border-hairline)] flex flex-col h-full">
            <div className="h-[56px] px-3 flex items-center justify-between border-b border-[var(--border-hairline)]">
              <AgentOSLogo size={24} showWordmark={true} />
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close navigation menu"
                className="p-2 rounded-[6px] text-[var(--ink-primary)] hover:bg-[var(--surface-elevated)]"
              >
                <X className="w-4 h-4" aria-hidden={true} />
              </button>
            </div>
            <nav aria-label="Mobile primary" className="flex-1 overflow-y-auto px-2">
              {renderNavList(false)}
            </nav>
          </aside>
        </div>
      )}

      {/* Main viewport */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="md:hidden h-[54px] px-4 border-b border-[var(--border-hairline)] bg-[var(--surface-elevated)] flex items-center justify-between">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-expanded={drawerOpen}
            aria-label="Open navigation menu"
            className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-[6px] border border-[var(--border-control)] text-[13px] font-medium"
          >
            <Menu className="w-4 h-4" aria-hidden={true} />
            <span>Menu</span>
          </button>
          <AgentOSLogo size={22} showWordmark={true} compact={true} />
        </header>

        <main id="main-content" className="flex-1 min-w-0 overflow-y-auto">
          <div className="max-w-[1280px] mx-auto px-5 py-6 md:px-8 md:py-7">{children}</div>
        </main>
      </div>

      {/* Live region toast stack */}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-[340px]"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role={toast.tone === "error" ? "alert" : "status"}
            className={[
              "pointer-events-auto rounded-[8px] border px-3.5 py-2.5 text-[13px] shadow-md flex items-center justify-between gap-3",
              toast.tone === "error"
                ? "bg-[var(--danger-tint)] text-[var(--danger-ink)] border-[var(--danger-border)]"
                : toast.tone === "success"
                  ? "bg-[var(--success-tint)] text-[var(--success-ink)] border-[var(--success-border)]"
                  : "bg-[var(--surface-elevated)] text-[var(--ink-primary)] border-[var(--border-control)]",
            ].join(" ")}
          >
            <span>{toast.message}</span>
            <button
              type="button"
              onClick={() => dismissToast(toast.id)}
              aria-label="Dismiss notification"
              className="text-[12px] underline shrink-0"
            >
              Dismiss
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
