import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { before, after, test } from 'node:test'
import { activatePlugin } from './plugin-host.mjs'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const source = await readFile(process.env.PLUGIN_SOURCE || new URL('../plugin.js', import.meta.url), 'utf8')
let browser
before(async () => { browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) }) })
after(async () => { await browser?.close() })

// Copies the inspected native markup and caps (markdown-text.tsx media, approval.tsx, delegate.tsx with its styles.css 75%, artifact-card.tsx, mcp-setup-tool.tsx, connector-tool.tsx) as plain CSS; not a native Desktop build.
const fixtureHtml = `<!doctype html><html><head><style>
	body { margin: 0; font: 14px/20px system-ui; }
	[data-slot="aui_thread-content"] { display: flex; flex-direction: column; width: 1000px; }
	[data-slot="aui_assistant-message-content"] > * { display: block; }
	.max-w-md { max-width: 28rem; }
	.max-w-lg { max-width: 32rem; }
	.max-w-xl { max-width: 36rem; }
	.max-w-2xl { max-width: 42rem; }
	.w-full { width: 100%; }
	.block { display: block; }
	[data-slot="aui_assistant-message-content"] [data-slot="tool-block"][data-delegate-card] { width: 100%; max-width: 75%; }
	[data-connector-offer] { display: grid; }
</style></head><body><main data-slot="aui_thread-content">
	<article data-slot="aui_assistant-message-content">
		<div class="aui-md">
			<span id="audio" class="block max-w-md"><span>clip.mp3</span><audio class="block w-full" controls></audio></span>
			<span id="video" class="block max-w-2xl"><span>clip.mp4</span><video class="block w-full"></video></span>
		</div>
		<div id="delegate" data-slot="tool-block" data-delegate-card=""><div>Invented goal</div></div>
		<button id="artifact" type="button" class="w-full max-w-md" data-slot="aui_artifact-card">Invented artifact</button>
		<div id="mcp" class="max-w-lg" data-connector-offer><div data-slot="connector-card">server</div><p data-slot="mcp-launch-target">npx invented-server --flag</p></div>
		<div id="mcp-settled" class="max-w-lg" data-connector-offer><div>server connected</div></div>
		<div id="connector" class="max-w-lg" data-connector-offer><div data-slot="connector-card">Invented app</div></div>
		<div id="catalog" class="max-w-lg" data-catalog-card data-connector-offer><div>Invented catalog</div></div>
		<p id="prose" class="max-w-md">Ordinary capped prose.</p>
	</article>
	<section id="approval" class="w-full max-w-xl" data-slot="tool-approval-stack"><pre>invented --command</pre></section>
</main></body></html>`

const ids = ['audio', 'video', 'delegate', 'artifact', 'mcp', 'mcp-settled', 'connector', 'catalog', 'prose', 'approval']
async function widths(page) {
	return page.evaluate(ids => ({
		available: document.querySelector('[data-slot="aui_assistant-message-content"]').getBoundingClientRect().width,
		...Object.fromEntries(ids.map(id => [id, document.getElementById(id).getBoundingClientRect().width]))
	}), ids)
}

async function fixture(preferences) {
	const page = await browser.newPage({ viewport: { width: 1200, height: 900 } })
	await page.route('https://fixture.invalid/**', route => route.fulfill({ contentType: 'text/html', body: fixtureHtml }))
	await page.goto('https://fixture.invalid/')
	if (preferences) await page.evaluate(value => localStorage.setItem('hermes.plugin.hermes-wide-previews.preferences', JSON.stringify(value)), preferences)
	return page
}

const wide = ['audio', 'delegate', 'artifact', 'mcp', 'approval']
const kept = ['video', 'mcp-settled', 'connector', 'catalog', 'prose']

test('cards that only cut or wrap their content take the full width; others keep their caps', async () => {
	const page = await fixture()
	try {
		const native = await widths(page)
		for (const id of wide) assert.ok(native[id] < native.available, `${id} must be capped natively for this test to mean anything`)
		await activatePlugin(page, source)
		const after = await widths(page)
		for (const id of wide) assert.equal(after[id], after.available, `${id} must fill the message width`)
		for (const id of kept) assert.equal(after[id], native[id], `${id} must keep its native width`)
		await page.evaluate(() => window.disposePlugin())
		assert.deepEqual(await widths(page), native, 'disposal restores every native width')
	} finally { await page.close() }
})

test('the switch applies live and persists, previews included', async () => {
	const page = await fixture()
	try {
		const native = await widths(page)
		await activatePlugin(page, source)
		await page.evaluate(() => window.mountPluginSettings())
		const toggle = page.getByRole('switch', { name: 'Previews and cards: full width', exact: true })
		assert.equal(await toggle.getAttribute('aria-checked'), 'true', 'on by default')
		await toggle.click()
		assert.equal(await toggle.getAttribute('aria-checked'), 'false')
		const off = await widths(page)
		for (const id of ids) assert.equal(off[id], native[id], `${id} must return to its native width when switched off`)
		assert.equal(await page.evaluate(() => document.querySelector('style[data-hermes-plugin]').textContent.includes('hermes-inline-preview-size')), false, 'preview widening follows the same switch')
		await page.evaluate(() => window.disposePlugin())
		await activatePlugin(page, source)
		for (const id of wide) assert.equal((await widths(page))[id], native[id], `${id}: the off choice must survive a reload`)
		await page.evaluate(() => window.mountPluginSettings())
		await toggle.click()
		const on = await widths(page)
		for (const id of wide) assert.equal(on[id], on.available, `${id} must widen again when switched on`)
	} finally { await page.close() }
})
