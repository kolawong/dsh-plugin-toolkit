# dsh-plugin-toolkit

Personal quality-of-life toolkit for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). Each optimization is small enough that it does not deserve its own vertical plugin, and ships as one entry inside the Toolkit settings card: Web settings → Plugins → click the **DSH-Toolkit** card to expand a half-width sub-card grid (each with an icon, title, short subtitle, and on/off badge), then click one sub-card to open that optimization's settings dialog. The plugins page stays a compact launcher as the list grows.

## Graduation rules

An optimization graduates out of this package into its own `dsh-plugin-*` when any of these holds:

- it grows its own settings GUI beyond one toggle row, a service route, a background job, or a `client.js` feature surface;
- it needs to be enabled/disabled per composition row (Cordis toggles whole rows, not single tools);
- its definition plus tests exceed roughly 200 lines;
- it is worth publishing or sharing on its own.

## Optimizations

### `workspacelessChat` (default on)

Chat without picking a workspace first, like other agent harnesses' default-project behavior. dsh's composer requires a blank session to belong to a workspace, so the optimization keeps a dedicated **no-project chat workspace** (「通用对话」) around: it is idempotently created with its friendly title whenever the optimization is enabled, so the option always shows in the sidebar and workspace picker — open it to chat without a project. On top of that, when both baselines are ready, no session is selected, and the runtime's own startup policy has no recent workspace to connect (first run, no workspaces), the client also auto-connects a blank session in that workspace so the composer is live immediately.

The cold-start auto-connect failures retry at most 3 times (2 s apart) and then stay dormant until a list change re-triggers the check. The runtime's own recent-workspace auto-connect always wins; the auto-connect only fills the nothing-to-connect case, while the workspace itself exists unconditionally. The workspace is renamed to its friendly title only while it still carries the auto-derived basename (a title you set yourself is never overwritten).

| Config | Default | Meaning |
|---|---|---|
| `optimizations.workspacelessChat` | `true` | Toggle the no-project chat workspace + auto-connect. |
| `chatWorkspacePath` | `""` | Host directory for the default chat workspace; empty resolves to `<DSH_HOME>/chat`. The server creates the directory (live on settings edits, too). |
| `chatWorkspaceTitle` | `通用对话` | Display title of the no-project chat workspace. |

The card writes go through the `toolkit` settings namespace, so toggles and path edits apply live without a restart.

### `editLastMessage` (default on)

Retry a failed answer without copy-pasting and without polluting the model's context: the last user message's hover actions gain an **Edit** button. Clicking it opens an inline editor prefilled with that message; **Save & resend** rewrites the session in place — the edited message and everything after it are replaced (the model context truly rewinds, so the next request contains only the edited content), and a new turn answers the edited message.

