// Drive body for `webapp.sh drive "$(cat tools/test-webapp/approval-width.js)"`, with mock-llm.py serving the workspace profile (see docs/development.md).
// Starts a fresh session whose scripted turn asks to approve a harmless delete, measures the real approval card with the plugin's widths on and off, then denies it.
const later = page.getByRole('button', { name: "I'll choose a provider later", exact: true })
if (await later.isVisible().catch(() => false)) await later.click()
await page.evaluate(() => { location.hash = '#/' })
await page.waitForTimeout(2000)
const box = page.locator('[contenteditable=true]').first()
await box.click()
await page.keyboard.type('Run the approval scenario (invented test turn)')
await page.keyboard.press('Enter')
const stack = page.locator('[data-slot="tool-approval-stack"]')
await stack.locator('pre').first().waitFor({ timeout: 60000 })
await page.waitForTimeout(500)
const measure = () => page.evaluate(() => {
	const stack = document.querySelector('[data-slot="tool-approval-stack"]')
	const command = stack.querySelector('pre')
	const column = document.querySelector('[data-slot="aui_assistant-message-content"]')
	return { stack: stack.getBoundingClientRect().width, column: column.getBoundingClientRect().width, commandLines: Math.round(command.scrollHeight / parseFloat(getComputedStyle(command).lineHeight)), placement: stack.dataset.approvalPlacement }
})
const wide = await measure()
const screenshot = await shot('approval-wide')
const style = await page.evaluate(() => { const el = document.querySelector('style[data-hermes-plugin]'); const text = el.textContent; el.textContent = ''; return text })
await page.waitForTimeout(300)
const native = await measure()
await page.evaluate(text => { document.querySelector('style[data-hermes-plugin]').textContent = text }, style)
await stack.getByRole('button', { name: 'Reject', exact: true }).first().click()
return { wide, native, screenshot }
