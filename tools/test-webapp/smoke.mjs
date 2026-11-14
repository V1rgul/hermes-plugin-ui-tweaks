import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// Execute against the persistent real Webapp. No fixture DOM, SDK replacement or model request.
async function smoke(page, context, shot) {
	const check = (condition, message) => { if (!condition) throw new Error(message) }
	const preferencesKey = 'hermes.plugin.hermes-wide-previews.preferences'
	const disclosuresKey = 'hermes.desktop.toolDisclosure.v1'
	const hideDiffsKey = 'hermes.desktop.toolView.hideCodeDiffs'
	const decisionsKey = 'hermes.desktop.pluginDecisions.v2'
	const keys = [preferencesKey, disclosuresKey, hideDiffsKey, decisionsKey]
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
		await page.evaluate(({ preferencesKey, disclosuresKey, hideDiffsKey, decisionsKey }) => {
			localStorage.setItem(preferencesKey, JSON.stringify({ expandToolCalls: true, foldFileEdits: true }))
			localStorage.removeItem(disclosuresKey)
			localStorage.setItem(hideDiffsKey, 'false')
			const decisions = JSON.parse(localStorage.getItem(decisionsKey) || '{}')
			localStorage.setItem(decisionsKey, JSON.stringify({ ...decisions, 'hermes-wide-previews': true }))
		}, { preferencesKey, disclosuresKey, hideDiffsKey, decisionsKey })
		await page.reload()
		await ready()
		await route('/ui-tweaks-example-tools')
		await expanded(groupToggle(), true)
		await expanded(editToggle(), false)
		check(await page.locator('[data-tool-row]').count() >= 3, 'Real tool group must render its read/search rows and the separate edit')
		const indentation = await page.locator('[data-tool-group]').first().evaluate(el => {
			const summary = el.querySelector('[data-tool-summary]').getBoundingClientRect()
			const row = el.querySelector('[data-tool-row] > div:first-child').getBoundingClientRect()
			return row.x - summary.x
		})
		check(Math.abs(indentation - 16) < 1, `Tool indentation must be 16px, got ${indentation}`)
		report.checks.push('native tool group expanded, edit folded, rows indented 16px')
		const connectors = await page.locator('[data-tool-group]').first().evaluate(el => {
			const summary = el.querySelector('[data-tool-summary]').getBoundingClientRect()
			return { summaryBottom: summary.bottom, rows: Array.from(el.querySelectorAll(':scope > div > [data-tool-row]'), row => {
				const rect = row.getBoundingClientRect()
				const before = getComputedStyle(row, '::before')
				const after = getComputedStyle(row, '::after')
				return { content: before.content, top: rect.top + parseFloat(before.top), bottom: rect.top + parseFloat(before.top) + parseFloat(before.height), branch: rect.top + parseFloat(after.top), stroke: before.borderInlineStartWidth, branchStroke: after.borderBlockStartWidth, pointerEvents: before.pointerEvents }
			}) }
		})
		check(connectors.rows.length >= 2, 'Native group must expose multiple branches')
		check(Math.abs(connectors.rows[0].top - connectors.summaryBottom) < 1, 'Tree rail must join the native summary without a gap')
		for (const [index, line] of connectors.rows.entries()) {
			check(line.content === '""' && line.stroke === '1px' && line.branchStroke === '1px', 'Each native row must paint both connector strokes')
			check(line.pointerEvents === 'none', 'Connectors must not intercept native controls')
			if (index) check(Math.abs(connectors.rows[index - 1].bottom - line.top) < 1, 'Native tree rail must stay continuous between calls')
		}
		check(Math.abs(connectors.rows.at(-1).bottom - connectors.rows.at(-1).branch) < 1, 'Last native branch must end in an L')
		report.checks.push('continuous tree rail from summary to calls, final L, noninteractive decoration')
		report.treeScreenshot = await shot('integration-tool-tree')
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

		await route('/settings?tab=plugins&plugin=hermes-wide-previews%3Asettings')
		const expandSwitch = page.getByRole('switch', { name: 'Expand tool-call lists by default', exact: true })
		const foldSwitch = page.getByRole('switch', { name: 'Fold patches and file edits by default', exact: true })
		await expandSwitch.waitFor()
		check(await expandSwitch.getAttribute('aria-checked') === 'true', 'Native settings must show expand enabled')
		await expandSwitch.click()
		check(await expandSwitch.getAttribute('aria-checked') === 'false', 'Native switch must turn off')
		check(await foldSwitch.getAttribute('aria-checked') === 'true', 'Independent fold switch must stay on')
		await page.reload()
		await ready()
		await route('/settings?tab=plugins&plugin=hermes-wide-previews%3Asettings')
		await expandSwitch.waitFor()
		check(await expandSwitch.getAttribute('aria-checked') === 'false', 'Native SDK storage must persist the switch')
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
