/** Register Brazilian Portuguese as a language pack and its namespace dictionaries. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { dictionaries } from './dictionaries.ts'

/** Services this plugin reads. */
export const inject = ['locale']

/**
 * Add the pt-BR language definition and every translated namespace dictionary.
 * @param ctx - browser plugin context.
 */
export function apply(ctx: Context): void {
  ctx.effect(
    () => ctx.locale.addLanguage({ id: 'pt-BR', label: 'Português (Brasil)', fallback: 'en' }),
    'ui-locale-pt: language',
  )
  for (const [namespace, dictionary] of Object.entries(dictionaries)) {
    ctx.effect(
      () => ctx.locale.register(namespace, 'pt-BR', dictionary),
      `ui-locale-pt: ${namespace}`,
    )
  }
}
