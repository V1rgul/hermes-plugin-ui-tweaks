# Hermes UI Tweaks

A small Hermes Desktop UI plugin for full-width inline HTML previews, independent tool-call, file-edit, status-stack, queue-list and long-prompt display preferences, and resync of duplicated chat messages.

## Chat behavior

- Built-in inline HTML previews fill the available assistant-message width. Ordinary prose, images, preview height, sandbox, document contents, and widget state stay unchanged.
- Tool-call lists start expanded, without opening every tool's input/output details.
- Calls inside a fold are indented one level (`1rem`) beneath its summary, including the live ticker. A thin, theme-colored tree rail connects the summary to each call, ending in an L at the last header rather than running down its expanded result. Ungrouped single calls keep their original alignment without connectors.
- An open list drops its summary line: the fold's own toggle becomes a small minus box at the top of the rail, level with the first call, and the rail starts from it. A folded list keeps its summary line, with a plus box in the rail's column and the label aligned with the calls it folds. This has its own switch.
- Tool lines run one native step smaller: `10px` text on `16px` lines instead of `11px` on `18px`, scaled by the chat text size, for calls inside and outside folds, summaries and the live ticker. Opened results keep their native size. Tool lists have no vertical row gaps, so the rail stays continuous, and adjacent top-level tool blocks touch; prose boundaries and result contents retain their native spacing.
- With Hermes transcript timestamps (`display.timestamps`), times no longer take lines of their own. A text block's time sits at the end of its first line, which wraps before it; the message's time moves into the empty start of its action row; a fold summary's time ends its line like a call's. Every text line stays where it would be with timestamps off.
- Opened calls show up to three times more of their output, payload, error or diff before scrolling (native caps of `5rem`, `14rem` and `12rem` become `15rem`, `42rem` and `36rem`), never taller than `70vh`. Short results keep their natural height; the review pane's diffs are unchanged.
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
- **Lists: tree toggle instead of summary line** — open lists replace their summary line with a minus box on the rail; folded lists keep the line, behind a plus box. Off restores the native summary line immediately.
- **File edits: fold diffs by default** — folds patches and file-edit diffs but leaves them reopenable.
- **Rows: compact** — always on, shown for information without a switch.
- **Details: taller output** — always on, shown for information without a switch.

### Composer

- **Status stack: fold by default** — folds the branch and activity drawer when there are no queued prompts. Hermes already remembers manual folding per conversation, but has no global start-folded preference in the inspected Desktop version. This switch does not enable or disable queue expansion.
- **Queued prompts: expand list by default** — opens the queue list on additions/updates and reveals its containing drawer if needed, regardless of the status-folding switch. Turning it off leaves the list under native/manual control; enabling it applies to an existing queue immediately.
- **Queued prompts: expand long text by default** — opens individual long-text disclosures when rows are mounted and interactive. It does not open the queue list or change history messages.

### Conversation

- **Long messages: expand by default** — lifts the text clamp/fade from ordinary sent user messages, without clicking their edit buttons. Native spectator/touch expansion controls are opened once and remain manually usable. It does not change queued prompts.
- **Duplicated messages: resync automatically** — rebuilds a finished chat from the server when it shows repeated blocks (see [Duplicated messages](#duplicated-messages)). When off, duplicates are only flagged by the orange broom.
- **Timestamps: at the end of the line** — an **Always on** feature row, without a switch, effective when Hermes timestamps are enabled.
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

- One reversible stylesheet targets the two preview wrapper spans inside `[data-slot="aui_assistant-message-content"]`. Native frames are identified by their sandbox and built-in size-message marker; browser-hosted frames use `/assets/webapp-preview.html`. It removes the older 640 px cap/one-time measured width and the newer 960 px cap without replacing the iframe. Scoped tool-layout rules add logical inline-start padding inside grouped rows or the live ticker, draw noninteractive connectors in that gutter, and reduce only tool-to-tool grid gaps/margins. Tool blocks shrink by overriding Desktop's `--conversation-tool-font-size` and `--conversation-line-height` tokens on each top-level tool row or group, so the ticker window, reel stride and connector midpoints follow one value; opened results get the message's native values back. A renamed token leaves native sizes.
- The tree toggle is a separate stylesheet, present only while its switch is on. It restyles the native summary button rather than adding a control: while the list is open, the summary takes no height, its label is visually hidden but keeps the button's accessible name, its time is hidden, and the button covers only the rail's gutter beside the first call. While folded, the button keeps its line with its label moved one indent level in. The box is the button's `::before`, so clicks, keyboard use, `aria-expanded` and saved disclosure choices stay Hermes's own.
- Timestamp placement is part of the always-on stylesheet and only matches `[data-slot="timeline-timestamp"]` elements, which Hermes renders only with `display.timestamps`. A text block's time floats to the end of its first line; the text switches from `overflow: hidden` to `overflow: clip`, which still clips but lets only that first line wrap around the float. The native block gap moves from the time to the text, and to the float, which Chromium places below the previous block's own margin, so text lines land exactly where they would without timestamps. The message footer's time has no height and is drawn over the empty start of the following action row (`.min-h-6`), above it so its precise-time tooltip remains reachable. Fold summaries and other disclosure rows push a trailing time to the end when no action button sits between. Inside `[data-tool-row]`, the detail caps are raised by the native Tailwind class names (`max-h-20`, `max-h-56`) and the `file-diff-panel`/`diff-lines` slots; a renamed class leaves the native height. The row gutter keeps strokes inside native overflow clipping without replacing any controls or adding observers. These styles apply independently of the behavioral switches and disappear when the plugin is disabled.
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

Coverage includes preview resizing and interaction-state retention, dynamic messages, list-only expansion, folded patch/edit/write diffs, manual and keyboard overrides, pending-to-completed edits, native state preservation on remount, errors and unrelated controls, storage denial, approval visibility, disposal, and repeated reloads. Settings tests exercise independent switches, live enable/disable behavior, plugin/browser reload persistence, malformed preferences, manual-choice preservation, registration fallback, and in-memory operation when storage is denied. Status-drawer tests cover both drawer bodies, retained contents/drafts, scoped manual opens, reused grips on navigation, native closed choices, late insertion/reveal, and listener disposal; integration checks exercise the real branch row in a credential-free test Git repo. Tool-layout geometry tests check indentation, continuous connectors and the final L with an expanded result, appended/removed calls, compact adjacent-tool gaps, one-step-smaller tool lines with native-size opened results, gapless adjacent tool blocks, the tree toggle's box position, rail join, hit targets, accessible name, plus/minus states, ticker join, RTL placement and switch-off behavior, unchanged prose/result spacing, singleton/outside-scope isolation, dynamic insertion, narrow layouts, RTL, a ticker window that keeps the newest call in view at the smaller stride, retained input state, and exact restoration on disable. Timestamp tests compare each text line's position with and without timestamps, including after an opened diff, and check the first-line wrap, the shared end column, the action-row overlay with its hit targets, and restoration on disable. The real-renderer check also verifies the open list's minus box and continuous rail, one-step-smaller tool lines next to native tokens, gapless adjacent blocks, the seeded timestamps' placement, and the tree-toggle switch applying live.

For an existing Playwright installation or separately installed Chromium, tests accept `PLAYWRIGHT_MODULE` and `CHROMIUM_EXECUTABLE`. `PLUGIN_SOURCE` selects an alternate source for tool-default and tool-layout tests, allowing mutation checks without editing the delivered plugin.
