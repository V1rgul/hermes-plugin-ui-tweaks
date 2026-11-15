import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { before, after, test } from 'node:test'
import { activatePlugin } from './plugin-host.mjs'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const source = await readFile(process.env.PLUGIN_SOURCE || new URL('../plugin.js', import.meta.url), 'utf8')
let browser
before(async () => { browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) }) })
after(async () => { await browser?.close() })

const long = 'Invented prose long enough to wrap: '.repeat(8)
// Geometry fixture of the inspected message-parts/assistant-message timestamp contracts, not a native Desktop build. `stamps` toggles Hermes's display.timestamps.
function fixtureHtml(stamps) {
	const stamp = (text, className = '') => stamps ? `<span data-slot="timeline-timestamp" class="${className}"><time>${text}</time></span>` : ''
	const prose = (id, text) => `${stamp('10:00:01.000', 'prose')}<div class="aui-md" id="${id}"><div>${text}</div></div>`
	const disclosure = (label, { action = false } = {}) => `<div class="row"><button type="button" aria-expanded="true"><span>${label}</span></button>${action ? '<span class="action"><button type="button" aria-label="Dismiss">×</button></span>' : ''}${stamps ? `<span class="trailing"><span>${stamp('10:00:00.000 → 10:00:00.500')}</span></span>` : ''}</div>`
	const message = (id, parts) => `<div class="root" id="${id}" data-slot="aui_assistant-message-root"><div class="content" data-slot="aui_assistant-message-content">${parts}</div>${stamp('10:00:00.000 → 10:00:02.000', 'footer')}<div class="min-h-6"><div class="bar"><button type="button" aria-label="Copy">⧉</button></div></div></div>`
	return `<!doctype html><html><head><style>
	:root { --conversation-tool-font-size: 11px; --conversation-line-height: 18px; --conversation-text-font-size: 14px; --dt-line-height: 1.5; --turn-block-gap: 12px; --paragraph-gap: 10px; }
	body { margin: 0; padding: 16px; font: 14px system-ui; }
	.root { display: flex; flex-direction: column; width: 600px; margin-bottom: 24px; }
	.content { overflow: hidden; font-size: var(--conversation-text-font-size); line-height: var(--dt-line-height); }
	.content > :is([data-slot="tool-block"], .aui-md) + :is([data-slot="tool-block"], .aui-md) { margin-top: var(--turn-block-gap); }
	.content > :is([data-slot="tool-block"]) + :is([data-slot="tool-block"]) { margin-top: 4px; }
	.content > .aui-md + .aui-md { margin-top: var(--paragraph-gap); }
	.content > [data-tool-row][data-file-edit] { margin-block: var(--turn-block-gap); }
	.aui-md { overflow: hidden; }
	[data-tool-row], [data-tool-group] { font-size: var(--conversation-tool-font-size); overflow: hidden; }
	.row { position: relative; display: flex; }
	.row > button { display: flex; max-width: fit-content; min-width: 0; border: 0; padding: 0; font: inherit; line-height: var(--conversation-line-height); background: none; }
	.action { margin-left: auto; display: flex; padding-left: 6px; }
	.trailing { display: flex; padding-left: 6px; line-height: var(--conversation-line-height); }
	[data-slot="timeline-timestamp"] { font-size: 10px; line-height: 16px; }
	.content > [data-slot="timeline-timestamp"] { display: block; margin-bottom: 2px; }
	.footer { padding: 2px 12px 0; }
	.min-h-6 { display: flex; flex-direction: column; align-items: flex-end; min-height: 24px; }
	/* Native action bars are a positioned full-width row that would paint over an overlapping time. */
	.bar { position: relative; display: flex; width: 100%; justify-content: flex-end; }
	.diff { height: 40px; }
</style></head><body>
	${message('after-tools', `<div data-slot="tool-block" data-tool-group data-conversation-scaffold><div data-tool-summary data-conversation-scaffold>${disclosure('Ran 2 commands')}</div></div><div data-slot="tool-block" data-tool-row data-conversation-scaffold><div>${disclosure('Read example.txt', { action: true })}</div></div>${prose('long', long)}${prose('next', 'A second, short paragraph.')}`)}
	${message('after-edit', `<div data-slot="tool-block" data-tool-row data-file-edit data-conversation-scaffold><div>${disclosure('example.txt')}</div><div class="diff"></div></div>${prose('edited', 'Prose after an opened diff.')}`)}
	${message('first', prose('opening', 'Prose that opens its message.'))}
</body></html>`
}

async function fixture(stamps) {
	const page = await browser.newPage({ viewport: { width: 900, height: 1200 } })
	await page.route('https://fixture.invalid/**', route => route.fulfill({ contentType: 'text/html', body: fixtureHtml(stamps) }))
	await page.goto('https://fixture.invalid/')
	await page.evaluate(() => localStorage.setItem('hermes.plugin.hermes-wide-previews.preferences', JSON.stringify({ expandToolCalls: false, foldFileEdits: false })))
	await activatePlugin(page, source)
	return page
}

