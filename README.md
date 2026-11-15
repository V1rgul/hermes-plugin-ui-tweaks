# Hermes UI Tweaks

A small Hermes Desktop UI plugin for full-width inline HTML previews, independent tool-call, file-edit, status-stack, queue-list and long-prompt display preferences, and resync of duplicated chat messages.

## Chat behavior

- Built-in inline HTML previews fill the available assistant-message width. Ordinary prose, images, preview height, sandbox, document contents, and widget state stay unchanged.
- Tool-call lists start expanded, without opening every tool's input/output details.
- Calls inside a fold are indented one level (`1rem`) beneath its summary, including the live ticker. A thin, theme-colored tree rail connects the summary to each call, ending in an L at the last header rather than running down its expanded result. Ungrouped single calls keep their original alignment without connectors.
- Tool lists have no vertical row gaps, so the rail stays continuous. Adjacent top-level tool blocks use a compact `0.125rem` gap; prose boundaries, result contents, and ticker row heights retain their native spacing.
- Opened calls show up to three times more of their output, payload, error or diff before scrolling (native caps of `5rem`, `14rem` and `12rem` become `15rem`, `42rem` and `36rem`), never taller than `70vh`, with its own setting. Short results keep their natural height; the review pane's diffs are unchanged.
- Successful patches and file edits that contain a diff start folded. Their toggle still opens the code normally; filenames and line counts remain Hermes's own UI.
- The status drawer above the composer starts folded when the queue is empty, according to its own preference. Queue-list expansion is a separate preference: adding queued prompts opens the list and reveals its drawer if necessary, including restored/paused queues. While the queue remains present, automatic folding is suspended. A manual collapse lasts until the queue count/status changes; an automatically revealed drawer folds again when the queue empties only if status folding is enabled and you have not explicitly opened it yourself.
- Long queued-prompt text starts in its native expanded view, independently of the queue-list preference. It does not open a closed list; native per-prompt controls still work, including their scrollable height limit.
- Long sent user messages in conversation history display without the native clamp/fade, using a separate setting. Ordinary message buttons keep their edit/restore behavior; spectator/touch messages with dedicated native expansion controls use those instead.
- Manual mouse and keyboard toggles take precedence except when a queue update deliberately reveals pending prompts. Existing native disclosure choices are preserved when local storage is available, including when rows or sessions remount.
- Late-arriving diffs and newly rendered messages receive the same defaults. Failed-edit explanations, unrelated controls, thinking blocks, and inert approval activity are left alone.

## Duplicated messages

