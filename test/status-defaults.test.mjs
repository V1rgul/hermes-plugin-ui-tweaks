import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { before, after, test } from 'node:test'
import { activatePlugin } from './plugin-host.mjs'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const source = await readFile(process.env.PLUGIN_SOURCE || new URL('../plugin.js', import.meta.url), 'utf8')
const preferenceKey = 'hermes.plugin.hermes-wide-previews.preferences'
const nativeKey = 'hermes.desktop.collapsedStatusDrawers.v1'
const opensKey = 'hermes.plugin.hermes-wide-previews.openStatusDrawers'
const label = 'Status stack: fold by default'
let browser
before(async () => { browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) }) })
after(async () => { await browser?.close() })

// Mirror useStatusDrawer: native storage holds only collapsed scoped keys,
// two mounted drawer bodies share one grip, and React commits after persistence.
function nativeFixture({ scope = ['local', 'default', 'default', 'chat-a'], collapsed = [], queued = 0, paused = false } = {}) {
	const key = 'hermes.desktop.collapsedStatusDrawers.v1'
	window.fixtureCollapsedDrawers = collapsed
	let currentScope = scope
	let draftCollapsed = false
	window.clicks = []
	try { localStorage.setItem(key, JSON.stringify(collapsed)) } catch {}
	const listeners = new Set()
	window.pluginHost = { state: { focusedStoredSessionId: { listen(fn) { listeners.add(fn); return () => listeners.delete(fn) } } } }
	window.focusListenerCount = () => listeners.size
	const root = document.createElement('section')
	root.dataset.slot = 'composer-dock'
	root.innerHTML = '<div class="status-drawer" id="activity"><div data-slot="composer-status-stack"><input value="retained activity"></div></div><div data-slot="composer-root"><button type="button" data-slot="status-drawer-toggle" aria-controls="activity coding"><span>Grip</span></button><div class="status-drawer" id="coding"><div class="coding-status-bar">main</div></div><textarea>Unsent draft</textarea></div>'
	const suffix = document.querySelectorAll('[data-slot="composer-dock"]').length
	for (const drawer of root.querySelectorAll('.status-drawer')) drawer.id += `-${suffix}`
	root.querySelector('button').setAttribute('aria-controls', `activity-${suffix} coding-${suffix}`)
	document.body.append(root)
	const button = root.querySelector('button')
	const scopedKey = () => currentScope ? JSON.stringify(currentScope) : null
	const renderDrawer = () => {
		const collapsed = scopedKey() ? window.fixtureCollapsedDrawers.includes(scopedKey()) : draftCollapsed
		button.setAttribute('aria-expanded', String(!collapsed))
		button.setAttribute('aria-label', collapsed ? 'Show status stack' : 'Hide status stack')
		for (const drawer of root.querySelectorAll('.status-drawer')) {
			drawer.inert = collapsed
			drawer.toggleAttribute('hidden', collapsed)
			if (collapsed) drawer.setAttribute('aria-hidden', 'true')
			else drawer.removeAttribute('aria-hidden')
		}
	}
	button.onclick = () => {
		const id = scopedKey()
		let saved = window.fixtureCollapsedDrawers
		const collapsed = id ? !saved.includes(id) : !draftCollapsed
		window.clicks.push({ id, collapsed })
		if (id) {
			saved = saved.filter(item => item !== id)
			if (collapsed) saved.push(id)
			window.fixtureCollapsedDrawers = saved
			try { localStorage.setItem(key, JSON.stringify(saved)) } catch {}
		} else draftCollapsed = collapsed
		queueMicrotask(renderDrawer)
	}
	window.switchDrawer = (scope, signal = 'focus') => {
		currentScope = scope
		draftCollapsed = false
		renderDrawer()
		if (signal === 'focus') for (const listener of listeners) listener()
		else location.hash = `/${scope?.join('/') || 'draft'}`
	}
	window.setFixtureQueue = (count, paused = false) => {
		let section = root.querySelector('[data-slot="status-section"]')
		if (!count) { section?.remove(); return }
		if (!section) {
			section = document.createElement('div')
			section.dataset.slot = 'status-section'
			section.innerHTML = '<div class="status-section-header"><button class="status-section-trigger" aria-expanded="false"><span class="status-section-icon"><i class="codicon"></i></span><span></span></button></div>'
			root.querySelector('[data-slot="composer-status-stack"]').append(section)
			const trigger = section.querySelector('button')
			trigger.onclick = () => {
				const expanded = trigger.getAttribute('aria-expanded') === 'false'
				queueMicrotask(() => {
					trigger.setAttribute('aria-expanded', String(expanded))
					section.querySelector('.status-section-body')?.remove()
					if (expanded) {
						const body = document.createElement('div')
						body.className = 'status-section-body'
						body.textContent = 'Invented queued prompt'
						section.append(body)
					}
				})
			}
		}
		section.querySelector('i').className = `codicon codicon-${paused ? 'debug-pause' : 'layers'}`
		const label = section.querySelector('button > span:last-child')
		const text = `${count} en attente${paused ? ' (pause)' : ''}`
		if (label.firstChild) label.firstChild.nodeValue = text
		else label.textContent = text
	}
	window.setFixtureQueue(queued, paused)
	window.renderDrawer = renderDrawer
	renderDrawer()
}

