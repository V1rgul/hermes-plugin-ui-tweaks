import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { before, after, test } from 'node:test'
import { activatePlugin } from './plugin-host.mjs'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const source = await readFile(process.env.PLUGIN_SOURCE || new URL('../plugin.js', import.meta.url), 'utf8')
let browser
before(async () => { browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) }) })
after(async () => { await browser?.close() })

function row(id, open = false) {
	return `<div id="${id}" data-slot="tool-block" data-tool-row ${open ? 'data-file-edit data-tool-open' : ''}><div><button type="button" aria-expanded="${open}">Read or edit example.ts</button></div>${open ? '<div class="result"><div data-slot="file-diff-panel"><pre>+changed code</pre></div><input aria-label="Unsent input" value="keep me"></div>' : ''}</div>`
}
function group(id = 'group', ticker = false) {
	const contents = ticker
		? `<div class="tool-ticker" data-tool-ticker><div class="tool-ticker__reel"><div class="tool-ticker__row">${row(`${id}-one`)}</div><div class="tool-ticker__row">${row(`${id}-two`)}</div></div></div>`
		: `<div class="list">${row(`${id}-one`)}${row(`${id}-two`)}${row(`${id}-edit`, true)}</div>`
	return `<div id="${id}" class="group" data-slot="tool-block" data-tool-group><div data-tool-summary><button type="button" aria-expanded="${!ticker}">Explored files and ran commands</button></div>${contents}</div>`
}
// Geometry fixture of the inspected grid/adjacency/ticker contracts, not a native Desktop build.
const fixtureHtml = `<!doctype html><html><head><style>
	:root { --tool-row-gap: 6px; --turn-block-gap: 24px; --scaffold-block-gap: 8px; --conversation-line-height: 20px; }
	body { margin: 0; padding: 16px; font: 14px system-ui; }
	article, aside { min-width: 0; }
	.group, .list { display: grid; min-width: 0; max-width: 100%; gap: var(--tool-row-gap); }
	[data-tool-row] { min-width: 0; max-width: 100%; overflow: hidden; }
	button { display: block; border: 0; padding: 0; line-height: var(--conversation-line-height); background: transparent; color: inherit; text-align: start; max-width: 100%; overflow-wrap: anywhere; }
	.result { display: grid; gap: 6px; padding: 6px; }
	input { box-sizing: border-box; max-width: 100%; }
	pre { margin: 0; overflow: auto; }
	.aui-md { margin: 0; height: 24px; }
	article > * + * { margin-top: var(--turn-block-gap); }
	article > [data-slot="tool-block"] + [data-slot="tool-block"] { margin-top: var(--scaffold-block-gap); }
	article > [data-file-edit] { margin-block: var(--turn-block-gap); }
	.tool-ticker { height: var(--conversation-line-height); overflow: clip; }
	.tool-ticker__reel { transform: translateY(calc(-1 * var(--conversation-line-height))); }
	.tool-ticker__row { display: flex; align-items: center; height: var(--conversation-line-height); overflow: hidden; }
</style></head><body><article data-slot="aui_assistant-message-content">
	<p id="before" class="aui-md">Normal response before tools.</p>
	${group()}
	<div id="singleton" class="group" data-tool-group data-slot="tool-block"><div class="list">${row('single-row')}</div></div>
	${row('standalone-edit', true)}${row('standalone-read')}
	<p id="after" class="aui-md">Normal response after tools.</p>
	${group('live', true)}
</article><aside>${group('outside')}</aside></body></html>`

