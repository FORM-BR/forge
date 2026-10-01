/** Static costs tab chip: glyph plus localized name, matching the guide entry. */
import type { ReactNode } from 'react'
import { IconDatabaseOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { CostsInjected } from './face.ts'
import type {} from './locales.ts'
import css from './CostsTab.module.css'

/**
 * Render the costs tab's chip label.
 * @param props - sidebar occurrence and localized copy.
 * @returns the database glyph and tab title.
 */
export function CostsTitle({ t }: PropsRuntime<'sidebar.right.pane.tab.title'> & PropsLocale<'sidebarCosts'> & InjectFace<CostsInjected>): ReactNode {
  return <span className={css.chip}><IconDatabaseOutlineRegular size={14} /><span>{t('title')}</span></span>
}