async function fixture(options = {}, preferences) {
	const page = await browser.newPage()
	page.setDefaultTimeout(3000)
	await page.route('https://fixture.invalid/**', route => route.fulfill({ contentType: 'text/html', body: '<button aria-expanded="true" id="unrelated">Unrelated disclosure</button>' }))
	await page.goto('https://fixture.invalid/')
	if (preferences) await page.evaluate(({ key, preferences }) => localStorage.setItem(key, JSON.stringify(preferences)), { key: preferenceKey, preferences })
	await page.evaluate(nativeFixture, options)
	return page
}
const toggle = page => page.locator('[data-slot="status-drawer-toggle"]')
async function expanded(page, value) {
	await page.waitForFunction(value => document.querySelector('[data-slot="status-drawer-toggle"]')?.getAttribute('aria-expanded') === String(value), value)
}
async function settle(page) { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))) }
async function settings(page) { await page.evaluate(() => window.mountPluginSettings()); await page.getByRole('switch', { name: label, exact: true }).waitFor() }

test('folds both native drawer bodies without touching their contents, draft or unrelated disclosures', async () => {
	const page = await fixture()
	try {
		await activatePlugin(page, source)
		await expanded(page, false)
		assert.equal(await page.locator('.status-drawer[inert]').count(), 2)
		assert.equal(await page.locator('input').inputValue(), 'retained activity')
		assert.equal(await page.locator('textarea').inputValue(), 'Unsent draft')
		assert.equal(await page.locator('#unrelated').getAttribute('aria-expanded'), 'true')
		assert.equal(await page.evaluate(() => window.clicks.length), 1)
		await toggle(page).click()
		await expanded(page, true)
		assert.equal(await page.locator('.status-drawer[inert]').count(), 0)
		assert.equal(await page.locator('.coding-status-bar').innerText(), 'main')
	} finally { await page.close() }
})

test('the new switch is independent, applies live, persists false, and does not force the opposite layout', async () => {
	const page = await fixture({}, { foldStatusStack: false })
	try {
		await activatePlugin(page, source)
		await settings(page)
		await expanded(page, true)
		assert.equal(await page.getByRole('switch', { name: label }).getAttribute('aria-checked'), 'false')
		await page.getByRole('switch', { name: label }).click()
		await expanded(page, false)
		for (const name of ['Lists: expand by default', 'File edits: fold diffs by default']) assert.equal(await page.getByRole('switch', { name, exact: true }).getAttribute('aria-checked'), 'true')
		await page.getByRole('switch', { name: label }).click()
		await expanded(page, false)
		assert.equal(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).foldStatusStack, preferenceKey), false)
		await page.reload()
		await page.evaluate(nativeFixture, {})
		await activatePlugin(page, source)
		await settings(page)
		await expanded(page, true)
		assert.equal(await page.getByRole('switch', { name: label }).getAttribute('aria-checked'), 'false')
	} finally { await page.close() }
})

test('manual keyboard opens survive plugin and browser reloads and stay isolated by native scope', async () => {
	const page = await fixture()
	try {
		await activatePlugin(page, source)
		await expanded(page, false)
		await toggle(page).focus()
		await page.keyboard.press('Space')
		await expanded(page, true)
		await settle(page)
		assert.deepEqual(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), opensKey), [JSON.stringify(['local', 'default', 'default', 'chat-a'])])
		await page.evaluate(() => window.disposePlugin())
		await activatePlugin(page, source)
		await settle(page)
		await expanded(page, true)
		await page.reload()
		await page.evaluate(nativeFixture, {})
		await activatePlugin(page, source)
		await settle(page)
		await expanded(page, true)
		await page.evaluate(() => window.switchDrawer(['remote', 'default', 'default', 'chat-a']))
		await settle(page)
		await expanded(page, false)
		await page.evaluate(() => window.switchDrawer(['local', 'other', 'other', 'chat-a']))
		await settle(page)
		await expanded(page, false)
	} finally { await page.close() }
})

