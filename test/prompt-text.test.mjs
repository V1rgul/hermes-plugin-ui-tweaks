import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { before, after, test } from 'node:test'
import { activatePlugin, countSearches } from './plugin-host.mjs'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const source = await readFile(process.env.PLUGIN_SOURCE || new URL('../plugin.js', import.meta.url), 'utf8')
const preferencesKey = 'hermes.plugin.hermes-wide-previews.preferences'
const queuedLabel = 'Queued prompts: expand long text by default'
const historyLabel = 'Long messages: expand by default'
let browser
before(async () => { browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) }) })
after(async () => { await browser?.close() })

// Match the native history clamp and QueuePanel's per-entry expanded IDs. Native
// expansion buttons commit asynchronously; ordinary history clicks start editing.
function nativeFixture({ queueOpen = true } = {}) {
	const text = Array.from({ length: 10 }, (_, i) => `Invented long prompt line ${i + 1}`).join('\n')
	window.editClicks = 0
	document.querySelector('#history-text').textContent = text
	document.querySelector('#ordinary-history button').onclick = () => window.editClicks++
	for (const id of ['spectator-history', 'touch-history']) {
		const root = document.getElementById(id)
		const button = root.querySelector('button[aria-expanded]')
		button.onclick = () => {
			const open = button.getAttribute('aria-expanded') === 'false'
			queueMicrotask(() => {
				button.setAttribute('aria-expanded', String(open))
				root.querySelector('[data-body]').classList.toggle('sticky-human-clamp', !open)
			})
		}
	}
	const section = document.querySelector('#queue')
	const header = section.querySelector('.status-section-trigger')
	let open = queueOpen
	const expandedIds = new Set()
	window.queueEntries = ['first']
	window.renderQueue = () => {
		header.setAttribute('aria-expanded', String(open))
		let body = section.querySelector('.status-section-body')
		if (!open) { body?.remove(); return }
		if (!body) { body = document.createElement('div'); body.className = 'status-section-body'; section.append(body) }
		for (const id of window.queueEntries) {
			let row = body.querySelector(`[data-entry="${id}"]`)
			if (!row) {
				row = document.createElement('div')
				row.dataset.entry = id
				row.dataset.slot = 'status-row'
				row.innerHTML = '<div class="status-row-content"><p></p></div><div class="status-row-actions"><button type="button" aria-expanded="false"><i class="codicon codicon-chevron-down"></i></button><button type="button" data-edit>Edit</button></div>'
				row.querySelector('p').textContent = text
				row.querySelector('[data-edit]').onclick = () => window.editClicks++
				row.querySelector('button[aria-expanded]').onclick = () => {
					if (expandedIds.has(id)) expandedIds.delete(id)
					else expandedIds.add(id)
					queueMicrotask(window.renderQueue)
				}
				body.append(row)
			}
			row.querySelector('button[aria-expanded]').setAttribute('aria-expanded', String(expandedIds.has(id)))
			row.querySelector('p').className = expandedIds.has(id) ? 'queue-full' : 'queue-clamped'
		}
	}
	header.onclick = () => { open = !open; queueMicrotask(window.renderQueue) }
	window.renderQueue()
}

