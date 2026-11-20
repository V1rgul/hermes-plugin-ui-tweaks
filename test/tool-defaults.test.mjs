import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { before, after, test } from 'node:test'
import { activatePlugin, countSearches } from './plugin-host.mjs'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const source = await readFile(process.env.PLUGIN_SOURCE || new URL('../plugin.js', import.meta.url), 'utf8')
let browser
before(async () => { browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) }) })
after(async () => { await browser?.close() })

// Stateful DOM fixture of ToolRun/ToolEntry, not a full Electron build. Like core:
// disclosures persist synchronously, rendering commits later, groups unmount hidden rows,
// and data-file-edit only exists on open edits (including errors).
function nativeFixture({ groups, stored = {} }) {
	const storageKey = 'hermes.desktop.toolDisclosure.v1'
	localStorage.setItem(storageKey, JSON.stringify(stored))
	let disclosure = { ...stored }
	window.groups = groups
	window.clicks = []
	window.actions = 0
	let queued = false
	const states = () => disclosure
	const rowOpen = row => states()[row.id] ?? Boolean(row.diff)
	const groupOpen = group => group.rows.length < 2 || (states()[group.id] ?? group.rows.some(row => Boolean(states()[row.id])))
	function save(id, open) {
		window.clicks.push({ id, open })
		disclosure = { ...states(), [id]: open }
		try { localStorage.setItem(storageKey, JSON.stringify(disclosure)) } catch {}
		if (!queued) {
			queued = true
			queueMicrotask(() => { queued = false; window.render() })
		}
	}
	function rowElement(row, group) {
		const root = document.createElement('div')
		root.dataset.toolRow = ''
		root.dataset.testRow = row.id
		root.dataset.slot = 'tool-block'
		root.innerHTML = '<div><div><button type="button"><span></span></button><button type="button" data-action>Copy</button></div></div>'
		root.querySelector('[data-action]').onclick = () => window.actions++
		root.update = () => {
			const open = rowOpen(row)
			root.toggleAttribute('data-tool-open', open)
			root.toggleAttribute('data-file-edit', Boolean(row.edit && open))
			const button = root.querySelector('button')
			button.setAttribute('aria-expanded', String(open))
			button.firstElementChild.textContent = row.id
			button.onclick = () => {
				if (!open && group) save(group.id, true)
				save(row.id, !open)
			}
			root.querySelector('[data-body]')?.remove()
			if (open) {
				const body = document.createElement('div')
				body.dataset.body = ''
				if (row.diff) {
					const diff = document.createElement('div')
					diff.dataset.slot = 'file-diff-panel'
					diff.textContent = '+changed code'
					body.append(diff)
				} else body.textContent = row.error ? 'File is read-only' : 'Tool output'
				root.append(body)
			}
		}
		root.update()
		return root
	}
	window.render = () => {
		const container = document.querySelector('article')
		for (const group of groups) {
			let root = container.querySelector(`[data-test-group="${group.id}"]`)
			if (!root) {
				root = document.createElement('div')
				root.dataset.toolGroup = ''
				root.dataset.testGroup = group.id
				container.append(root)
			}
			root.inert = Boolean(group.inert)
			const open = groupOpen(group)
			let header = root.querySelector('[data-tool-summary]')
			if (group.rows.length > 1) {
				if (!header) {
					header = document.createElement('div')
					header.dataset.toolSummary = ''
					header.innerHTML = '<div><button type="button">Tool calls</button></div>'
					root.prepend(header)
				}
				const button = header.querySelector('button')
				button.setAttribute('aria-expanded', String(open))
				button.onclick = () => save(group.id, !open)
			}
			let body = root.querySelector('[data-rows]')
			if (!open && !group.live) { body?.remove(); continue }
			if (!body) {
				body = document.createElement('div')
				body.dataset.rows = ''
				root.append(body)
			}
			body.toggleAttribute('data-tool-ticker', !open && Boolean(group.live))
			for (const row of group.rows) {
				let element = body.querySelector(`[data-test-row="${row.id}"]`)
				if (!element) { element = rowElement(row, group); body.append(element) }
				else element.update()
			}
		}
	}
	window.remount = () => { document.querySelector('article').replaceChildren(); window.render() }
	window.makeOutsideRow = row => { document.querySelector('aside').append(rowElement(row)) }
	window.render()
}

