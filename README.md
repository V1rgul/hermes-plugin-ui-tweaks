# Hermes UI Tweaks

A small Hermes Desktop UI plugin for full-width inline HTML previews, expanded tool-call lists, and folded file-edit diffs.

## Chat behavior

- Built-in inline HTML previews fill the available assistant-message width. Ordinary prose, images, preview height, sandbox, document contents, and widget state stay unchanged.
- Tool-call lists start expanded, without opening every tool's input/output details.
- Calls inside a fold are indented one level (`1rem`) beneath its summary, including the live ticker. Ungrouped single calls keep their original alignment.
- Tool lists use a compact `0.125rem` row gap. Adjacent top-level tool blocks also have tighter spacing; prose boundaries, result contents, and ticker row heights retain their native spacing.
- Successful patches and file edits that contain a diff start folded. Their toggle still opens the code normally; filenames and line counts remain Hermes's own UI.
- Manual mouse and keyboard toggles take precedence. Existing native disclosure choices are preserved when local storage is available, including when rows or sessions remount.
- Late-arriving diffs and newly rendered messages receive the same defaults. Failed-edit explanations, unrelated controls, thinking blocks, and inert approval activity are left alone.

The native **Hide code diffs** setting remains authoritative: switch it off if you want folded diffs that you can reopen. The plugin does not change Hermes's global settings, messages, file contents, or tool execution. It makes no network requests and needs no agent-side component.

## Settings

Open **Settings → Plugins → Hermes UI Tweaks**. The page uses Hermes's native settings rows and has two independent switches:

- **Expand tool-call lists by default** — enabled by default; opens lists without expanding every tool payload.
- **Fold patches and file edits by default** — enabled by default; folds diffs but leaves them reopenable.

Changes take effect without reloading. Enabling a default also applies it to currently mounted controls that do not already have an explicit choice. Turning a default off stops applying it; it does not force the current chat into the opposite layout or clear manual choices. Full-width previews remain enabled regardless of these two switches.

Preferences are saved through the public `ctx.storage` API for this plugin on this Desktop installation/browser, not on the remote backend. They survive plugin and app reloads. If local storage is unavailable, the switches still work for the current plugin instance but cannot persist. Older hosts without the `registerSettingsPage` convenience helper use the documented `settings.plugins` contribution fallback.

## Installation or update

Download [plugin.js](https://raw.githubusercontent.com/V1rgul/hermes-plugin-ui-tweaks/main/plugin.js) from this repository. The plugin keeps its existing `hermes-wide-previews` ID so updates retain saved preferences.

1. On the computer running Hermes Desktop, open **Capabilities → Plugins** and use the folder/reveal control for **Hermes UI Tweaks** (previously **Wide HTML Previews**) to find its local `plugin.js`.
2. Replace that file with the updated `plugin.js`, keeping the folder name `hermes-wide-previews` and the file directly inside it: `desktop-plugins/hermes-wide-previews/plugin.js`.
3. Desktop watches the folder and should hot-reload it. If needed, use **Reload desktop plugins** in the command palette. Keep **Hermes UI Tweaks** enabled.
4. Open a conversation containing several tool calls and a file-edit diff. New/unselected tool-call lists should be open, diffs folded, and the toggles usable.

For a first installation, use the same folder/reveal control to locate the Desktop plugin root, create the `hermes-wide-previews` folder there, and put `plugin.js` directly inside it.

Updating files on a remote Hermes server does **not** update the separate Windows Desktop copy. No build, npm installation, backend install, or backend restart is needed to use this plugin.

Disabling the plugin removes its preview sizing rule, observer, and click listener. An already queued restoration of a saved manual choice may finish on the next animation frame; no new defaults are applied after disable. Current disclosure choices remain in Hermes's native UI storage, just as after manual toggles; disabling does not reset the chat layout. To uninstall, disable it and remove only its `hermes-wide-previews` folder.

## Implementation and compatibility

The public SDK supplies registration and disposal but no default-expansion hook for these chat controls. The plugin therefore uses two isolated mechanisms:

- One reversible stylesheet targets the two preview wrapper spans inside `[data-slot="aui_assistant-message-content"]`. Native frames are identified by their sandbox and built-in size-message marker; browser-hosted frames use `/assets/webapp-preview.html`. It removes the older 640 px cap/one-time measured width and the newer 960 px cap without replacing the iframe. Scoped tool-layout rules add logical inline-start padding after a group summary and reduce only tool-to-tool grid gaps/margins. These styles apply independently of the two behavioral switches and disappear when the plugin is disabled.
- A mutation observer reacts to added tool controls and disclosure/visibility attributes. It uses the existing group/row buttons rather than hiding code with CSS or changing React state privately. Only groups expand; only open file-edit rows containing a `file-diff-panel` fold, according to the corresponding preference. Candidate scanning is incremental; changing a switch performs one refresh, not recurring full-transcript scans or polling.

Before/after reads of `hermes.desktop.toolDisclosure.v1` distinguish an explicit saved native choice from a default. When a newly mounted control reveals an existing choice, the controller restores it through the native toggle after the render commits. With local storage unavailable, per-mounted-control manual toggles are still respected, but preservation across remounts cannot be guaranteed.

The wrapper shape, tool markers, disclosure buttons, browser endpoint, and local-storage key are Hermes implementation details, not a stable chat-customization API. The plugin lives outside Hermes core and survives application updates, but a future renderer change may require updating its selectors. It intentionally preserves any separate width restriction on the chat column itself. Preview attachment cards are not converted into live previews.

## Tests

```sh
npm ci && npx playwright install chromium && npm test
```

Tests run the actual plugin in headless Chromium against geometry fixtures matching older/current/browser-hosted previews and stateful tool-control fixtures matching the inspected `ToolRun`, `ToolEntry`, and `DisclosureRow` contracts. The latter persist disclosure state synchronously, commit DOM updates later, and unmount hidden rows. The settings page is rendered with real React and a fixture matching the public SDK's `ToggleRow`, registry, and namespaced-storage contracts. These are fixtures, not a full Electron Desktop build; the user's installed Windows client remains the final integration check. The React/esbuild packages are development-only; Desktop supplies the plugin's runtime imports itself.

Coverage includes preview resizing and interaction-state retention, dynamic messages, list-only expansion, folded patch/edit/write diffs, manual and keyboard overrides, pending-to-completed edits, native state preservation on remount, errors and unrelated controls, storage denial, approval visibility, disposal, and repeated reloads. Settings tests exercise both switches independently, live enable/disable behavior, plugin/browser reload persistence, malformed preferences, manual-choice preservation, registration fallback, and in-memory operation when storage is denied. Tool-layout geometry tests check indentation, compact list and adjacent-tool gaps, unchanged prose/result spacing, singleton/outside-scope isolation, dynamic insertion, narrow layouts, RTL, ticker stride, retained input state, and exact restoration on disable.

For an existing Playwright installation or separately installed Chromium, tests accept `PLAYWRIGHT_MODULE` and `CHROMIUM_EXECUTABLE`. `PLUGIN_SOURCE` selects an alternate source for tool-default and tool-layout tests, allowing mutation checks without editing the delivered plugin.
