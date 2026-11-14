import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { before, after, test } from 'node:test'
import { activatePlugin } from './plugin-host.mjs'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const source = await readFile(process.env.PLUGIN_SOURCE || new URL('../plugin.js', import.meta.url), 'utf8')
let browser
before(async () => { browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) }) })
after(async () => { await browser?.close() })

// A real origin, so the plugin's namespaced storage works as in Desktop.
async function blankPage() {
	const page = await browser.newPage()
	await page.route('https://fixture.invalid/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' }))
	await page.goto('https://fixture.invalid/')
	return page
}

const turn = ['Batch 0 of 3: reading the next files in the repository.', 'Batch 1 of 3: reading the next files in the repository.', 'Batch 2 of 3: reading the next files in the repository.']

// Fixture of the primary chat and one split tile with the renderer's gateway socket, not a Desktop build. Like the
// measured renderer: a replay_gap naming the session a chat shows rebuilds that chat, asynchronously, from the
// server copy (one copy of each block); tool rows and thinking text are not prose. A tile is known by its stored
// session only; the host's focus atoms name its runtime session while it has focus.
function rendererFixture({ blocks, rebuilds = true }) {
	const atom = value => {
		const listeners = new Set()
		return { get: () => value, set(next) { value = next; listeners.forEach(listener => listener(value)) }, listen(listener) { listeners.add(listener); return () => listeners.delete(listener) } }
	}
	window.notes = []
	window.gaps = []
	window.fakeHost = {
		state: { activeSessionId: atom('runtime-1'), busyBySession: atom({}), focusedSessionId: atom('runtime-1'), focusedStoredSessionId: atom('stored-1') },
		notify: input => window.notes.push(input)
	}
	const surface = (target, anchor) => `<div data-chat-surface data-composer-target="${target}" data-session-anchor="${anchor}"><div data-slot="aui_assistant-message-content"></div><div data-composer-actions></div></div>`
	document.body.innerHTML = surface('main', 'workspace') + surface('tile-9', 'session-tile:stored-9')
	window.chat = which => document.querySelector(which === 'tile' ? '[data-composer-target="tile-9"]' : '[data-composer-target="main"]')
	window.paint = (list, which = 'main') => {
		// Long enough to count as a duplicate run if they were treated as prose.
		const tool = '<div data-tool-row><p>Ran a long verification command over the whole repository tree.</p><p>Exit code 0 with forty lines of identical output.</p></div>'
		const thought = `<div data-slot="aui_thinking-body"><p>${'Thinking about which file in this repository to read next. '.repeat(5)}</p></div>`
		window.chat(which).querySelector('[data-slot="aui_assistant-message-content"]').innerHTML = list.map(text => `<p>${text}</p>`).join('') + tool + tool + thought + thought
	}
	window.paint(blocks)
	window.paint(blocks.slice(0, 1), 'tile')
	window.focusTile = () => {
		window.fakeHost.state.focusedStoredSessionId.set('stored-9')
		window.fakeHost.state.focusedSessionId.set('runtime-9')
	}
	class GatewaySocket extends EventTarget {
		url = 'ws://127.0.0.1:9120/api/ws?native_dial=browser'
		readyState = 1
		// The renderer's own frames go through WebSocket.prototype.send, which is how the plugin finds this socket.
		ping() { try { WebSocket.prototype.send.call(this, '{}') } catch {} }
	}
	window.socket = new GatewaySocket()
	window.socket.addEventListener('message', event => {
		const { params } = JSON.parse(event.data)
		if (params.type !== 'session.replay_gap') return
		window.gaps.push(params.session_id)
		if (!rebuilds) return
		const which = params.session_id === window.fakeHost.state.activeSessionId.get() ? 'main' : params.session_id === 'runtime-9' ? 'tile' : null
		if (which) setTimeout(() => window.paint([...new Set(blocks)], which), 50)
	})
	window.socket.ping()
}

const delays = { settle: 30, verify: 300, poll: 20, socketWait: 200, minRunning: 0 }

async function fixture({ blocks, rebuilds, autoResync = true }) {
	const page = await blankPage()
	await page.evaluate(rendererFixture, { blocks, rebuilds })
	// Activating without window.pluginHost skips the plugin's own controller, as on an older host; the tests drive one with short delays.
	await activatePlugin(page, source)
	await page.evaluate(({ autoResync, delays }) => {
		window.controller = window.pluginExports.installDuplicateResync({ host: window.fakeHost, getPreferences: () => ({ autoResync }), notify: input => window.fakeHost.notify(input), delays })
		window.socket.ping()
	}, { autoResync, delays })
	return page
}

