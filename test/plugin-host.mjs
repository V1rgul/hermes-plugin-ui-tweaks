import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

// Real React/JSX rendering with an SDK contract fixture. The real Desktop supplies
// its own styled ToggleRow and registry; this does not claim to be Electron.
const bundle = await build({
	stdin: {
		resolveDir: fileURLToPath(new URL('..', import.meta.url)),
		contents: `
			import { useEffect, useRef, useState } from 'react'
			import { createRoot } from 'react-dom/client'
			import { jsx, jsxs } from 'react/jsx-runtime'
			function ToggleRow({ label, description, checked, onChange }) {
				return jsxs('div', { children: [
					jsx('span', { children: label }),
					jsx('button', { type: 'button', role: 'switch', 'aria-label': label, 'aria-checked': checked, onClick: () => onChange(!checked), children: checked ? 'On' : 'Off' }),
					jsx('p', { children: description })
				] })
			}
			function ListRow({ title, description, action }) {
				return jsxs('div', { children: [jsx('span', { children: title }), jsx('p', { children: description }), action] })
			}
			window.pluginReact = { useEffect, useRef, useState, createRoot, jsx, jsxs, ToggleRow, ListRow }
		`
	},
	bundle: true,
	write: false,
	format: 'iife',
	platform: 'browser',
	define: { 'process.env.NODE_ENV': '"production"' }
})

export async function activatePlugin(page, source, { disposeImmediately = false, legacySettingsApi = false } = {}) {
	if (!await page.evaluate(() => Boolean(window.pluginReact))) await page.addScriptTag({ content: bundle.outputFiles[0].text })
	await page.evaluate(async ({ source, disposeImmediately, legacySettingsApi }) => {
		const urls = []
		const moduleUrl = text => {
			const url = URL.createObjectURL(new Blob([text], { type: 'text/javascript' }))
			urls.push(url)
			return url
		}
		const modules = {
			// `host` is a fixture only when a test defines window.pluginHost; otherwise it has no state atoms, as on older hosts.
			'@hermes/plugin-sdk': moduleUrl("export const ToggleRow = window.pluginReact.ToggleRow; export const ListRow = window.pluginReact.ListRow; export const host = window.pluginHost || { state: {} }; export const COMPOSER_AREAS = { actions: 'composer.actions' }; export const GHOST_ICON_BTN = 'ghost-icon-btn'"),
			'react': moduleUrl('export const { useEffect, useRef, useState } = window.pluginReact'),
			'react/jsx-runtime': moduleUrl('export const jsx = window.pluginReact.jsx; export const jsxs = window.pluginReact.jsxs')
		}
		let root
		const disposers = []
		window.pluginPages ??= []
		// Composer slots render contributions where Desktop would, inside each chat surface.
		const slots = new Map()
		window.mountContribution = (id, container) => {
			const contribution = window.pluginContributions[id]
			const root = window.pluginReact.createRoot(container)
			slots.set(container, { id, root })
			root.render(window.pluginReact.jsx(contribution.render, {}))
		}
		window.pluginContributions ??= {}
		function registerSettingsPage(settingsPage) {
			window.pluginPages.push(settingsPage)
			disposers.push(() => {
				root?.unmount()
				window.pluginPages = window.pluginPages.filter(page => page !== settingsPage)
			})
		}
		const context = {
			storage: {
				get(key, fallback) {
					try {
						const raw = localStorage.getItem(`hermes.plugin.hermes-wide-previews.${key}`)
						return raw === null ? fallback : JSON.parse(raw)
					} catch { return fallback }
				},
				set(key, value) {
					try { localStorage.setItem(`hermes.plugin.hermes-wide-previews.${key}`, JSON.stringify(value)) } catch {}
				}
			},
			onDispose(dispose) { disposers.push(dispose) },
			register(contribution) {
				// Re-registering an id replaces it, as in the real registry.
				if (contribution.area.startsWith('composer.')) {
					window.pluginContributions[contribution.id] = contribution
					const remove = () => {
						if (window.pluginContributions[contribution.id] !== contribution) return
						delete window.pluginContributions[contribution.id]
						for (const [container, mounted] of slots) if (mounted.id === contribution.id) { mounted.root.unmount(); slots.delete(container) }
					}
					disposers.push(remove)
					return remove
				}
				if (contribution.area !== 'settings.plugins') throw new Error('Unexpected contribution area')
				registerSettingsPage(contribution)
			}
		}
		if (!legacySettingsApi) context.registerSettingsPage = registerSettingsPage
		try {
			const rewritten = source.replace(/(['"])(@hermes\/plugin-sdk|react\/jsx-runtime|react)\1/g, (_, quote, name) => JSON.stringify(modules[name]))
			window.pluginExports = await import(moduleUrl(rewritten))
			window.pluginExports.default.register(context)
			window.mountPluginSettings = () => {
				const settingsPage = window.pluginPages[0]
				if (!settingsPage) throw new Error('No settings page registered')
				let container = document.querySelector('#plugin-settings')
				if (!container) { container = document.createElement('section'); container.id = 'plugin-settings'; document.body.append(container) }
				root?.unmount()
				root = window.pluginReact.createRoot(container)
				root.render(window.pluginReact.jsx(settingsPage.render, {}))
			}
			window.disposePlugin = () => {
				for (const dispose of disposers.splice(0).reverse()) dispose()
			}
			if (disposeImmediately) window.disposePlugin()
		} finally { urls.forEach(url => URL.revokeObjectURL(url)) }
	}, { source, disposeImmediately, legacySettingsApi })
}
