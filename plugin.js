import { ToggleRow } from '@hermes/plugin-sdk'
import { useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

/** Customize chat presentation without touching preview documents or message history. */
const ID = 'hermes-wide-previews'
const defaultPreferences = { expandToolCalls: true, foldFileEdits: true }

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

export default {
	id: ID,
	name: 'Wide HTML Previews',
	description: 'Full-width HTML previews, expanded tool lists, and folded file edits.',
	version: '0.4.0',
	register(ctx) {
		let preferences = readPreferences(ctx.storage)
		const getPreferences = () => preferences
		ctx.onDispose(installWidePreviews())
		const tools = installToolDefaults(document, getPreferences)
		ctx.onDispose(tools.dispose)
		const updatePreference = (key, on) => {
			preferences = { ...preferences, [key]: on }
			ctx.storage.set('preferences', preferences)
			tools.refresh()
			return preferences
		}
		const page = {
			id: 'settings',
			title: 'Wide HTML Previews',
			icon: 'settings-gear',
			render: () => jsx(SettingsPage, { getPreferences, updatePreference })
		}
		if (ctx.registerSettingsPage) ctx.registerSettingsPage(page)
		else ctx.register({ id: page.id, area: 'settings.plugins', title: page.title, render: page.render, data: { icon: page.icon } })
	}
}
