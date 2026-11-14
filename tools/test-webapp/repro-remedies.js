// Drive body: reproduce compaction duplicates in fresh sessions, then try plugin-reachable remedies in order.
const runs = Number(process.env.RUNS || 3)
const out = []
const sdk = () => page.evaluate(() => Boolean(window.__HERMES_PLUGIN_SDK__?.host))

const dupes = async () => {
	await page.getByRole('button', { name: /^Scroll to bottom/ }).click({ timeout: 300 }).catch(() => {})
	return page.evaluate(() => {
		const text = [...document.querySelectorAll('[data-slot=aui_assistant-message-content]')].map(n => n.innerText).join('\n')
		const counts = {}
		for (const tag of text.match(/\[[0-9a-f]{8}\]/g) || []) counts[tag] = (counts[tag] || 0) + 1
		const busy = [...document.querySelectorAll('button[aria-label]')].some(b => /stop|interrupt|cancel/i.test(b.getAttribute('aria-label')))
		return { n: Object.values(counts).filter(n => n > 1).length, len: text.length, busy }
	})
}

async function settle(quiet = 9000, max = 120000) {
	let last = null, since = Date.now(); const start = Date.now()
	while (Date.now() - start < max) {
		const s = await dupes()
		const key = `${s.len}|${s.busy}|${s.n}`
		if (key !== last) { last = key; since = Date.now() } else if (!s.busy && Date.now() - since > quiet) return s
		await page.waitForTimeout(400)
	}
	return dupes()
}

for (let r = 0; r < runs; r++) {
	await page.evaluate(() => { location.hash = '#/' })
	await page.waitForTimeout(2500)
	const box = page.locator('[contenteditable=true]').first()
	await box.click(); await page.keyboard.type(`Run ${r}: run the long scenario`); await page.keyboard.press('Enter')
	const settled = await settle()
	const entry = { r, sdk: await sdk(), session: await page.evaluate(() => window.__HERMES_PLUGIN_SDK__?.host?.state?.focusedStoredSessionId?.get?.() ?? null), afterTurn: settled.n }
	if (settled.n) {
		entry.shot = await shot(`compaction-dupes-${r}`)
		await page.evaluate(() => { window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')) })
		await page.waitForTimeout(5000)
		entry.afterFocusRefresh = (await dupes()).n
		if (entry.afterFocusRefresh) {
			entry.refreshInPlace = await page.evaluate(async id => {
				try { await window.__HERMES_PLUGIN_SDK__.host.openSession(id, { refreshInPlace: true }); return 'ok' } catch (e) { return String(e) }
			}, entry.session)
			await page.waitForTimeout(6000)
			entry.afterRefreshInPlace = (await dupes()).n
		}
		if (entry.afterRefreshInPlace) {
			const url = page.url()
			await page.evaluate(() => { location.hash = '#/' }); await page.waitForTimeout(1500); await page.goto(url); await page.waitForTimeout(5000)
			entry.afterSwitch = (await dupes()).n
		}
	}
	out.push(entry)
}
return out
