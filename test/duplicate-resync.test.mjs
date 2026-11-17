import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { before, after, test } from 'node:test'
import { activatePlugin } from './plugin-host.mjs'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const source = await readFile(process.env.PLUGIN_SOURCE || new URL('../plugin.js', import.meta.url), 'utf8')
let browser
// `gc()` lets retention tests check that a released socket is actually collectable.
before(async () => { browser = await chromium.launch({ headless: true, args: ['--js-flags=--expose-gc'], ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) }) })
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
	const replay = event => {
		const { params } = JSON.parse(event.data)
		if (params.type !== 'session.replay_gap') return
		window.gaps.push(params.session_id)
		if (!rebuilds) return
		const which = params.session_id === window.fakeHost.state.activeSessionId.get() ? 'main' : params.session_id === 'runtime-9' ? 'tile' : null
		if (which) setTimeout(() => window.paint([...new Set(blocks)], which), 50)
	}
	// A reconnect opens a new socket, which the plugin finds by its first frame.
	window.openSocket = () => {
		window.socket = new GatewaySocket()
		window.socket.addEventListener('message', replay)
		window.socket.ping()
	}
	window.openSocket()
}

const delays = { settle: 30, verify: 300, poll: 20, socketWait: 200, minRunning: 0 }

async function fixture({ blocks, rebuilds, autoResync = true, delays: overrides = {} }) {
	const page = await blankPage()
	await page.evaluate(rendererFixture, { blocks, rebuilds })
	// Activating without window.pluginHost skips the plugin's own controller, as on an older host; the tests drive one with short delays.
	await activatePlugin(page, source)
	await page.evaluate(({ autoResync, delays }) => {
		// Timers still pending, by delay, so tests can tell a cancelled wait from one left running.
		window.pendingTimers = new Map()
		const { setTimeout, clearTimeout } = window
		window.setTimeout = (callback, ms, ...args) => {
			const timer = setTimeout(() => { window.pendingTimers.delete(timer); callback(...args) }, ms)
			window.pendingTimers.set(timer, ms)
			return timer
		}
		window.clearTimeout = timer => { window.pendingTimers.delete(timer); clearTimeout(timer) }
		window.controller = window.pluginExports.installDuplicateResync({ host: window.fakeHost, getPreferences: () => ({ autoResync }), notify: input => window.fakeHost.notify(input), delays })
		window.socket.ping()
	}, { autoResync, delays: { ...delays, ...overrides } })
	return page
}

