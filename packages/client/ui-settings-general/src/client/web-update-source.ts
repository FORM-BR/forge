/** Client-owned observation of the Host update check for Web and source installs. */
import { createSnapshotStore, type ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { WebUpdateView } from '../types.ts'

/** What the Host reports; mirrors `UpdateCheckStatus` without depending on the Host package. */
export interface WebUpdateStatus {
  readonly enabled: boolean
  readonly checking?: boolean | undefined
  /** True when the last GitHub check could not complete (offline, rate limit, or a private repository answering 404). */
  readonly failed?: boolean | undefined
  readonly newerVersion?: string | undefined
  readonly releaseUrl?: string | undefined
}

/** Reads the Host status; resolves undefined when the Host cannot answer. */
export type WebUpdateReader = () => Promise<WebUpdateStatus | undefined>

/** Browser-local slot holding the version whose notice was dismissed. */
const DISMISSED_KEY = 'dsh.update-notice.dismissed.v1'
/** Poll again soon while the Host is still on its first check, or its on/off state has not caught up. */
const SETTLING_POLL_MS = 3_000
/** Retry after the Host could not answer (connection not ready yet). */
const RETRY_POLL_MS = 60_000
/** Re-read the Host's last result; the Host itself checks GitHub far less often. */
const IDLE_POLL_MS = 30 * 60_000
/** How many fast polls an on/off change may use waiting for the Host to reload. */
const SETTLE_ATTEMPTS = 5

function loadDismissed(): string | undefined {
  try {
    return globalThis.localStorage.getItem(DISMISSED_KEY) ?? undefined
  } catch {
    return undefined
  }
}

function saveDismissed(version: string): void {
  try {
    globalThis.localStorage.setItem(DISMISSED_KEY, version)
  } catch {
    // A private or full browser store only means the notice returns after a reload.
  }
}

/** Owns the Host poll, the user preference gate and the per-version dismissal. */
export class WebUpdateSource {
  /** Framework-observed notice shared by the sidebar chip and the rail badge. */
  readonly store = createSnapshotStore<WebUpdateView>({})
  private live = true
  private status: WebUpdateStatus | undefined
  private dismissed: string | undefined = loadDismissed()
  private timer: ReturnType<typeof setTimeout> | undefined
  private settling = 0
  private enabled: boolean
  private readonly unsubscribe: () => void

  /**
   * @param read - Host status reader.
   * @param preference - the user's "notify me" choice; false hides every notice at once.
   */
  constructor(private readonly read: WebUpdateReader, preference: ObservableSnapshot<boolean>) {
    this.enabled = preference.getSnapshot()
    this.unsubscribe = preference.subscribe(() => {
      const next = preference.getSnapshot()
      if (next === this.enabled) return
      this.enabled = next
      this.settling = SETTLE_ATTEMPTS
      this.publish()
      void this.poll()
    })
    this.publish()
    void this.poll()
  }

  /** Hide the current notice until a newer version than this one appears. */
  dismiss(): void {
    const version = this.store.getSnapshot().notice?.version
    if (version === undefined) return
    this.dismissed = version
    saveDismissed(version)
    this.publish()
  }

  /** Stop polling and ignore any pending answer. */
  dispose(): void {
    this.live = false
    this.unsubscribe()
    clearTimeout(this.timer)
  }

  private publish(): void {
    const { status } = this
    const releaseUrl = status?.releaseUrl
    const version = status?.newerVersion
    const show = this.enabled && status?.enabled === true && version !== undefined && version !== this.dismissed
      && releaseUrl !== undefined && releaseUrl.startsWith('https://')
    const current = this.store.getSnapshot().notice
    if (!show) {
      if (current !== undefined) this.store.set({})
      return
    }
    if (current?.version === version && current.releaseUrl === releaseUrl) return
    this.store.set({ notice: { version, releaseUrl } })
  }

  private async poll(): Promise<void> {
    clearTimeout(this.timer)
    let status: WebUpdateStatus | undefined
    try {
      status = await this.read()
    } catch {
      status = undefined
    }
    if (!this.live) return
    this.status = status ?? this.status
    this.publish()
    let delay = IDLE_POLL_MS
    if (status === undefined) delay = RETRY_POLL_MS
    else if (status.checking === true) delay = SETTLING_POLL_MS
    else if (this.settling > 0) {
      if (status.enabled === this.enabled) {
        this.settling = 0
      } else {
        this.settling -= 1
        delay = SETTLING_POLL_MS
      }
    }
    clearTimeout(this.timer)
    this.timer = setTimeout(() => { void this.poll() }, delay)
  }
}