This needs host support for the `session.rewrite` RPC (a small addition to this repo's dsh checkout). On hosts without it, the button still shows but reports that rewriting is unsupported. The client transcript erases the old message and its failed turn; turn boundaries are kept so the failed turn collapses into an invisible empty turn. Requires an idle session (a running turn rejects with `agent-busy`); only the last human user message is editable, text-only.

| Config | Default | Meaning |
|---|---|---|
| `optimizations.editLastMessage` | `true` | Edit-and-resend button on the last user message. |

### `viewActivity` (default on)

Adds an **Activity** icon (native clock glyph) to the workspace sidebar, right after the search (magnifier) control. Clicking it **re-sorts the sidebar's conversation list in place**: running conversations surface in a leading **Priority** group, then the remaining history grouped by **Today / Yesterday / Weekday / Earlier** (newest first within each group) — the familiar "recent conversations" pattern. Clicking again restores the previous grouping (workspace sections or the flat list); the icon highlights while the activity sort is on.

| Config | Default | Meaning |
|---|---|---|
| `optimizations.viewActivity` | `true` | Workspace-header activity icon + in-place running-first / by-day re-sort. |

> 100% non-invasive external implementation: hooks the activity toggle into the sidebar header and dynamically swaps the session tree, with zero modifications to official DSH core packages and zero conflict with upstream one-click upgrades.

### `slashI18n` (default on)

The `/` menu's shell copy (group titles, the user-only badge, skeleton rows) is already localized, but the entries' descriptions come straight from the host: built-in command descriptions, argument hints, and skill catalog descriptions all render verbatim in English, even under the Chinese UI. This optimization translates them **client-side**: the toolkit wraps the `remote.commands.list` and `remote.skills.list` namespace methods and rewrites each response's `description` / `input.hint` through an exact-match en→zh dictionary before any consumer reads it.

Scope and safety rails:

- `name` fields are never translated — fuzzy matching, the draft-chip lexicon, and claim adjudication all read them; `whenToUse` / `modelInvocable` ride untouched too.
- A dictionary miss falls back to the original string, so a dsh update that rewords a description degrades to English until the dictionary catches up (it never breaks the menu).
- Translations apply only while the UI language is Chinese, and the settings toggle is re-read per RPC result, so switching takes effect at the very next menu opening.
- Results are rebuilt into fresh objects, so no caller cache aliases the wire data; rejections and error results pass through untouched; re-applying the plugin cannot double-wrap a method.
- Skills you authored yourself can simply carry a Chinese `description` in their SKILL.md frontmatter — no dictionary needed. The dictionary only covers what ships with dsh (6 built-in commands, 2 hints not already keyed by ui-conversation's own `hint.*` locale keys, and the 2 built-in skills).
- No dsh source changes and no host extension are required; on a host without these namespaces the optimization simply stays dormant.

| Config | Default | Meaning |
|---|---|---|
| `optimizations.slashI18n` | `true` | Chinese descriptions for the `/` menu's commands and skills. |

### `changeReport` (default on)

A codex-style change report at the tail of every completed turn. When a turn changed files (`edit` / `write` / mutating `str_replace_editor` calls), the tail renders a compact card: **"N files edited · +A -R"**, one row per file with its own `+N -M` (click a row to open the file in the viewer), a *show more* expander beyond four rows, and a **Review** button opening the turn's full diff. The card is a superset of dsh's built-in produced-files tail: it joins the same `conversation.chat.turnTail` chain ahead of it (lower priority) and declines on non-mutating turns, so the stock tail renders exactly as before.

How it works, and its bounds:

- Data comes from the transcript, client-side: a conversation turn-data accumulator records one before/after hunk per successful mutation call — direct agent tool calls **and** run_code's nested sub-calls (which log as `tool/code-dispatch` events keyed by their root call). Line counts reuse the primitives' `diffTotals`, so the header numbers always match what the review `DiffBlock` renders.
- `bash`-side file writes (sed, redirects, …) are invisible to the transcript and therefore not tracked — the report covers the dedicated file-mutation tools, like codex tracks its own.
- Failed calls (tool error results) contribute nothing; settlements after the closing assistant seq are excluded; aggregated results are rebuilt per render (no aliasing with the wire data).
- No **undo**: reverting files on disk would need a host-side capability the browser does not have. Declining is deliberate — V1 is display-only.
- No dsh source changes: the slot, the turn-data definition registry, and the diff primitives are all public extension surfaces. Disabling the toggle restores the stock tail verbatim.

| Config | Default | Meaning |
|---|---|---|
| `optimizations.changeReport` | `true` | Per-turn change report card at the turn tail. |

## Install (web profile)

```sh
cd ~/.dsh/profiles/web
pnpm add file:/root/dsh-plugin-toolkit   # or link:/root/dsh-plugin-toolkit while developing
# add "dsh-plugin-toolkit" to the dsh.profile.bundles list in package.json
systemctl restart deepseek-harness.service  # or your profile's restart path
```

Server-side changes (this package) need a profile restart; the client bundle re-syncs with `pnpm install` inside the profile followed by a browser hard refresh.

## Model experience

No tool is registered and no prompt surface changes; this package is pure UI/runtime ergonomics. The one exception is the `editLastMessage` rewrite, which by design changes what the model sees: after an edit, the erased tail is removed from the derived request history (via the surface `replace`), so subsequent turns read only the edited content.
