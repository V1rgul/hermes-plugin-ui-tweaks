// Drive body for `webapp.sh drive "$(cat tools/test-webapp/repro-dupes.js)"`.
// Every mock-model prose block carries a unique [xxxx] tag, so a tag rendered twice is a duplicate.
// Env: TURNS, SCEN (comma list of prompts keywords), ACTIONS (comma list rotated per turn).
const turns = Number(process.env.TURNS || 6)
const scenarios = (process.env.SCEN || 'background,long,multi,silent,parallel').split(',')
const actions = (process.env.ACTIONS || 'none').split(',')
const log = []
if (process.env.FRESH) { await page.evaluate(() => { location.hash = '#/' }); await page.waitForTimeout(2000) }

const snapshot = async () => {
	await page.getByRole('button', { name: /^Scroll to bottom/ }).click({ timeout: 300 }).catch(() => {})
	return page.evaluate(() => {
	const text = [...document.querySelectorAll('[data-slot=aui_assistant-message-content]')].map(n => n.innerText).join('\n')
	const counts = {}
	for (const tag of text.match(/\[[0-9a-f]{8}\]/g) || []) counts[tag] = (counts[tag] || 0) + 1
	const busy = [...document.querySelectorAll('button[aria-label]')].some(b => /stop|interrupt|cancel/i.test(b.getAttribute('aria-label')))
	return { dupes: Object.entries(counts).filter(([, n]) => n > 1).map(([t, n]) => `${t}x${n}`), tags: Object.keys(counts).length, busy, len: text.length }
	})
}

async function send(prompt) {
	const box = page.locator('[contenteditable=true]').first()
	await box.click()
	await page.keyboard.type(prompt)
	await page.keyboard.press('Enter')
}

// Sample until not busy and transcript text unchanged for `quiet` ms; record any duplicate ever seen.
async function settle(quiet = 11000, max = 90000, during) {
	const seen = new Set()
	let firstAt = null, lastAt = null, firstShot = null
	let last = null, stableSince = Date.now(), start = Date.now(), fired = false
	while (Date.now() - start < max) {
		const s = await snapshot()
		s.dupes.forEach(d => seen.add(d))
		if (s.dupes.length) {
			lastAt = Date.now() - start
			if (firstAt === null) { firstAt = lastAt; firstShot = await shot(`dupe-live-${Date.now()}`) }
		}
		if (during && !fired && Date.now() - start > during.after) { fired = true; await during.run() }
		const key = `${s.len}|${s.busy}`
		if (key !== last) { last = key; stableSince = Date.now() }
		else if (!s.busy && Date.now() - stableSince > quiet) return { transient: [...seen], final: s.dupes, tags: s.tags, firstAt, lastAt, firstShot }
		await page.waitForTimeout(400)
	}
	const s = await snapshot()
	return { transient: [...seen], final: s.dupes, tags: s.tags, firstAt, lastAt, firstShot, timeout: true }
}

async function switchAway(ms = 1500) {
	const url = page.url()
	await page.evaluate(() => { location.hash = '#/' })
	await page.waitForTimeout(ms)
	await page.goto(url)
}

for (let i = 0; i < turns; i++) {
	const scenario = scenarios[i % scenarios.length]
	const action = actions[i % actions.length]
	const during = action === 'midturn-switch' ? { after: 2500, run: () => switchAway() }
		: action === 'midturn-send' ? { after: 2500, run: () => send('Quick follow-up: run the silent checks') }
		: action === 'midturn-reload' ? { after: 2500, run: () => page.reload() }
		: null
	await send(`Turn ${i}: run the ${scenario} scenario`)
	const result = await settle(11000, 120000, during)
	if (action === 'switch') { await switchAway(); await page.waitForTimeout(3000); result.afterSwitch = (await snapshot()).dupes }
	if (action === 'reload') { await page.reload(); await page.waitForTimeout(5000); result.afterReload = (await snapshot()).dupes }
	const entry = { i, scenario, action, url: page.url().split('#')[1], ...result }
	if (entry.final.length) entry.shot = await shot(`dupe-final-${Date.now()}`)
	log.push(entry)
}
return log