const endTurn = (page, id = 'runtime-1') => page.evaluate(id => {
	window.fakeHost.state.busyBySession.set({ [id]: true })
	window.fakeHost.state.busyBySession.set({})
}, id)
const settle = (page, ms = 500) => page.waitForTimeout(ms)
const duplicated = (page, which = 'main') => page.evaluate(which => Boolean(window.pluginExports.findDuplicateRun(window.pluginExports.transcriptBlocks(window.chat(which)))), which)
const view = (page, which = 'main') => page.evaluate(which => window.controller.viewOf(window.chat(which).querySelector('[data-composer-actions]')), which)

test('only repeated runs of assistant prose count as paint duplicates', async () => {
	const page = await blankPage()
	await activatePlugin(page, source)
	try {
		const run = blocks => page.evaluate(blocks => window.pluginExports.findDuplicateRun(blocks), blocks)
		const user = '\u0000user '
		assert.equal((await run(['Intro.', ...turn, `${user}continue`, ...turn])).length, 3, 'a whole repeated turn is found')
		assert.equal(await run(['Running the tests.', 'Done.', `${user}again`, 'Running the tests.', 'Done.']), null, 'short wording repeated across turns is not a duplicate')
		const prompt = `${user}${'Please review the attached report carefully. '.repeat(6)}`
		assert.equal(await run([prompt, 'First answer.', prompt, 'Second answer.']), null, 'a resent long prompt is not a duplicate')
		const answer = 'The final answer explains the change in detail. '.repeat(5)
		assert.ok(await run([answer, `${user}thanks`, answer]), 'a single long answer painted twice is found')
	} finally { await page.close() }
})

test('a turn that ends showing duplicates is rebuilt once from the server, without a notification', async () => {
	const page = await fixture({ blocks: turn })
	try {
		await settle(page)
		// The duplicate is painted while the turn runs, as in the measured mid-turn resume.
		await page.evaluate(turn => {
			window.fakeHost.state.busyBySession.set({ 'runtime-1': true })
			window.paint([...turn, ...turn])
		}, turn)
		await settle(page)
		assert.deepEqual(await page.evaluate(() => window.gaps), [], 'nothing is resynced while the turn runs')
		assert.deepEqual(await view(page), { running: false, busy: true, duplicates: false }, 'mid-turn paint is not flagged')
		await page.evaluate(() => window.fakeHost.state.busyBySession.set({}))
		await settle(page)
		assert.deepEqual(await page.evaluate(() => window.gaps), ['runtime-1'])
		assert.equal(await duplicated(page), false)
		assert.deepEqual(await page.evaluate(() => window.notes), [])
		assert.deepEqual(await view(page), { running: false, busy: false, duplicates: false })
	} finally { await page.close() }
})

test('tool rows and thinking blocks repeated by design do not trigger a resync', async () => {
	const page = await fixture({ blocks: turn })
	try {
		await endTurn(page)
		await settle(page)
		assert.deepEqual(await page.evaluate(() => window.gaps), [])
	} finally { await page.close() }
})

test('duplicates that survive a rebuild offer a reload once and are not retried automatically', async () => {
	const page = await fixture({ blocks: [...turn, ...turn], rebuilds: false })
	try {
		await endTurn(page)
		await settle(page, 800)
		const notes = await page.evaluate(() => window.notes.map(note => ({ kind: note.kind, action: note.action?.label })))
		assert.deepEqual(notes, [{ kind: 'warning', action: 'Reload window' }])
		assert.equal((await view(page)).duplicates, true)
		await endTurn(page)
		await settle(page, 800)
		assert.equal(await page.evaluate(() => window.gaps.length), 1, 'the same leftover is not resynced on every turn end')
		await page.evaluate(() => window.controller.resyncFrom(window.chat('main')))
		await settle(page, 800)
		assert.equal(await page.evaluate(() => window.gaps.length), 2, 'the button still retries on demand')
	} finally { await page.close() }
})

test('a busy session is never resynced', async () => {
	const page = await fixture({ blocks: turn })
	try {
		await page.evaluate(() => window.fakeHost.state.busyBySession.set({ 'runtime-1': true }))
		await page.evaluate(() => window.controller.resyncFrom(window.chat('main')))
		await settle(page)
		assert.deepEqual(await page.evaluate(() => window.gaps), [])
		assert.deepEqual(await page.evaluate(() => window.notes.map(note => note.kind)), ['info'])
		// Switching to a chat that is mid-turn and already shows duplicates schedules a check that must wait.
		await page.evaluate(turn => {
			window.fakeHost.state.busyBySession.set({ 'runtime-1': true, 'runtime-2': true })
			window.paint([...turn, ...turn])
			window.fakeHost.state.activeSessionId.set('runtime-2')
		}, turn)
		await settle(page)
		assert.deepEqual(await page.evaluate(() => window.gaps), [])
	} finally { await page.close() }
})

test('with automatic resync off, duplicates are only flagged', async () => {
	const page = await fixture({ blocks: [...turn, ...turn], autoResync: false })
	try {
		await endTurn(page)
		await settle(page)
		assert.deepEqual(await page.evaluate(() => window.gaps), [])
		assert.equal((await view(page)).duplicates, true)
	} finally { await page.close() }
})

