# Development

## Real Desktop workspace integration tests

The container/browser workflow is adapted from [T3sidebar](https://github.com/V1rgul/hermes-plugin-t3sidebar/tree/main/tools/test-webapp). It runs Hermes's actual gateway and browser-served Desktop workspace (Webapp), not a UI fixture or the Web Dashboard. It does not launch the native Electron shell, so Windows/Electron-specific behavior still needs a native-client check.

Requirements: Podman (preferred) or Docker, curl, Git, Node.js, and the project's pinned Playwright Chromium:

```sh
npm ci && npx playwright install chromium
```

On Ubuntu 26.04, this pinned Playwright version does not recognize the distribution yet. Use its Ubuntu 24.04 build: `export PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64` before installing/running the browser, or set `CHROMIUM_EXECUTABLE` to a compatible existing Chromium. Do not upgrade project dependencies just to change the test host mapping.

From the checkout/worktree under test:

```sh
npm run webapp -- setup && npm run webapp -- seed && npm run webapp -- browser && npm run test:integration
```

- `setup` creates/reuses a container for this exact checkout and copies its current, possibly uncommitted `plugin.js` into the real Desktop plugin directory. This is a standalone UI plugin: no backend component or enablement helper is needed.
- `seed` writes clearly labeled invented conversations through Hermes's own `SessionDB`: grouped tool calls with a patch diff, an interactive HTML preview served from the test workspace, a multiline history prompt, a long terminal output and diff for detail heights, a long code block for the expanded code height, text blocks opening with a code block, table, quote, preview or display math, and capped cards (a silent audio clip, an HTML document that becomes an artifact card, a settled delegation). It initializes an empty test-only Git repo for the native branch row, without a commit or credentials, and turns on Hermes's display-only `display.timestamps` in the test home so the time layout is exercised. Rerunning preserves existing sessions, including manual test conversations. It does not call a model or manufacture a claimed live execution.
- `browser` starts ordinary headless Chromium on the host and signs it in through a one-use link from the container. The browser persists between `drive` calls. Its profile holds localStorage, plugin preferences and sign-in state; normal sync/start/stop never reset it.
- `test:integration` drives this real workspace and checks native rendering, settings, defaults, manual overrides, preview sizing and interaction. It uses only seeded data, with no model request. It restores the preferences and disclosure choices it changes.

The container mounts only `<checkout>/.test-webapp/data`; it never mounts or clones the host's Hermes home, sessions, plugins or credentials. Ports are loopback-only, beginning at `19220` (CDP is the selected port + 1000). Separate checkouts/worktrees receive separate names, data, ports and browser profiles. The pinned image is `docker.io/nousresearch/hermes-agent:v0.23.0`. This is an integration baseline, not a promise to match every newer native client.

No provider credentials are installed or needed. Live model turns require a separately authorized dedicated test account; never copy personal credentials into the container.

## Iterating and inspecting

```sh
npm run webapp -- sync && npm run webapp -- browser && npm run test:integration
```

`sync` copies only `plugin.js`. It does not restart any Hermes backend. The browser driver disables HTTP caching, and `browser` navigates through a fresh sign-in link so updated plugin source loads.

```sh
npm run webapp -- drive 'return { title: await page.title(), screenshot: await shot("workspace") }'
```

Drive bodies receive Playwright `page`, `context` and `shot(name)`. Screenshots are written beneath `.test-webapp/shots/`. Inspect the actual app using the same persistent browser rather than injecting fixture DOM or importing a replacement SDK. `login-url` prints a fresh launch link for an independently opened browser (valid for 60 seconds); ordinary Chromium sessions do not share the test browser's storage.

`npm run webapp -- status` shows the selected container, port and data directory. `UI_WEBAPP_RUNTIME`, `UI_WEBAPP_IMAGE` and `UI_WEBAPP_PORT` override the runtime, image and initial Webapp port; an existing container keeps its port. `CHROMIUM_EXECUTABLE` selects an already installed browser. The script never changes global Hermes/browser settings.

## Cleanup

```sh
npm run webapp -- stop
```

Stop when testing is finished. This closes Chromium cleanly and stops only this checkout's container, retaining its data and browser profile. Resume with `start` then `browser`.

`browser-reset` is manual-only: it closes Chromium and deletes just the browser profile. To retire a task worktree, run `npm run webapp -- destroy` **before** removing that worktree; it removes that checkout's container and generated `.test-webapp` state. No global pruning or changes to T3sidebar's containers are performed.

## Reproducing duplicated messages

`tools/test-webapp/mock-llm.py` is a scripted OpenAI-compatible model, so live turns run without provider credentials: the gateway, tools and renderer are real, the replies are invented. Every prose block carries a unique `[xxxxxxxx]` tag, so a tag rendered twice is a duplicate. Run it in the container (`podman cp` it to `/opt/data`, then `python /opt/data/mock-llm.py 18080` as `hermes`) and point the workspace profile at it with `hermes config set` (`model.provider custom`, `model.base_url http://127.0.0.1:18080/v1`, `model.default mock`, and a placeholder `model.api_key`). Prompt keywords such as `long`, `background`, `parallel` or `many` select its scenarios.

The `repro-*.js` files are `drive` bodies (`npm run webapp -- drive "$(cat tools/test-webapp/repro-dupes.js)"`) whose header comments list their environment variables:

- `repro-dupes.js` runs turns across scenarios and records every duplicate seen. With `compression.in_place true` and a low `compression.threshold_tokens` (30000), the long scenario compacts mid-turn and leaves duplicates.
- `repro-away.js` leaves a session mid-turn and returns, in a session longer than the 120-row tail page.
- `repro-remedies.js` reproduces the compaction case and tries plugin-reachable remedies in order.

They are diagnostics for [#134415](https://github.com/NousResearch/hermes-agent/issues/134415), useful to recheck the resync after a Desktop update; they are not part of `npm test`.

The approval card only exists for a live request, so its width is checked the same way: with the mock serving the profile and `hermes config set approvals.mode manual` (the default smart mode asks the mock instead of the user), `approval-width.js` starts a turn whose scripted command is a recursive delete of a path that never exists, measures the card with the plugin's widths on and off, then rejects it. MCP setup cards also need a live request and have no seeded check; the fixture suite covers their selector. Back up `/opt/data/config.yaml` before these `config set` calls and restore it afterwards, so seeded and integration runs keep their usual profile.

## Fixture checks

`npm test` remains the fast, broader fixture suite. It complements the real-renderer smoke check; neither suite claims to exercise native Electron integration or live model execution.

```sh
npm ci && npx playwright install chromium && npm test
```

Tests run the actual plugin in headless Chromium against geometry fixtures matching older/current/browser-hosted previews and stateful tool-control fixtures matching the inspected `ToolRun`, `ToolEntry`, and `DisclosureRow` contracts. The latter persist disclosure state synchronously, commit DOM updates later, and unmount hidden rows. The settings page is rendered with real React and a fixture matching the public SDK's `ToggleRow`, registry, and namespaced-storage contracts. These are fixtures, not a full Electron Desktop build; native Electron behavior requires a separate integration check. The React/esbuild packages are development-only; Desktop supplies the plugin's runtime imports itself.

Coverage includes preview resizing and interaction-state retention, dynamic messages, list-only expansion, folded patch/edit/write diffs, manual and keyboard overrides, pending-to-completed edits, native state preservation on remount, errors and unrelated controls, storage denial, approval visibility, disposal, and repeated reloads. Settings tests exercise independent switches, live enable/disable behavior, plugin/browser reload persistence, malformed preferences, manual-choice preservation, registration fallback, and in-memory operation when storage is denied. Status-drawer tests cover both drawer bodies, retained contents/drafts, scoped manual opens, reused grips on navigation, native closed choices, late insertion/reveal, and listener disposal; integration checks exercise the real branch row in a credential-free test Git repo. Tool-layout geometry tests check indentation, continuous connectors and the final L with an expanded result, appended/removed calls, one-step-smaller tool lines with native-size opened results, gapless adjacent tool blocks, the tree toggle's box position, rail join, hit targets, accessible name, plus/minus states, ticker join, RTL placement and switch-off behavior, unchanged prose/result spacing, singleton/outside-scope isolation, dynamic insertion, narrow layouts, RTL, a ticker window that keeps the newest call in view at the smaller stride, retained input state, and exact restoration on disable. Width tests check that audio, approval, subagent, artifact and MCP-launch cards fill the message while video, settled MCP, connector and catalog cards keep their caps, and that the switch applies live, persists and covers previews. Code block tests check that an expanded block reaches the raised cap within the window bound and drops its fade, while folded, short and out-of-scope blocks keep their native size, and that the switch applies live and persists. Timestamp tests compare each text line's position with and without timestamps, including after an opened diff, and check the first-line wrap, the shared end column, the action-row overlay with its hit targets, full-width opening blocks below the time, and restoration on disable. The real-renderer check also verifies the open list's minus box and continuous rail, one-step-smaller tool lines next to native tokens, gapless adjacent blocks, the seeded timestamps' placement, full-width code cards, tables, previews and display math opening a text block, an expanded long code block at the raised cap without its fade and back to native with its switch off, full-width audio, artifact and subagent cards with the switch restoring their caps live, and the tree-toggle switch applying live.

For an existing Playwright installation or separately installed Chromium, tests accept `PLAYWRIGHT_MODULE` and `CHROMIUM_EXECUTABLE`. `PLUGIN_SOURCE` selects an alternate source for tool-default and tool-layout tests, allowing mutation checks without editing the delivered plugin.

## Preferences and lifecycle

Changes take effect without reloading. Enabling a native disclosure default also applies it to currently mounted controls that do not already have an explicit choice. Turning one off stops applying it without forcing the opposite layout or clearing manual choices. The taller prompt edit box is reversible styling: turning that setting off immediately restores the native 12rem cap. Full-width previews remain enabled regardless of these switches.

Preferences are saved through the public `ctx.storage` API for this plugin on this Desktop installation/browser, not on the remote backend. They survive plugin and app reloads. If local storage is unavailable, the switches still work for the current plugin instance but cannot persist. Older hosts without the `registerSettingsPage` convenience helper use the documented `settings.plugins` contribution fallback.

The plugin keeps its existing `hermes-wide-previews` ID so updates retain saved preferences. Updating files on a remote Hermes server does **not** update the separate native Desktop copy. No build, npm installation, backend install, or backend restart is needed to use this plugin.

Disabling the plugin removes its preview/history styles, observers and listeners. An already queued restoration of a saved manual choice may finish on the next animation frame; no new defaults are applied after disable. Native disclosure states remain as they are, just as after manual toggles; ordinary history messages return to native styling. To uninstall, disable it and remove only its `hermes-wide-previews` folder.

## Duplicated messages

Desktop sometimes paints part of a conversation twice although the server holds one copy ([#134415](https://github.com/NousResearch/hermes-agent/issues/134415)), for example after leaving a session mid-turn and coming back, or after an in-place context compaction during a turn.

- When a turn ends, or after switching to a session, the plugin looks for a repeated run of assistant prose in the main chat. Tool rows, thinking blocks and short repeated wording are ignored.
- If it finds one, it asks Desktop to rebuild that session from the server, as Desktop itself does after missing gateway events. No page reload, no request to the server; other tabs and the composer are untouched.
- A broom button next to the model picker, in every composer including split tiles, does the same on demand. It turns orange when that chat shows duplicates, sweeps while cleaning, and is disabled and struck through while the session is working.
- In a split tile, the button acts on the tile once it has focus (clicking in it is enough). Automatic resync covers the primary chat only.

## Implementation and compatibility

The plugin does not change Hermes's global settings, messages, file contents, or tool execution. It makes no network requests and needs no agent-side component. The public SDK supplies registration and disposal but no default-expansion hook for these chat controls. The plugin therefore uses isolated styling and disclosure controllers:

- One reversible stylesheet targets the two preview wrapper spans inside `[data-slot="aui_assistant-message-content"]`. Native frames are identified by their sandbox and built-in size-message marker; browser-hosted frames use `/assets/webapp-preview.html`. It removes the older 640 px cap/one-time measured width and the newer 960 px cap without replacing the iframe. Under the same switch, caps that only cut or wrap content are lifted: the audio player's span (`span:has(> audio)` in `.aui-md`), `[data-slot="tool-approval-stack"]` (rendered after the messages, so outside the message scope), the delegation card's 75% (`[data-delegate-card]`), `[data-slot="aui_artifact-card"]`, and a `[data-connector-offer]` card containing `[data-slot="mcp-launch-target"]`. MCP setup and connector cards share that markup, so only an MCP card showing its launch command widens; its settled one-word summary and connector cards keep 32rem. Video spans and images keep their caps. Scoped tool-layout rules add logical inline-start padding inside grouped rows or the live ticker, draw noninteractive connectors in that gutter, and reduce only tool-to-tool grid gaps/margins. Inside `[data-tool-row]`, the detail caps are raised by the native Tailwind class names (`max-h-20`, `max-h-56`) and the `file-diff-panel`/`diff-lines` slots; a renamed class leaves the native height. Its own switch adds or removes just these rules from the stylesheet. The row gutter keeps strokes inside native overflow clipping without replacing any controls or adding observers. Apart from the full-width rules and the detail heights, these styles apply independently of the behavioral switches; all of them disappear when the plugin is disabled.
- Tool lines run one native step smaller (`10px` text on `16px` lines instead of `11px` on `18px` at 100% chat text size). The stylesheet overrides Desktop's `--conversation-tool-font-size` and `--conversation-line-height` tokens on each top-level tool row or group rather than font sizes, so the ticker window, reel stride and connector midpoints follow one value; opened results get the message's native values back. Adjacent top-level tool blocks touch. A renamed token leaves native sizes.
- The tree toggle is a separate stylesheet, present only while its switch is on. It restyles the native summary button rather than adding a control: while the list is open, the summary takes no height, its label is visually hidden but keeps the button's accessible name, its time is hidden, and the button covers only the rail's gutter beside the first call. While folded, the button keeps its line with its label moved one indent level in. The box is the button's `::before`, so clicks, keyboard use, `aria-expanded` and saved disclosure choices stay Hermes's own.
- Timestamp placement is part of the always-on stylesheet and only matches `[data-slot="timeline-timestamp"]` elements, which Hermes renders only with `display.timestamps`. A text block's time floats to the end of its first line; the text switches from `overflow: hidden` to `overflow: clip`, which still clips but lets only that first line wrap around the float. The native block gap moves from the time to the text, and to the float, which Chromium places below the previous block's own margin, so text lines land exactly where they would without timestamps. Only running text (paragraphs, headings, lists, quotes) shares that line: any other block opening the text clears the float, since a code card or table wrapper starts a formatting context that would shrink as a whole beside it, and a preview or display math would run under it. The message footer's time has no height and is drawn over the empty start of the following action row (`.min-h-6`), above it so its precise-time tooltip remains reachable. Fold summaries and other disclosure rows push a trailing time to the end when no action button sits between.
- A mutation observer reacts to added tool controls and disclosure/visibility attributes. It uses the existing group/row buttons rather than hiding code with CSS or changing React state privately. Only groups expand; only open file-edit rows containing a `file-diff-panel` fold, according to the corresponding preference. Candidate scanning is incremental, with each subtree or composer dock searched once per mutation delivery; changing a switch performs one refresh, not recurring full-transcript scans or polling. A controller whose defaults are all off searches for nothing, still records manual choices, and applies a default to mounted controls when it is switched back on.
- A separate incremental controller uses `[data-slot="status-drawer-toggle"]` and its controlled drawers. It identifies only the native queued section's header icon (`layers` or `debug-pause`), including inside a folded/inert drawer, without parsing translated labels. When queue expansion is enabled, a queue header appearing or changing reopens that drawer and list; other composers and status groups are untouched. Status folding is checked independently when the queue empties. Native folding preserves accessibility and mounted state. Session/profile/connection focus changes and hash navigation refresh defaults for reused composer controls. Hosts without the drawer marker are left unchanged.
- A prompt-text controller opens only the queued row's native text chevron; sent prompts keep their native fold and expansion controls. A separate reversible stylesheet raises only the `max-h-48` cap of the editor inside `aui_edit-composer-root`, the inline editor a sent prompt opens on click; the main composer and the read-only bubbles keep their own sizing. Queued-text manual choices are preserved while their buttons stay mounted; unlike tool disclosures, core does not persist these choices across remounts.

Before/after reads of `hermes.desktop.toolDisclosure.v1` distinguish an explicit saved native choice from a default. Storage is read at every boundary; its JSON is parsed again only when the stored text changed. When a newly mounted control reveals an existing choice, the controller restores it through the native toggle after the render commits. With local storage unavailable, per-mounted-control manual toggles are still respected, but preservation across remounts cannot be guaranteed.

Hermes stores only closed status drawers in `hermes.desktop.collapsedStatusDrawers.v1`. The plugin records up to 512 explicit manual opens under its own `openStatusDrawers` storage entry, keyed by the exact connection/profile/session identity revealed by the native toggle. It restores those opens after remounts/reloads instead of guessing a session scope. Automatic queue reveals never become saved manual-open choices. An open choice made before this plugin was active cannot be distinguished from Hermes's open default. Unsaved drafts and denied local storage retain manual choices only while their control stays mounted.

The duplicate resync uses the public `host.state` atoms (`activeSessionId`, `busyBySession`), `host.notify` and a `COMPOSER_AREAS.actions` button; a split tile's session is read from `focusedSessionId` while that tile has focus. The broom is Lucide's `broom` icon (ISC). The rebuild itself relies on Desktop internals: the plugin wraps `WebSocket.prototype.send` to recognize the renderer's gateway socket (`/api/ws`) and dispatches a local `session.replay_gap` event on it, which Desktop answers with an authoritative snapshot of the session. If a Desktop update changes that event or its transport, the resync stops having an effect and the leftover notification suggests a reload; disabling the plugin ends an in-flight resync silently and restores `send`, or, if another wrapper was installed above it since, leaves its own wrapper in place passing frames through. Closed sockets are forgotten once a resync or a reconnect finds them. The buttons and the automatic check analyse each chat once per notification, never while its session works. On hosts without `host.state`, the feature is skipped and the other tweaks still load.

The wrapper shape, tool markers, disclosure buttons, browser endpoint, and local-storage key are Hermes implementation details, not a stable chat-customization API. The plugin lives outside Hermes core and survives application updates, but a future renderer change may require updating its selectors. It intentionally preserves any separate width restriction on the chat column itself. Preview attachment cards are not converted into live previews.
