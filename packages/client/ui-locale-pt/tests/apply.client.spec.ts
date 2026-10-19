/** Language definition, namespace registration, translations, and effect disposal. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '../src/client/index.ts'
import { dictionaries } from '../src/client/dictionaries.ts'

async function bench() {
  const ctx = new Context()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, locale, fiber }
}

describe('ui-locale-pt browser plugin', () => {
  it('declares the locale service it reads', () => {
    expect(inject).toEqual(['locale'])
  })

  it('adds pt-BR with an English fallback', async () => {
    const { locale, fiber } = await bench()

    const definition = locale.getSnapshot().locales.find(candidate => candidate.id === 'pt-BR')

    expect(definition).toMatchObject({ id: 'pt-BR', label: 'Português (Brasil)' })
    await fiber.dispose()
  })

  it('translates every registered namespace once pt-BR is active', async () => {
    const { locale, fiber } = await bench()
    locale.setLocale('pt-BR')
    expect(locale.getSnapshot().active).toBe('pt-BR')

    for (const [namespace, dictionary] of Object.entries(dictionaries)) {
      const key = Object.keys(dictionary)[0]!
      const translate = locale.bind(namespace)

      expect(translate(key), `${namespace} :: ${key}`).toBe(dictionary[key])
    }
    await fiber.dispose()
  })

  it('releases every namespace and the language definition when the plugin unloads', async () => {
    const { locale, fiber } = await bench()
    const chat = dictionaries['chat']!
    await fiber.dispose()

    expect(() => locale.register('chat', 'pt-BR', chat)).not.toThrow()
    expect(() => locale.addLanguage({ id: 'pt-BR', label: 'Português (Brasil)', fallback: 'en' })).not.toThrow()
  })
})