async function layout(page) {
	return page.evaluate(() => {
		const lineBoxes = id => {
			const range = document.createRange()
			range.selectNodeContents(document.querySelector(`#${id} > div`).firstChild)
			return Array.from(range.getClientRects(), rect => ({ top: rect.top, bottom: rect.bottom, right: rect.right, middle: (rect.top + rect.bottom) / 2 }))
		}
		const rect = el => el.getBoundingClientRect()
		const prose = Object.fromEntries(['long', 'next', 'edited', 'opening'].map(id => {
			const stamp = document.querySelector(`#${id}`).previousElementSibling
			const at = stamp?.matches('[data-slot="timeline-timestamp"]') ? rect(stamp) : null
			const content = rect(document.querySelector(`#${id}`).parentElement)
			return [id, { lines: lineBoxes(id), stamp: at && { top: at.top, bottom: at.bottom, left: at.left, right: at.right, middle: (at.top + at.bottom) / 2, float: getComputedStyle(stamp).float }, contentRight: content.right }]
		}))
		const root = document.querySelector('#after-tools')
		const actions = root.querySelector('.min-h-6')
		const copy = actions.querySelector('button')
		const copyAt = rect(copy)
		const footer = root.querySelector('.footer')
		const summary = root.querySelector('[data-tool-summary] .row')
		const callRow = root.querySelector('[data-tool-row] .row')
		const time = row => row.querySelector('[data-slot="timeline-timestamp"]')
		return {
			prose,
			actionsTop: rect(actions).top,
			nextMessageTop: rect(document.querySelector('#after-edit')).top,
			footer: footer && { top: rect(footer).top, left: rect(footer).left, height: rect(footer).height, text: rect(footer.firstChild), textHit: footer.contains(document.elementFromPoint(rect(footer.firstChild).left + 2, (rect(footer.firstChild).top + rect(footer.firstChild).bottom) / 2)), copyHit: copy.contains(document.elementFromPoint(copyAt.left + copyAt.width / 2, copyAt.top + copyAt.height / 2)) },
			actionsBox: { top: rect(actions).top, bottom: rect(actions).bottom, left: rect(actions).left },
			summary: { right: rect(summary).right, time: time(summary) && rect(time(summary)).right },
			call: { right: rect(callRow).right, time: time(callRow) && rect(time(callRow)).right, dismiss: rect(callRow.querySelector('.action')).left }
		}
	})
}

test('prose timestamps share the first line at its end and cost no vertical space', async () => {
	const plain = await fixture(false)
	const stamped = await fixture(true)
	try {
		const without = await layout(plain)
		const withStamps = await layout(stamped)
		for (const [id, block] of Object.entries(withStamps.prose)) {
			assert.equal(block.stamp.float, 'inline-end', `${id}: the time must leave its own line`)
			assert.deepEqual(block.lines.map(line => line.top), without.prose[id].lines.map(line => line.top), `${id}: every text line must sit where it would without timestamps`)
			assert.equal(block.stamp.right, block.contentRight, `${id}: the time must end at the message’s end edge, where tool rows put theirs`)
			assert.ok(Math.abs(block.stamp.middle - block.lines[0].middle) < 1, `${id}: the time must be level with the first line`)
		}
		const { lines, stamp } = withStamps.prose.long
		assert.ok(lines[0].right <= stamp.left, 'the first line must wrap before the time')
		assert.ok(lines[1].right > stamp.left, 'only the first line makes room for it')
	} finally { await plain.close(); await stamped.close() }
})

test('the message time moves into the action row, and fold summaries put theirs at the end of the line', async () => {
	const plain = await fixture(false)
	const stamped = await fixture(true)
	try {
		const without = await layout(plain)
		const withStamps = await layout(stamped)
		assert.equal(withStamps.actionsTop, without.actionsTop, 'the message time must not push the action row down')
		assert.equal(withStamps.nextMessageTop, without.nextMessageTop, 'nor the next message')
		const { footer, actionsBox } = withStamps
		assert.equal(footer.height, 0)
		assert.ok(footer.text.top >= actionsBox.top && footer.text.bottom <= actionsBox.bottom, 'the time must be drawn inside the action row')
		assert.equal(footer.left, actionsBox.left, 'at its start, away from the actions')
		assert.ok(footer.copyHit, 'the time must not cover the message actions')
		assert.ok(footer.textHit, 'the time must stay above the action row, so hovering it still shows its precise time')
		assert.equal(withStamps.summary.time, withStamps.summary.right, 'a summary’s time must end its line like a call’s')
		assert.equal(withStamps.call.time, withStamps.call.right)
		const unpatched = await fixture(true)
		try {
			await unpatched.evaluate(() => window.disposePlugin())
			assert.equal((await layout(unpatched)).call.dismiss, withStamps.call.dismiss, 'a call’s dismiss action must keep its native place')
		} finally { await unpatched.close() }
	} finally { await plain.close(); await stamped.close() }
})

test('disabling the plugin gives timestamps their own lines back', async () => {
	const page = await fixture(true)
	try {
		await page.evaluate(() => window.disposePlugin())
		const native = await layout(page)
		assert.equal(native.prose.long.stamp.float, 'none')
		assert.ok(native.prose.long.lines[0].top >= native.prose.long.stamp.bottom, 'native timestamps sit above their text')
		assert.ok(native.footer.height > 0)
	} finally { await page.close() }
})
