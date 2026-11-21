#!/bin/sh
# Real Hermes Desktop workspace in a container; only this checkout's test data is mounted.
set -eu
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
REPO=$(CDPATH= cd -- "$HERE/../.." && pwd -P)
STATE=$REPO/.test-webapp
PROFILE=$STATE/browser-profile
RUNTIME=${UI_WEBAPP_RUNTIME:-$(command -v podman >/dev/null 2>&1 && printf podman || printf docker)}
IMAGE=${UI_WEBAPP_IMAGE:-docker.io/nousresearch/hermes-agent:latest}
# Include the full checkout path: equally named worktrees in different repos must not share a container.
NAME=ui-tweaks-$(printf '%s' "$REPO" | cksum | cut -d ' ' -f 1)
LABEL=ui-tweaks.checkout
PLUGIN=/opt/data/desktop-plugins/hermes-wide-previews
fail() { printf '%s\n' "$*" >&2; exit 1; }
# Generated state must never redirect a mount, browser profile or cleanup into another directory.
for path in "$STATE" "$STATE/data" "$PROFILE"; do [ ! -L "$path" ] || fail "Refusing symlinked test state: $path"; done
exists() { "$RUNTIME" container inspect "$NAME" >/dev/null 2>&1; }
owned() {
	[ "$("$RUNTIME" container inspect -f "{{index .Config.Labels \"$LABEL\"}}" "$NAME")" = "$REPO" ] || fail "Refusing to touch $NAME: it belongs to another checkout"
}
in_box() { "$RUNTIME" exec --user hermes -e HERMES_HOME=/opt/data "$NAME" "$@"; }
port_free() {
	! "$RUNTIME" ps -a --format '{{.Ports}}' | grep -q ":$1->" || return 1
	rc=0
	curl -s -o /dev/null --max-time 1 "http://127.0.0.1:$1/" || rc=$?
	[ "$rc" -eq 7 ]
}
# The existing container is authoritative, including after another worktree took a lower port.
if exists; then
	owned
	PORT=$("$RUNTIME" container inspect -f '{{(index (index .HostConfig.PortBindings "9120/tcp") 0).HostPort}}' "$NAME")
	[ -z "${UI_WEBAPP_PORT:-}" ] || [ "$UI_WEBAPP_PORT" = "$PORT" ] || fail "Existing container uses port $PORT; destroy it before changing ports"
else
	PORT=${UI_WEBAPP_PORT:-19220}
	case "$PORT" in ''|*[!0-9]*) fail 'UI_WEBAPP_PORT must be a number';; esac
	[ "$PORT" -ge 1024 ] && [ "$PORT" -lt 64000 ] || fail 'Webapp port must be in 1024..63999'
	if [ -n "${UI_WEBAPP_PORT:-}" ]; then
		port_free "$PORT" || fail "Port $PORT is already reserved"
	else
		until port_free "$PORT"; do PORT=$((PORT + 1)); [ "$PORT" -lt 19320 ] || fail 'No free test port'; done
	fi
fi
CDP_PORT=$((PORT + 1000))
drive() { UI_WEBAPP_CDP_PORT=$CDP_PORT UI_WEBAPP_SHOTS=$STATE/shots node "$HERE/drive.mjs" "$@"; }
wait_ready() {
	i=0
	until code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/") && [ "$code" -ge 200 ] && [ "$code" -lt 500 ]; do
		i=$((i + 1)); [ "$i" -lt 90 ] || fail "Webapp did not start; inspect with $RUNTIME logs $NAME"
		sleep 1
	done
}
start() {
	exists || fail 'Run setup first'
	owned
	[ "$("$RUNTIME" container inspect -f '{{.State.Running}}' "$NAME")" = true ] || "$RUNTIME" start "$NAME" >/dev/null
	wait_ready
}
sync_plugin() {
	# This UI-only plugin needs no package manifest, backend enablement, helper plugin or credential.
	"$RUNTIME" exec "$NAME" mkdir -p "$PLUGIN"
	"$RUNTIME" cp "$REPO/plugin.js" "$NAME:$PLUGIN/plugin.js"
	"$RUNTIME" exec "$NAME" chown -R hermes:hermes "$PLUGIN"
}
login_url() {
	in_box hermes webapp --no-open --skip-build | sed -n "s|^ *http://127.0.0.1:9121/|http://127.0.0.1:$PORT/|p"
}
# Check kernel argv, not just a reusable PID, before stopping any process.
browser_pid() {
	[ -f "$STATE/browser.pid" ] || return 1
	pid=$(cat "$STATE/browser.pid")
	node -e 'const fs=require("node:fs"); try { const args=fs.readFileSync(`/proc/${process.argv[1]}/cmdline`, "utf8").split("\0"); if (!args.includes(process.argv[2]) || !args.includes(process.argv[3])) process.exit(1); } catch { process.exit(1); }' "$pid" "$HERE/browser.mjs" "$PROFILE" || return 1
	printf '%s' "$pid"
}
stop_browser() {
	pid=$(browser_pid) || return 0
	# A normal close flushes localStorage; SIGTERM can lose the last preference change.
	drive 'await (await context.browser().newBrowserCDPSession()).send("Browser.close").catch(() => {})' >/dev/null 2>&1 || true
	i=0
	while kill -0 "$pid" 2>/dev/null && [ "$i" -lt 50 ]; do sleep 0.1; i=$((i + 1)); done
	! browser_pid >/dev/null || kill "$pid"
	rm -f "$STATE/browser.pid"
}
# The Webapp requires loopback for passwordless launch links. Only a same-user forwarder may redeem them.
FORWARD='import asyncio
async def pipe(reader, writer):
	try:
		while data := await reader.read(65536):
			writer.write(data); await writer.drain()
	finally:
		writer.close()
async def client(reader, writer):
	try:
		upstream = await asyncio.open_connection("127.0.0.1", 9121)
	except OSError:
		writer.close(); return
	await asyncio.gather(pipe(reader, upstream[1]), pipe(upstream[0], writer), return_exceptions=True)
async def main():
	async with await asyncio.start_server(client, "0.0.0.0", 9120):
		await asyncio.Event().wait()
asyncio.run(main())'
case "${1:-}" in
setup)
	if exists; then start; else
		mkdir -p "$STATE/data"
		# A new container gets the current release: a cached floating tag would otherwise stay on an old one. Offline, fall back to the cached image.
		"$RUNTIME" pull "$IMAGE" >/dev/null || "$RUNTIME" image inspect "$IMAGE" >/dev/null 2>&1 || fail "Cannot pull $IMAGE"
		# Configure only the dedicated test home through the native CLI. Never clone a real Hermes home.
		"$RUNTIME" run --rm -v "$STATE/data:/opt/data:Z" "$IMAGE" sh -c 'hermes config set webapp.enabled true && hermes config set webapp.host 127.0.0.1 && hermes config set webapp.port 9121 && hermes config set telemetry.shared_metrics.enabled false && hermes config set telemetry.shared_metrics.send false' >/dev/null
		"$RUNTIME" run -d --name "$NAME" --label "$LABEL=$REPO" -v "$STATE/data:/opt/data:Z" -p "127.0.0.1:$PORT:9120" --entrypoint sh "$IMAGE" -c '/command/s6-setuidgid hermes /opt/hermes/.venv/bin/python -c "$1" & exec /opt/hermes/docker/entrypoint-dispatch.sh gateway run' sh "$FORWARD" >/dev/null
		wait_ready
	fi
	sync_plugin
	printf '%s\n' "$NAME http://127.0.0.1:$PORT (CDP $CDP_PORT)" 'Ready. Run seed, then browser. No model credentials are installed.'
	;;
