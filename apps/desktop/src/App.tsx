import React from "react";
import { EmptyState } from "@agentos/ui";
import { ShellLayout } from "./components/ShellLayout.js";
import { OverviewPage } from "./pages/OverviewPage.js";
import { SettingsPage } from "./pages/SettingsPage.js";
import { AppProvider, useApp } from "./stores/AppContext.js";

function ActiveView(): React.JSX.Element {
  const { route, setRoute } = useApp();

  switch (route) {
    case "overview":
      return <OverviewPage />;
    case "settings":
      return <SettingsPage />;
    default:
      return (
        <EmptyState
          title={`View '${route}' is loading in the next build milestone`}
          description="Core desktop foundation, provider settings, and workspace authorization are active. Agent orchestration and tool screens arrive in Phases 2 to 5."
          actionLabel="Return to Overview"
          onAction={() => setRoute("overview")}
        />
      );
  }
}

export function App(): React.JSX.Element {
  return (
    <AppProvider>
      <ShellLayout>
        <ActiveView />
      </ShellLayout>
    </AppProvider>
  );
}