test('a split tile is flagged and resynced by its own button, once it has focus', async () => {
	const page = await fixture({ blocks: turn })
	try {
		await settle(page)
		// The post-turn refresh paints the duplicate just after busy clears; buttons must re-read once it has settled.
		await page.evaluate(turn => {
			window.fakeHost.state.busyBySession.set({ 'runtime-9': true })
			window.fakeHost.state.busyBySession.set({})
			window.paint([...turn, ...turn], 'tile')
			window.rereads = 0
			window.controller.subscribe(() => window.rereads++)
		}, turn)
		await settle(page)
		assert.ok(await page.evaluate(() => window.rereads > 0), 'buttons re-read their chat once a tile turn has settled')
		assert.equal((await view(page, 'tile')).duplicates, true, 'a tile showing duplicates is flagged')
		assert.deepEqual(await page.evaluate(() => window.gaps), [], 'automatic resync covers the primary chat only')
		await page.evaluate(() => window.controller.resyncFrom(window.chat('tile')))
		await settle(page)
		assert.deepEqual(await page.evaluate(() => window.gaps), [], 'an unfocused tile names no runtime session')
		assert.equal(await page.evaluate(() => window.notes.at(-1).kind), 'info')
		await page.evaluate(() => { window.focusTile(); return window.controller.resyncFrom(window.chat('tile')) })
		assert.deepEqual(await page.evaluate(() => window.gaps), ['runtime-9'])
		assert.equal(await duplicated(page, 'tile'), false)
		assert.equal(await page.evaluate(() => window.notes.at(-1).message), 'Chat resynced from the server.')
	} finally { await page.close() }
})

test('the composer broom turns orange on duplicates, sweeps while cleaning, and disappears with the plugin', async () => {
	const page = await blankPage()
	await page.evaluate(rendererFixture, { blocks: [...turn, ...turn] })
	await page.evaluate(() => {
		window.originalSend = WebSocket.prototype.send
		window.pluginHost = window.fakeHost
		// Automatic resync off, so the plugin's own first check only flags the duplicate.
		localStorage.setItem('hermes.plugin.hermes-wide-previews.preferences', JSON.stringify({ autoResync: false }))
	})
	await activatePlugin(page, source)
	try {
		await page.evaluate(() => {
			window.socket.ping()
			window.mountContribution('resync', window.chat('main').querySelector('[data-composer-actions]'))
		})
		assert.equal(await page.evaluate(() => window.pluginContributions.resync.area), 'composer.actions')
		const broom = page.locator('[data-composer-target="main"] button.hermes-ui-tweaks-resync')
		await broom.locator('svg').waitFor()
		// The first check runs after Desktop's settle delay.
		await page.waitForFunction(() => document.querySelector('.hermes-ui-tweaks-resync[data-duplicates]'), null, { timeout: 6000 })
		const orange = await page.evaluate(() => {
			document.documentElement.style.setProperty('--ui-orange', 'rgb(255, 128, 0)')
			return getComputedStyle(document.querySelector('.hermes-ui-tweaks-resync')).color
		})
		assert.equal(orange, 'rgb(255, 128, 0)')
		assert.match(await broom.getAttribute('title'), /Duplicated messages detected/)
		await page.evaluate(() => window.fakeHost.state.busyBySession.set({ 'runtime-1': true }))
		await page.waitForFunction(() => document.querySelector('.hermes-ui-tweaks-resync').disabled)
		assert.equal(await broom.getAttribute('data-duplicates'), null, 'a working chat is not flagged')
		await page.evaluate(() => window.fakeHost.state.busyBySession.set({}))
		await page.waitForFunction(() => !document.querySelector('.hermes-ui-tweaks-resync').disabled)
		await broom.click()
		await page.waitForFunction(() => document.querySelector('.hermes-ui-tweaks-resync').getAttribute('aria-busy') === 'true')
		assert.match(await page.evaluate(() => getComputedStyle(document.querySelector('.hermes-ui-tweaks-resync svg')).animationName), /sweep/)
		await page.waitForFunction(() => document.querySelector('.hermes-ui-tweaks-resync').getAttribute('aria-busy') === null, null, { timeout: 4000 })
		assert.deepEqual(await page.evaluate(() => window.gaps), ['runtime-1'])
		assert.equal(await duplicated(page), false)
		assert.equal(await broom.getAttribute('data-duplicates'), null)
		assert.deepEqual(await page.evaluate(() => window.notes.map(note => note.kind)), ['success'])
		await page.evaluate(() => window.disposePlugin())
		assert.equal(await page.evaluate(() => WebSocket.prototype.send === window.originalSend), true, 'WebSocket.send is restored')
		assert.equal(await page.evaluate(() => 'resync' in window.pluginContributions), false)
		assert.equal(await broom.count(), 0)
	} finally { await page.close() }
})