const endTurn = (page, id = 'runtime-1') => page.evaluate(id => {
	window.fakeHost.state.busyBySession.set({ [id]: true })
	window.fakeHost.state.busyBySession.set({})
}, id)
const settle = (page, ms = 500) => page.waitForTimeout(ms)
const duplicated = (page, which = 'main') => page.evaluate(which => Boolean(window.pluginExports.findDuplicateRun(window.pluginExports.transcriptBlocks(window.chat(which)))), which)
const view = (page, which = 'main') => page.evaluate(which => window.controller.viewOf(window.chat(which).querySelector('[data-composer-actions]')), which)
// Bounded settlement observer: a resync either settles within the bound or the assertion fails; nothing waits indefinitely.
const startResync = (page, which = 'main') => page.evaluate(which => {
	window.settled = false
	window.controller.resyncFrom(window.chat(which)).then(() => { window.settled = true })
}, which)
const settles = (page, timeout = 1000) => page.waitForFunction(() => window.settled, null, { timeout }).then(() => true, () => false)
const pendingTimers = (page, ms) => page.evaluate(ms => [...window.pendingTimers.values()].filter(delay => delay === ms).length, ms)
// Whether every object in window.refs has been collected. WeakRef targets survive the job that created them; collect over later tasks.
const collectable = page => page.evaluate(async () => {
	for (let i = 0; i < 3; i++) {
		await new Promise(resolve => setTimeout(resolve, 0))
		window.gc()
	}
	return window.refs.every(ref => ref.deref() === undefined)
})
const release = page => page.evaluate(() => { window.socket.readyState = 3; window.refs = [new WeakRef(window.socket)] })

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
		// The earliest of equally long runs wins; a run never extends into its own copy.
		assert.deepEqual(await run([...turn, 'Between.', ...turn, 'Again.', ...turn]), { first: 0, second: 4, length: 3, chars: 165, text: turn[0] })
		assert.deepEqual(await run(['A', 'B', 'A', 'B', 'A', 'B', 'A', 'B'].map(text => text.repeat(45))), { first: 0, second: 4, length: 4, chars: 180, text: 'A'.repeat(45) })
		assert.equal(await run([`${user}${'x'.repeat(300)}`, 'a'.repeat(60), `${user}${'x'.repeat(300)}`, 'a'.repeat(60)]), null, 'long repeated prompts do not lift short assistant text over the threshold')
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
		// Struck means the slash is drawn and the brush head is cut open where it crosses the slash, instead of the whole broom being drawn under it.
		const struck = () => page.evaluate(() => {
			const svg = document.querySelector('.hermes-ui-tweaks-resync svg')
			const paths = [...svg.querySelectorAll('path')].map(path => path.getAttribute('d'))
			return paths.includes('m2 2 20 20') && !paths.some(d => d.endsWith('z'))
		})
		assert.equal(await struck(), true, 'a disabled broom is struck through')
		await page.evaluate(() => window.fakeHost.state.busyBySession.set({}))
		await page.waitForFunction(() => !document.querySelector('.hermes-ui-tweaks-resync').disabled)
		assert.equal(await struck(), false, 'an enabled broom is not struck through')
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

test('disposal settles an in-flight resync at every wait, with nothing dispatched or reported afterwards', async t => {
	const cases = [
		{ name: 'verification polling', blocks: [...turn, ...turn], rebuilds: false, delays: { verify: 10000, poll: 5000 }, gaps: 1, notes: [] },
		{ name: 'minimum visible time', blocks: turn, delays: { minRunning: 10000 }, gaps: 1, notes: ['success'] },
		{ name: 'socket discovery', blocks: turn, closed: true, delays: { socketWait: 10000 }, gaps: 0, notes: [] }
	]
	for (const { name, closed, gaps, notes, ...options } of cases) await t.test(name, async () => {
		const page = await fixture({ ...options, autoResync: false })
		try {
			await page.evaluate(closed => { if (closed) window.socket.readyState = 3 }, closed)
			await startResync(page)
			await page.evaluate(() => window.controller.dispose())
			const settled = await settles(page)
			await page.evaluate(() => window.openSocket())
			await settle(page, 100)
			assert.deepEqual({ settled, gaps: await page.evaluate(() => window.gaps.length), notes: await page.evaluate(() => window.notes.map(note => note.kind)) }, { settled: true, gaps, notes })
		} finally { await page.close() }
	})
})

test('a socket found while waiting cancels the timeout, and a reconnect releases the closed socket', async () => {
	const page = await fixture({ blocks: turn, autoResync: false, delays: { socketWait: 5000 } })
	try {
		// The renderer reconnects while idle.
		await release(page)
		await page.evaluate(() => window.openSocket())
		const idleReconnect = await collectable(page)
		// It reconnects again while a resync waits for its socket.
		await release(page)
		await startResync(page)
		await page.evaluate(() => window.openSocket())
		assert.equal(await settles(page), true)
		assert.deepEqual(await page.evaluate(() => window.gaps), ['runtime-1'])
		assert.deepEqual({ idleReconnect, pendingTimeouts: await pendingTimers(page, 5000), waitingReconnect: await collectable(page) }, { idleReconnect: true, pendingTimeouts: 0, waitingReconnect: true })
	} finally { await page.close() }
})