async function fixture(groups, stored = {}) {
	const page = await browser.newPage()
	page.setDefaultTimeout(3000)
	await page.route('https://fixture.invalid/**', route => route.fulfill({ contentType: 'text/html', body: '<article data-slot="aui_assistant-message-content"></article><aside></aside>' }))
	await page.goto('https://fixture.invalid/')
	await page.evaluate(nativeFixture, { groups, stored })
	return page
}
async function activate(page, disposeImmediately = false) {
	await activatePlugin(page, source, { disposeImmediately })
}
const groupToggle = (page, id = 'run') => page.locator(`[data-test-group="${id}"] > [data-tool-summary] button`)
const rowToggle = (page, id) => page.locator(`[data-test-row="${id}"] > div:first-child button[aria-expanded]`)
async function expectExpanded(locator, expected) {
	await locator.waitFor()
	await locator.page().waitForFunction(({ selector, expected }) => document.querySelector(selector)?.getAttribute('aria-expanded') === String(expected), { selector: await locator.evaluate(el => el.closest('[data-test-row]') ? `[data-test-row="${el.closest('[data-test-row]').dataset.testRow}"] > div:first-child button[aria-expanded]` : `[data-test-group="${el.closest('[data-test-group]').dataset.testGroup}"] > [data-tool-summary] button`), expected }, { timeout: 3000 })
}
async function settle(page) { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))) }
const ordinary = { id: 'read-file' }
const edit = { id: 'patch', edit: true, diff: true }

test('expands the list but folds patch/edit/write diffs without opening ordinary payloads', async () => {
	const page = await fixture([{ id: 'run', rows: [ordinary, edit, { id: 'edit-file', edit: true, diff: true }, { id: 'write-file', edit: true, diff: true }] }])
	try {
		await activate(page)
		await expectExpanded(groupToggle(page), true)
		for (const id of ['read-file', 'patch', 'edit-file', 'write-file']) await expectExpanded(rowToggle(page, id), false)
		assert.equal(await page.locator('[data-slot="file-diff-panel"]').count(), 0)
		await rowToggle(page, 'patch').click()
		await expectExpanded(rowToggle(page, 'patch'), true)
		assert.equal(await page.locator('[data-slot="file-diff-panel"]').textContent(), '+changed code')
	} finally { await page.close() }
})

test('manual choices survive mutations, row unmounts and complete session remounts', async () => {
	const page = await fixture([{ id: 'run', rows: [ordinary, edit] }])
	try {
		await activate(page)
		await expectExpanded(rowToggle(page, 'patch'), false)
		await rowToggle(page, 'patch').click()
		await expectExpanded(rowToggle(page, 'patch'), true)
		await page.evaluate(() => window.render())
		await settle(page)
		await expectExpanded(rowToggle(page, 'patch'), true)
		await groupToggle(page).click()
		await expectExpanded(groupToggle(page), false)
		await page.evaluate(() => window.render())
		await settle(page)
		await expectExpanded(groupToggle(page), false)
		await groupToggle(page).click()
		await expectExpanded(rowToggle(page, 'patch'), true)
		await page.evaluate(() => window.remount())
		await settle(page)
		await expectExpanded(groupToggle(page), true)
		await expectExpanded(rowToggle(page, 'patch'), true)
	} finally { await page.close() }
})

test('honors native choices made before plugin activation, including collapsed groups', async () => {
	const page = await fixture([{ id: 'run', rows: [ordinary, edit] }, { id: 'closed', rows: [{ id: 'other-read' }, { id: 'other-patch', edit: true, diff: true }] }], { run: true, patch: true, closed: false })
	try {
		await activate(page)
		await settle(page)
		await expectExpanded(rowToggle(page, 'patch'), true)
		await expectExpanded(groupToggle(page, 'closed'), false)
		assert.equal(await page.locator('[data-test-row="other-patch"]').count(), 0)
	} finally { await page.close() }
})

