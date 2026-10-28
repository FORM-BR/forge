// @vitest-environment jsdom
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { AboutRow } from '../src/client/AboutRow.tsx'
import type { AboutRowComponentProps } from '../src/client/AboutRow.tsx'
import { createStyleRowStore } from '../src/client/settings-store.ts'
import { DEFAULT_LOOK } from '../src/theme-settings.ts'

// Every fixture carries the resource hook the resources plugin merges into GlobalStandardProps.
const useResource = (() => ({ status: 'none' as const, value: undefined, failure: undefined, reload: () => {} })) as GlobalStandardProps['useResource']
const usePanelInfo: GlobalStandardProps['usePanelInfo'] = selector => selector({ activePanelId: null })

afterEach(cleanup)

function emptySessions() {
  const store = createSnapshotStore<SessionListState>(
    { ids: [], byId: {}, phase: 'ready', projectionsBySession: {} })
  return bindSnapshotSelector(store)
}
function emptyWorkspaces() {
  const store = createSnapshotStore<WorkspaceSnapshot>({
    items: [], archivedSessionIds: [], pinnedSessionIds: [], state: 'idle', phase: 'ready', error: null,
  })
  return bindSnapshotSelector(store)
}

type AttentionSnapshot = Parameters<Parameters<AboutRowComponentProps['useSessionStatus']>[0]>[0]
const noAttention: AttentionSnapshot = new Map()
const useSessionStatus: AboutRowComponentProps['useSessionStatus'] = selector => selector(noAttention)

function mount(signature: 'on' | 'off' = 'on') {
  const store = createStyleRowStore().create()
  store.actions.sync({ ...DEFAULT_LOOK, signature }, 0)
  const props: AboutRowComponentProps = {
    useSessions: emptySessions(),
    useSessionStatus,
    usePanelInfo, useSessionRetainInfo: () => undefined, useResource,
    useWorkspaces: emptyWorkspaces(),
    useStore: bindSnapshotSelector(store),
    actions: store.actions,
    t: (key: string) => key,
  }
  const view = render(<AboutRow {...props} />)
  return { store, view }
}

describe('AboutRow', () => {
  it('renders the made-by line and the invite with an external formbr.com link', () => {
    mount()
    expect(screen.getByText('about.made')).toBeDefined()
    expect(screen.getByText(/about\.invite/)).toBeDefined()
    const link = screen.getByRole('link', { name: 'about.linkLabel' })
    expect(link.textContent).toBe('about.link')
    expect(link.getAttribute('href')).toBe('https://formbr.com')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('renders nothing while the signature is off and returns when it is switched on', () => {
    const { store, view } = mount('off')
    expect(view.container.firstChild).toBeNull()
    act(() => { store.actions.sync({ ...DEFAULT_LOOK, signature: 'on' }, 1) })
    expect(screen.getByText('about.made')).toBeDefined()
  })
})
