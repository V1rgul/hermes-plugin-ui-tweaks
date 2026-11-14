// Adapted from hermes-plugin-t3sidebar's persistent per-checkout browser driver.
import { access, mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const executable = process.env.CHROMIUM_EXECUTABLE || chromium.executablePath()
if (process.argv[2] === '--chromium') {
	await access(executable).catch(() => { throw new Error('Run npx playwright install chromium, or set CHROMIUM_EXECUTABLE') })
	process.stdout.write(executable)
} else {
	const port = process.env.UI_WEBAPP_CDP_PORT
	const shots = process.env.UI_WEBAPP_SHOTS
	const body = process.argv[2]
	if (!port || !shots || !body) throw new Error("Use webapp.sh drive '<async body using page, context, shot>'")
	const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
	try {
		const context = browser.contexts()[0]
		const page = context.pages().find(candidate => !candidate.url().startsWith('devtools:')) || await context.newPage()
		const cdp = await context.newCDPSession(page)
		await cdp.send('Network.enable')
		await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
		await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true })
		await page.setViewportSize({ width: 1440, height: 900 })
		const shot = async (name = 'shot') => {
			if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error('Screenshot names must contain only letters, digits, _ or -')
			// The shell can be interactive underneath the startup fade; capture only after it leaves.
			await page.getByText(/^connecting[.… ]*$/i).waitFor({ state: 'hidden' })
			await mkdir(shots, { recursive: true })
			const path = `${shots}/${name}.png`
			await page.screenshot({ path })
			return path
		}
		const AsyncFunction = (async () => {}).constructor
		const result = await new AsyncFunction('page', 'context', 'shot', body)(page, context, shot)
		if (result !== undefined) console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 2))
	} finally {
		// connectOverCDP's close disconnects this client; the browser and its profile stay alive.
		await browser.close()
	}
}