test('reused grips get defaults after focus and hash navigation, while explicit opens and closes win', async () => {
	const page = await fixture()
	try {
		await activatePlugin(page, source)
		await expanded(page, false)
		await toggle(page).click()
		await expanded(page, true)
		await settle(page)
		await page.evaluate(() => window.switchDrawer(['local', 'default', 'default', 'chat-b']))
		await settle(page)
		await expanded(page, false)
		await page.evaluate(() => window.switchDrawer(['local', 'default', 'default', 'chat-a'], 'hash'))
		await settle(page)
		await expanded(page, true)
		await toggle(page).click()
		await expanded(page, false)
		await settle(page)
		assert.deepEqual(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), opensKey), [])
		await page.evaluate(() => window.switchDrawer(['local', 'default', 'default', 'chat-c'], 'hash'))
		await settle(page)
		await expanded(page, false)
	} finally { await page.close() }
})

test('native closed choices require no click and hidden or dynamically inserted grips initialize on reveal', async () => {
	const id = JSON.stringify(['local', 'default', 'default', 'chat-a'])
	const page = await fixture({ collapsed: [id] })
	try {
		await activatePlugin(page, source)
		await expanded(page, false)
		assert.equal(await page.evaluate(() => window.clicks.length), 0)
		await page.evaluate(() => {
			document.querySelector('[data-slot="composer-dock"]').remove()
			window.disposePlugin()
		})
		await page.evaluate(nativeFixture, { scope: ['local', 'default', 'default', 'late'] })
		await page.evaluate(() => { document.querySelector('[data-slot="composer-dock"]').inert = true })
		await activatePlugin(page, source)
		await settle(page)
		await expanded(page, true)
		await page.evaluate(() => { document.querySelector('[data-slot="composer-dock"]').inert = false })
		await expanded(page, false)
		await page.evaluate(() => document.querySelector('[data-slot="composer-dock"]').remove())
		await page.evaluate(nativeFixture, { scope: ['local', 'default', 'default', 'inserted'] })
		await expanded(page, false)
	} finally { await page.close() }
})

test('denied storage still permits defaults and manual overrides on the mounted drawer', async () => {
	const page = await fixture({ scope: null })
	try {
		await page.evaluate(() => {
			Storage.prototype.getItem = () => { throw new DOMException('Denied', 'SecurityError') }
			Storage.prototype.setItem = () => { throw new DOMException('Denied', 'SecurityError') }
		})
		await activatePlugin(page, source)
		await expanded(page, false)
		await toggle(page).click()
		await expanded(page, true)
		await page.evaluate(() => window.renderDrawer())
		await settle(page)
		await expanded(page, true)
		await settings(page)
		await page.getByRole('switch', { name: label }).click()
		assert.equal(await page.getByRole('switch', { name: label }).getAttribute('aria-checked'), 'false')
	} finally { await page.close() }
})

test('disposal removes focus/navigation listeners and observers without resetting the native layout', async () => {
	const page = await fixture()
	try {
		for (let index = 0; index < 3; index++) {
			await activatePlugin(page, source)
			await settle(page)
			assert.equal(await page.evaluate(() => window.focusListenerCount()), 1)
			await page.evaluate(() => window.disposePlugin())
			assert.equal(await page.evaluate(() => window.focusListenerCount()), 0)
		}
		await expanded(page, false)
		await page.evaluate(() => window.switchDrawer(['local', 'default', 'default', 'after-dispose'], 'hash'))
		await settle(page)
		await expanded(page, true)
	} finally { await page.close() }
})

test('queued prompts reveal the drawer and list, reopen on updates, and refold after an automatic reveal empties', async () => {
	const page = await fixture()
	const queueToggle = page.locator('.status-section-trigger')
	try {
		await activatePlugin(page, source)
		await expanded(page, false)
		await page.evaluate(() => window.setFixtureQueue(1))
		await expanded(page, true)
		await page.waitForFunction(() => document.querySelector('.status-section-trigger')?.getAttribute('aria-expanded') === 'true')
		assert.equal(await page.locator('.status-section-body').innerText(), 'Invented queued prompt')
		assert.equal(await page.evaluate(key => localStorage.getItem(key), opensKey), null, 'automatic queue reveal must not become a permanent manual-open preference')
		await queueToggle.click()
		await toggle(page).click()
		await expanded(page, false)
		await settle(page)
		await expanded(page, false)
		assert.equal(await queueToggle.getAttribute('aria-expanded'), 'false', 'manual collapse lasts until the queue changes')
		await page.evaluate(() => window.setFixtureQueue(2))
		await expanded(page, true)
		await page.waitForFunction(() => document.querySelector('.status-section-trigger')?.getAttribute('aria-expanded') === 'true')
		await page.evaluate(() => window.setFixtureQueue(0))
		await expanded(page, false)
	} finally { await page.close() }
})