test('a timed-out socket wait still reports and releases the closed socket, and a socket captured afterwards serves the next resync once', async () => {
	const page = await fixture({ blocks: turn, autoResync: false, delays: { socketWait: 100 } })
	try {
		await release(page)
		await startResync(page)
		assert.equal(await settles(page), true)
		assert.deepEqual(await page.evaluate(() => window.notes.map(note => note.kind)), ['warning'])
		await page.evaluate(() => { window.socket = null })
		assert.equal(await collectable(page), true, 'a closed socket is released even without a reconnect')
		await page.evaluate(() => window.openSocket())
		await startResync(page)
		assert.equal(await settles(page), true)
		assert.deepEqual(await page.evaluate(() => window.gaps), ['runtime-1'])
		assert.equal(await page.evaluate(() => window.notes.at(-1).kind), 'success')
	} finally { await page.close() }
})

test('a chat switched away during verification stops it silently', async () => {
	const page = await fixture({ blocks: [...turn, ...turn], rebuilds: false, autoResync: false, delays: { verify: 10000 } })
	try {
		await startResync(page)
		await page.evaluate(() => window.fakeHost.state.activeSessionId.set('runtime-2'))
		assert.equal(await settles(page), true, 'verification stops once the chat shows another session')
		assert.deepEqual(await page.evaluate(() => window.notes), [])
		assert.equal((await view(page)).running, false)
	} finally { await page.close() }
})

test('a chat switched away during socket discovery is not rebuilt', async () => {
	const page = await fixture({ blocks: turn, autoResync: false, delays: { socketWait: 5000 } })
	try {
		await page.evaluate(() => { window.socket.readyState = 3 })
		await startResync(page)
		await page.evaluate(() => { window.fakeHost.state.activeSessionId.set('runtime-2'); window.openSocket() })
		assert.equal(await settles(page), true)
		assert.deepEqual({ gaps: await page.evaluate(() => window.gaps), notes: await page.evaluate(() => window.notes), pendingTimeouts: await pendingTimers(page, 5000) }, { gaps: [], notes: [], pendingTimeouts: 0 })
	} finally { await page.close() }
})

test('after disposal under another send wrapper, ours only passes frames on and keeps no socket', async () => {
	const page = await blankPage()
	await page.evaluate(rendererFixture, { blocks: turn })
	await activatePlugin(page, source)
	try {
		await page.evaluate(delays => {
			window.sent = []
			WebSocket.prototype.send = function (data) { window.sent.push(data) }
			window.controller = window.pluginExports.installDuplicateResync({ host: window.fakeHost, getPreferences: () => ({ autoResync: false }), delays })
			// Captured before disposal.
			window.socket.ping()
			const below = WebSocket.prototype.send
			window.above = WebSocket.prototype.send = function (data) { return below.call(this, data) }
			window.controller.dispose()
		}, delays)
		assert.equal(await page.evaluate(() => WebSocket.prototype.send === window.above), true, 'a wrapper installed later is not removed')
		await page.evaluate(() => {
			window.refs = [new WeakRef(window.socket)]
			// The renderer reconnects after disposal.
			window.openSocket()
			window.refs.push(new WeakRef(window.socket))
			window.socket = null
		})
		assert.deepEqual(await page.evaluate(() => window.sent), ['{}', '{}'], 'frames still reach the original send')
		assert.equal(await collectable(page), true, 'the disposed wrapper retains no socket')
	} finally { await page.close() }
})

