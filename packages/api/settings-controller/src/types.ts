/**
 * Browser-safe failure vocabulary of the configuration surfaces this package
 * serves. The redacted views themselves live with their seam in
 * `@deepseek-ai/dsh-settings/types`, whose Cordis event declarations already
 * register that file for the Client compilation face.
 *
 * @module @deepseek-ai/dsh-api-settings-controller/types
 */

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /**
     * Every seam refusal that is not a stale write: an unregistered or malformed
     * namespace, a read-only provider, schema validation, storage.
     */
    'settings/rejected': { readonly ns: string }
    /**
     * The stored revision moved after the caller read it. Its own outcome rather
     * than an invalid request: the caller must re-read and re-apply.
     */
    'settings/conflict': { readonly ns: string; readonly expected: number; readonly actual: number }
    /**
     * The provider refused a valid credential write, for example because a
     * read-only source shadows the reference. The details name only the
     * reference, never the value.
     */
    'credential/rejected': { readonly ref: string }
  }
}

/** Confirmation that the settings document was handed to the native editor. */
export interface SettingsDocumentOpenValue {
  readonly opened: true
}

/** The switch's state as a settings page renders it. */
export type RemoteAccessState =
  /** Switched off (or never switched on). */
  | 'off'
  /** Published on the tailnet and admitted by the fence. */
  | 'on'
  /** No `tailscale` command on this computer. */
  | 'unavailable'
  /** Tailscale is installed but stopped or signed out. */
  | 'needs-login'
  /** Tailscale Serve is not enabled for the tailnet yet; {@link RemoteAccessStatus.link} enables it. */
  | 'needs-serve'
  /** Anything else; {@link RemoteAccessStatus.detail} says what. */
  | 'failed'

/** What the page shows: the state, and the link a phone opens while it is on. */
export interface RemoteAccessStatus {
  state: RemoteAccessState
  /** Tailnet host name of this computer, when Tailscale is connected. */
  host?: string
  /** Address to open on the phone, with this process's login token; present only while `on`. */
  url?: string
  /** Page that enables Serve; present only with `needs-serve`. */
  link?: string
  /** Short diagnostic for `failed`. */
  detail?: string
}

/** What a settings page shows for the GitHub release update check. */
export interface UpdateCheckStatus {
  /** Whether a repository is configured and the user preference has it on. */
  enabled: boolean
  /** A check is in flight or has never completed yet (only meaningful when `enabled`). */
  checking?: boolean
  /** The running build's version, for comparison display (only present when `enabled`). */
  current?: string
  /** The most recent check failed (network, timeout, or unparseable response); never an error shown as a hard failure. */
  failed?: boolean
  /** The latest GitHub release's version, present only when it is newer than `current`. */
  newerVersion?: string
  /** Release page to open for "See what's new", present only alongside `newerVersion`. */
  releaseUrl?: string
}