test('disabling during a deferred native render does not overwrite saved manual choices', async () => {
	const page = await fixture([{ id: 'run', rows: [ordinary, edit] }, { id: 'closed', rows: [{ id: 'other-read' }, { id: 'other-patch', edit: true, diff: true }] }], { run: true, patch: true, closed: false })
	try {
		await activate(page, true)
		await settle(page)
		await expectExpanded(rowToggle(page, 'patch'), true)
		await expectExpanded(groupToggle(page, 'closed'), false)
		assert.equal(await page.locator('style[data-hermes-plugin]').count(), 0)
	} finally { await page.close() }
})

test('handles streaming singleton-to-group transitions, late diffs and newly inserted runs', async () => {
	const page = await fixture([{ id: 'run', live: true, rows: [ordinary] }])
	try {
		await activate(page)
		await page.evaluate(() => { window.groups[0].rows.push({ id: 'pending', edit: true }); window.render() })
		await expectExpanded(groupToggle(page), true)
		await expectExpanded(rowToggle(page, 'pending'), false)
		await page.evaluate(() => { window.groups[0].rows[1].diff = true; window.groups[0].live = false; window.render() })
		await settle(page)
		await expectExpanded(rowToggle(page, 'pending'), false)
		await page.evaluate(() => { window.groups.push({ id: 'late-run', rows: [{ id: 'late-read' }, { id: 'late-write', edit: true, diff: true }] }); window.render() })
		await expectExpanded(groupToggle(page, 'late-run'), true)
		await expectExpanded(rowToggle(page, 'late-write'), false)
	} finally { await page.close() }
})

test('a user opening a pending edit keeps it open when the diff arrives', async () => {
	const page = await fixture([{ id: 'run', rows: [ordinary, { id: 'pending', edit: true }] }])
	try {
		await activate(page)
		await rowToggle(page, 'pending').click()
		await expectExpanded(rowToggle(page, 'pending'), true)
		await page.evaluate(() => { window.groups[0].rows[1].diff = true; window.render() })
		await settle(page)
		await expectExpanded(rowToggle(page, 'pending'), true)
	} finally { await page.close() }
})

test('preserves failed-edit errors, inert approval activity, unrelated controls and outside content', async () => {
	const page = await fixture([{ id: 'run', rows: [ordinary, { id: 'failure', edit: true, error: true }] }, { id: 'approval', inert: true, rows: [{ id: 'approval-one' }, { id: 'approval-two' }] }], { run: true, failure: true })
	try {
		await page.evaluate(() => window.makeOutsideRow({ id: 'outside', edit: true, diff: true }))
		await activate(page)
		await settle(page)
		await expectExpanded(rowToggle(page, 'failure'), true)
		assert.match(await page.locator('[data-test-row="failure"]').textContent(), /File is read-only/)
		await expectExpanded(rowToggle(page, 'outside'), true)
		await expectExpanded(groupToggle(page, 'approval'), false)
		assert.equal(await page.evaluate(() => window.actions), 0)
		await page.locator('[data-test-row="failure"] [data-action]').click()
		assert.equal(await page.evaluate(() => window.actions), 1)
		await expectExpanded(rowToggle(page, 'failure'), true)
	} finally { await page.close() }
})

test('keyboard toggles are respected and disabling stops all automatic disclosure changes', async () => {
	const page = await fixture([{ id: 'run', rows: [ordinary, edit] }])
	try {
		await activate(page)
		await expectExpanded(rowToggle(page, 'patch'), false)
		await rowToggle(page, 'patch').focus()
		await page.keyboard.press('Enter')
		await expectExpanded(rowToggle(page, 'patch'), true)
		await page.evaluate(() => window.render())
		await settle(page)
		await expectExpanded(rowToggle(page, 'patch'), true)
		await page.evaluate(() => window.disposePlugin())
		assert.equal(await page.locator('style[data-hermes-plugin]').count(), 0)
		await page.evaluate(() => { window.groups.push({ id: 'disabled', rows: [{ id: 'disabled-read' }, { id: 'disabled-patch', edit: true, diff: true }] }); window.render() })
		await settle(page)
		await expectExpanded(groupToggle(page, 'disabled'), false)
		await groupToggle(page, 'disabled').click()
		await expectExpanded(rowToggle(page, 'disabled-patch'), true)
	} finally { await page.close() }
})