test('a check analyses the primary chat once for its buttons and itself, skips a working session, and rereads later changes', async () => {
	const page = await fixture({ blocks: turn })
	try {
		await settle(page, 200)
		await page.evaluate(() => {
			// One subscriber per chat, as each mounted broom re-reads its own chat on every notification.
			for (const which of ['main', 'tile']) window.controller.subscribe(() => window.controller.viewOf(window.chat(which).querySelector('[data-composer-actions]')))
			window.scans = { main: 0, tile: 0 }
			const search = Element.prototype.querySelectorAll
			Element.prototype.querySelectorAll = function (selector) {
				for (const which of ['main', 'tile']) if (this === window.chat(which)) window.scans[which]++
				return search.call(this, selector)
			}
		})
		const scans = async action => {
			await page.evaluate(() => { window.scans = { main: 0, tile: 0 } })
			await page.evaluate(action)
			await settle(page, 150)
			return page.evaluate(() => window.scans)
		}
		const unrelated = await scans(() => window.fakeHost.state.busyBySession.set({ 'runtime-x': true }))
		const idleCheck = await scans(() => window.controller.refresh())
		const busyCheck = await scans(() => { window.fakeHost.state.busyBySession.set({ 'runtime-1': true }); window.controller.refresh() })
		console.log(`transcript scans: unrelated busy ${JSON.stringify(unrelated)}, idle check ${JSON.stringify(idleCheck)}, check while busy ${JSON.stringify(busyCheck)}`)
		// One notification reads each chat once; the automatic check reuses the buttons’ reading of the primary chat and does not analyse it while it works.
		assert.deepEqual({ unrelated, idleCheck, busyCheck }, { unrelated: { main: 1, tile: 1 }, idleCheck: { main: 1, tile: 1 }, busyCheck: { main: 0, tile: 2 } })
		// The duplicate painted meanwhile is read afresh once the turn settles.
		await page.evaluate(turn => { window.paint([...turn, ...turn]); window.fakeHost.state.busyBySession.set({}) }, turn)
		await settle(page)
		assert.deepEqual(await page.evaluate(() => window.gaps), ['runtime-1'])
		assert.equal(await duplicated(page), false)
	} finally { await page.close() }
})

test('brooms re-render only when their own chat’s view changes', async () => {
	const page = await blankPage()
	await page.evaluate(rendererFixture, { blocks: turn })
	// A first activation only loads the React fixture, so its jsx can be counted before the plugin's real activation.
	await activatePlugin(page, source, { disposeImmediately: true })
	await page.evaluate(() => {
		const { jsx } = window.pluginReact
		window.renders = 0
		window.pluginReact.jsx = (type, props, key) => {
			if (type === 'button' && props?.className?.includes('hermes-ui-tweaks-resync')) window.renders++
			return jsx(type, props, key)
		}
		window.pluginHost = window.fakeHost
	})
	await activatePlugin(page, source)
	try {
		await page.evaluate(() => {
			window.socket.ping()
			for (const which of ['main', 'tile']) window.mountContribution('resync', window.chat(which).querySelector('[data-composer-actions]'))
		})
		await page.waitForFunction(() => document.querySelectorAll('.hermes-ui-tweaks-resync').length === 2)
		await settle(page, 100)
		await page.evaluate(() => { window.renders = 0 })
		// Another session's turns and focusing the idle tile change neither chat's view; each arrives in its own task, as gateway events do.
		for (let i = 0; i < 5; i++) {
			await page.evaluate(() => window.fakeHost.state.busyBySession.set({ 'runtime-x': true }))
			await page.evaluate(() => window.fakeHost.state.busyBySession.set({}))
		}
		await page.evaluate(() => window.focusTile())
		await settle(page, 100)
		const unchanged = await page.evaluate(() => window.renders)
		console.log(`broom renders for 11 notification tasks without a view change: ${unchanged}`)
		assert.equal(unchanged, 0)
		await page.evaluate(() => window.fakeHost.state.busyBySession.set({ 'runtime-1': true }))
		await page.waitForFunction(() => window.chat('main').querySelector('.hermes-ui-tweaks-resync').disabled)
		assert.equal(await page.evaluate(() => window.chat('tile').querySelector('.hermes-ui-tweaks-resync').disabled), false, 'only the working chat’s broom changes')
		await page.evaluate(() => window.fakeHost.state.busyBySession.set({ 'runtime-9': true }))
		await page.waitForFunction(() => window.chat('tile').querySelector('.hermes-ui-tweaks-resync').disabled, null, { timeout: 2000 })
		await page.evaluate(() => window.fakeHost.state.busyBySession.set({}))
		await page.waitForFunction(() => [...document.querySelectorAll('.hermes-ui-tweaks-resync')].every(broom => !broom.disabled))
	} finally { await page.close() }
})
