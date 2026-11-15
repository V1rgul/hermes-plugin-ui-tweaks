import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { before, after, test } from 'node:test'
import { activatePlugin } from './plugin-host.mjs'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const source = await readFile(process.env.PLUGIN_SOURCE || new URL('../plugin.js', import.meta.url), 'utf8')
let browser
before(async () => { browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) }) })
after(async () => { await browser?.close() })

const lines = count => Array.from({ length: count }, (_, index) => `line ${index + 1}`).join('\n')
// Copies the inspected native caps (fallback.tsx, diff-lines.tsx) as plain CSS; not a native Desktop build.
const fixtureHtml = `<!doctype html><html><head><style>
	body { margin: 0; font: 14px/20px system-ui; }
	pre, div { margin: 0; overflow: auto; }
	.max-h-20 { max-height: 5rem; }
	.max-h-56 { max-height: 14rem; }
	[data-slot="file-diff-panel"], [data-slot="diff-lines"] { max-height: 12rem; }
</style></head><body><article data-slot="aui_assistant-message-content">
	<div data-tool-row data-tool-open>
		<pre id="output" class="max-h-20">${lines(200)}</pre>
		<pre id="short" class="max-h-20">one line</pre>
		<pre id="error" class="max-h-56">${lines(200)}</pre>
		<div id="diff" data-slot="file-diff-panel"><pre>${lines(200)}</pre></div>
		<pre id="diff-lines" data-slot="diff-lines">${lines(200)}</pre>
	</div>
	<pre id="prose-code" class="max-h-20">${lines(200)}</pre>
</article><aside><div data-tool-row><div id="review-diff" data-slot="file-diff-panel"><pre>${lines(200)}</pre></div></div></aside></body></html>`

const ids = ['output', 'short', 'error', 'diff', 'diff-lines', 'prose-code', 'review-diff']
async function heights(page) {
	return page.evaluate(ids => Object.fromEntries(ids.map(id => [id, document.getElementById(id).getBoundingClientRect().height])), ids)
}

test('triples tool detail caps, keeps short results and other scrollers, and restores on disable', async () => {
	const page = await browser.newPage({ viewport: { width: 900, height: 2000 } })
	try {
		await page.route('https://fixture.invalid/**', route => route.fulfill({ contentType: 'text/html', body: fixtureHtml }))
		await page.goto('https://fixture.invalid/')
		const native = await heights(page)
		await activatePlugin(page, source)
		const tall = await heights(page)
		for (const id of ['output', 'error', 'diff', 'diff-lines']) assert.equal(tall[id], native[id] * 3, `${id} must show three times the native height`)
		assert.equal(tall.short, native.short, 'a short result must keep its natural height')
		assert.equal(tall['prose-code'], native['prose-code'], 'a matching class outside tool rows must not grow')
		assert.equal(tall['review-diff'], native['review-diff'], 'diffs outside the assistant message must not grow')
		const scroller = await page.locator('#output').evaluate(el => el.scrollHeight > el.clientHeight)
		assert.equal(scroller, true, 'long output must still scroll inside its box')

		await page.setViewportSize({ width: 900, height: 400 })
		const bounded = await heights(page)
		for (const id of ['output', 'error', 'diff']) assert.equal(bounded[id], Math.min(tall[id], 280), `${id} must not exceed 70% of the viewport`)

		await page.evaluate(() => window.disposePlugin())
		await page.setViewportSize({ width: 900, height: 2000 })
		assert.deepEqual(await heights(page), native)
	} finally { await page.close() }
})

const label = 'Output and diffs: taller boxes'
const switchChecked = page => page.getByRole('switch', { name: label, exact: true }).getAttribute('aria-checked')

test('one switch restores and reapplies both output and diff heights live, and persists off', async () => {
	const page = await browser.newPage({ viewport: { width: 900, height: 2000 } })
	try {
		await page.route('https://fixture.invalid/**', route => route.fulfill({ contentType: 'text/html', body: fixtureHtml }))
		await page.goto('https://fixture.invalid/')
		const native = await heights(page)
		await activatePlugin(page, source)
		await page.evaluate(() => window.mountPluginSettings())
		assert.equal(await switchChecked(page), 'true', 'taller boxes must be on by default')
		await page.getByRole('switch', { name: label, exact: true }).click()
		assert.equal(await switchChecked(page), 'false')
		const off = await heights(page)
		for (const id of ['output', 'error', 'diff', 'diff-lines']) assert.equal(off[id], native[id], `${id} must return to its native height`)
		assert.equal(await page.locator('style[data-hermes-plugin]').count(), 1, 'turning it off must keep the other plugin styles')
		await page.getByRole('switch', { name: label, exact: true }).click()
		const on = await heights(page)
		for (const id of ['output', 'diff']) assert.equal(on[id], native[id] * 3, `${id} must grow again without reloading`)
		await page.getByRole('switch', { name: label, exact: true }).click()
		await page.evaluate(() => window.disposePlugin())
		await activatePlugin(page, source)
		const reloaded = await heights(page)
		for (const id of ['output', 'diff']) assert.equal(reloaded[id], native[id], `${id} must stay native after reactivation with the switch off`)
	} finally { await page.close() }
})
