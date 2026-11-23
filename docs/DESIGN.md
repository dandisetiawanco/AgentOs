# AgentOS Design Direction

## Design Read
Reading this as: desktop-native AI operations application for developers and technical knowledge workers on macOS, in a restrained warm-slate and cobalt-ink precision instrument style, dial ENERGY 1 / RHYTHM 2 / MOTION 1.

Dial: ENERGY 1 / RHYTHM 2 / MOTION 1

## Visual Identity Rationale (R-31)
- Brand voice: Direct, operational, verifiable, human-controlled. Tagline: "Intelligence that takes action."
- Palette (2 core neutral surfaces + 1 deliberate accent + functional semantic tones):
  - Light canvas `#F6F5F2` (warm alabaster reduces desktop eye fatigue over long sessions), elevated panel `#FFFFFF`, recessed sidebar/code surface `#ECEAE4`, primary ink `#18181B` (16.25:1 on canvas, 17.72:1 on surface), secondary ink `#52525B` (7.09:1 on canvas), recessed secondary ink `#4B4B52` (7.19:1), hairline border `#D6D3CB`, interactive border `#76746B` (4.69:1 on surface).
  - Dark canvas `#121316` (neutral obsidian-graphite, avoids purple-black slop), elevated panel `#1A1C21`, recessed sidebar `#16181D`, primary ink `#F3F2EE` (16.58:1 on canvas, 15.22:1 on surface), secondary ink `#A8ABB3` (8.09:1 on canvas, 7.42:1 on surface), hairline border `#2A2D35`, interactive border `#828894` (4.79:1 on surface).
  - Single deliberate accent: Cobalt Ink `#1D4ED8` (light mode, 6.70:1 against `#FFFFFF`) and `#2563EB` filled / `#60A5FA` text (dark mode, 5.17:1 filled and 6.70:1 text on `#1A1C21`). Used strictly for the primary action button, active navigation bar marker, and `:focus-visible` outlines.
  - Semantic risk and status colors always pair text labels and icons with tint/ink contrast > 6.3:1 in light mode and > 8.9:1 in dark mode.
- Typography (R-06):
  - UI sans: Native macOS system UI stack (`-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif`) chosen so AgentOS integrates seamlessly with macOS window chrome on Intel hardware with zero external webfont latency.
  - Monospace: `"SF Mono", ui-monospace, Menlo, Consolas, monospace`, strictly for file paths, tool identifiers, SHA-256 hashes, timestamps, and structured JSON payloads (never decorative large headings).
- Border radius (R-11):
  - Deliberate hierarchy: 10px for modal dialogs and primary containers, 8px for workspace panels, 6px for interactive buttons and inputs, 4px for compact risk/status tags (never uniform pill shapes everywhere).
- Elevation and surfaces (R-10, R-12, R-13):
  - Panels sit flat with 1px hairline borders; shadow is reserved strictly for modal dialogs (`<dialog>`) and transient toast notices to mark foreground layering. Zero backdrop blur stacking, zero decorative glows.
- Iconography (R-04):
  - `lucide-react` (per technical specification) at consistent 1.75px stroke, restricted strictly to functional desktop metaphors (folders, files, browser globe, CPU, terminal, shield, checklist, sliders). No sparkle, magic wand, orb, or robot glyphs.
- Identity motif:
  - A 2px solid left-edge bar marks the active sidebar route and the active executing plan step. The AgentOS monogram pairs a geometric frame with a directional action chevron representing "plan to verified action".
- Motion (R-19):
  - Dial MOTION 1: subtle 120ms color/border transitions on hover and focus; zero endless pulses or decorative bounce loops; all transitions disabled under `prefers-reduced-motion: reduce`.
- Layout composition (R-05, C-3):
  - Sidebar navigation shell grouped into Operate (Overview, Assistant, Tasks), Automate (Workflows, Tools), and Govern (Memory, Activity, Settings), with collapsible rail, active shape+weight marker, and narrow-viewport slide-over drawer.
  - Each view follows its operational job rather than repeating a stat-card + chart + table template:
    - Overview: real runtime readiness ledger (backend health, configured provider, authorized workspaces, recent real tasks, quick launch actions).
    - Assistant: focused split canvas (conversation + structured plan + inline approval gate on left; live step inspector, budget meter, and exportable report on right).
    - Tasks: filterable chronological ledger with detail drawer (timeline, tool calls, permission grants, retry/cancel).
    - Workflows: template catalog and user workflows with live manual run, schedule configuration (clearly noting active while app is open), and run history.
    - Tools: categorized deterministic tool catalog showing declared schemas, risk tier, permissions, and verification procedures.
    - Memory: searchable local SQLite memory store with inline edit, delete, clear-all confirmation, JSON export, retention policy, and global enable/disable toggle.
    - Activity: immutable audit timeline with risk/category filters, redacted arguments, and diagnostic export.
    - Settings: structured section navigation (Providers & Keychain, Workspaces, Security & Terminal Policy, MCP Servers, Computer Use Capabilities, Memory, Appearance, Diagnostics, About).