async function fixture(preferences = {}, options = {}) {
	const page = await browser.newPage()
	page.setDefaultTimeout(3000)
	await page.route('https://fixture.invalid/**', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><style>
		body { font: 16px/20px system-ui; }
		.sticky-human-clamp { max-height: 40px; overflow: hidden; }
		.sticky-human-clamp[data-clamped=true] { mask-image: linear-gradient(black, transparent); }
		[data-body], #history-text { white-space: pre-wrap; }
		.queue-clamped { max-height: 40px; overflow: hidden; white-space: pre-wrap; }
		.queue-full { max-height: 160px; overflow-y: auto; white-space: pre-wrap; }
	</style><main>
		<div id="ordinary-history" data-slot="aui_user-message-root"><button type="button" class="composer-human-message"><div class="sticky-human-clamp" data-clamped="true"><span id="history-text" data-slot="aui_user-message-text"></span></div></button></div>
		<div id="spectator-history" data-slot="aui_user-message-root"><button type="button" class="composer-human-message" aria-expanded="false"><div class="sticky-human-clamp" data-body>Read-only prompt\nMore text\nMore text</div></button></div>
		<div id="touch-history" data-slot="aui_user-message-root"><div class="composer-human-message"><div class="sticky-human-clamp" data-body>Touch prompt\nMore text\nMore text</div></div><button type="button" data-slot="aui_user-touch-expand" aria-expanded="false">Expand</button></div>
		<div data-slot="aui_assistant-message-content"><div class="sticky-human-clamp" id="outside">Not a user prompt\nMore text\nMore text</div></div>
		<div data-slot="composer-status-stack"><div data-slot="status-section" id="queue"><div class="status-section-header"><button type="button" class="status-section-trigger" aria-expanded="false"><span class="status-section-icon"><i class="codicon codicon-layers"></i></span><span>1 en attente</span></button></div></div></div>
	</main>` }))
	await page.goto('https://fixture.invalid/')
	await page.evaluate(({ key, preferences }) => localStorage.setItem(key, JSON.stringify(preferences)), { key: preferencesKey, preferences })
	await page.evaluate(nativeFixture, options)
	return page
}
const queuedToggle = (page, id = 'first') => page.locator(`[data-entry="${id}"] button[aria-expanded]`)
const historyClamp = page => page.locator('#ordinary-history .sticky-human-clamp')
async function expectExpanded(locator, expected) {
	await locator.page().waitForFunction(({ selector, expected }) => document.querySelector(selector)?.getAttribute('aria-expanded') === String(expected), { selector: await locator.evaluate(el => {
		el.dataset.promptTest = 'target'
		return '[data-prompt-test="target"]'
	}), expected })
	await locator.evaluate(el => el.removeAttribute('data-prompt-test'))
}
async function fullHistory(page, expected) {
	await page.waitForFunction(expected => {
		const el = document.querySelector('#ordinary-history .sticky-human-clamp')
		return (el.clientHeight >= el.scrollHeight) === expected
	}, expected)
}
async function settings(page) { await page.evaluate(() => window.mountPluginSettings()); await page.getByRole('switch', { name: historyLabel }).waitFor() }
async function settle(page) { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))) }

test('expands queued text and history without invoking edit actions or changing assistant content', async () => {
	const page = await fixture()
	try {
		await fullHistory(page, false)
		await activatePlugin(page, source)
		await fullHistory(page, true)
		await expectExpanded(queuedToggle(page), true)
		for (const id of ['spectator-history', 'touch-history']) await expectExpanded(page.locator(`#${id} button[aria-expanded]`), true)
		assert.equal(await historyClamp(page).evaluate(el => getComputedStyle(el).maskImage), 'none')
		assert.equal(await page.evaluate(() => window.editClicks), 0)
		assert.equal(await page.locator('#outside').evaluate(el => getComputedStyle(el).maxHeight), '40px')
		await page.locator('#ordinary-history button').click()
		assert.equal(await page.evaluate(() => window.editClicks), 1, 'ordinary native edit action must remain usable')
	} finally { await page.close() }
})

test('text switches work independently and live; manual native collapses survive subsequent refreshes', async () => {
	const page = await fixture({ expandQueuedPromptText: false, expandHistoryPrompts: false, expandQueuedPrompts: false })
	try {
		await activatePlugin(page, source)
		await settings(page)
		await fullHistory(page, false)
		await expectExpanded(queuedToggle(page), false)
		await page.getByRole('switch', { name: queuedLabel }).click()
		await expectExpanded(queuedToggle(page), true)
		await fullHistory(page, false)
		await queuedToggle(page).click()
		await expectExpanded(queuedToggle(page), false)
		await page.getByRole('switch', { name: historyLabel }).click()
		await fullHistory(page, true)
		await expectExpanded(queuedToggle(page), false)
		await page.getByRole('switch', { name: historyLabel }).click()
		await fullHistory(page, false)
		const spectator = page.locator('#spectator-history button[aria-expanded]')
		await spectator.focus()
		await page.keyboard.press('Space')
		await expectExpanded(spectator, false)
		await page.getByRole('switch', { name: historyLabel }).click()
		await expectExpanded(spectator, false)
		await fullHistory(page, true)
	} finally { await page.close() }
})

