# AgentOS User Guide

## First Launch

1. Launch AgentOS. On first startup, AgentOS boots its local backend automatically and opens on **Overview**.
2. Go to **Settings -> AI Providers & Keychain Credentials**:
   - Paste your own API key for Google Gemini, OpenAI, or Anthropic and click **Save to Keychain**, or select local **Ollama**.
   - Click **Test connection** to verify connectivity.
   - To explore offline without API keys, leave **Offline Deterministic Test Mode** selected.
3. Go to **Settings -> Authorized Workspaces** and add a project or documents folder. AgentOS never accesses folders outside this list.

## Running Tasks Safely

1. Open **Assistant**, choose your provider, model, and authorized workspace, and enter an instruction.
2. Read-only steps (listing files, detecting duplicates, reading documents, system diagnostics) run and verify automatically.
3. Any file mutation, report generation, form submission, or allowlisted terminal command pauses in **Awaiting approval** and opens a preview dialog showing the exact tool and arguments.
4. Click **Approve & execute** to grant a 15-minute scoped task permission, or **Decline** to cancel cleanly.
5. After supported file operations, click **Restore files** to roll back recorded changes, or **Export report** to save a Markdown summary.

## Emergency Stop

Click **Emergency stop** in **Overview** or **Settings -> Computer Use** at any time to halt active tasks and block non-read-only actions until you explicitly clear it.