Desktop sometimes paints part of a conversation twice although the server holds one copy ([#134415](https://github.com/NousResearch/hermes-agent/issues/134415)), for example after leaving a session mid-turn and coming back, or after an in-place context compaction during a turn.

- When a turn ends, or after switching to a session, the plugin looks for a repeated run of assistant prose in the main chat. Tool rows, thinking blocks and short repeated wording are ignored.
- If it finds one, it asks Desktop to rebuild that session from the server, as Desktop itself does after missing gateway events. No page reload, no request to the server; other tabs and the composer are untouched.
- A broom button next to the model picker, in every composer including split tiles, does the same on demand. It turns orange when that chat shows duplicates, sweeps while cleaning, and is disabled while the session is working.
- In a split tile, the button acts on the tile once it has focus (clicking in it is enough). Automatic resync covers the primary chat only.

The native **Hide code diffs** setting remains authoritative: switch it off if you want folded diffs that you can reopen. The plugin does not change Hermes's global settings, messages, file contents, or tool execution. It makes no network requests and needs no agent-side component.

## Settings

Open **Settings → Plugins → Hermes UI Tweaks**. The page groups Hermes's native settings rows into three categories, with eight independent switches, all enabled by default:

### Tool calls

- **Lists: expand by default** — opens lists without expanding every tool payload.
- **File edits: fold diffs by default** — folds patches and file-edit diffs but leaves them reopenable.
- **Output and diffs: taller boxes** — triples the scroll height of opened output, payloads, errors and file-edit diffs; turning it off restores the native heights at once.

### Composer

- **Status stack: fold by default** — folds the branch and activity drawer when there are no queued prompts. Hermes already remembers manual folding per conversation, but has no global start-folded preference in the inspected Desktop version. This switch does not enable or disable queue expansion.
- **Queued prompts: expand list by default** — opens the queue list on additions/updates and reveals its containing drawer if needed, regardless of the status-folding switch. Turning it off leaves the list under native/manual control; enabling it applies to an existing queue immediately.
- **Queued prompts: expand long text by default** — opens individual long-text disclosures when rows are mounted and interactive. It does not open the queue list or change history messages.

### Conversation

- **Long messages: expand by default** — lifts the text clamp/fade from ordinary sent user messages, without clicking their edit buttons. Native spectator/touch expansion controls are opened once and remain manually usable. It does not change queued prompts.
- **Duplicated messages: resync automatically** — rebuilds a finished chat from the server when it shows repeated blocks (see [Duplicated messages](#duplicated-messages)). When off, duplicates are only flagged by the orange broom.
- **HTML previews: full width** — an **Always on** feature row, without a switch. Previews fill the available message width while preserving their content and interaction state.

Changes take effect without reloading. Enabling a native disclosure default also applies it to currently mounted controls that do not already have an explicit choice. Turning one off stops applying it without forcing the opposite layout or clearing manual choices. The ordinary history-message override is reversible styling: turning that setting off immediately restores the native clamp/fade. Full-width previews remain enabled regardless of these switches.

Preferences are saved through the public `ctx.storage` API for this plugin on this Desktop installation/browser, not on the remote backend. They survive plugin and app reloads. If local storage is unavailable, the switches still work for the current plugin instance but cannot persist. Older hosts without the `registerSettingsPage` convenience helper use the documented `settings.plugins` contribution fallback.

## Installation or update

Download [plugin.js](https://raw.githubusercontent.com/V1rgul/hermes-plugin-ui-tweaks/main/plugin.js) from this repository. The plugin keeps its existing `hermes-wide-previews` ID so updates retain saved preferences.

1. On the computer running Hermes Desktop, open **Capabilities → Plugins** and use the folder/reveal control for **Hermes UI Tweaks** (previously **Wide HTML Previews**) to find its local `plugin.js`.
2. Replace that file with the updated `plugin.js`, keeping the folder name `hermes-wide-previews` and the file directly inside it: `desktop-plugins/hermes-wide-previews/plugin.js`.
3. Desktop watches the folder and should hot-reload it. If needed, use **Reload desktop plugins** in the command palette. Keep **Hermes UI Tweaks** enabled.
4. Open a conversation containing several tool calls and a file-edit diff. New/unselected tool-call lists should be open, diffs folded, and the toggles usable.

For a first installation, use the same folder/reveal control to locate the Desktop plugin root, create the `hermes-wide-previews` folder there, and put `plugin.js` directly inside it.

Updating files on a remote Hermes server does **not** update the separate native Desktop copy. No build, npm installation, backend install, or backend restart is needed to use this plugin.

Disabling the plugin removes its preview/history styles, observers and listeners. An already queued restoration of a saved manual choice may finish on the next animation frame; no new defaults are applied after disable. Native disclosure states remain as they are, just as after manual toggles; ordinary history messages return to native styling. To uninstall, disable it and remove only its `hermes-wide-previews` folder.

## Implementation and compatibility

The public SDK supplies registration and disposal but no default-expansion hook for these chat controls. The plugin therefore uses isolated styling and disclosure controllers:

- One reversible stylesheet targets the two preview wrapper spans inside `[data-slot="aui_assistant-message-content"]`. Native frames are identified by their sandbox and built-in size-message marker; browser-hosted frames use `/assets/webapp-preview.html`. It removes the older 640 px cap/one-time measured width and the newer 960 px cap without replacing the iframe. Scoped tool-layout rules add logical inline-start padding inside grouped rows or the live ticker, draw noninteractive connectors in that gutter, and reduce only tool-to-tool grid gaps/margins. Inside `[data-tool-row]`, the detail caps are raised by the native Tailwind class names (`max-h-20`, `max-h-56`) and the `file-diff-panel`/`diff-lines` slots; a renamed class leaves the native height. Its own switch adds or removes just these rules from the stylesheet. The row gutter keeps strokes inside native overflow clipping without replacing any controls or adding observers. Apart from the detail heights, these styles apply independently of the behavioral switches; all of them disappear when the plugin is disabled.
- A mutation observer reacts to added tool controls and disclosure/visibility attributes. It uses the existing group/row buttons rather than hiding code with CSS or changing React state privately. Only groups expand; only open file-edit rows containing a `file-diff-panel` fold, according to the corresponding preference. Candidate scanning is incremental; changing a switch performs one refresh, not recurring full-transcript scans or polling.
- A separate incremental controller uses `[data-slot="status-drawer-toggle"]` and its controlled drawers. It identifies only the native queued section's header icon (`layers` or `debug-pause`), including inside a folded/inert drawer, without parsing translated labels. When queue expansion is enabled, a queue header appearing or changing reopens that drawer and list; other composers and status groups are untouched. Status folding is checked independently when the queue empties. Native folding preserves accessibility and mounted state. Session/profile/connection focus changes and hash navigation refresh defaults for reused composer controls. Hosts without the drawer marker are left unchanged.
- A prompt-text controller opens only the queued row's native text chevron and known history expansion controls. It never clicks ordinary history edit buttons. A separate reversible stylesheet lifts `.sticky-human-clamp` only inside ordinary `aui_user-message-root` messages without native expansion controls. Assistant content, edit composers and unrelated clamped blocks retain their own styling. Text-disclosure manual choices are preserved while their buttons stay mounted; unlike tool disclosures, core does not persist these choices across remounts.

Before/after reads of `hermes.desktop.toolDisclosure.v1` distinguish an explicit saved native choice from a default. When a newly mounted control reveals an existing choice, the controller restores it through the native toggle after the render commits. With local storage unavailable, per-mounted-control manual toggles are still respected, but preservation across remounts cannot be guaranteed.

Hermes stores only closed status drawers in `hermes.desktop.collapsedStatusDrawers.v1`. The plugin records up to 512 explicit manual opens under its own `openStatusDrawers` storage entry, keyed by the exact connection/profile/session identity revealed by the native toggle. It restores those opens after remounts/reloads instead of guessing a session scope. Automatic queue reveals never become saved manual-open choices. An open choice made before this plugin was active cannot be distinguished from Hermes's open default. Unsaved drafts and denied local storage retain manual choices only while their control stays mounted.

The duplicate resync uses the public `host.state` atoms (`activeSessionId`, `busyBySession`), `host.notify` and a `COMPOSER_AREAS.actions` button; a split tile's session is read from `focusedSessionId` while that tile has focus. The broom is Lucide's `broom` icon (ISC). The rebuild itself relies on Desktop internals: the plugin wraps `WebSocket.prototype.send` to recognize the renderer's gateway socket (`/api/ws`) and dispatches a local `session.replay_gap` event on it, which Desktop answers with an authoritative snapshot of the session. If a Desktop update changes that event or its transport, the resync stops having an effect and the leftover notification suggests a reload; disabling the plugin restores `send`. On hosts without `host.state`, the feature is skipped and the other tweaks still load.

The wrapper shape, tool markers, disclosure buttons, browser endpoint, and local-storage key are Hermes implementation details, not a stable chat-customization API. The plugin lives outside Hermes core and survives application updates, but a future renderer change may require updating its selectors. It intentionally preserves any separate width restriction on the chat column itself. Preview attachment cards are not converted into live previews.

## Tests

For integration checks against the **real Hermes Desktop workspace**, use the isolated container and persistent Chromium setup adapted from T3sidebar:

```sh
npm ci && npx playwright install chromium && npm run webapp -- setup && npm run webapp -- seed && npm run webapp -- browser && npm run test:integration
```

See [Development](docs/development.md) for iteration, screenshots, per-worktree isolation and cleanup. It uses the actual Webapp renderer/gateway with explicitly invented conversations, without mounting your Hermes home or copying credentials. It is not the native Electron shell. Stop it with `npm run webapp -- stop` when finished.

The broader fixture suite remains available:

```sh
npm ci && npx playwright install chromium && npm test
```

Tests run the actual plugin in headless Chromium against geometry fixtures matching older/current/browser-hosted previews and stateful tool-control fixtures matching the inspected `ToolRun`, `ToolEntry`, and `DisclosureRow` contracts. The latter persist disclosure state synchronously, commit DOM updates later, and unmount hidden rows. The settings page is rendered with real React and a fixture matching the public SDK's `ToggleRow`, registry, and namespaced-storage contracts. These are fixtures, not a full Electron Desktop build; native Electron behavior requires a separate integration check. The React/esbuild packages are development-only; Desktop supplies the plugin's runtime imports itself.

Coverage includes preview resizing and interaction-state retention, dynamic messages, list-only expansion, folded patch/edit/write diffs, manual and keyboard overrides, pending-to-completed edits, native state preservation on remount, errors and unrelated controls, storage denial, approval visibility, disposal, and repeated reloads. Settings tests exercise independent switches, live enable/disable behavior, plugin/browser reload persistence, malformed preferences, manual-choice preservation, registration fallback, and in-memory operation when storage is denied. Status-drawer tests cover both drawer bodies, retained contents/drafts, scoped manual opens, reused grips on navigation, native closed choices, late insertion/reveal, and listener disposal; integration checks exercise the real branch row in a credential-free test Git repo. Tool-layout geometry tests check indentation, continuous connectors and the final L with an expanded result, appended/removed calls, compact adjacent-tool gaps, unchanged prose/result spacing, singleton/outside-scope isolation, dynamic insertion, narrow layouts, RTL, ticker stride, retained input state, and exact restoration on disable. The real-renderer check also verifies that the rail joins the native summary and every call without gaps.

For an existing Playwright installation or separately installed Chromium, tests accept `PLAYWRIGHT_MODULE` and `CHROMIUM_EXECUTABLE`. `PLUGIN_SOURCE` selects an alternate source for tool-default and tool-layout tests, allowing mutation checks without editing the delivered plugin.
