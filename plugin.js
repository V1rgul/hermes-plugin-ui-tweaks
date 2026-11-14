import * as sdk from '@hermes/plugin-sdk'
import { ToggleRow } from '@hermes/plugin-sdk'
import { useEffect, useRef, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

/** Customize chat presentation without touching preview documents or message history. */
const ID = 'hermes-wide-previews'
const NAME = 'Hermes UI Tweaks'
const defaultPreferences = { expandToolCalls: true, foldFileEdits: true, autoResync: true }

function readPreferences(storage) {
	const saved = storage.get('preferences', {})
	return Object.fromEntries(Object.entries(defaultPreferences).map(([key, fallback]) => [key, typeof saved?.[key] === 'boolean' ? saved[key] : fallback]))
}

function SettingsPage({ getPreferences, updatePreference }) {
	const [preferences, setPreferences] = useState(getPreferences)
	const change = key => on => setPreferences(updatePreference(key, on))
	return jsxs('div', {
		children: [
			jsx(ToggleRow, {
				label: 'Expand tool-call lists by default',
				description: 'Show the list of calls without opening every call’s input/output details.',
				checked: preferences.expandToolCalls,
				onChange: change('expandToolCalls')
			}),
			jsx(ToggleRow, {
				label: 'Fold patches and file edits by default',
				description: 'Keep diffs closed until you open them. Leave Hermes “Hide code diffs” off to keep them reopenable.',
				checked: preferences.foldFileEdits,
				onChange: change('foldFileEdits')
			}),
			jsx(ToggleRow, {
				label: 'Resync duplicated messages automatically',
				description: 'When a finished turn shows repeated blocks, rebuild the chat from the server. The status-bar resync button does the same on demand.',
				checked: preferences.autoResync,
				onChange: change('autoResync')
			}),
			jsx('p', {
				className: 'mt-4 text-sm text-(--ui-text-secondary)',
				children: 'Changes apply without reloading. Turning a default off leaves the current layout unchanged; manual choices are always respected. HTML previews stay full width.'
			})
		]
	})
}

// Desktop uses srcdoc; the browser workspace uses a served document instead.
// The size-message marker distinguishes native previews from unrelated srcdoc frames.
const frame = 'iframe[sandbox="allow-scripts"]:is([srcdoc*="hermes-inline-preview-size"], [src*="/assets/webapp-preview.html"])'
const scope = '[data-slot="aui_assistant-message-content"]'

export const previewStyles = `
${scope} span:has(> span > ${frame}),
${scope} span:has(> ${frame}) {
	width: 100% !important;
	max-width: none !important;
	min-width: 0 !important;
	box-sizing: border-box;
}
`

// Indent the list/ticker, not its summary or the contents of an individual result.
// Compact only tool-to-tool spacing; keep the prose boundaries and ticker line height intact.
export const toolLayoutStyles = `
${scope} [data-tool-group] {
	--tool-row-gap: 0.125rem;
	row-gap: 0.125rem !important;
}
${scope} [data-tool-group] > [data-tool-summary] ~ div:has([data-tool-row]) {
	padding-inline-start: 1rem;
	box-sizing: border-box;
	min-width: 0;
}
${scope} [data-tool-group] > [data-tool-summary] ~ div:not([data-tool-ticker]):has([data-tool-row]) {
	row-gap: 0.125rem !important;
}
${scope} > :is([data-tool-row], [data-tool-group]) + :is([data-tool-row], [data-tool-group]) {
	margin-block-start: 0.125rem !important;
}
${scope} > :is([data-tool-row], [data-tool-group]):has(+ :is([data-tool-row], [data-tool-group])) {
	margin-block-end: 0 !important;
}
`

export function installWidePreviews(doc = document) {
	const style = doc.createElement('style')
	style.dataset.hermesPlugin = ID
	style.textContent = previewStyles + toolLayoutStyles + resyncStyles
	doc.head.append(style)
	return () => style.remove()
}

// Hermes persists these same disclosures when its own buttons are clicked.
// Reading before/after lets a remounted row keep an explicit choice instead of mistaking it for a default.
const disclosureStorageKey = 'hermes.desktop.toolDisclosure.v1'
const ownerSelector = '[data-tool-group], [data-tool-row]'

function disclosureStates(doc) {
	try {
		const states = JSON.parse(doc.defaultView.localStorage.getItem(disclosureStorageKey) || '{}')
		return states && typeof states === 'object' && !Array.isArray(states) ? states : {}
	} catch { return {} }
}

function toggleFor(owner) {
	return owner.querySelector(owner.matches('[data-tool-group]')
		? ':scope > [data-tool-summary] button[aria-expanded]'
		: ':scope > div:first-child button[aria-expanded]')
}

export function installToolDefaults(doc = document, getPreferences = () => defaultPreferences) {
	const win = doc.defaultView
	const initialized = new WeakSet()
	const candidates = new Set()
	const restores = new Map()
	let applying = false
	let disposed = false
	let frameId = null

	function click(button) {
		applying = true
		try { button.click() } finally { applying = false }
	}

	function restoreChoices() {
		for (const [owner, restore] of restores) {
			const button = toggleFor(owner)
			if (!owner.isConnected || !button) {
				restores.delete(owner)
			} else if (button.getAttribute('aria-expanded') !== String(restore.open)) {
				restores.delete(owner)
				click(button)
			}
		}
	}

	function scheduleRestore() {
		if (frameId !== null) return
		frameId = win.requestAnimationFrame(() => {
			frameId = null
			restoreChoices()
			if (disposed) restores.clear()
		})
	}

	function setDefault(owner, button, open) {
		initialized.add(owner)
		if (button.getAttribute('aria-expanded') === String(open)) return
		const before = disclosureStates(doc)
		click(button)
		const after = disclosureStates(doc)
		// Existing booleans are explicit native choices, including a manual toggle before plugin activation.
		if (Object.keys(after).some(key => after[key] === open && typeof before[key] === 'boolean' && before[key] !== open)) {
			restores.set(owner, { open: !open })
			scheduleRestore()
		}
	}

	function applyDefaults(owner) {
		if (initialized.has(owner) || !owner.isConnected || !owner.closest(scope) || owner.closest('[inert], [aria-hidden="true"]')) return
		const button = toggleFor(owner)
		if (!button || button.disabled) return
		if (owner.matches('[data-tool-group]')) {
			if (getPreferences().expandToolCalls) setDefault(owner, button, true)
		} else if (getPreferences().foldFileEdits && owner.matches('[data-file-edit]') && owner.querySelector('[data-slot="file-diff-panel"]')) {
			// The edit marker exists only while open; wait for an actual diff so errors stay readable.
			setDefault(owner, button, false)
		}
	}

	function queueOwner(node) {
		const owner = node.nodeType === 1 ? node.closest(ownerSelector) : null
		if (owner) candidates.add(owner)
	}

	function queueTree(node) {
		if (node.nodeType !== 1 && node.nodeType !== 9) return
		queueOwner(node)
		for (const owner of node.querySelectorAll(`${scope} [data-tool-group], ${scope} [data-tool-row]`)) candidates.add(owner)
	}

	function flush() {
		if (disposed) return
		restoreChoices()
		for (const owner of candidates) applyDefaults(owner)
		candidates.clear()
	}

	function onClick(event) {
		if (applying) return
		const button = event.target?.closest?.('button[aria-expanded]')
		const owner = button?.closest(ownerSelector)
		if (!owner?.closest(scope) || button !== toggleFor(owner)) return
		// Capture runs before React changes the DOM, including keyboard-activated button clicks.
		initialized.add(owner)
		restores.delete(owner)
	}

	const observer = new win.MutationObserver(records => {
		for (const record of records) {
			queueOwner(record.target)
			if (record.attributeName === 'inert' || record.attributeName === 'aria-hidden') queueTree(record.target)
			for (const node of record.addedNodes) queueTree(node)
		}
		flush()
	})
	doc.addEventListener('click', onClick, true)
	observer.observe(doc, {
		childList: true,
		subtree: true,
		attributes: true,
		attributeFilter: ['aria-expanded', 'data-file-edit', 'inert', 'aria-hidden']
	})
	queueTree(doc)
	flush()

	return {
		refresh() { queueTree(doc); flush() },
		dispose() {
			disposed = true
			observer.disconnect()
			doc.removeEventListener('click', onClick, true)
			// A native commit may still be queued. Finish only its preservation, never apply new defaults after disposal.
			restoreChoices()
			if (restores.size) scheduleRestore()
			else if (frameId !== null) { win.cancelAnimationFrame(frameId); frameId = null }
			candidates.clear()
		}
	}
}

// Desktop can paint part of a transcript twice (a mid-turn resume grafting its refresh page beside the live copy, or an in-place compaction re-inserting a turn) while the server holds one copy.
// Only a full rebuild from the server clears it: Desktop does that for a `session.replay_gap`, so the resync delivers one to the renderer's own gateway socket. Nothing is sent to the server.
const proseSelector = 'p, pre, h1, h2, h3, h4, h5, h6, li:not(:has(p))'
const userSelector = '[data-slot="aui_user-message-root"]'
const ignoredSelector = '[data-tool-row], [data-tool-group], [data-slot^="aui_thinking"], [data-slot="aui_reasoning-text"]'
const userMark = '\u0000user '

export function transcriptBlocks(surface) {
	const blocks = []
	for (const el of surface.querySelectorAll(`${scope} :is(${proseSelector}), ${userSelector}`)) {
		const user = el.matches(userSelector)
		if (!user && (el.closest(ignoredSelector) || el.parentElement?.closest(proseSelector))) continue
		const text = el.textContent.replace(/\s+/g, ' ').trim()
		if (text) blocks.push(user ? userMark + text : text)
	}
	return blocks
}

/** Longest repeated run of consecutive blocks, measured in assistant text, or null when none is long enough to be a paint duplicate rather than repeated wording. */
export function findDuplicateRun(blocks, { minChars = 80, singleChars = 200 } = {}) {
	const positions = new Map()
	let best = null
	blocks.forEach((text, j) => {
		for (const i of positions.get(text) ?? []) {
			// Measure each run once, from its first block.
			if (i > 0 && blocks[i - 1] === blocks[j - 1]) continue
			let length = 0
			let chars = 0
			while (j + length < blocks.length && i + length < j && blocks[i + length] === blocks[j + length]) {
				if (!blocks[i + length].startsWith(userMark)) chars += blocks[i + length].length
				length++
			}
			// A resent prompt is not a paint duplicate: count assistant text only.
			if (((length >= 2 && chars >= minChars) || chars >= singleChars) && chars > (best?.chars ?? 0)) best = { first: i, second: j, length, chars, text }
		}
		positions.set(text, [...positions.get(text) ?? [], j])
	})
	return best
}

const gatewaySocket = /\/api\/ws(\?|$)/
const mainSurface = '[data-chat-surface][data-composer-target="main"]'
const tileAnchor = 'session-tile:'

export function installDuplicateResync({ doc = document, host, getPreferences = () => defaultPreferences, notify = () => {}, delays = {} }) {
	const win = doc.defaultView
	const { settle = 3000, verify = 8000, poll = 400, socketWait = 15000, minRunning = 900 } = delays
	const sockets = new Set()
	const waiters = new Set()
	const proto = win.WebSocket?.prototype
	const originalSend = proto?.send
	// The renderer opens its gateway socket before plugins load; its next outgoing frame identifies it.
	function capturingSend(data) {
		if (gatewaySocket.test(this.url)) {
			sockets.add(this)
			for (const resolve of waiters) resolve(this)
			waiters.clear()
		}
		return originalSend.call(this, data)
	}
	if (originalSend) proto.send = capturingSend
	const timers = new Set()
	const wait = ms => new Promise(resolve => {
		const timer = win.setTimeout(() => { timers.delete(timer); resolve() }, ms)
		timers.add(timer)
	})
	const nextSocket = () => Promise.race([new Promise(resolve => waiters.add(resolve)), wait(socketWait).then(() => null)])

	const listeners = new Set()
	const emit = () => { if (!disposed) listeners.forEach(listener => listener()) }
	let running = null
	let unresolved = null
	let disposed = false
	const activeId = () => host.state.activeSessionId.get()
	const busy = id => Boolean(id && host.state.busyBySession.get()?.[id])
	const duplicateIn = surface => surface?.isConnected ? findDuplicateRun(transcriptBlocks(surface)) : null

	// The primary chat shows the active session. A split tile names only its stored session; its runtime id is
	// known while the tile has focus, which clicking inside it gives.
	function sessionOf(surface) {
		if (!surface) return null
		if (surface.matches(mainSurface) || surface.dataset.sessionAnchor === 'workspace') return activeId()
		const anchor = surface.dataset.sessionAnchor ?? ''
		if (!anchor.startsWith(tileAnchor) || host.state.focusedStoredSessionId?.get() !== anchor.slice(tileAnchor.length)) return null
		return host.state.focusedSessionId?.get() ?? null
	}

	function viewOf(el) {
		const surface = el?.closest('[data-chat-surface]')
		const id = sessionOf(surface)
		const working = busy(id)
		// Mid-turn paint is transient by nature; only a settled chat is judged.
		return { running: Boolean(running && running === id), busy: working, duplicates: !working && Boolean(duplicateIn(surface)) }
	}

	async function resync(manual, id, surface) {
		if (!id || running || disposed) return
		if (busy(id)) {
			if (manual) notify({ kind: 'info', message: 'Wait for the turn to finish before resyncing the chat.' })
			return
		}
		running = id
		emit()
		const started = Date.now()
		try {
			let targets = [...sockets].filter(socket => socket.readyState === 1)
			if (!targets.length) targets = [await nextSocket()].filter(Boolean)
			if (!targets.length) {
				notify({ kind: 'warning', message: 'The gateway connection was not found. Reload the window to resync.' })
				return
			}
			const frame = JSON.stringify({ jsonrpc: '2.0', method: 'event', params: { type: 'session.replay_gap', session_id: id, payload: { replay_epoch: 'hermes-ui-tweaks-resync', latest_seq: 0 } } })
			for (const socket of targets) socket.dispatchEvent(new win.MessageEvent('message', { data: frame }))
			let run = duplicateIn(surface)
			for (let waited = 0; run && waited < verify && !disposed; waited += poll) {
				await wait(poll)
				run = duplicateIn(surface)
			}
			// A chat switched away during the rebuild no longer shows this session: nothing to report.
			if (disposed || sessionOf(surface) !== id) return
			const main = surface.matches(mainSurface)
			if (run) {
				// Remember the leftover so automatic checks do not retry the same content forever.
				if (main) unresolved = { id, text: run.text }
				notify({ id: `${ID}-duplicates`, kind: 'warning', message: 'Duplicated messages remain after resyncing.', action: { label: 'Reload window', onClick: () => win.location.reload() } })
			} else {
				if (main) unresolved = null
				if (manual) notify({ kind: 'success', message: 'Chat resynced from the server.' })
			}
		} finally {
			// Keep the sweep visible long enough to be seen, even when the rebuild is instant.
			const left = minRunning - (Date.now() - started)
			if (left > 0 && !disposed) await wait(left)
			running = null
			emit()
		}
	}

	// Automatic resync covers the primary chat; every button re-reads its own chat at the same moments.
	let checkTimer = null
	function check() {
		checkTimer = null
		emit()
		const id = activeId()
		if (disposed || !id || running || !getPreferences().autoResync) return
		const surface = doc.querySelector(mainSurface)
		const run = duplicateIn(surface)
		if (!run || (unresolved?.id === id && unresolved.text === run.text)) return
		resync(false, id, surface)
	}
	function schedule(ms = settle) {
		if (checkTimer !== null) win.clearTimeout(checkTimer)
		checkTimer = win.setTimeout(check, ms)
	}

	// The post-turn refresh lands after busy clears: check once it has settled, for any session (the primary chat
	// or a tile), and after a session switch hydrates.
	let lastBusy = { ...host.state.busyBySession.get() }
	const unlisten = [
		host.state.busyBySession.listen(next => {
			if (Object.keys(lastBusy).some(id => lastBusy[id] && !next?.[id])) schedule()
			lastBusy = { ...next }
			emit()
		}),
		host.state.activeSessionId.listen(() => schedule(settle * 2)),
		...[host.state.focusedSessionId, host.state.focusedStoredSessionId].filter(Boolean).map(atom => atom.listen(emit))
	]
	schedule()

	return {
		subscribe(listener) {
			listeners.add(listener)
			return () => listeners.delete(listener)
		},
		viewOf,
		async resyncFrom(el) {
			const surface = el?.closest('[data-chat-surface]')
			// Desktop focuses a tile on pointerdown, before the click lands here.
			const id = sessionOf(surface)
			if (!id) {
				notify({ kind: 'info', message: 'Click inside that chat once, then resync it.' })
				return
			}
			await resync(true, id, surface)
		},
		refresh: () => schedule(0),
		dispose() {
			disposed = true
			listeners.clear()
			unlisten.forEach(stop => stop())
			if (checkTimer !== null) win.clearTimeout(checkTimer)
			timers.forEach(timer => win.clearTimeout(timer))
			waiters.forEach(resolve => resolve(null))
			// Another wrapper may have been installed on top since; only restore our own.
			if (originalSend && proto.send === capturingSend) proto.send = originalSend
		}
	}
}

// Lucide "broom" icon (ISC licence, https://lucide.dev); newer than the Lucide release bundled with Desktop.
const broomPaths = [
	'M13.5 10.5 22 2',
	'M14.734 13.841a2 2 0 00-.314-2.42L12.58 9.58a2 2 0 00-2.421-.314l-7.657 4.461A1 1 0 002.3 15.3l6.403 6.403a1 1 0 001.571-.204z',
	'm5 18 2-2',
	'm7.699 10.7 5.602 5.601'
]
const resyncClass = 'hermes-ui-tweaks-resync'

// Orange while this chat shows duplicates; while cleaning, the broom sweeps from the end of its handle (top right).
export const resyncStyles = `
.${resyncClass}[data-duplicates] {
	color: var(--ui-orange) !important;
}
.${resyncClass}[aria-busy="true"] svg {
	transform-origin: 92% 8%;
	animation: ${resyncClass}-sweep 0.4s ease-in-out infinite alternate;
}
@keyframes ${resyncClass}-sweep {
	from { transform: rotate(-18deg); }
	to { transform: rotate(18deg); }
}
@media (prefers-reduced-motion: reduce) {
	.${resyncClass}[aria-busy="true"] svg { animation: ${resyncClass}-fade 0.9s ease-in-out infinite alternate; }
}
@keyframes ${resyncClass}-fade {
	from { opacity: 0.35; }
	to { opacity: 1; }
}
`

function ResyncButton({ controller }) {
	const ref = useRef(null)
	const [view, setView] = useState({ running: false, busy: false, duplicates: false })
	useEffect(() => {
		const update = () => { if (ref.current) setView(controller.viewOf(ref.current)) }
		update()
		return controller.subscribe(update)
	}, [controller])
	const title = view.busy ? 'Resync is available once the turn finishes'
		: view.duplicates ? 'Duplicated messages detected: resync this chat from the server'
		: 'Resync this chat from the server'
	return jsx('button', {
		ref,
		type: 'button',
		title,
		'aria-label': title,
		className: [sdk.GHOST_ICON_BTN, resyncClass].filter(Boolean).join(' '),
		'data-duplicates': view.duplicates ? '' : undefined,
		'aria-busy': view.running ? 'true' : undefined,
		disabled: view.busy,
		onClick: () => { if (!view.running) controller.resyncFrom(ref.current) },
		children: jsx('svg', {
			'aria-hidden': 'true', width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
			strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round',
			children: broomPaths.map(d => jsx('path', { d }, d))
		})
	})
}

// Next to the model picker in every composer, the primary chat's and each split tile's.
function registerResyncButton(ctx, controller) {
	ctx.register({ id: 'resync', area: sdk.COMPOSER_AREAS?.actions ?? 'composer.actions', render: () => jsx(ResyncButton, { controller }) })
}

export default {
	id: ID,
	name: NAME,
	description: 'Full-width HTML previews, expanded tool lists, folded file edits, and resync of duplicated chat messages.',
	version: '0.5.0',
	register(ctx) {
		let preferences = readPreferences(ctx.storage)
		const getPreferences = () => preferences
		ctx.onDispose(installWidePreviews())
		const tools = installToolDefaults(document, getPreferences)
		ctx.onDispose(tools.dispose)
		// Older hosts without the state atoms keep every other tweak.
		let duplicates = null
		if (sdk.host?.state?.busyBySession && sdk.host.state.activeSessionId) {
			duplicates = installDuplicateResync({ host: sdk.host, getPreferences, notify: input => sdk.host.notify?.(input) })
			ctx.onDispose(duplicates.dispose)
			registerResyncButton(ctx, duplicates)
		}
		const updatePreference = (key, on) => {
			preferences = { ...preferences, [key]: on }
			ctx.storage.set('preferences', preferences)
			tools.refresh()
			duplicates?.refresh()
			return preferences
		}
		const page = {
			id: 'settings',
			title: NAME,
			icon: 'symbol-color',
			render: () => jsx(SettingsPage, { getPreferences, updatePreference })
		}
		if (ctx.registerSettingsPage) ctx.registerSettingsPage(page)
		else ctx.register({ id: page.id, area: 'settings.plugins', title: page.title, render: page.render, data: { icon: page.icon } })
	}
}