test('manual pending-edit choices still work when local storage is unavailable', async () => {
	const page = await fixture([{ id: 'run', rows: [ordinary, { id: 'pending', edit: true }] }])
	try {
		await page.evaluate(() => {
			Storage.prototype.getItem = () => { throw new DOMException('Storage denied', 'SecurityError') }
			Storage.prototype.setItem = () => { throw new DOMException('Storage denied', 'SecurityError') }
		})
		await activate(page)
		await expectExpanded(groupToggle(page), true)
		await rowToggle(page, 'pending').click()
		await expectExpanded(rowToggle(page, 'pending'), true)
		await page.evaluate(() => { window.groups[0].rows[1].diff = true; window.render() })
		await settle(page)
		await expectExpanded(rowToggle(page, 'pending'), true)
	} finally { await page.close() }
})

test('applies defaults when previously inert activity becomes interactive', async () => {
	const page = await fixture([{ id: 'run', inert: true, rows: [ordinary, edit] }], { run: true })
	try {
		await activate(page)
		await settle(page)
		await expectExpanded(rowToggle(page, 'patch'), true)
		await page.evaluate(() => { window.groups[0].inert = false; window.render() })
		await settle(page)
		await expectExpanded(rowToggle(page, 'patch'), false)
	} finally { await page.close() }
})

const expandLabel = 'Lists: expand by default'
const foldLabel = 'File edits: fold diffs by default'
const preferenceStorageKey = 'hermes.plugin.hermes-wide-previews.preferences'
async function showSettings(page) {
	await page.evaluate(() => window.mountPluginSettings())
	await page.getByRole('switch', { name: expandLabel }).waitFor()
}
async function expectChecked(page, label, checked) {
	await page.waitForFunction(({ label, checked }) => Array.from(document.querySelectorAll('[role="switch"]')).find(el => el.getAttribute('aria-label') === label)?.getAttribute('aria-checked') === String(checked), { label, checked }, { timeout: 3000 })
}

test('settings group controls and show always-on features without a switch', async () => {
	const page = await fixture([{ id: 'run', rows: [ordinary, edit] }])
	try {
		await activate(page)
		await showSettings(page)
		const settings = page.locator('#plugin-settings')
		assert.equal(await settings.getByRole('region', { name: 'Tool calls', exact: true }).getByRole('switch', { name: expandLabel, exact: true }).count(), 1)
		assert.equal(await settings.getByRole('region', { name: 'Composer', exact: true }).getByRole('switch', { name: 'Status stack: fold by default', exact: true }).count(), 1)
		const conversation = settings.getByRole('region', { name: 'Conversation', exact: true })
		const timestampRow = conversation.getByText('Timestamps: share existing lines', { exact: true }).locator('..')
		assert.equal(await timestampRow.getByText('Always on', { exact: true }).count(), 1)
		assert.equal(await timestampRow.locator('button, input, [role="switch"]').count(), 0)
		assert.equal(await conversation.getByRole('switch', { name: 'Previews and cards: full width', exact: true }).count(), 1)
		assert.equal(await conversation.getByRole('switch', { name: 'Duplicated messages: resync automatically', exact: true }).count(), 1)
		assert.equal(await settings.getByRole('switch').count(), 10)
	} finally { await page.close() }
})

