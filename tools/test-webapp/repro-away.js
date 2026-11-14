// Drive body: background jobs finishing while the user works in another session, in a session past the 120-row tail page.
// Env: SETUP=1 (create sessions), FILL (many-turns for A), CYCLES, VARIANTS (watch,send-now), LATENCY (ms, optional).
const fs = await import('node:fs/promises')
const state = `${process.env.UI_WEBAPP_SHOTS}/../away-sessions.json`
const cycles = Number(process.env.CYCLES || 4)
const variants = (process.env.VARIANTS || 'watch,send-now').split(',')
const out = []
let { a, b } = process.env.SETUP ? {} : JSON.parse(await fs.readFile(state, 'utf8'))

if (process.env.LATENCY) {
	const cdp = await context.newCDPSession(page)
	await cdp.send('Network.enable')
	await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: Number(process.env.LATENCY), downloadThroughput: -1, uploadThroughput: -1 })
}

const snap = async () => {
	await page.getByRole('button', { name: /^Scroll to bottom/ }).click({ timeout: 300 }).catch(() => {})
	return page.evaluate(() => {
		const text = [...document.querySelectorAll('[data-slot=aui_assistant-message-content]')].filter(n => n.offsetParent).map(n => n.innerText).join('\n')
		const counts = {}
		for (const tag of text.match(/\[[0-9a-f]{8}\]/g) || []) counts[tag] = (counts[tag] || 0) + 1
		return { dupes: Object.entries(counts).filter(([, n]) => n > 1).map(([t]) => t), len: text.length }
	})
}

async function send(prompt) {
	const box = page.locator('[contenteditable=true]:visible').first()
	await box.click()
	await page.keyboard.type(prompt)
	await page.keyboard.press('Enter')
}

async function settle(quiet, max = 90000) {
	const seen = new Set(); let last = -1, since = Date.now(), firstShot = null; const start = Date.now()
	while (Date.now() - start < max) {
		const s = await snap()
		s.dupes.forEach(d => seen.add(d))
		if (s.dupes.length && !firstShot) firstShot = await shot(`away-live-${Date.now()}`)
		if (s.len !== last) { last = s.len; since = Date.now() } else if (Date.now() - since > quiet) return { transient: [...seen], final: s.dupes, firstShot }
		await page.waitForTimeout(400)
	}
	const s = await snap()
	return { transient: [...seen], final: s.dupes, firstShot, timeout: true }
}

// TAB_A/TAB_B: switch by clicking workspace tabs (both sessions stay mounted) instead of re-routing one view.
async function open(url) {
	const tab = url === a ? process.env.TAB_A : process.env.TAB_B
	if (tab) await page.getByRole('tab', { name: new RegExp(`^${tab}$`, 'i') }).click()
	else await page.evaluate(u => { location.hash = u.split('#')[1] }, url)
	await page.waitForTimeout(2500)
}

if (process.env.SETUP) {
	await page.evaluate(() => { location.hash = '#/' }); await page.waitForTimeout(2500)
	for (let i = 0; i < Number(process.env.FILL || 9); i++) { await send(`Fill ${i}: run the many scenario`); await settle(4000) }
	a = page.url()
	await page.evaluate(() => { location.hash = '#/' }); await page.waitForTimeout(2500)
	await send('Session B: run the parallel scenario'); await settle(4000)
	b = page.url()
	await fs.writeFile(state, JSON.stringify({ a, b }))
	return { a, b }
}

for (let i = 0; i < cycles && process.env.MODE === 'slow'; i++) {
	// Leave A during its 25 s foreground tool, by tab or by route, then come back before it ends.
	const how = (process.env.SWITCH || 'tab,route').split(',')[i % (process.env.SWITCH || 'tab,route').split(',').length]
	const away = Number((process.env.AWAY || '4,12').split(',')[i % (process.env.AWAY || '4,12').split(',').length])
	await open(a)
	await send(`Cycle ${i}: run the slow scenario steps=${process.env.STEPS || 1}`)
	await page.waitForTimeout(6000)
	if (how === 'route') await page.evaluate(() => { location.hash = '#/' })
	else await open(b)
	await page.waitForTimeout(away * 1000)
	if (how === 'route') { await page.evaluate(u => { location.hash = u.split('#')[1] }, a); await page.waitForTimeout(1000) } else await open(a)
	const result = await settle(9000, 120000)
	const entry = { i, how, away, ...result }
	if (result.final.length) entry.shot = await shot(`slow-final-${i}`)
	out.push(entry)
}
for (let i = 0; i < cycles && process.env.MODE !== 'slow'; i++) {
	const variant = variants[i % variants.length]
	await open(a)
	const before = (await snap()).dupes
	await send(`Cycle ${i}: run the away scenario`)
	await settle(3000)
	await open(b)
	await send(`Cycle ${i} in B: run the parallel scenario`)
	await page.waitForTimeout(22000)
	await open(a)
	if (variant === 'send-now') await send(`Cycle ${i} follow-up: run the many scenario`)
	const result = await settle(9000)
	const entry = { i, variant, before, ...result }
	if (result.final.length) entry.shot = await shot(`away-final-${i}`)
	out.push(entry)
}
return out
