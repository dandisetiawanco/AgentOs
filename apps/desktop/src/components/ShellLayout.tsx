import React, { useEffect, useState } from "react";
import { useApp, type RouteId } from "../stores/AppContext.js";
import { AppHeader } from "./AppHeader.js";
import { GlassSidebar } from "./GlassSidebar.js";

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

  return (
    <div className="relative min-h-screen text-[var(--ink-primary)]">
      {/* Layered tonal light-field backdrop so frosted glass translucency is perceptible */}
      <div aria-hidden="true" className="agentos-backdrop" />

      <div className="relative z-10 min-h-screen flex">
        <a href="#main-content" className="visually-hidden skip-link">
          Skip to main content
        </a>

        <GlassSidebar
          route={route}
          onNavigate={handleNavigate}
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed((prev) => !prev)}
          drawerOpen={drawerOpen}
          onCloseDrawer={() => setDrawerOpen(false)}
          backendError={error}
          version={bootstrap?.app.version ?? "0.1.0"}
        />

        <div className="flex-1 min-w-0 flex flex-col min-h-screen overflow-x-clip">
          <AppHeader drawerOpen={drawerOpen} onOpenDrawer={() => setDrawerOpen(true)} />

          <main id="main-content" className="flex-1 min-w-0">
            <div className="max-w-[1320px] mx-auto px-4 py-6 sm:px-6">{children}</div>
          </main>
        </div>
      </div>

      {/* Live region toast stack */}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed bottom-5 right-5 z-50 flex flex-col gap-2 max-w-[360px]"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role={toast.tone === "error" ? "alert" : "status"}
            className={[
              "pointer-events-auto rounded-[12px] border px-4 py-3 type-secondary shadow-[var(--shadow-float)] flex items-center justify-between gap-3",
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
              className="type-meta underline shrink-0"
            >
              Dismiss
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