test('settings switches independently control live defaults without reloading', async () => {
	const page = await fixture([{ id: 'run', rows: [ordinary, edit] }])
	try {
		await activate(page)
		await showSettings(page)
		await expectChecked(page, expandLabel, true)
		await expectChecked(page, foldLabel, true)
		await page.getByRole('switch', { name: expandLabel }).click()
		await expectChecked(page, expandLabel, false)
		await expectChecked(page, foldLabel, true)
		await page.evaluate(() => {
			window.groups.push({ id: 'not-expanded', rows: [{ id: 'new-read' }, { id: 'new-search' }] }, { id: 'still-folded', rows: [{ id: 'new-patch', edit: true, diff: true }] })
			window.render()
		})
		await settle(page)
		await expectExpanded(groupToggle(page, 'not-expanded'), false)
		await expectExpanded(rowToggle(page, 'new-patch'), false)
		await page.getByRole('switch', { name: expandLabel }).click()
		await expectExpanded(groupToggle(page, 'not-expanded'), true)
		await page.getByRole('switch', { name: foldLabel }).focus()
		await page.keyboard.press('Space')
		await expectChecked(page, foldLabel, false)
		await expectChecked(page, expandLabel, true)
		await page.evaluate(() => { window.groups.push({ id: 'not-folded', rows: [{ id: 'open-patch', edit: true, diff: true }] }); window.render() })
		await settle(page)
		await expectExpanded(rowToggle(page, 'open-patch'), true)
		await page.getByRole('switch', { name: foldLabel }).click()
		await expectExpanded(rowToggle(page, 'open-patch'), false)
		assert.equal(await page.locator('style[data-hermes-plugin]').count(), 1, 'tool settings must not disable preview sizing')
	} finally { await page.close() }
})

test('settings persist through plugin and browser reloads with both defaults disabled', async () => {
	const page = await fixture([{ id: 'run', rows: [ordinary, edit] }])
	try {
		await activate(page)
		await showSettings(page)
		await page.getByRole('switch', { name: expandLabel }).click()
		await page.getByRole('switch', { name: foldLabel }).click()
		assert.deepEqual(await page.evaluate(key => {
			const { expandToolCalls, foldFileEdits } = JSON.parse(localStorage.getItem(key))
			return { expandToolCalls, foldFileEdits }
		}, preferenceStorageKey), { expandToolCalls: false, foldFileEdits: false })
		await page.evaluate(() => window.disposePlugin())
		assert.equal(await page.evaluate(() => window.pluginPages.length), 0)
		await activate(page)
		await showSettings(page)
		await expectChecked(page, expandLabel, false)
		await expectChecked(page, foldLabel, false)
		await page.reload()
		await page.evaluate(nativeFixture, { groups: [{ id: 'reloaded', rows: [{ id: 'reloaded-read' }, { id: 'reloaded-patch', edit: true, diff: true }] }] })
		await activate(page)
		await showSettings(page)
		await expectChecked(page, expandLabel, false)
		await expectChecked(page, foldLabel, false)
		await settle(page)
		await expectExpanded(groupToggle(page, 'reloaded'), false)
		await groupToggle(page, 'reloaded').click()
		await expectExpanded(rowToggle(page, 'reloaded-patch'), true)
	} finally { await page.close() }
})

test('changing defaults does not reset manual group or file-edit choices', async () => {
	const page = await fixture([{ id: 'run', rows: [ordinary, edit] }])
	try {
		await activate(page)
		await expectExpanded(rowToggle(page, 'patch'), false)
		await rowToggle(page, 'patch').click()
		await expectExpanded(rowToggle(page, 'patch'), true)
		await groupToggle(page).click()
		await expectExpanded(groupToggle(page), false)
		await showSettings(page)
		for (const label of [expandLabel, foldLabel, expandLabel, foldLabel]) await page.getByRole('switch', { name: label }).click()
		await settle(page)
		await expectExpanded(groupToggle(page), false)
		await groupToggle(page).click()
		await expectExpanded(rowToggle(page, 'patch'), true)
	} finally { await page.close() }
})

test('settings normalize invalid saved values without losing a valid false value', async () => {
	const page = await fixture([{ id: 'run', rows: [ordinary, edit] }])
	try {
		await page.evaluate(key => localStorage.setItem(key, JSON.stringify({ expandToolCalls: false, foldFileEdits: 'false' })), preferenceStorageKey)
		await activate(page)
		await showSettings(page)
		await expectChecked(page, expandLabel, false)
		await expectChecked(page, foldLabel, true)
		await expectExpanded(groupToggle(page), false)
		await groupToggle(page).click()
		await expectExpanded(rowToggle(page, 'patch'), false)
	} finally { await page.close() }
})

