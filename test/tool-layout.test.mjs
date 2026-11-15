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
	// Native summaries are a DisclosureRow: a relative flex row holding the labelled toggle and a trailing time.
	return `<div id="${id}" class="group" data-slot="tool-block" data-tool-group><div data-tool-summary><div class="disclosure"><button type="button" aria-expanded="${!ticker}"><span>Explored files and ran commands</span></button><span class="trailing">10:00</span></div></div>${contents}</div>`
}
// Geometry fixture of the inspected grid/adjacency/ticker contracts, not a native Desktop build.
const fixtureHtml = `<!doctype html><html><head><style>
	:root { --tool-row-gap: 6px; --turn-block-gap: 24px; --scaffold-block-gap: 8px; --conversation-tool-font-size: 11px; --conversation-line-height: 18px; }
	body { margin: 0; padding: 16px; font: 14px system-ui; }
	article, aside { min-width: 0; }
	.group, .list { display: grid; min-width: 0; max-width: 100%; gap: var(--tool-row-gap); }
	[data-tool-row], [data-tool-summary] { min-width: 0; max-width: 100%; overflow: hidden; font-size: var(--conversation-tool-font-size); }
	button { display: block; border: 0; padding: 0; font: inherit; line-height: var(--conversation-line-height); background: transparent; color: inherit; text-align: start; max-width: 100%; overflow-wrap: anywhere; }
	.disclosure { position: relative; display: flex; }
	.disclosure > button { max-width: fit-content; min-width: 0; }
	.trailing { line-height: var(--conversation-line-height); padding-inline-start: 6px; }
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

async function fixture({ treeToggle = false } = {}) {
	const page = await browser.newPage({ viewport: { width: 900, height: 1200 } })
	await page.route('https://fixture.invalid/**', route => route.fulfill({ contentType: 'text/html', body: fixtureHtml }))
	await page.goto('https://fixture.invalid/')
	// Disable behavioral defaults to isolate stylesheet geometry from native toggling; the tree toggle has its own tests.
	await page.evaluate(treeToggle => localStorage.setItem('hermes.plugin.hermes-wide-previews.preferences', JSON.stringify({ expandToolCalls: false, foldFileEdits: false, treeToggle })), treeToggle)
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
			rowFont: getComputedStyle(document.querySelector(`#${id}-one button`)).fontSize,
			rowStride: second.top - first.top,
			headerGap: first.top - header.bottom,
			headerHeight: header.height,
			groupWidth: group.width,
			rowWidth: firstContent.width,

			leadingBoundary: rect('#group').top - rect('#before').bottom,
			trailingBoundary: rect('#after').top - rect('#standalone-read').bottom,
			standaloneGap: rect('#standalone-read').top - rect('#standalone-edit').bottom,
			standaloneHeight: rect('#standalone-read').height,
			singleIndent: rect('#single-row').left - rect('#singleton').left,
			singleHeight: rect('#single-row').height,
			detailGap: getComputedStyle(document.querySelector('#group-edit .result')).rowGap,
			detailPadding: getComputedStyle(document.querySelector('#group-edit .result')).padding,
			detailFont: getComputedStyle(document.querySelector('#group-edit .result')).fontSize,
			detailLineHeight: getComputedStyle(document.querySelector('#group-edit .result')).getPropertyValue('--conversation-line-height').trim(),
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

