/**
 * dsh-mcp-manager client: registers the "MCP Servers" settings section.
 * Built by tsdown into the __ModuleLoader__ factory bundle at
 * client/client.js; react and dsh-client-ui-primitives resolve from the
 * frozen platform module table as externals.
 */

import { createElement as h } from 'react'
import { en, zh } from './locales.ts'
import { McpSection } from './McpSection.tsx'

const NS = 'dsh-mcp-manager'

/** Structural subset of the locale service this plugin touches. */
interface LocaleService {
  register(namespace: string, dicts: { zh: Record<string, string>; en: Record<string, string> }): unknown
  bind(namespace: string): (key: string) => string
}

/** Structural subset of the slots service this plugin touches. */
interface SlotsService {
  inject(slot: string, register: () => unknown): void
  register(meta: Record<string, unknown>, component: () => unknown): unknown
}

/** The client cordis context shape this plugin relies on. */
interface ManagerClientContext {
  effect(callback: () => unknown, label?: string): void
  locale: LocaleService
  slots: SlotsService
}

export const name = 'dsh-mcp-manager'
export const inject = ['slots', 'locale', 'theme']

export function apply(ctx: ManagerClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-mcp-manager: dictionaries')
  const t = ctx.locale.bind(NS)

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'mcp-manager',
    order: 45,
    label: () => t('nav'),
    locale: NS,
    inject: () => ({ t }),
  }, () => h(McpSection, { t })))
}