test('settings use the supported registry fallback on hosts without registerSettingsPage', async () => {
	const page = await fixture([{ id: 'run', rows: [ordinary, edit] }])
	try {
		await activatePlugin(page, source, { legacySettingsApi: true })
		await showSettings(page)
		await page.getByRole('switch', { name: expandLabel }).click()
		await expectChecked(page, expandLabel, false)
		await page.evaluate(() => window.disposePlugin())
		assert.equal(await page.evaluate(() => window.pluginPages.length), 0)
		assert.equal(await page.getByRole('switch').count(), 0)
	} finally { await page.close() }
})

test('settings remain usable in memory when persistence is unavailable', async () => {
	const page = await fixture([{ id: 'run', rows: [ordinary, edit] }])
	try {
		await page.evaluate(() => {
			Storage.prototype.getItem = () => { throw new DOMException('Storage denied', 'SecurityError') }
			Storage.prototype.setItem = () => { throw new DOMException('Storage denied', 'SecurityError') }
		})
		await activate(page)
		await showSettings(page)
		await page.getByRole('switch', { name: expandLabel }).click()
		await page.getByRole('switch', { name: foldLabel }).click()
		await expectChecked(page, expandLabel, false)
		await expectChecked(page, foldLabel, false)
		await page.evaluate(() => {
			window.groups.push({ id: 'memory-only', rows: [{ id: 'memory-read' }, { id: 'memory-search' }] }, { id: 'memory-edit', rows: [{ id: 'memory-patch', edit: true, diff: true }] })
			window.render()
		})
		await settle(page)
		await expectExpanded(groupToggle(page, 'memory-only'), false)
		await expectExpanded(rowToggle(page, 'memory-patch'), true)
	} finally { await page.close() }
})

test('repeated plugin reloads leave one controller and do not fight manual choices', async () => {
	const page = await fixture([{ id: 'run', rows: [ordinary, edit] }])
	try {
		for (let i = 0; i < 3; i++) {
			await activate(page)
			await settle(page)
			assert.equal(await page.locator('style[data-hermes-plugin]').count(), 1)
			await page.evaluate(() => window.disposePlugin())
		}
		await page.evaluate(() => { window.groups.push({ id: 'after-reloads', rows: [{ id: 'after-read' }, { id: 'after-patch', edit: true, diff: true }] }); window.render() })
		await settle(page)
		assert.equal(await page.evaluate(() => window.clicks.filter(click => click.id === 'after-reloads').length), 0)
	} finally { await page.close() }
})

test('a mutation delivery searches a newly mounted run once, and its defaults still apply', async () => {
	const page = await fixture([{ id: 'run', rows: [ordinary, edit] }])
	try {
		await page.evaluate(countSearches)
		await activate(page)
		await settle(page)
		await page.evaluate(() => {
			window.searches.reset()
			// An independent observer sees the same deliveries as the plugin's; count those adding elements.
			window.additions = 0
			new MutationObserver(records => { if (records.some(record => [...record.addedNodes].some(node => node.nodeType === 1))) window.additions++ }).observe(document, { childList: true, subtree: true, attributes: true })
			// React commits a run as a root with its summary, list and rows inside.
			window.groups.push({ id: 'late', rows: [{ id: 'late-read' }, { id: 'late-search' }, { id: 'late-patch', edit: true, diff: true }, { id: 'late-write', edit: true, diff: true }] })
			window.render()
		})
		await expectExpanded(groupToggle(page, 'late'), true)
		for (const id of ['late-read', 'late-patch', 'late-write']) await expectExpanded(rowToggle(page, id), false)
		await settle(page)
		const counts = await page.evaluate(() => ({ searches: window.searches('data-tool-'), deliveries: window.additions }))
		console.log(`tool discovery searches for ${counts.deliveries} deliveries adding nested elements: ${counts.searches}`)
		assert.equal(counts.searches, counts.deliveries, 'one search per delivery that added nested elements')
	} finally { await page.close() }
})