sync)
	start; sync_plugin
	printf '%s\n' 'Copied working-tree plugin.js. Reload the test browser to pick up changes.'
	;;
seed)
	start
	# Transcript timestamps exercise the plugin's time layout. Display-only: no model context changes.
	in_box hermes config set display.timestamps true >/dev/null
	"$RUNTIME" cp "$HERE/seed.py" "$NAME:/opt/data/ui-tweaks-seed.py"
	in_box /opt/hermes/.venv/bin/python /opt/data/ui-tweaks-seed.py
	;;
start) start;;
stop) stop_browser; exists && "$RUNTIME" stop "$NAME" >/dev/null;;
login-url) start; login_url;;
browser)
	start
	if ! browser_pid >/dev/null; then
		port_free "$CDP_PORT" || fail "CDP port $CDP_PORT is already occupied"
		mkdir -p "$PROFILE" "$STATE/shots"
		# The Node owner retains stable argv: Chromium rewrites its own kernel command line.
		nohup node "$HERE/browser.mjs" "$PROFILE" "$CDP_PORT" > "$STATE/browser.log" 2>&1 &
		printf '%s\n' "$!" > "$STATE/browser.pid"
		i=0
		until curl -s -o /dev/null "http://127.0.0.1:$CDP_PORT/json/version"; do
			i=$((i + 1)); [ "$i" -lt 100 ] || fail "Browser did not start; see $STATE/browser.log"; sleep 0.1
		done
	fi
	link=$(login_url)
	[ -n "$link" ] || fail 'Hermes returned no launch link'
	UI_WEBAPP_URL=$link drive 'await page.goto(process.env.UI_WEBAPP_URL); await page.waitForFunction(() => Boolean(window.hermesDesktop)); await page.waitForSelector("[role=tab]"); await page.locator("style[data-hermes-plugin=hermes-wide-previews]").waitFor({ state: "attached", timeout: 60000 }); return "Signed in; plugin loaded"'
	printf '%s\n' "Browser: $PROFILE; CDP: $CDP_PORT"
	;;
drive) shift; drive "$@";;
browser-reset)
	# Manual only: normal start, sync and stop must retain preferences and sign-in storage.
	stop_browser; rm -rf -- "$PROFILE"
	;;
status)
	"$RUNTIME" ps -a --filter "name=^$NAME\$" --format '{{.Names}} {{.Status}} {{.Ports}}'
	printf '%s\n' "Test state: $STATE; CDP: $CDP_PORT"
	;;
destroy)
	stop_browser
	if exists; then owned; "$RUNTIME" rm -f "$NAME" >/dev/null; fi
	# Remove only the fixed generated data subdirectory; never a caller-supplied directory or a shared home.
	if [ -d "$STATE/data" ]; then
		"$RUNTIME" run --rm -v "$STATE:/test:Z" --entrypoint rm "$IMAGE" -rf /test/data
	fi
	rm -rf -- "$STATE"
	;;
*) printf '%s\n' "Usage: $0 <setup|sync|seed|start|stop|login-url|browser|drive '<code>'|browser-reset|status|destroy>"; exit 2;;
esac