async function fixture() {
	const page = await browser.newPage({ viewport: { width: 900, height: 1200 } })
	await page.route('https://fixture.invalid/**', route => route.fulfill({ contentType: 'text/html', body: fixtureHtml }))
	await page.goto('https://fixture.invalid/')
	// Disable behavioral defaults to isolate stylesheet geometry from native toggling.
	await page.evaluate(() => localStorage.setItem('hermes.plugin.hermes-wide-previews.preferences', JSON.stringify({ expandToolCalls: false, foldFileEdits: false })))
	return page
}
async function geometry(page, id = 'group') {
	return page.evaluate(id => {
		const rect = selector => document.querySelector(selector).getBoundingClientRect()
		const group = rect(`#${id}`)
		const header = rect(`#${id} > [data-tool-summary]`)
		const first = rect(`#${id}-one`)
		const firstContent = rect(`#${id}-one > div:first-child`)
		const second = rect(`#${id}-two`)
		return {
			indentLeft: firstContent.left - header.left,
			indentRight: header.right - firstContent.right,
			rowGap: second.top - first.bottom,
			rowHeight: first.height,
			rowStride: second.top - first.top,
			headerGap: first.top - header.bottom,
			groupWidth: group.width,
			rowWidth: firstContent.width,

			leadingBoundary: rect('#group').top - rect('#before').bottom,
			trailingBoundary: rect('#after').top - rect('#standalone-read').bottom,
			standaloneGap: rect('#standalone-read').top - rect('#standalone-edit').bottom,
			singleIndent: rect('#single-row').left - rect('#singleton').left,
			detailGap: getComputedStyle(document.querySelector('#group-edit .result')).rowGap,
			detailPadding: getComputedStyle(document.querySelector('#group-edit .result')).padding,
			overflow: document.documentElement.scrollWidth > innerWidth
		}
	}, id)
}

async function connectors(page, selector = '#group > .list > [data-tool-row]') {
	return page.locator(selector).evaluateAll(rows => rows.map(row => {
		const rect = row.getBoundingClientRect()
		const content = row.firstElementChild.getBoundingClientRect()
		const before = getComputedStyle(row, '::before')
		const after = getComputedStyle(row, '::after')
		const rtl = getComputedStyle(row).direction === 'rtl'
		const x = rtl ? rect.right - parseFloat(before.right) : rect.left + parseFloat(before.left)
		return {
			content: before.content,
			start: rect.top + parseFloat(before.top),
			end: rect.top + parseFloat(before.top) + parseFloat(before.height),
			branch: rect.top + parseFloat(after.top),
			branchWidth: parseFloat(after.width),
			stroke: parseFloat(before.borderInlineStartWidth),
			branchStroke: parseFloat(after.borderBlockStartWidth),
			pointerEvents: before.pointerEvents,
			x,
			contentEdge: rtl ? content.right : content.left,
			rowBottom: rect.bottom,
			headerMiddle: content.top + content.height / 2
		}
	}))
}

test('connects each indented header without gaps and stops at the last header, not its expanded result', async () => {
	const page = await fixture()
	try {
		await activatePlugin(page, source)
		for (const direction of ['ltr', 'rtl']) {
			await page.evaluate(direction => { document.documentElement.dir = direction }, direction)
			const lines = await connectors(page)
			const summaryBottom = await page.locator('#group > [data-tool-summary]').evaluate(el => el.getBoundingClientRect().bottom)
			assert.equal(lines[0].start, summaryBottom, 'the rail must attach directly below the summary')
			for (const [index, line] of lines.entries()) {
				assert.equal(line.content, '""')
				assert.equal(line.stroke, 1, 'the vertical rail must actually be painted')
				assert.equal(line.branchStroke, 1, 'each header must have a painted horizontal branch')
				assert.equal(line.pointerEvents, 'none', 'decoration must not intercept the native controls')
				assert.equal(line.branch, line.headerMiddle, 'branches must align with headers rather than full result heights')
				assert.ok(direction === 'rtl' ? line.x - line.branchWidth > line.contentEdge : line.x + line.branchWidth < line.contentEdge, 'branches must remain inside the indentation gutter')
				if (index) assert.equal(lines[index - 1].end, line.start, 'successive strokes must join without a break')
			}
			assert.equal(lines.at(-1).end, lines.at(-1).branch, 'the final L must end at its horizontal branch')
			assert.ok(lines.at(-1).end < lines.at(-1).rowBottom, 'an expanded last result must not extend the rail')
		}
		for (const selector of ['#single-row', '#standalone-read', '#outside-one']) {
			assert.equal((await connectors(page, selector))[0].content, 'none', 'ungrouped and outside-scope calls must have no connector')
		}
		await page.locator('#group > .list').evaluate((list, markup) => list.insertAdjacentHTML('beforeend', markup), row('appended'))
		const appended = await connectors(page)
		assert.equal(appended.at(-2).end, appended.at(-1).start, 'a newly appended call must extend the old last branch')
		assert.equal(appended.at(-1).end, appended.at(-1).branch)
		await page.locator('#appended').evaluate(el => el.remove())
		const removed = await connectors(page)
		assert.equal(removed.at(-1).end, removed.at(-1).branch, 'removing the last call must shorten the rail again')
		await page.evaluate(() => window.disposePlugin())
		assert.equal((await connectors(page))[0].content, 'none', 'disabling must remove every connector')
	} finally { await page.close() }
})

