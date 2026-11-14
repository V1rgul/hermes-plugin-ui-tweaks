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
- `seed` writes two clearly labeled invented conversations through Hermes's own `SessionDB`: grouped tool calls with a patch diff, and an interactive HTML preview served from the test workspace. Rerunning preserves existing sessions, including manual test conversations. It does not call a model or manufacture a claimed live execution.
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

## Fixture checks

`npm test` remains the fast, broader fixture suite. It complements the real-renderer smoke check; neither suite claims to exercise native Electron integration or live model execution.
