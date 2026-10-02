/** Registration of the Git Map right-Sidebar tab type and its two seats. */
import type { Context } from '@deepseek-ai/cordis'
import { IconBranchOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { GitMapTab, GitMapTitle, type GitMapInjected } from './GitMapTab.tsx'

/** Stable implementation identity: the key of the tab body and title seats. */
export const GIT_MAP_ID = '@deepseek-ai/dsh-client-ui-workspace/git-map'

/** Page-type discriminator opened through `ctx.sidebarRight.openTab`. */
export const GIT_MAP_KIND = 'gitmap'

/**
 * Register the Git Map tab type, its guide entry and both Sidebar seats.
 * @param ctx - Client root carrying the Sidebar tab registry and Slots.
 * @param t - workspace namespace translator for the type's static copy.
 * @param locale - the namespace the seats read their copy from.
 * @param injected - the Host lookup handed to the body.
 */
export function registerGitMap(
  ctx: Context,
  t: TranslateNS<'workspace'>,
  locale: 'workspace',
  injected: () => GitMapInjected,
): void {
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: GIT_MAP_ID,
    kind: GIT_MAP_KIND,
    priority: 'builtin',
    title: () => t('gitMap.title'),
    guide: [{
      id: 'open',
      order: 27,
      title: () => t('gitMap.title'),
      description: () => t('gitMap.description'),
      icon: IconBranchOutlineRegular,
    }],
  } satisfies SidebarRightTabDefinition), 'ui-workspace: Git Map type')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: GIT_MAP_ID,
    locale,
    inject: injected,
  }, GitMapTab)), 'ui-workspace: Git Map body')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab.title',
    key: GIT_MAP_ID,
    locale,
    inject: injected,
  }, GitMapTitle)), 'ui-workspace: Git Map title')
}