test('indents grouped calls, compacts only tool gaps, and restores original geometry on disable', async () => {
	const page = await fixture()
	try {
		const original = await geometry(page)
		const outside = await geometry(page, 'outside')
		await activatePlugin(page, source)
		const compact = await geometry(page)
		assert.ok(compact.indentLeft > original.indentLeft, 'the tool rows must start to the right of their fold summary')
		assert.ok(compact.rowWidth < original.rowWidth, 'indentation must consume available width rather than overflow it')
		assert.ok(compact.rowGap < original.rowGap, 'adjacent calls must have less vertical whitespace')
		assert.ok(compact.headerGap < original.headerGap, 'the summary-to-list gap must also be compact')
		assert.ok(compact.standaloneGap < original.standaloneGap, 'adjacent top-level tools must not retain expanded-edit margins')
		for (const key of ['groupWidth', 'rowHeight', 'leadingBoundary', 'trailingBoundary', 'singleIndent', 'detailGap', 'detailPadding']) assert.equal(compact[key], original[key], `${key} must not change`)
		assert.equal(compact.overflow, false)
		const untouched = await geometry(page, 'outside')
		for (const key of ['indentLeft', 'rowWidth', 'rowGap', 'headerGap']) assert.equal(untouched[key], outside[key], `outside ${key} must not change`)
		await page.getByRole('textbox', { name: 'Unsent input' }).first().fill('unsaved user input')
		await page.evaluate(() => { window.savedRow = document.querySelector('#group-one'); window.disposePlugin() })
		assert.deepEqual(await geometry(page), original)
		assert.equal(await page.evaluate(() => window.savedRow === document.querySelector('#group-one')), true)
		assert.equal(await page.getByRole('textbox', { name: 'Unsent input' }).first().inputValue(), 'unsaved user input')
	} finally { await page.close() }
})

test('styles newly inserted folds and preserves narrow-layout bounds', async () => {
	const page = await fixture()
	try {
		await activatePlugin(page, source)
		await page.locator('article').evaluate((article, markup) => article.insertAdjacentHTML('beforeend', markup), group('late'))
		const initial = await geometry(page, 'late')
		assert.ok(initial.indentLeft > 0)
		await page.setViewportSize({ width: 320, height: 1200 })
		const narrow = await geometry(page, 'late')
		assert.equal(narrow.indentLeft, initial.indentLeft)
		assert.equal(narrow.rowGap, initial.rowGap)
		assert.ok(narrow.rowWidth < initial.rowWidth)
		assert.equal(narrow.overflow, false)
	} finally { await page.close() }
})

test('uses logical indentation for RTL and does not disturb the running ticker stride', async () => {
	const page = await fixture()
	try {
		const tickerBefore = await geometry(page, 'live')
		await activatePlugin(page, source)
		const tickerAfter = await geometry(page, 'live')
		assert.ok(tickerAfter.indentLeft > tickerBefore.indentLeft)
		for (const key of ['rowGap', 'rowHeight', 'rowStride']) assert.equal(tickerAfter[key], tickerBefore[key], `ticker ${key} must stay unchanged`)
		const tickerLine = await page.locator('#live > [data-tool-ticker]').evaluate(el => {
			const line = getComputedStyle(el, '::before')
			return { content: line.content, vertical: line.borderInlineStartWidth, horizontal: line.borderBlockEndWidth, height: parseFloat(line.height), tickerHeight: el.getBoundingClientRect().height }
		})
		assert.equal(tickerLine.content, '""')
		assert.equal(tickerLine.vertical, '1px')
		assert.equal(tickerLine.horizontal, '1px')
		assert.equal(tickerLine.height, tickerLine.tickerHeight / 2, 'the live ticker must keep a stationary L at its header midpoint')
		await page.evaluate(() => { document.documentElement.dir = 'rtl' })
		const rtl = await geometry(page)
		assert.ok(rtl.indentRight > 0, 'RTL rows must indent from the right')
		assert.equal(rtl.indentLeft, 0)
		assert.equal(rtl.overflow, false)
	} finally { await page.close() }
})
