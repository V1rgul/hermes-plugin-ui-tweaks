import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { before, after, test } from 'node:test'
import { activatePlugin } from './plugin-host.mjs'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const pluginSource = await readFile(new URL('../plugin.js', import.meta.url), 'utf8')
let browser
before(async () => { browser = await chromium.launch({ headless:true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath:process.env.CHROMIUM_EXECUTABLE } : {}) }) })
after(async () => { await browser?.close() })

// Match both inspected core layouts. This is a geometry fixture, not a Desktop build.
const documentText = '<!doctype html><html><body><script>/* hermes-inline-preview-size */</script><button onclick="this.textContent=Number(this.textContent)+1">0</button><div style="width:100%;height:140px;border:1px solid;box-sizing:border-box">Responsive HTML preview</div></body></html>'
const attr = value => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')
function frameMarkup(kind, id = 'preview') {
	const old = kind === 'old'
	const source = kind === 'browser' ? 'src="https://example.invalid/assets/webapp-preview.html"' : `srcdoc="${attr(documentText)}"`
	return `<span id="${id}" class="outer" style="max-width:${old ? 640 : 960}px"><span class="inner" style="height:240px;${old ? 'width:640px' : 'width:100%'}"><iframe sandbox="allow-scripts" ${source} title="Example.html"></iframe></span></span>`
}
function fixture(kind) {
	return `<!doctype html><html><head><style>
	body { margin:0; font:16px system-ui; }
	[data-slot="aui_thread-content"] { padding:24px; }
	[data-slot="aui_assistant-message-content"] { min-width:0; }
	.outer { display:block; width:100%; margin:8px 0; }
	.inner { display:block; position:relative; max-width:100%; }
	iframe { position:absolute; inset:0; width:100%; height:100%; border:0; }
	.ordinary { width:540px; max-width:100%; }
	</style></head><body><main data-slot="aui_thread-content"><article data-slot="aui_assistant-message-content">
	<p id="prose" class="ordinary">Ordinary prose keeps its existing width.</p>
	${frameMarkup(kind)}
	<div id="image" class="ordinary" style="height:20px">Image placeholder</div>
	<span class="outer" id="unrelated" style="max-width:300px"><span class="inner" style="height:120px;width:300px"><iframe sandbox="allow-scripts" srcdoc="Unrelated embedded content"></iframe></span></span>
	<span class="outer" id="other-sandbox" style="max-width:310px"><span class="inner" style="height:120px;width:310px"><iframe sandbox="" srcdoc="hermes-inline-preview-size"></iframe></span></span>
	</article><section id="outside"><span class="outer" style="max-width:320px"><span class="inner" style="width:320px;height:120px"><iframe sandbox="allow-scripts" srcdoc="hermes-inline-preview-size"></iframe></span></span></section></main></body></html>`
}
async function dimensions(page) {
	return page.evaluate(() => {
		const width = selector => document.querySelector(selector).getBoundingClientRect().width
		const iframe = document.querySelector('#preview iframe')
		return {
			available:width('[data-slot="aui_assistant-message-content"]'),
			outer:width('#preview'), inner:width('#preview > span'), frame:width('#preview iframe'),
			prose:width('#prose'), image:width('#image'), unrelated:width('#unrelated'), otherSandbox:width('#other-sandbox'), outside:width('#outside > span'),
			height:iframe.getBoundingClientRect().height, sandbox:iframe.getAttribute('sandbox'), source:iframe.getAttribute('srcdoc') || iframe.getAttribute('src'),
			overflow:document.documentElement.scrollWidth > innerWidth
		}
	})
}
async function activate(page) {
	await activatePlugin(page, pluginSource)
	await page.evaluate(() => { window.disposeWidePreviews = window.disposePlugin })
}
function assertWide(state) {
	for (const key of ['outer', 'inner', 'frame']) assert.ok(Math.abs(state[key] - state.available) < 1, `${key}: ${state[key]} must fill ${state.available}`)
	assert.equal(state.overflow, false, 'plugin must not create page-wide horizontal scrolling')
}
for (const kind of ['old', 'current', 'browser']) {
	test(`${kind}: removes caps, follows resize and new messages, preserves content, restores on disable`, async () => {
		const page = await browser.newPage({ viewport:{ width:1800, height:1000 } })
		await page.route('https://example.invalid/**', route => route.fulfill({ contentType:'text/html', body:documentText }))
		try {
			await page.setContent(fixture(kind))
			const original = await dimensions(page)
			assert.equal(original.frame, kind === 'old' ? 640 : 960)
			await activate(page)
			const wide = await dimensions(page)
			assertWide(wide)
			for (const key of ['prose','image','unrelated','otherSandbox','outside','height','sandbox','source']) assert.equal(wide[key], original[key], `${key} must not change`)
			// Width changes must not reload interactive previews or reset their state.
			await page.frameLocator('#preview iframe').getByRole('button').click()
			await page.setViewportSize({ width:720, height:1000 })
			const narrow = await dimensions(page)
			assertWide(narrow)
			await page.setViewportSize({ width:2000, height:1000 })
			const wider = await dimensions(page)
			assertWide(wider)
			// Emulate a late React width update from the older measurement script.
			await page.locator('#preview > span').evaluate(el => { el.style.width = '280px' })
			assertWide(await dimensions(page))
			await page.locator('[data-slot="aui_assistant-message-content"]').evaluate((el, markup) => el.insertAdjacentHTML('beforeend', markup), frameMarkup(kind,'late'))
			const late = await page.locator('#late iframe').boundingBox()
			assert.equal(late.width, (await dimensions(page)).available)
			await page.evaluate(() => window.disposeWidePreviews())
			assert.equal(await page.locator('style[data-hermes-plugin]').count(), 0)
			assert.equal((await dimensions(page)).outer, original.outer)
			assert.equal((await dimensions(page)).inner, 280, 'the underlying React-owned width remains intact')
			assert.equal(await page.frameLocator('#preview iframe').getByRole('button').textContent(), '1')
			console.log(JSON.stringify({ renderer:kind, before:original.frame, after:wide.frame, messageWidth:wide.available, narrowWidth:narrow.frame, wideWindowWidth:wider.frame }))
		} finally { await page.close() }
	})
}

test('repeated load/dispose leaves no styles behind', async () => {
	const page = await browser.newPage({ viewport:{ width:1800, height:1000 } })
	try {
		await page.setContent(fixture('old'))
		for (let i = 0; i < 3; i++) {
			await activate(page)
			assertWide(await dimensions(page))
			assert.equal(await page.locator('style[data-hermes-plugin]').count(), 1)
			await page.evaluate(() => window.disposeWidePreviews())
			assert.equal((await dimensions(page)).frame, 640)
		}
	} finally { await page.close() }
})
