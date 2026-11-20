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
// Copies the inspected native ExpandableBlock (expandable-block.tsx): the toggle swaps the scroller's 7.5rem fold for a 40dvh cap, and the fade stays drawn in both states. Plain CSS and a click handler, not a native Desktop build.
const block = (id, text, expanded = false) => `<div class="relative">
	<div id="${id}" class="overflow-y-auto ${expanded ? 'max-h-[40dvh]' : 'max-h-[7.5rem]'}"><pre>${text}</pre></div>
	<div class="fade"><button type="button" aria-expanded="${expanded}">v</button></div>
</div>`
const fixtureHtml = `<!doctype html><html><head><style>
	body { margin: 0; font: 14px/20px system-ui; }
	pre { margin: 0; }
	.relative { position: relative; }
	.overflow-y-auto { overflow-y: auto; }
	.max-h-\\[7\\.5rem\\] { max-height: 7.5rem; }
	.max-h-\\[40dvh\\] { max-height: 40dvh; }
	.fade { position: absolute; inset-inline: 0; bottom: 0; height: 28px; background-image: linear-gradient(to top, white, transparent); }
</style></head><body><article data-slot="aui_assistant-message-content">
	<div class="aui-md">${block('code', lines(200))}${block('short', lines(2))}${block('open', lines(200), true)}</div>
	<div data-tool-row>${block('tool', lines(200), true)}</div>
</article><aside class="aui-md">${block('outside', lines(200), true)}</aside>
<script>
	document.addEventListener('click', event => {
		const button = event.target.closest('button[aria-expanded]')
		if (!button) return
		const expanded = button.getAttribute('aria-expanded') !== 'true'
		button.setAttribute('aria-expanded', expanded)
		button.closest('.relative').firstElementChild.className = 'overflow-y-auto ' + (expanded ? 'max-h-[40dvh]' : 'max-h-[7.5rem]')
	})
</script></body></html>`

const ids = ['code', 'short', 'open', 'tool', 'outside']
async function measure(page) {
	return page.evaluate(ids => Object.fromEntries(ids.map(id => {
		const scroller = document.getElementById(id)
		return [id, { height: scroller.getBoundingClientRect().height, scrolls: scroller.scrollHeight > scroller.clientHeight, fade: getComputedStyle(scroller.nextElementSibling).backgroundImage !== 'none' }]
	})), ids)
}
const toggle = (page, id) => page.locator(`#${id} ~ .fade button`).click()

test('expanded code blocks grow to 42rem within 70% of the window and drop their fade; folded and outside blocks stay native', async () => {
	const page = await browser.newPage({ viewport: { width: 900, height: 2000 } })
	try {
		await page.route('https://fixture.invalid/**', route => route.fulfill({ contentType: 'text/html', body: fixtureHtml }))
		await page.goto('https://fixture.invalid/')
		const native = await measure(page)
		assert.equal(native.open.height, 800, 'fixture must start from the native 40dvh cap')
		await activatePlugin(page, source)
		const tall = await measure(page)
		assert.equal(tall.open.height, 672, 'an expanded block must reach 42rem when the window allows it')
		assert.equal(tall.open.scrolls, true, 'a block longer than the cap must still scroll')
		assert.equal(tall.open.fade, false, 'an expanded block must not draw the fade over its last line')
		assert.deepEqual(tall.code, native.code, 'a folded block must keep its native fold and fade')
		assert.equal(tall.code.fade, true)
		assert.deepEqual(tall.short, native.short, 'a short block must keep its natural height')
		assert.deepEqual(tall.tool, native.tool, 'blocks outside message text must keep their native cap')
		assert.deepEqual(tall.outside, native.outside, 'blocks outside the assistant message must keep their native cap')

		await toggle(page, 'code')
		const opened = await measure(page)
		assert.deepEqual(opened.code, tall.open, 'expanding a folded block must apply the raised cap without its fade')
		await toggle(page, 'code')
		assert.deepEqual((await measure(page)).code, native.code, 'folding it again must restore the native fold and fade')

		await page.setViewportSize({ width: 900, height: 600 })
		assert.equal((await measure(page)).open.height, 420, 'the cap must not exceed 70% of the window height')

		await page.evaluate(() => window.disposePlugin())
		await page.setViewportSize({ width: 900, height: 2000 })
		assert.deepEqual(await measure(page), native)
	} finally { await page.close() }
})

const label = 'Code blocks: taller when expanded'
const codeSwitch = page => page.getByRole('switch', { name: label, exact: true })

test('the switch restores and reapplies the expanded cap live, and persists off', async () => {
	const page = await browser.newPage({ viewport: { width: 900, height: 2000 } })
	try {
		await page.route('https://fixture.invalid/**', route => route.fulfill({ contentType: 'text/html', body: fixtureHtml }))
		await page.goto('https://fixture.invalid/')
		const native = await measure(page)
		await activatePlugin(page, source)
		await page.evaluate(() => window.mountPluginSettings())
		assert.equal(await codeSwitch(page).getAttribute('aria-checked'), 'true', 'taller code blocks must be on by default')
		await codeSwitch(page).click()
		assert.equal(await codeSwitch(page).getAttribute('aria-checked'), 'false')
		assert.deepEqual((await measure(page)).open, native.open, 'turning it off must restore the native cap and fade')
		assert.equal(await page.locator('style[data-hermes-plugin]').count(), 1, 'turning it off must keep the other plugin styles')
		await codeSwitch(page).click()
		assert.equal((await measure(page)).open.height, 672, 'turning it on must raise the cap again without reloading')
		await codeSwitch(page).click()
		await page.evaluate(() => window.disposePlugin())
		await activatePlugin(page, source)
		assert.deepEqual((await measure(page)).open, native.open, 'the cap must stay native after reactivation with the switch off')
	} finally { await page.close() }
})
