import * as sdk from '@hermes/plugin-sdk'
import { host, ListRow, ToggleRow } from '@hermes/plugin-sdk'
import { useEffect, useRef, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

/** Customize chat presentation without changing preview documents or stored messages. */
const ID = 'hermes-wide-previews'
const NAME = 'Hermes UI Tweaks'
const defaultPreferences = { expandToolCalls: true, foldFileEdits: true, foldStatusStack: true, expandQueuedPrompts: true, expandQueuedPromptText: true, expandHistoryPrompts: true, autoResync: true }

function readPreferences(storage) {
	const saved = storage.get('preferences', {})
	return Object.fromEntries(Object.entries(defaultPreferences).map(([key, fallback]) => [key, typeof saved?.[key] === 'boolean' ? saved[key] : fallback]))
}

function SettingsGroup({ title, children }) {
	return jsxs('section', {
		'aria-label': title,
		className: 'mb-6',
		children: [
			jsx('h3', { className: 'mb-2.5 pt-2 text-[length:var(--conversation-text-font-size)] font-medium', children: title }),
			children
		]
	})
}

function SettingsPage({ getPreferences, updatePreference }) {
	const [preferences, setPreferences] = useState(getPreferences)
	const change = key => on => setPreferences(updatePreference(key, on))
	return jsxs('div', {
		children: [
			jsxs(SettingsGroup, {
				title: 'Tool calls',
				children: [
					jsx(ToggleRow, {
						label: 'Lists: expand by default',
						description: 'Show the list of calls without opening every call’s input/output details.',
						checked: preferences.expandToolCalls,
						onChange: change('expandToolCalls')
					}),
					jsx(ToggleRow, {
						label: 'File edits: fold diffs by default',
						description: 'Keep patches and file-edit diffs closed until you open them. Leave Hermes “Hide code diffs” off to keep them reopenable.',
						checked: preferences.foldFileEdits,
						onChange: change('foldFileEdits')
					}),
					jsx(ListRow, {
						title: 'Details: taller output',
						description: 'Opened calls and diffs show up to three times more lines before scrolling, within the window height. Short results keep their size.',
						action: jsx('span', { className: 'text-sm text-(--ui-text-secondary)', children: 'Always on' })
					})
				]
			}),
			jsxs(SettingsGroup, {
				title: 'Composer',
				children: [
					jsx(ToggleRow, {
						label: 'Status stack: fold by default',
						description: 'Start the branch and activity drawer folded when the queue is empty. Queue expansion is controlled separately below.',
						checked: preferences.foldStatusStack,
						onChange: change('foldStatusStack')
					}),
					jsx(ToggleRow, {
						label: 'Queued prompts: expand list by default',
						description: 'Open the queue list when prompts are added or updated, revealing its drawer if necessary. Works independently of status-stack folding.',
						checked: preferences.expandQueuedPrompts,
						onChange: change('expandQueuedPrompts')
					}),
					jsx(ToggleRow, {
						label: 'Queued prompts: expand long text by default',
						description: 'Use each queued prompt’s native expanded text view, without opening a closed queue list.',
						checked: preferences.expandQueuedPromptText,
						onChange: change('expandQueuedPromptText')
					})
				]
			}),
			jsxs(SettingsGroup, {
				title: 'Conversation',
				children: [
					jsx(ToggleRow, {
						label: 'Long messages: expand by default',
						description: 'Show sent user prompts without the text clamp/fade. Editing and restore actions stay unchanged.',
						checked: preferences.expandHistoryPrompts,
						onChange: change('expandHistoryPrompts')
					}),
					jsx(ToggleRow, {
						label: 'Duplicated messages: resync automatically',
						description: 'When a finished turn shows repeated blocks, rebuild the chat from the server. The broom next to the model picker does the same on demand and turns orange on duplicates.',
						checked: preferences.autoResync,
						onChange: change('autoResync')
					}),
					jsx(ListRow, {
						title: 'HTML previews: full width',
						description: 'Use the full available message width without changing preview content or state.',
						action: jsx('span', { className: 'text-sm text-(--ui-text-secondary)', children: 'Always on' })
					})
				]
			}),
			jsx('p', {
				className: 'mt-4 text-sm text-(--ui-text-secondary)',
				children: 'Changes apply without reloading. Turning a default off leaves the current layout unchanged. Manual choices are retained; queue updates can reopen the status drawer.'
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

const toolList = `${scope} [data-tool-group] > [data-tool-summary] ~ div:not([data-tool-ticker]):has(> [data-tool-row])`
const toolTicker = `${scope} [data-tool-group] > [data-tool-summary] ~ [data-tool-ticker]`

// Keep connectors inside each row's clipping boundary; a gapless list joins their vertical strokes.
// The last branch stops at its header, even when its result is open. Ticker stride stays native.
export const toolLayoutStyles = `
${scope} [data-tool-group] {
	--tool-row-gap: 0;
	row-gap: 0 !important;
}
${toolList} {
	row-gap: 0 !important;
}
${toolList} > [data-tool-row],
${toolTicker} {
	position: relative;
	padding-inline-start: 1rem;
	box-sizing: border-box;
	min-width: 0;
}
${toolList} > [data-tool-row]::before,
${toolList} > [data-tool-row]::after,
${toolTicker}::before {
	content: '';
	position: absolute;
	inset-inline-start: 0.375rem;
	pointer-events: none;
	border-color: var(--ui-text-quaternary, var(--ui-text-tertiary, currentColor));
	border-style: solid;
	border-width: 0;
}
${toolList} > [data-tool-row]::before {
	inset-block: 0;
	border-inline-start-width: 1px;
}
${toolList} > [data-tool-row]:last-child::before {
	block-size: calc(var(--conversation-line-height, 1.5em) / 2);
	inset-block-end: auto;
}
${toolList} > [data-tool-row]::after {
	inset-block-start: calc(var(--conversation-line-height, 1.5em) / 2);
	inline-size: 0.5rem;
	border-block-start-width: 1px;
}
${toolTicker}::before {
	inset-block-start: 0;
	block-size: calc(var(--conversation-line-height, 1.5em) / 2);
	inline-size: 0.5rem;
	border-inline-start-width: 1px;
	border-block-end-width: 1px;
}
${scope} > :is([data-tool-row], [data-tool-group]) + :is([data-tool-row], [data-tool-group]) {
	margin-block-start: 0.125rem !important;
}
${scope} > :is([data-tool-row], [data-tool-group]):has(+ :is([data-tool-row], [data-tool-group])) {
	margin-block-end: 0 !important;
}
`

// Native expanded calls cap output/payloads at 5rem (about four lines), error bodies at 14rem and diffs at 12rem, so reading a result means scrolling a tiny box. Triple each cap; max-height leaves short results at their natural height. The viewport bound keeps a long result one scroller that fits on screen. The review pane's diffs sit outside tool rows and keep their own sizing.
const toolDetail = `${scope} [data-tool-row]`
export const toolDetailStyles = `
${toolDetail} .max-h-20 {
	max-height: min(15rem, 70vh) !important;
}
${toolDetail} .max-h-56 {
	max-height: min(42rem, 70vh) !important;
}
${toolDetail} :is([data-slot="file-diff-panel"], [data-slot="diff-lines"]) {
	max-height: min(36rem, 70vh) !important;
}
`

export function installWidePreviews(doc = document) {
	const style = doc.createElement('style')
	style.dataset.hermesPlugin = ID
	style.textContent = previewStyles + toolLayoutStyles + toolDetailStyles + resyncStyles
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

const queueHeaderSelector = '[data-slot="status-section"] > .status-section-header > button[aria-expanded]:has(> .status-section-icon > :is(.codicon-layers, .codicon-debug-pause))'
const historyToggleSelector = '[data-slot="aui_user-message-root"] :is(button[data-slot="aui_user-touch-expand"], button.composer-human-message[aria-expanded])'

// Ordinary history bubbles edit on click, so lift their visual clamp without clicking them.
// Spectator/touch bubbles have real expansion controls; leave their state to the controller below.
export const historyPromptStyles = `
[data-slot="aui_user-message-root"]:not(:has(button[data-slot="aui_user-touch-expand"], button.composer-human-message[aria-expanded])) .sticky-human-clamp {
	max-height: none !important;
	overflow: visible !important;
	mask-image: none !important;
	-webkit-mask-image: none !important;
}
`

export function installPromptTextDefaults(doc = document, getPreferences = () => defaultPreferences) {
	const win = doc.defaultView
	const queueTextSelector = '[data-slot="status-row"] .status-row-actions button[aria-expanded]:has(.codicon-chevron-down)'
	const selector = `${queueTextSelector}, ${historyToggleSelector}`
	const initialized = new WeakSet()
	const candidates = new Set()
	const style = doc.createElement('style')
	style.dataset.hermesPromptDefaults = ID
	doc.head.append(style)
	let applying = false
	let disposed = false

	function enabled(button) {
		if (button.matches(historyToggleSelector)) return getPreferences().expandHistoryPrompts
		const section = button.closest('[data-slot="status-section"]')
		return Boolean(section?.querySelector(queueHeaderSelector)) && getPreferences().expandQueuedPromptText
	}

	function queueTree(node) {
		if (node.nodeType !== 1 && node.nodeType !== 9) return
		if (node.matches?.(selector)) candidates.add(node)
		for (const button of node.querySelectorAll(selector)) candidates.add(button)
	}

	function flush() {
		if (disposed) return
		for (const button of candidates) {
			if (initialized.has(button) || !button.isConnected || button.disabled || button.closest('[inert], [aria-hidden="true"]') || !enabled(button)) continue
			initialized.add(button)
			if (button.getAttribute('aria-expanded') !== 'false') continue
			applying = true
			try { button.click() } finally { applying = false }
		}
		candidates.clear()
	}

	function onClick(event) {
		if (applying) return
		const button = event.target?.closest?.(selector)
		if (button) initialized.add(button)
	}

	const observer = new win.MutationObserver(records => {
		for (const record of records) {
			if (record.target.matches?.(selector)) candidates.add(record.target)
			if (record.attributeName === 'inert' || record.attributeName === 'aria-hidden') queueTree(record.target)
			for (const node of record.addedNodes) queueTree(node)
		}
		flush()
	})
	doc.addEventListener('click', onClick, true)
	observer.observe(doc, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-expanded', 'inert', 'aria-hidden'] })
	function refresh() {
		style.textContent = getPreferences().expandHistoryPrompts ? historyPromptStyles : ''
		queueTree(doc)
		flush()
	}
	refresh()
	return {
		refresh,
		dispose() { disposed = true; observer.disconnect(); doc.removeEventListener('click', onClick, true); style.remove(); candidates.clear() }
	}
}

// Core remembers only closed drawers. Remember explicit opens separately, using
// the exact scoped key revealed by its own toggle, not a guessed session/profile.
export function installStatusDefaults(doc = document, getPreferences = () => defaultPreferences, storage) {
	const win = doc.defaultView
	const selector = 'button[data-slot="status-drawer-toggle"][aria-expanded]'
	const nativeKey = 'hermes.desktop.collapsedStatusDrawers.v1'
	const queueSelector = `[data-slot="composer-status-stack"] ${queueHeaderSelector}`
	const saved = storage?.get('openStatusDrawers', [])
	const openDrawers = new Set(Array.isArray(saved) ? saved.filter(key => typeof key === 'string').slice(-512) : [])
	let initialized = new WeakSet()
	let queues = new WeakMap()
	let queueOpened = new WeakSet()
	const candidates = new Set()
	const restores = new Set()
	const clicks = new WeakMap()
	let applying = false
	let disposed = false
	let frameId = null
	let navigationFrame = null

	function nativeDrawers() {
		try {
			const keys = JSON.parse(win.localStorage.getItem(nativeKey) || '[]')
			return Array.isArray(keys) ? keys.filter(key => typeof key === 'string') : []
		} catch { return [] }
	}

	function changedKey(before, after, opening) {
		const keys = opening ? before.filter(key => !after.includes(key)) : after.filter(key => !before.includes(key))
		return keys.length === 1 ? keys[0] : null
	}

	function click(button) {
		applying = true
		try { button.click() } finally { applying = false }
	}

	function restoreChoices() {
		for (const button of restores) {
			if (!button.isConnected) restores.delete(button)
			else if (button.getAttribute('aria-expanded') === 'false') {
				restores.delete(button)
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

	function queueOwner(node) {
		const element = node.nodeType === 1 ? node : node.parentElement
		const dock = element?.closest?.('[data-slot="composer-dock"]')
		if (dock) for (const button of dock.querySelectorAll(selector)) candidates.add(button)
	}

	function queueTree(node) {
		if (node.nodeType !== 1 && node.nodeType !== 9) return
		queueOwner(node)
		if (node.matches?.(selector)) candidates.add(node)
		for (const button of node.querySelectorAll(selector)) candidates.add(button)
	}

	function queuedSection(button) {
		// The shared grip controls two drawers; inspect only its own activity area, even while inert.
		for (const id of (button.getAttribute('aria-controls') || '').split(/\s+/)) {
			const queue = doc.getElementById(id)?.querySelector(queueSelector)
			if (queue) return queue
		}
		return null
	}

	function flush() {
		if (disposed) return
		restoreChoices()
		for (const button of candidates) {
			if (!button.isConnected || button.disabled || button.closest('[inert], [aria-hidden="true"]')) continue
			const preferences = getPreferences()
			const queue = queuedSection(button)
			const previous = queues.get(button)
			if (queue) {
				const text = queue.textContent
				queues.set(button, { queue, text, expand: preferences.expandQueuedPrompts })
				// Header text changes with the queue count/status, without parsing a translated label.
				if (preferences.expandQueuedPrompts && (previous?.queue !== queue || previous.text !== text || !previous.expand)) {
					if (button.getAttribute('aria-expanded') === 'false') { queueOpened.add(button); click(button) }
					if (queue.getAttribute('aria-expanded') === 'false') click(queue)
				}
				continue
			}
			queues.delete(button)
			if (queueOpened.has(button)) { queueOpened.delete(button); initialized.delete(button) }
			if (!preferences.foldStatusStack || initialized.has(button)) continue
			initialized.add(button)
			if (button.getAttribute('aria-expanded') !== 'true') continue
			const before = nativeDrawers()
			click(button)
			const key = changedKey(before, nativeDrawers(), false)
			if (key && openDrawers.has(key)) { restores.add(button); scheduleRestore() }
		}
		candidates.clear()
	}

	function onClick(event) {
		if (applying) return
		const button = event.target?.closest?.(selector)
		if (!button) return
		initialized.add(button)
		queueOpened.delete(button)
		restores.delete(button)
		clicks.set(event, { opening: button.getAttribute('aria-expanded') === 'false', before: nativeDrawers() })
	}

	function onClicked(event) {
		const choice = clicks.get(event)
		if (!choice) return
		// Bubble runs after the native/React handler. A capture microtask can run before it.
		const key = changedKey(choice.before, nativeDrawers(), choice.opening)
		if (!key) return
		openDrawers.delete(key)
		if (choice.opening) openDrawers.add(key)
		if (openDrawers.size > 512) openDrawers.delete(openDrawers.values().next().value)
		storage?.set('openStatusDrawers', [...openDrawers])
	}

	function refresh() { queueTree(doc); flush() }
	function navigate() {
		if (navigationFrame !== null) return
		navigationFrame = win.requestAnimationFrame(() => {
			navigationFrame = null
			initialized = new WeakSet()
			queues = new WeakMap()
			queueOpened = new WeakSet()
			refresh()
		})
	}

	const observer = new win.MutationObserver(records => {
		for (const record of records) {
			queueOwner(record.target)
			if (record.target.matches?.(selector)) candidates.add(record.target)
			if (record.attributeName === 'inert' || record.attributeName === 'aria-hidden') queueTree(record.target)
			for (const node of record.addedNodes) queueTree(node)
		}
		flush()
	})
	doc.addEventListener('click', onClick, true)
	doc.addEventListener('click', onClicked)
	win.addEventListener('hashchange', navigate)
	observer.observe(doc, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['aria-expanded', 'inert', 'aria-hidden'] })
	refresh()

	return {
		refresh,
		navigate,
		dispose() {
			disposed = true
			observer.disconnect()
			doc.removeEventListener('click', onClick, true)
			doc.removeEventListener('click', onClicked)
			win.removeEventListener('hashchange', navigate)
			if (navigationFrame !== null) win.cancelAnimationFrame(navigationFrame)
			restoreChoices()
			if (restores.size) scheduleRestore()
			else if (frameId !== null) win.cancelAnimationFrame(frameId)
			candidates.clear()
		}
	}
}

export default {
	id: ID,
	name: NAME,
	description: 'Full-width previews, tool/edit defaults, independent queue, prompt-text, and status-stack preferences, and resync of duplicated chat messages.',
	version: '0.7.0',
	register(ctx) {
		let preferences = readPreferences(ctx.storage)
		const getPreferences = () => preferences
		ctx.onDispose(installWidePreviews())
		const tools = installToolDefaults(document, getPreferences)
		ctx.onDispose(tools.dispose)
		const status = installStatusDefaults(document, getPreferences, ctx.storage)
		ctx.onDispose(status.dispose)
		const prompts = installPromptTextDefaults(document, getPreferences)
		ctx.onDispose(prompts.dispose)
		for (const store of [host.state.focusedStoredSessionId || host.state.activeSessionId, host.state.profile, host.state.connectionId]) {
			if (store?.listen) ctx.onDispose(store.listen(status.navigate))
		}
		// Older hosts without the state atoms keep every other tweak.
		let duplicates = null
		if (host.state?.busyBySession && host.state.activeSessionId) {
			duplicates = installDuplicateResync({ host, getPreferences, notify: input => host.notify?.(input) })
			ctx.onDispose(duplicates.dispose)
			registerResyncButton(ctx, duplicates)
		}
		const updatePreference = (key, on) => {
			preferences = { ...preferences, [key]: on }
			ctx.storage.set('preferences', preferences)
			tools.refresh()
			duplicates?.refresh()
			status.refresh()
			prompts.refresh()
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
