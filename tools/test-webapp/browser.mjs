import { chromium } from 'playwright'

const [profile, port] = process.argv.slice(2)
if (!profile || !port) throw new Error('Use webapp.sh browser')
// A persistent Playwright owner gives the launcher a stable PID/argv to verify before stopping.
// Chromium rewrites its own /proc command line into one string on some Linux builds.
const context = await chromium.launchPersistentContext(profile, {
	headless: true,
	executablePath: process.env.CHROMIUM_EXECUTABLE || chromium.executablePath(),
	viewport: { width: 1440, height: 900 },
	args: ['--no-sandbox', '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${port}`]
})
process.once('SIGTERM', () => { context.close().catch(() => {}) })
process.once('SIGINT', () => { context.close().catch(() => {}) })
await new Promise(resolve => context.once('close', resolve))
