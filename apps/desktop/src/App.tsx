import React from "react";
import { ShellLayout } from "./components/ShellLayout.js";
import { ActivityPage } from "./pages/ActivityPage.js";
import { AssistantPage } from "./pages/AssistantPage.js";
import { MemoryPage } from "./pages/MemoryPage.js";
import { OverviewPage } from "./pages/OverviewPage.js";
import { SettingsPage } from "./pages/SettingsPage.js";
import { TasksPage } from "./pages/TasksPage.js";
import { ToolsPage } from "./pages/ToolsPage.js";
import { WorkflowsPage } from "./pages/WorkflowsPage.js";
import { AppProvider, useApp } from "./stores/AppContext.js";

function ActiveView(): React.JSX.Element {
  const { route } = useApp();

  switch (route) {
    case "overview":
      return <OverviewPage />;
    case "assistant":
      return <AssistantPage />;
    case "tasks":
      return <TasksPage />;
    case "workflows":
      return <WorkflowsPage />;
    case "tools":
      return <ToolsPage />;
    case "memory":
      return <MemoryPage />;
    case "activity":
      return <ActivityPage />;
    case "settings":
      return <SettingsPage />;
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
