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
		// The credential check can finish after the gateway connects. A fresh profile must wait for its picker; a profile with a configured provider never shows it.
		const skipped = await page.evaluate(() => localStorage.getItem('hermes-onboarding-skipped-v1') === '1' || localStorage.getItem('hermes-desktop-onboarded-v1') !== null)
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
	// Clicking the sent prompt opens the native inline editor; the plugin only raises that editor's cap.
	const editBoxTall = async expected => {
		await historyExpanded(false)
		await page.locator('[data-slot="aui_user-message-root"] button.composer-human-message').first().click()
		const editor = page.locator('[data-slot="aui_edit-composer-root"] .ui-prompt-input-editor__input').first()
		await editor.waitFor()
		const { max, height, scroll, tall } = await editor.evaluate(el => ({ max: parseFloat(getComputedStyle(el).maxHeight), height: el.clientHeight, scroll: el.scrollHeight, tall: Math.min(36 * parseFloat(getComputedStyle(document.documentElement).fontSize), innerHeight * 0.7) }))
		check(Math.abs(max - (expected ? tall : 192)) < 1, `The prompt edit box cap must be ${expected ? 'raised' : 'native'}: ${max}px`)
		if (expected) check(height === scroll && height > 192, `The seeded prompt must fit the raised edit box: ${height}/${scroll}px`)
		await page.keyboard.press('Escape')
		await page.locator('[data-slot="aui_edit-composer-root"]').waitFor({ state: 'detached' })
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
			localStorage.setItem(preferencesKey, JSON.stringify({ expandToolCalls: true, foldFileEdits: true, foldStatusStack: true, expandQueuedPrompts: true, expandQueuedPromptText: true, tallerPromptEditor: true }))
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
			const row = el.querySelector('[data-tool-row] > div:first-child').getBoundingClientRect()
			return row.x - summary.x
		})
		check(Math.abs(indentation - 16) < 1, `Tool indentation must be 16px, got ${indentation}`)
		report.checks.push('native tool group expanded, edit folded, rows indented 16px')
		// Hit tests need the startup Connecting overlay gone: it covers the shell while the app underneath is already interactive.
		await page.getByText(/^connecting[.… ]*$/i).waitFor({ state: 'hidden' })
		const connectors = await page.locator('[data-tool-group]').first().evaluate(el => {
			const summary = el.querySelector('[data-tool-summary]')
			const toggle = summary.querySelector('button[aria-expanded]')
			const at = toggle.getBoundingClientRect()
			const box = getComputedStyle(toggle, '::before')
			const boxRect = { left: at.left + parseFloat(box.left), top: at.top + parseFloat(box.top), width: parseFloat(box.width), height: parseFloat(box.height) }
			const center = { x: boxRect.left + boxRect.width / 2, y: boxRect.top + boxRect.height / 2 }
			const first = el.querySelector(':scope > div > [data-tool-row] button[aria-expanded]')
			const firstAt = first.getBoundingClientRect()
			return {
				summaryHeight: summary.getBoundingClientRect().height,
				groupTop: el.getBoundingClientRect().top,
				box: boxRect,
				boxHit: toggle.contains(document.elementFromPoint(center.x, center.y)),
				hitTag: (({ tagName, className, dataset }) => `${tagName} ${String(className).slice(0, 60)} ${JSON.stringify(dataset)}`)(document.elementFromPoint(center.x, center.y) || { tagName: 'none', className: '', dataset: {} }),
				firstHit: first.contains(document.elementFromPoint(firstAt.left + 4, firstAt.top + firstAt.height / 2)),
				name: toggle.textContent.trim(),
				rows: Array.from(el.querySelectorAll(':scope > div > [data-tool-row]'), row => {
					const rect = row.getBoundingClientRect()
					const before = getComputedStyle(row, '::before')
					const after = getComputedStyle(row, '::after')
					return { top: rect.top, content: before.content, railTop: rect.top + parseFloat(before.top), bottom: rect.top + parseFloat(before.top) + parseFloat(before.height), branch: rect.top + parseFloat(after.top), stroke: before.borderInlineStartWidth, branchStroke: after.borderBlockStartWidth, pointerEvents: before.pointerEvents }
				})
			}
		})
		check(connectors.rows.length >= 2, 'Native group must expose multiple branches')
		check(connectors.summaryHeight === 0 && Math.abs(connectors.rows[0].top - connectors.groupTop) < 1, 'An open list must drop its summary line and start with its first call')
		check(connectors.boxHit && connectors.name.length > 0, `The minus box must be the native, still labelled summary toggle, got ${JSON.stringify({ box: connectors.box, hit: connectors.boxHit, name: connectors.name, hitTag: connectors.hitTag })}`)
		check(connectors.firstHit, 'The hidden summary must not cover the first call’s toggle')
		check(Math.abs(connectors.rows[0].branch - (connectors.box.top + connectors.box.height / 2)) < 1, 'The box must sit level with the first call')
		check(Math.abs(connectors.rows[0].railTop - (connectors.box.top + connectors.box.height)) < 1, 'Tree rail must start at the box without a gap')
		for (const [index, line] of connectors.rows.entries()) {
			check(line.content === '""' && line.stroke === '1px' && line.branchStroke === '1px', 'Each native row must paint both connector strokes')
			check(line.pointerEvents === 'none', 'Connectors must not intercept native controls')
			if (index) check(Math.abs(connectors.rows[index - 1].bottom - line.railTop) < 1, 'Native tree rail must stay continuous between calls')
		}
		check(Math.abs(connectors.rows.at(-1).bottom - connectors.rows.at(-1).branch) < 1, 'Last native branch must end in an L')
		report.checks.push('open list drops its summary for a minus box on a continuous tree rail, final L, noninteractive decoration')
		const sizes = await page.locator('[data-tool-group]').first().evaluate(el => {
			// A probe in the message content resolves Desktop's own token there, outside the tool blocks.
			const probe = document.createElement('span')
			probe.style.fontSize = 'var(--conversation-tool-font-size)'
			el.parentElement.append(probe)
			const native = parseFloat(getComputedStyle(probe).fontSize)
			probe.remove()
			const labelFont = root => parseFloat(getComputedStyle(Array.from(root.querySelectorAll('span')).find(span => !span.childElementCount && span.textContent.trim())).fontSize)
			const edit = el.parentElement.querySelector(':scope > [data-tool-row]')
			return { native, rowFont: labelFont(el.querySelector(':scope > div > [data-tool-row]')), editFont: labelFont(edit), editGap: edit.getBoundingClientRect().top - el.getBoundingClientRect().bottom }
		})
		check(Math.abs(sizes.rowFont / sizes.native - 10 / 11) < 0.01 && Math.abs(sizes.editFont - sizes.rowFont) < 0.01, `Tool calls must run one native step smaller, inside and outside lists, got ${JSON.stringify(sizes)}`)
		check(Math.abs(sizes.editGap) < 0.5, `The edit after the list must touch it, got ${sizes.editGap}`)
		report.checks.push('tool calls one native step smaller, adjacent tool blocks gapless')
		const times = await page.locator('[data-slot="aui_assistant-message-content"]').first().evaluate(content => {
			const stamp = content.querySelector(':scope > [data-slot="timeline-timestamp"]')
			if (!stamp) return null
			const prose = stamp.nextElementSibling
			const range = document.createRange()
			range.selectNodeContents(prose)
			const line = Array.from(range.getClientRects()).find(rect => rect.width && rect.height < 40)
			const at = stamp.getBoundingClientRect()
			const footer = content.parentElement.querySelector(':scope > [data-slot="timeline-timestamp"]')
			const summaryTime = content.querySelector('[data-tool-row] [data-slot="timeline-timestamp"]')
			return { float: getComputedStyle(stamp).float, right: at.right, contentRight: content.getBoundingClientRect().right, level: Math.abs((at.top + at.bottom) / 2 - (line.top + line.bottom) / 2), footerHeight: footer?.getBoundingClientRect().height, callTimeRight: summaryTime?.getBoundingClientRect().right }
		})
		check(times !== null, 'The seed enables display.timestamps; rerun `npm run webapp -- seed` and reload')
		check(times.float !== 'none' && Math.abs(times.right - times.contentRight) < 1 && times.level < 2, `Prose times must share the first line at its end, got ${JSON.stringify(times)}`)
		check(times.footerHeight === 0, 'The message time must not take its own line')
		check(Math.abs(times.callTimeRight - times.right) < 1, 'Prose and call times must share one end column')
		report.checks.push('prose and message times share existing lines, in the tool rows’ end column')
		report.treeScreenshot = await shot('integration-tool-tree')
		await route('/ui-tweaks-example-first-blocks')
		await page.getByText('Invented text after the math.').waitFor()
		await page.locator('[data-slot="aui_assistant-message-content"] iframe').first().waitFor()
		report.firstBlocks = await page.evaluate(() => Array.from(document.querySelectorAll('[data-slot="aui_assistant-message-content"] > [data-slot="timeline-timestamp"] + .aui-md'), md => {
			const block = md.firstElementChild.firstElementChild
			const at = block.getBoundingClientRect()
			return { block: block.dataset.slot || block.tagName, width: at.width, contentWidth: md.getBoundingClientRect().width, top: at.top, stampBottom: md.previousElementSibling.getBoundingClientRect().bottom }
		}))
		check(report.firstBlocks.length === 5, `The seeded opening blocks must render: ${JSON.stringify(report.firstBlocks)}`)
		for (const box of report.firstBlocks.filter(box => box.block !== 'BLOCKQUOTE')) check(Math.abs(box.width - box.contentWidth) < 1 && box.top >= box.stampBottom - 0.5, `A code card, table, preview or display math opening a text block must keep the full width below the time: ${JSON.stringify(box)}`)
		report.checks.push('code cards, tables, previews and display math that open a text block keep the full width')
		report.firstBlocksScreenshot = await shot('integration-first-blocks')
		await route('/ui-tweaks-example-tools')
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

		const details = async () => {
			await route('/ui-tweaks-example-long-output')
			await page.getByText('Invented history for the tool detail height check', { exact: false }).waitFor()
			for (const name of ['seq 80', 'long.ts']) {
				const toggle = page.locator('[data-tool-row]').filter({ hasText: name }).locator('button[aria-expanded]').first()
				if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click()
				await expanded(toggle, true)
			}
			await page.locator('[data-tool-row] [data-slot="file-diff-panel"]').waitFor()
			// Wait for the highlighted renderer, so the measured box is the one code-file diffs use.
			await page.waitForFunction(() => document.querySelector('[data-tool-row] [data-slot="file-diff-panel"] .shiki, [data-tool-row] [data-slot="file-diff-panel"] [style*="color"]'))
			return page.evaluate(() => Array.from(document.querySelectorAll('[data-tool-row] :is(pre.max-h-20, [data-slot="file-diff-panel"])'), el => ({ slot: el.dataset.slot || 'output', height: el.getBoundingClientRect().height, scrolls: el.scrollHeight > el.clientHeight, native: el.dataset.slot ? 192 : 80, cap: Math.min(el.dataset.slot ? 576 : 240, innerHeight * 0.7) })))
		}
		report.details = await details()
		check(report.details.length === 2, `Opened long output and diff must render one box each: ${JSON.stringify(report.details)}`)
		for (const box of report.details) check(Math.abs(box.height - box.cap) < 1 && box.scrolls, `Long ${box.slot} must fill its tripled cap and still scroll: ${JSON.stringify(box)}`)
		report.checks.push('opened native terminal output and highlighted diff use three times their height caps, then scroll')
		report.detailsScreenshot = await shot('integration-tool-details')
		await route('/settings?tab=plugins&plugin=hermes-wide-previews%3Asettings')
		const tallerSwitch = page.getByRole('switch', { name: 'Output and diffs: taller boxes', exact: true })
		await tallerSwitch.waitFor()
		check(await tallerSwitch.getAttribute('aria-checked') === 'true', 'Taller boxes must be on by default')
		await tallerSwitch.click()
		report.nativeDetails = await details()
		for (const box of report.nativeDetails) check(Math.abs(box.height - box.native) < 1, `Switching off must restore the native ${box.slot} height: ${JSON.stringify(box)}`)
		await route('/settings?tab=plugins&plugin=hermes-wide-previews%3Asettings')
		await tallerSwitch.click()
		check(await tallerSwitch.getAttribute('aria-checked') === 'true', 'Taller boxes must switch back on')
		report.checks.push('one native switch restores and reapplies both output and diff heights without reloading')
		await route('/ui-tweaks-example-tools')
		await page.getByText('Invented history for testing only.', { exact: false }).waitFor()

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
		const expandSwitch = page.getByRole('switch', { name: 'Lists: expand by default', exact: true })
		const foldSwitch = page.getByRole('switch', { name: 'File edits: fold diffs by default', exact: true })
		const statusSwitch = page.getByRole('switch', { name: 'Status stack: fold by default', exact: true })
		const queueSwitch = page.getByRole('switch', { name: 'Queued prompts: expand list by default', exact: true })
		const queuedTextSwitch = page.getByRole('switch', { name: 'Queued prompts: expand long text by default', exact: true })
		const historySwitch = page.getByRole('switch', { name: 'Long messages: taller edit box', exact: true })
		await expandSwitch.waitFor()
		for (const title of ['Tool calls', 'Composer', 'Conversation']) await page.getByRole('heading', { name: title, exact: true }).waitFor()
		const timestampRow = page.getByText('Timestamps: share existing lines', { exact: true }).locator('xpath=ancestor::div[contains(@class, "@container")][1]')
		check(await timestampRow.getByText('Always on', { exact: true }).count() === 1, 'Timestamp placement must be visible as an always-on feature')
		check(await timestampRow.locator('button, input, [role="switch"]').count() === 0, 'The always-on feature must not have a toggle, including a disabled one')
		report.checks.push('categorized settings and a native always-on row without a switch')
		const treeSwitch = page.getByRole('switch', { name: 'Lists: tree toggle instead of summary line', exact: true })
		const treeStyled = () => page.evaluate(() => Boolean(document.querySelector('style[data-hermes-tree-toggle]')?.textContent))
		check(await treeSwitch.getAttribute('aria-checked') === 'true' && await treeStyled(), 'The tree toggle must be on by default')
		await treeSwitch.click()
		check(await treeSwitch.getAttribute('aria-checked') === 'false' && !await treeStyled(), 'Switching the tree toggle off must restore native summaries without a reload')
		await treeSwitch.click()
		check(await treeStyled(), 'Switching it back on must apply it again')
		report.checks.push('tree-toggle switch applies live in both directions')
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
		await editBoxTall(false)
		await route('/ui-tweaks-example-preview')
		await page.locator('iframe[src*="/assets/webapp-preview.html"]').waitFor({ state: 'attached' })
		await setQueue(1)
		await expanded(statusToggle(), true)
		await expanded(queueToggle(), true)
		await expanded(queuedTextToggle(), false)
		report.checks.push('queue list expands with status folding disabled while long queued text stays collapsed and the prompt edit box keeps its native cap')
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
		await editBoxTall(true)
		report.checks.push('long queued text does not open its closed list; the sent prompt stays folded and its edit box opens taller')
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
		const cards = async () => {
			await route('/ui-tweaks-example-wide-cards')
			await page.getByText('Invented history for the card width check', { exact: false }).waitFor()
			await page.locator('[data-slot="aui_artifact-card"]').waitFor()
			return page.evaluate(() => {
				const width = selector => document.querySelector(selector).getBoundingClientRect().width
				return { available: width('[data-slot="aui_assistant-message-content"] .aui-md'), audio: width('.aui-md span:has(> audio)'), artifact: width('[data-slot="aui_artifact-card"]'), delegate: width('[data-delegate-card]') }
			})
		}
		report.cards = await cards()
		for (const name of ['audio', 'artifact', 'delegate']) check(Math.abs(report.cards[name] - report.cards.available) < 1, `The ${name} card must fill the message width: ${JSON.stringify(report.cards)}`)
		report.checks.push('audio player, artifact card and subagent card fill the message width')
		report.cardsScreenshot = await shot('integration-wide-cards')
		await route('/settings?tab=plugins&plugin=hermes-wide-previews%3Asettings')
		const widthSwitch = page.getByRole('switch', { name: 'Previews and cards: full width', exact: true })
		await widthSwitch.waitFor()
		check(await widthSwitch.getAttribute('aria-checked') === 'true', 'Full width must be on by default')
		await widthSwitch.click()
		report.nativeCards = await cards()
		for (const name of ['audio', 'artifact', 'delegate']) check(report.nativeCards[name] < report.nativeCards.available - 1, `Switching off must restore the native ${name} cap: ${JSON.stringify(report.nativeCards)}`)
		report.checks.push('the full-width switch restores native card widths live')
		check(errors.length === 0, `Uncaught renderer errors: ${errors.join('; ')}`)
		report.checks.push('no uncaught renderer errors')
		return report
	} finally {
		await route('/settings?tab=plugins&plugin=hermes-wide-previews%3Asettings')
		await page.getByRole('switch', { name: 'Status stack: fold by default', exact: true }).waitFor()
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
