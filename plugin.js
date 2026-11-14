import { host, ToggleRow } from '@hermes/plugin-sdk'
import { useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

/** Customize chat presentation without changing preview documents or stored messages. */
const ID = 'hermes-wide-previews'
const NAME = 'Hermes UI Tweaks'
const defaultPreferences = { expandToolCalls: true, foldFileEdits: true, foldStatusStack: true, expandQueuedPrompts: true, expandQueuedPromptText: true, expandHistoryPrompts: true }

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
				label: 'Fold status stack by default',
				description: 'Start the branch and activity drawer folded when the queue is empty. Queue expansion is controlled separately below.',
				checked: preferences.foldStatusStack,
				onChange: change('foldStatusStack')
			}),
			jsx(ToggleRow, {
				label: 'Expand queued-prompts section by default',
				description: 'Open the queue list when prompts are added or updated, revealing its drawer if necessary. Works independently of status-stack folding.',
				checked: preferences.expandQueuedPrompts,
				onChange: change('expandQueuedPrompts')
			}),
			jsx(ToggleRow, {
				label: 'Expand long queued-prompt text by default',
				description: 'Use each queued prompt’s native expanded text view, without opening a closed queue list.',
				checked: preferences.expandQueuedPromptText,
				onChange: change('expandQueuedPromptText')
			}),
			jsx(ToggleRow, {
				label: 'Expand long messages in history by default',
				description: 'Show sent user prompts without the text clamp/fade. Editing and restore actions stay unchanged.',
				checked: preferences.expandHistoryPrompts,
				onChange: change('expandHistoryPrompts')
			}),
			jsx('p', {
				className: 'mt-4 text-sm text-(--ui-text-secondary)',
				children: 'Changes apply without reloading. Turning a default off leaves the current layout unchanged. Manual choices are retained; queue updates can reopen the status drawer. HTML previews stay full width.'
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

export function installWidePreviews(doc = document) {
	const style = doc.createElement('style')
	style.dataset.hermesPlugin = ID
	style.textContent = previewStyles + toolLayoutStyles
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
	description: 'Full-width previews, tool/edit defaults, and independent queue, prompt-text, and status-stack preferences.',
	version: '0.5.0',
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
		const updatePreference = (key, on) => {
			preferences = { ...preferences, [key]: on }
			ctx.storage.set('preferences', preferences)
			tools.refresh()
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