test('queued-text default does not open its list, but handles late rows and revealed inert content', async () => {
	const page = await fixture({ expandQueuedPrompts: false }, { queueOpen: false })
	try {
		await activatePlugin(page, source)
		assert.equal(await page.locator('#queue .status-section-trigger').getAttribute('aria-expanded'), 'false')
		assert.equal(await queuedToggle(page).count(), 0)
		await page.locator('#queue .status-section-trigger').click()
		await expectExpanded(queuedToggle(page), true)
		await page.evaluate(() => { document.querySelector('#queue').inert = true; window.queueEntries.push('late'); window.renderQueue() })
		await settle(page)
		assert.equal(await queuedToggle(page, 'late').getAttribute('aria-expanded'), 'false')
		await page.evaluate(() => { document.querySelector('#queue').inert = false })
		await expectExpanded(queuedToggle(page, 'late'), true)
	} finally { await page.close() }
})

test('text preferences persist across reloads and disposal restores the native history clamp', async () => {
	const page = await fixture()
	try {
		await activatePlugin(page, source)
		await fullHistory(page, true)
		await settings(page)
		await page.getByRole('switch', { name: queuedLabel }).click()
		await page.getByRole('switch', { name: historyLabel }).click()
		await fullHistory(page, false)
		await page.reload()
		await page.evaluate(nativeFixture, {})
		await activatePlugin(page, source)
		await settings(page)
		for (const label of [queuedLabel, historyLabel]) assert.equal(await page.getByRole('switch', { name: label }).getAttribute('aria-checked'), 'false')
		await expectExpanded(queuedToggle(page), false)
		await page.getByRole('switch', { name: historyLabel }).click()
		await fullHistory(page, true)
		await page.evaluate(() => window.disposePlugin())
		await fullHistory(page, false)
		assert.equal(await page.locator('style[data-hermes-prompt-defaults]').count(), 0)
		await page.evaluate(() => { window.queueEntries.push('after-dispose'); window.renderQueue() })
		await settle(page)
		assert.equal(await queuedToggle(page, 'after-dispose').getAttribute('aria-expanded'), 'false')
	} finally { await page.close() }
})

test('a queue list opening with several prompts is searched once per delivery, and each prompt still expands', async () => {
	const page = await fixture({ expandQueuedPrompts: false }, { queueOpen: false })
	try {
		await page.evaluate(countSearches)
		await activatePlugin(page, source)
		await settle(page)
		await page.evaluate(() => {
			window.queueEntries.push('second', 'third', 'fourth')
			window.searches.reset()
			// An independent observer sees the same deliveries as the plugin's; count those adding elements.
			window.additions = 0
			new MutationObserver(records => { if (records.some(record => [...record.addedNodes].some(node => node.nodeType === 1))) window.additions++ }).observe(document, { childList: true, subtree: true, attributes: true })
		})
		// Opening the list mounts its body, then every row inside it.
		await page.locator('#queue .status-section-trigger').click()
		for (const id of ['first', 'second', 'third', 'fourth']) await expectExpanded(queuedToggle(page, id), true)
		await settle(page)
		const counts = await page.evaluate(() => ({ searches: window.searches('status-row-actions'), deliveries: window.additions }))
		console.log(`prompt discovery searches for ${counts.deliveries} deliveries adding nested elements: ${counts.searches}`)
		assert.equal(counts.searches, counts.deliveries)
	} finally { await page.close() }
})

test('with both text defaults off, nothing is searched, and re-enabling expands untouched prompts only', async () => {
	const page = await fixture({ expandQueuedPromptText: false, expandHistoryPrompts: false, expandQueuedPrompts: false })
	try {
		await page.evaluate(countSearches)
		await activatePlugin(page, source)
		await expectExpanded(queuedToggle(page), false)
		// While off: a queued prompt opened then closed again.
		for (const expected of [true, false]) {
			await queuedToggle(page).click()
			await expectExpanded(queuedToggle(page), expected)
		}
		await page.evaluate(() => { window.queueEntries.push('late'); window.renderQueue() })
		await settle(page)
		const searches = await page.evaluate(() => window.searches('status-row-actions') + window.searches('aui_user-touch-expand'))
		console.log(`prompt discovery searches with both defaults off: ${searches}`)
		assert.equal(searches, 0)
		await settings(page)
		await page.getByRole('switch', { name: queuedLabel }).click()
		await expectExpanded(queuedToggle(page, 'late'), true)
		await settle(page)
		await expectExpanded(queuedToggle(page), false)
		await expectExpanded(page.locator('#spectator-history button[aria-expanded]'), false)
	} finally { await page.close() }
})