test('queue expansion is independent of status folding, including native closed and paused queues', async () => {
	const id = JSON.stringify(['local', 'default', 'default', 'chat-a'])
	for (const enabled of [true, false]) {
		const page = await fixture({ collapsed: [id], queued: 1, paused: true }, { foldStatusStack: !enabled, expandQueuedPrompts: enabled })
		try {
			await activatePlugin(page, source)
			await settle(page)
			await expanded(page, enabled)
			assert.equal(await page.locator('.status-section-trigger').getAttribute('aria-expanded'), String(enabled))
			if (enabled) {
				await toggle(page).click()
				await expanded(page, false)
				await toggle(page).click()
				await expanded(page, true)
				await page.evaluate(() => window.setFixtureQueue(0))
				await settle(page)
				await expanded(page, true)
			}
		} finally { await page.close() }
	}
})

test('a queue opens only its own controlled composer and unrelated activity never opens the drawer', async () => {
	const page = await fixture()
	try {
		await page.evaluate(() => { window.setFirstQueue = window.setFixtureQueue })
		await page.evaluate(nativeFixture, { scope: ['local', 'default', 'default', 'chat-b'] })
		await activatePlugin(page, source)
		await settle(page)
		const grips = page.locator('[data-slot="status-drawer-toggle"]')
		assert.deepEqual(await grips.evaluateAll(els => els.map(el => el.getAttribute('aria-expanded'))), ['false', 'false'])
		await page.evaluate(() => {
			const unrelated = document.createElement('div')
			unrelated.innerHTML = '<button aria-expanded="false"><i class="codicon codicon-layers"></i>Not a queue section</button>'
			document.querySelector('[data-slot="composer-dock"]').append(unrelated)
		})
		await settle(page)
		assert.deepEqual(await grips.evaluateAll(els => els.map(el => el.getAttribute('aria-expanded'))), ['false', 'false'])
		await page.evaluate(() => window.setFixtureQueue(1))
		await page.waitForFunction(() => [...document.querySelectorAll('[data-slot="status-drawer-toggle"]')].map(el => el.getAttribute('aria-expanded')).join(',') === 'false,true')
		await page.evaluate(() => window.switchDrawer(['local', 'default', 'default', 'chat-b']))
		await settle(page)
		assert.deepEqual(await grips.evaluateAll(els => els.map(el => el.getAttribute('aria-expanded'))), ['false', 'true'], 'focus refresh must not reveal another composer’s queue')
		await page.evaluate(() => window.setFixtureQueue(0))
		await settle(page)
		assert.deepEqual(await grips.evaluateAll(els => els.map(el => el.getAttribute('aria-expanded'))), ['false', 'false'])
		await page.evaluate(() => window.setFirstQueue(1))
		await page.waitForFunction(() => [...document.querySelectorAll('[data-slot="status-drawer-toggle"]')].map(el => el.getAttribute('aria-expanded')).join(',') === 'true,false')
	} finally { await page.close() }
})

test('queue and status switches apply independently without reload and persist separately', async () => {
	const page = await fixture({}, { foldStatusStack: false, expandQueuedPrompts: false })
	const queueLabel = 'Queued prompts: expand list by default'
	try {
		await activatePlugin(page, source)
		await settings(page)
		await page.evaluate(() => window.setFixtureQueue(1))
		await settle(page)
		await expanded(page, true)
		assert.equal(await page.locator('.status-section-trigger').getAttribute('aria-expanded'), 'false')
		await page.getByRole('switch', { name: queueLabel, exact: true }).click()
		await page.waitForFunction(() => document.querySelector('.status-section-trigger')?.getAttribute('aria-expanded') === 'true')
		assert.equal(await page.getByRole('switch', { name: label, exact: true }).getAttribute('aria-checked'), 'false')
		await page.getByRole('switch', { name: label, exact: true }).click()
		await expanded(page, true)
		await page.getByRole('switch', { name: queueLabel, exact: true }).click()
		await page.locator('.status-section-trigger').click()
		await page.evaluate(() => window.setFixtureQueue(2))
		await settle(page)
		assert.equal(await page.locator('.status-section-trigger').getAttribute('aria-expanded'), 'false')
		await page.reload()
		await page.evaluate(nativeFixture, { queued: 1 })
		await activatePlugin(page, source)
		await settings(page)
		assert.equal(await page.getByRole('switch', { name: queueLabel, exact: true }).getAttribute('aria-checked'), 'false')
		assert.equal(await page.getByRole('switch', { name: label, exact: true }).getAttribute('aria-checked'), 'true')
		assert.equal(await page.locator('.status-section-trigger').getAttribute('aria-expanded'), 'false')
	} finally { await page.close() }
})