test('runs tool lines one step smaller and gapless, keeps results and prose spacing, and restores original geometry on disable', async () => {
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
		// One native step below the fixture's 11px/18px tokens.
		assert.deepEqual([original.rowFont, original.rowHeight, compact.rowFont, compact.rowHeight], ['11px', 18, '10px', 16], 'tool calls must run one step smaller')
		for (const key of ['headerHeight', 'standaloneHeight', 'singleHeight']) assert.equal(compact[key], compact.rowHeight, `${key} must match the compact calls, so neighbouring tool blocks read as one list`)
		assert.equal(compact.rowStride, compact.rowHeight, 'smaller calls must stay gapless')
		assert.equal(compact.standaloneGap, 0, 'adjacent top-level tools must touch like listed calls, without expanded-edit margins')
		for (const key of ['groupWidth', 'leadingBoundary', 'trailingBoundary', 'singleIndent', 'detailGap', 'detailPadding', 'detailFont', 'detailLineHeight']) assert.equal(compact[key], original[key], `${key} must not change`)
		assert.equal(compact.overflow, false)
		const untouched = await geometry(page, 'outside')
		for (const key of ['indentLeft', 'rowWidth', 'rowGap', 'rowHeight', 'rowFont', 'headerGap']) assert.equal(untouched[key], outside[key], `outside ${key} must not change`)
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

test('uses logical indentation for RTL and keeps the running ticker window on its smaller stride', async () => {
	const page = await fixture()
	try {
		const ticker = () => page.locator('#live > [data-tool-ticker]').evaluate(el => {
			const rows = el.querySelectorAll('.tool-ticker__row')
			return {
				window: el.getBoundingClientRect().height,
				stride: rows[1].getBoundingClientRect().top - rows[0].getBoundingClientRect().top,
				newestOffset: rows[1].getBoundingClientRect().top - el.getBoundingClientRect().top
			}
		})
		const tickerBefore = await geometry(page, 'live')
		await activatePlugin(page, source)
		const tickerAfter = await geometry(page, 'live')
		assert.ok(tickerAfter.indentLeft > tickerBefore.indentLeft)
		assert.ok(tickerAfter.rowHeight < tickerBefore.rowHeight, 'ticker calls must shrink like listed calls')
		const reel = await ticker()
		assert.deepEqual([reel.window, reel.stride, reel.newestOffset], [tickerAfter.rowHeight, tickerAfter.rowHeight, 0], 'the window, reel offset and stride must shrink together so the newest call stays exactly in view')
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

async function toggle(page, id) {
	return page.evaluate(id => {
		const group = document.querySelector(`#${id}`)
		const summary = group.querySelector(':scope > [data-tool-summary]')
		const button = summary.querySelector('button')
		const box = getComputedStyle(button, '::before')
		const at = button.getBoundingClientRect()
		const rect = { left: at.left + parseFloat(box.left), top: at.top + parseFloat(box.top), width: parseFloat(box.width), height: parseFloat(box.height) }
		const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
		const first = group.querySelector(':scope > .list > [data-tool-row]')
		const header = first?.firstElementChild.getBoundingClientRect()
		const firstButton = first?.querySelector('button').getBoundingClientRect()
		const rowAt = first?.getBoundingClientRect()
		const rail = first && getComputedStyle(first, '::before')
		const branch = first && getComputedStyle(first, '::after')
		const ticker = group.querySelector(':scope > [data-tool-ticker]')
		const tail = getComputedStyle(button, '::after')
		return {
			content: box.content,
			signs: (box.backgroundImage.match(/linear-gradient/g) || []).length,
			rect, center,
			hitsToggle: box.content !== 'none' && button.contains(document.elementFromPoint(center.x, center.y)),
			summaryHeight: summary.getBoundingClientRect().height,
			groupTop: group.getBoundingClientRect().top,
			groupEdge: getComputedStyle(group).direction === 'rtl' ? group.getBoundingClientRect().right : group.getBoundingClientRect().left,
			labelIndent: button.firstElementChild.getBoundingClientRect().left - group.getBoundingClientRect().left,
			trailingVisibility: getComputedStyle(summary.querySelector('.trailing')).visibility,
			first: first && {
				top: rowAt.top,
				headerMiddle: header.top + header.height / 2,
				railX: rowAt.left + parseFloat(rail.left) + 0.5,
				railTop: rowAt.top + parseFloat(rail.top),
				branchStart: rowAt.left + parseFloat(branch.left),
				buttonHit: first.querySelector('button').contains(document.elementFromPoint(firstButton.left + 4, firstButton.top + firstButton.height / 2))
			},
			tickerRail: ticker && { content: tail.content, top: at.top + parseFloat(tail.top), bottom: at.top + parseFloat(tail.top) + parseFloat(tail.height), tickerTop: ticker.getBoundingClientRect().top }
		}
	}, id)
}

test('an open list replaces its summary line with a minus box on the rail that stays the native labelled toggle', async () => {
	const page = await fixture({ treeToggle: true })
	try {
		await activatePlugin(page, source)
		const open = await toggle(page, 'group')
		assert.equal(open.summaryHeight, 0, 'the summary line must take no height while its list is open')
		assert.equal(open.first.top, open.groupTop, 'the first call must take the summary line’s place')
		assert.equal(open.content, '""')
		assert.equal(open.signs, 1, 'an open list must show a minus')
		assert.equal(open.center.y, open.first.headerMiddle, 'the box must sit level with the first call')
		assert.equal(open.center.x, open.first.railX, 'the box must sit on the rail')
		assert.equal(open.first.railTop, open.rect.top + open.rect.height, 'the rail must start at the box')
		assert.equal(open.first.branchStart, open.rect.left + open.rect.width, 'the first branch must start at the box')
		assert.ok(open.hitsToggle, 'clicking the box must reach the native summary toggle')
		assert.ok(open.first.buttonHit, 'the hidden summary must not cover the first call’s own toggle')
		assert.equal(open.trailingVisibility, 'hidden', 'the summary’s time must go with its line')
		const named = page.locator('#group').getByRole('button', { name: 'Explored files and ran commands', exact: true })
		assert.equal(await named.count(), 1)
		assert.ok(await named.isVisible(), 'the toggle must keep its native accessible name and stay operable')
		await page.evaluate(() => { document.documentElement.dir = 'rtl' })
		const rtl = await toggle(page, 'group')
		assert.equal(rtl.center.x, rtl.first.railX, 'RTL boxes must sit on the mirrored rail')
		assert.ok(rtl.hitsToggle)
		await page.evaluate(() => window.disposePlugin())
		assert.ok((await toggle(page, 'group')).summaryHeight > 0, 'disabling the plugin must restore the summary line')
	} finally { await page.close() }
})

test('a folded list keeps its summary line behind a plus box, joined to a live ticker', async () => {
	const page = await fixture({ treeToggle: true })
	try {
		await activatePlugin(page, source)
		// Native folding flips the toggle and unmounts the calls.
		await page.evaluate(() => { document.querySelector('#group button').setAttribute('aria-expanded', 'false'); document.querySelector('#group > .list').remove() })
		const folded = await toggle(page, 'group')
		assert.equal(folded.summaryHeight, 16, 'a folded list must keep one compact summary line')
		assert.equal(folded.signs, 2, 'a folded list must show a plus')
		assert.equal(folded.labelIndent, 16, 'the label must line up with the calls it folds')
		assert.ok(folded.hitsToggle)
		assert.equal(folded.center.x - folded.groupEdge, 6.5, 'the box must stay on the rail column')
		const live = await toggle(page, 'live')
		assert.equal(live.tickerRail.content, '""')
		assert.equal(live.tickerRail.top, live.rect.top + live.rect.height, 'the live ticker’s rail must start at the box')
		assert.equal(live.tickerRail.bottom, live.tickerRail.tickerTop, 'and reach the ticker without a gap')
	} finally { await page.close() }
})

test('with the tree toggle switched off, summaries keep their native line', async () => {
	const page = await fixture({ treeToggle: false })
	try {
		await activatePlugin(page, source)
		const native = await toggle(page, 'group')
		assert.equal(native.content, 'none')
		assert.equal(native.summaryHeight, 16)
		assert.equal(native.labelIndent, 0)
	} finally { await page.close() }
})