test('with both tool defaults off, nothing is searched, and re-enabling applies them without overriding manual choices', async () => {
	const page = await fixture([{ id: 'run', rows: [{ id: 'run-read' }, { id: 'run-search' }] }, { id: 'edits', rows: [{ id: 'edits-read' }, edit] }])
	try {
		await page.evaluate(key => localStorage.setItem(key, JSON.stringify({ expandToolCalls: false, foldFileEdits: false })), preferenceStorageKey)
		await page.evaluate(countSearches)
		await activate(page)
		// While off: a list opened then closed again, and an edit's diff closed then reopened.
		for (const expected of [true, false]) {
			await groupToggle(page, 'run').click()
			await expectExpanded(groupToggle(page, 'run'), expected)
		}
		await groupToggle(page, 'edits').click()
		await expectExpanded(rowToggle(page, 'patch'), true)
		for (const expected of [false, true]) {
			await rowToggle(page, 'patch').click()
			await expectExpanded(rowToggle(page, 'patch'), expected)
		}
		await page.evaluate(() => { window.groups.push({ id: 'late', rows: [{ id: 'late-read' }, { id: 'late-patch', edit: true, diff: true }] }); window.render() })
		await settle(page)
		const searches = await page.evaluate(() => window.searches('data-tool-'))
		console.log(`tool discovery searches with both defaults off: ${searches}`)
		assert.equal(searches, 0)
		await showSettings(page)
		await page.getByRole('switch', { name: expandLabel }).click()
		await page.getByRole('switch', { name: foldLabel }).click()
		await expectExpanded(groupToggle(page, 'late'), true)
		await expectExpanded(rowToggle(page, 'late-patch'), false)
		await settle(page)
		await expectExpanded(groupToggle(page, 'run'), false)
		await expectExpanded(rowToggle(page, 'patch'), true)
	} finally { await page.close() }
})

test('native disclosure storage is reread at every boundary but parsed only when its text changes', async () => {
	const page = await fixture([{ id: 'run', rows: [ordinary, ...['a', 'b', 'c', 'd', 'e'].map(id => ({ id: `edit-${id}`, edit: true, diff: true }))] }])
	try {
		await page.evaluate(key => {
			// Malformed storage reads as no saved choice; the fixture's next native click replaces it.
			localStorage.setItem(key, '{not json')
			window.storage = { reads: 0, parses: 0 }
			const raws = new Set()
			const { getItem } = Storage.prototype
			Storage.prototype.getItem = function (name) {
				const raw = getItem.call(this, name)
				if (name === key) { window.storage.reads++; raws.add(raw) }
				return raw
			}
			const { parse } = JSON
			JSON.parse = (text, ...rest) => {
				if (raws.has(text)) window.storage.parses++
				return parse(text, ...rest)
			}
		}, 'hermes.desktop.toolDisclosure.v1')
		await activate(page)
		await expectExpanded(groupToggle(page), true)
		for (const id of ['a', 'b', 'c', 'd', 'e']) await expectExpanded(rowToggle(page, `edit-${id}`), false)
		const clicks = await page.evaluate(() => window.clicks.length)
		const { reads, parses } = await page.evaluate(() => window.storage)
		console.log(`native disclosure storage for ${clicks} default clicks: ${reads} reads, ${parses} parses`)
		// Each click is read before and after; consecutive boundaries share a text, which is parsed once.
		assert.deepEqual({ reads, parses }, { reads: 2 * clicks, parses: clicks + 1 })
		// A choice saved later is read afresh: on remount it is restored over the default.
		await rowToggle(page, 'edit-c').click()
		await expectExpanded(rowToggle(page, 'edit-c'), true)
		await page.evaluate(() => window.remount())
		await settle(page)
		await expectExpanded(rowToggle(page, 'edit-c'), true)
		await expectExpanded(rowToggle(page, 'edit-d'), false)
	} finally { await page.close() }
})
