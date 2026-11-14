import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// Execute against the persistent real Webapp. No fixture DOM, SDK replacement or model request.
async function smoke(page, context, shot) {
	const check = (condition, message) => { if (!condition) throw new Error(message) }
	const preferencesKey = 'hermes.plugin.hermes-wide-previews.preferences'
	const disclosuresKey = 'hermes.desktop.toolDisclosure.v1'
	const hideDiffsKey = 'hermes.desktop.toolView.hideCodeDiffs'
	const decisionsKey = 'hermes.desktop.pluginDecisions.v2'
	const drawersKey = 'hermes.desktop.collapsedStatusDrawers.v1'
	const opensKey = 'hermes.plugin.hermes-wide-previews.openStatusDrawers'
	const queueKey = 'hermes.desktop.composerQueue.v1'
	const keys = [preferencesKey, disclosuresKey, hideDiffsKey, decisionsKey, drawersKey, opensKey, queueKey]
	const saved = await page.evaluate(keys => Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)])), keys)
	const errors = []
	page.on('pageerror', error => errors.push(error.message))
	const report = { environment: 'real Hermes Webapp', data: 'invented; no live model turns', checks: [] }
	const style = page.locator('style[data-hermes-plugin="hermes-wide-previews"]')
	const ready = async () => {
		await style.waitFor({ state: 'attached', timeout: 60000 })
		await page.getByRole('button', { name: /^backend v/ }).waitFor({ timeout: 60000 })
		const later = page.getByRole('button', { name: "I'll choose a provider later", exact: true })
		// The credential check can finish after the gateway connects. A fresh profile must wait for its picker.
		const skipped = await page.evaluate(() => localStorage.getItem('hermes-onboarding-skipped-v1') === '1')
		if (!skipped) await later.waitFor({ state: 'visible', timeout: 60000 })
		if (await later.isVisible()) await later.click()
		const decline = page.getByRole('button', { name: 'No thanks', exact: true })
		if (await decline.isVisible()) await decline.click()
	}
	const route = async hash => {
		await page.evaluate(hash => { location.hash = hash }, hash)
	}
	const groupToggle = () => page.locator('[data-tool-group] > [data-tool-summary] button[aria-expanded]').first()
	const statusToggle = () => page.locator('[data-slot="status-drawer-toggle"]').first()
	const queueToggle = () => page.locator('[data-slot="composer-status-stack"] .status-section-trigger:has(.codicon-layers, .codicon-debug-pause)').first()
	const queuedTextToggle = () => page.locator('[data-slot="status-row"]').filter({ hasText: 'Invented queued prompt 1 — renderer test only' }).locator('.status-row-actions button[aria-expanded]').first()
	const historyExpanded = async expected => {
		await page.getByText('Invented long history prompt — renderer test only', { exact: false }).waitFor()
		await page.waitForFunction(expected => {
			const el = document.querySelector('[data-slot="aui_user-message-root"] .sticky-human-clamp')
			return el && (el.clientHeight >= el.scrollHeight) === expected
		}, expected)
	}
	const setQueue = async count => {
		// Invented input through the real cross-window queue store, not replacement DOM/SDK or a model turn.
		// Server-owned rows are excluded from both native auto-drainers; never submit these test prompts.
		await page.evaluate(({ key, count }) => {
			const oldValue = localStorage.getItem(key)
			const state = JSON.parse(oldValue || '{}')
			if (count) state['ui-tweaks-example-preview'] = Array.from({ length: count }, (_, index) => ({
				id: `ui-tweaks-queue-${index}`, text: `Invented queued prompt ${index + 1} — renderer test only\n` + Array.from({ length: 8 }, (_, line) => `Long queued text line ${line + 1}`).join('\n'), attachments: [], queuedAt: Date.now(), serverStatus: 'queued'
			}))
			else delete state['ui-tweaks-example-preview']
			const newValue = JSON.stringify(state)
			localStorage.setItem(key, newValue)
			window.dispatchEvent(new StorageEvent('storage', { key, oldValue, newValue, storageArea: localStorage, url: location.href }))
		}, { key: queueKey, count })
	}
	const editToggle = () => page.locator('[data-tool-row]').filter({ hasText: 'example.txt' }).filter({ has: page.locator('button[aria-expanded]') }).last().locator('button[aria-expanded]').first()
	const expanded = async (locator, expected) => {
		await locator.waitFor()
		await page.waitForFunction(({ selector, expected }) => document.querySelector(selector)?.getAttribute('aria-expanded') === String(expected), { selector: await locator.evaluate(el => {
			// A test-owned attribute only identifies the real control; it does not replace its behavior.
			el.setAttribute('data-smoke-toggle', 'target')
			return '[data-smoke-toggle="target"]'
		}), expected })
		await locator.evaluate(el => el.removeAttribute('data-smoke-toggle'))
	}
	try {
		await page.evaluate(({ preferencesKey, disclosuresKey, hideDiffsKey, decisionsKey, drawersKey, opensKey, queueKey }) => {
			localStorage.setItem(preferencesKey, JSON.stringify({ expandToolCalls: true, foldFileEdits: true, foldStatusStack: true, expandQueuedPrompts: true, expandQueuedPromptText: true, expandHistoryPrompts: true }))
			localStorage.removeItem(disclosuresKey)
			localStorage.removeItem(drawersKey)
			localStorage.removeItem(opensKey)
			localStorage.removeItem(queueKey)
			localStorage.setItem(hideDiffsKey, 'false')
			const decisions = JSON.parse(localStorage.getItem(decisionsKey) || '{}')
			localStorage.setItem(decisionsKey, JSON.stringify({ ...decisions, 'hermes-wide-previews': true }))
		}, { preferencesKey, disclosuresKey, hideDiffsKey, decisionsKey, drawersKey, opensKey, queueKey })
		await page.reload()
		await ready()
		await route('/ui-tweaks-example-tools')
		await expanded(groupToggle(), true)
		await expanded(editToggle(), false)
		check(await page.locator('[data-tool-row]').count() >= 3, 'Real tool group must render its read/search rows and the separate edit')
		const indentation = await page.locator('[data-tool-group]').first().evaluate(el => {
			const summary = el.querySelector('[data-tool-summary]').getBoundingClientRect()
			const row = el.querySelector('[data-tool-row]').getBoundingClientRect()
			return row.x - summary.x
		})
		check(Math.abs(indentation - 16) < 1, `Tool indentation must be 16px, got ${indentation}`)
		report.checks.push('native tool group expanded, edit folded, rows indented 16px')
		await editToggle().click()
		await page.locator('[data-tool-row] [data-slot="file-diff-panel"]').waitFor()
		check((await page.locator('[data-tool-row] [data-slot="file-diff-panel"]').innerText()).includes('After the invented edit.'), 'Native diff contents must reopen')
		await groupToggle().click()
		await expanded(groupToggle(), false)
		await page.reload()
		await ready()
		await route('/ui-tweaks-example-tools')
		await expanded(groupToggle(), false)
		await expanded(editToggle(), true)
		report.checks.push('manual group/diff choices survive a real app reload')
		report.toolsScreenshot = await shot('integration-tools')

		await expanded(statusToggle(), false)
		await page.locator('.coding-status-bar').waitFor({ state: 'attached' })
		check(await page.locator('.coding-status-bar').isVisible() === false, 'Folded native drawer must hide the branch row')
		await statusToggle().click()
		await expanded(statusToggle(), true)
		await page.locator('.coding-status-bar').waitFor({ state: 'visible' })
		check((await page.locator('.coding-status-bar').innerText()).includes('ui-tweaks-test'), 'Grip must reopen the real test branch')
		await page.reload()
		await ready()
		await route('/ui-tweaks-example-tools')
		await expanded(statusToggle(), true)
		await route('/ui-tweaks-example-preview')
		await expanded(statusToggle(), false)
		await route('/ui-tweaks-example-tools')
		await expanded(statusToggle(), true)
		report.checks.push('native branch drawer starts folded, reopens with its grip, and preserves per-session manual opens across reload/navigation')

		await route('/ui-tweaks-example-preview')
		await page.locator('iframe[src*="/assets/webapp-preview.html"]').waitFor({ state: 'attached' })
		await expanded(statusToggle(), false)
		await setQueue(1)
		await expanded(statusToggle(), true)
		await expanded(queueToggle(), true)
		await page.getByText('Invented queued prompt 1 — renderer test only', { exact: false }).waitFor()
		await expanded(queuedTextToggle(), true)
		await queueToggle().click()
		await statusToggle().click()
		await expanded(statusToggle(), false)
		await setQueue(2)
		await expanded(statusToggle(), true)
		await expanded(queueToggle(), true)
		await page.getByText('Invented queued prompt 2 — renderer test only', { exact: false }).waitFor()
		check(await page.evaluate(key => (JSON.parse(localStorage.getItem(key) || '[]')).every(scope => JSON.parse(scope)[3] !== 'ui-tweaks-example-preview'), opensKey), 'Automatic queue reveals must not create a saved manual-open choice')
		await setQueue(0)
		await expanded(statusToggle(), false)
		report.checks.push('adding seeded queue entries reveals the native drawer/list, another addition reopens them, and emptying refolds without creating manual-open preferences')

		await route('/settings?tab=plugins&plugin=hermes-wide-previews%3Asettings')
		const expandSwitch = page.getByRole('switch', { name: 'Expand tool-call lists by default', exact: true })
		const foldSwitch = page.getByRole('switch', { name: 'Fold patches and file edits by default', exact: true })
		const statusSwitch = page.getByRole('switch', { name: 'Fold status stack by default', exact: true })
		const queueSwitch = page.getByRole('switch', { name: 'Expand queued-prompts section by default', exact: true })
		const queuedTextSwitch = page.getByRole('switch', { name: 'Expand long queued-prompt text by default', exact: true })
		const historySwitch = page.getByRole('switch', { name: 'Expand long messages in history by default', exact: true })
		await expandSwitch.waitFor()
		check(await expandSwitch.getAttribute('aria-checked') === 'true', 'Native settings must show expand enabled')
		await expandSwitch.click()
		check(await expandSwitch.getAttribute('aria-checked') === 'false', 'Native switch must turn off')
		check(await foldSwitch.getAttribute('aria-checked') === 'true', 'Independent fold switch must stay on')
		check(await statusSwitch.getAttribute('aria-checked') === 'true', 'Status-stack default must start enabled')
		await statusSwitch.click()
		check(await statusSwitch.getAttribute('aria-checked') === 'false', 'Status-stack switch must turn off independently')
		for (const control of [queueSwitch, queuedTextSwitch, historySwitch]) check(await control.getAttribute('aria-checked') === 'true', 'Each prompt setting must start enabled independently')
		await queuedTextSwitch.click()
		await historySwitch.click()
		check(await queueSwitch.getAttribute('aria-checked') === 'true', 'Disabling text defaults must not disable queue expansion')
		await page.reload()
		await ready()
		await route('/settings?tab=plugins&plugin=hermes-wide-previews%3Asettings')
		await expandSwitch.waitFor()
		check(await expandSwitch.getAttribute('aria-checked') === 'false', 'Native SDK storage must persist the switch')
		check(await statusSwitch.getAttribute('aria-checked') === 'false', 'Native SDK storage must persist the status-stack switch')
		for (const control of [queuedTextSwitch, historySwitch]) check(await control.getAttribute('aria-checked') === 'false', 'Text switches must persist independently')
		await route('/ui-tweaks-example-long-prompts')
		await historyExpanded(false)
		await route('/ui-tweaks-example-preview')
		await page.locator('iframe[src*="/assets/webapp-preview.html"]').waitFor({ state: 'attached' })
		await setQueue(1)
		await expanded(statusToggle(), true)
		await expanded(queueToggle(), true)
		await expanded(queuedTextToggle(), false)
		report.checks.push('queue list expands with status folding disabled while long queued text and history remain independently collapsed')
		await route('/settings?tab=plugins&plugin=hermes-wide-previews%3Asettings')
		await queueSwitch.waitFor()
		await queueSwitch.click()
		await queuedTextSwitch.click()
		await historySwitch.click()
		await route('/ui-tweaks-example-preview')
		await page.locator('iframe[src*="/assets/webapp-preview.html"]').waitFor({ state: 'attached' })
		await expanded(queueToggle(), false)
		await queueToggle().click()
		await expanded(queuedTextToggle(), true)
		await setQueue(0)
		await expanded(statusToggle(), true)
		await route('/ui-tweaks-example-long-prompts')
		await historyExpanded(true)
		check(await page.locator('[data-slot="aui_edit-composer-root"]').count() === 0, 'Expanding history must not open the native edit composer')
		report.checks.push('long queued text does not open its closed list; long history expands without triggering editing')
		await route('/settings?tab=plugins&plugin=hermes-wide-previews%3Asettings')
		await queueSwitch.waitFor()
		await queueSwitch.click()
		report.settingsScreenshot = await shot('integration-settings')
		report.checks.push('real SDK settings render, independent switch updates and reload persistence')

		await route('/ui-tweaks-example-preview')
		const frame = page.locator('iframe[src*="/assets/webapp-preview.html"]')
		await frame.waitFor()
		await frame.scrollIntoViewIfNeeded()
		// The real Webapp's served bridge contains a second, sandboxed document frame.
		const documentFrame = page.frameLocator('iframe[src*="/assets/webapp-preview.html"]').frameLocator('iframe')
		const button = documentFrame.getByRole('button', { name: 'Clicks: 0', exact: true })
		await button.click()
		const widths = () => frame.evaluate(el => {
			const message = el.closest('[data-slot="aui_assistant-message-content"]')
			const css = getComputedStyle(message)
			return { frame: el.getBoundingClientRect().width, available: message.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight) }
		})
		report.preview = await widths()
		check(Math.abs(report.preview.frame - report.preview.available) < 1, `Preview must fill its real content box: ${JSON.stringify(report.preview)}`)
		for (const width of [800, 1600]) {
			await page.setViewportSize({ width, height: 900 })
			await page.waitForFunction(() => {
				const el = document.querySelector('iframe[src*="/assets/webapp-preview.html"]')
				if (!el) return false
				const message = el.closest('[data-slot="aui_assistant-message-content"]')
				const css = getComputedStyle(message)
				return Math.abs(el.getBoundingClientRect().width - (message.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight))) < 1
			})
			check(await documentFrame.getByRole('button', { name: 'Clicks: 1', exact: true }).count() === 1, 'Resizing must retain preview state')
		}
		report.checks.push('native preview fills its message at wide/narrow sizes without losing interaction state')
		await page.setViewportSize({ width: 1440, height: 900 })
		report.previewScreenshot = await shot('integration-preview')
		check(errors.length === 0, `Uncaught renderer errors: ${errors.join('; ')}`)
		report.checks.push('no uncaught renderer errors')
		return report
	} finally {
		await route('/settings?tab=plugins&plugin=hermes-wide-previews%3Asettings')
		await page.getByRole('switch', { name: 'Fold status stack by default', exact: true }).waitFor()
		await page.evaluate(saved => {
			for (const [key, value] of Object.entries(saved)) {
				if (value === null) localStorage.removeItem(key)
				else localStorage.setItem(key, value)
			}
		}, saved)
		await page.setViewportSize({ width: 1440, height: 900 })
		await page.reload()
	}
}

const script = fileURLToPath(new URL('./webapp.sh', import.meta.url))
try {
	const output = execFileSync('sh', [script, 'drive', `return await (${smoke.toString()})(page, context, shot)`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 150000 })
	process.stdout.write(output)
} catch (error) {
	process.stderr.write(error.stderr?.toString() || error.message)
	process.exitCode = 1
}
