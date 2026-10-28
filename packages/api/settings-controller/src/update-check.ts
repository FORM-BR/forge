/**
 * Host owner of the `updateCheck` Remote namespace: polls the configured
 * GitHub repository's latest release on boot and on an interval, compares it
 * against the running build version, and exposes the result to clients that
 * are not the Electron Desktop app (which has its own `electron-updater`
 * indicator; see @deepseek-ai/dsh-client-ui-settings-general). Built for a
 * plain Web/source install with no auto-updater of its own.
 *
 * Nothing is sent to GitHub beyond the anonymous release-list request itself
 * (no telemetry, no identifying headers beyond a fixed User-Agent). The
 * request respects `ETag`/`If-None-Match` so a repeat check that finds no new
 * release costs GitHub's unauthenticated rate limit only a conditional
 * request, and a rate-limited or offline check degrades to silence rather
 * than surfacing an error to the user.
 *
 * @module @deepseek-ai/dsh-api-settings-controller/src/update-check.ts
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { UpdateCheckStatus } from './types.ts'

/** How long one GitHub Releases request may take before it counts as failed. */
const GITHUB_REQUEST_TIMEOUT_MS = 10_000

/** `User-Agent` sent on the anonymous GitHub Releases request; GitHub rejects requests without one. */
const GITHUB_USER_AGENT = 'FORGE'

/** Validated plugin configuration: which repository to poll, how often, and the user's on/off preference. */
export interface Config {
  /** `owner/repo` on GitHub whose releases are polled. Checking is disabled when unset. */
  readonly repository?: string
  /** Hours between checks after the boot check. */
  readonly intervalHours: number
  /** User-facing preference: whether to check at all. */
  readonly enabled: boolean
}

/** One parsed GitHub release, reduced to what this controller compares and links to. */
export interface GitHubLatestRelease {
  /** Release tag, expected as `v<semver>` (the leading `v` is stripped before comparison). */
  readonly tagName: string
  /** Page a person can open to read what changed. */
  readonly htmlUrl: string
  /** Response `ETag`, replayed as `If-None-Match` on the next check; absent when GitHub sent none. */
  readonly etag: string | undefined
}

/** Result of one GitHub Releases check. */
export type GitHubLatestReleaseCheck =
  | { kind: 'release'; release: GitHubLatestRelease }
  /** HTTP 304: the release known from a previous check (and its `etag`) is still current. */
  | { kind: 'not-modified' }
  /** Network failure, timeout, rate limit, or an unparseable response. */
  | { kind: 'unavailable' }

/** Fetches the latest release of one GitHub repository. */
export type GitHubLatestReleaseFetcher = (
  owner: string,
  repo: string,
  etag: string | undefined,
  signal: AbortSignal,
) => Promise<GitHubLatestReleaseCheck>

/** Read a string member of an object-shaped value. */
function memberString(value: unknown, key: string): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const member = (value as Record<string, unknown>)[key]
  return typeof member === 'string' ? member : undefined
}

/** Default fetcher: calls the public, unauthenticated GitHub REST API. */
export const fetchGitHubLatestRelease: GitHubLatestReleaseFetcher = async (owner, repo, etag, signal) => {
  let response: Response
  try {
    response = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/latest`, {
      signal,
      headers: {
        'user-agent': GITHUB_USER_AGENT,
        'accept': 'application/vnd.github+json',
        ...etag === undefined ? {} : { 'if-none-match': etag },
      },
    })
  } catch {
    return { kind: 'unavailable' }
  }
  if (response.status === 304) return { kind: 'not-modified' }
  if (!response.ok) return { kind: 'unavailable' }
  let body: unknown
  try {
    body = await response.json()
  } catch {
    return { kind: 'unavailable' }
  }
  const tagName = memberString(body, 'tag_name')
  const htmlUrl = memberString(body, 'html_url')
  if (tagName === undefined || htmlUrl === undefined) return { kind: 'unavailable' }
  return { kind: 'release', release: { tagName, htmlUrl, etag: response.headers.get('etag') ?? undefined } }
}

/** Parse a dotted numeric version (`1.2.3`, with an optional leading `v`) into comparable parts, or `undefined` when unparseable. */
function parseVersionParts(raw: string): readonly number[] | undefined {
  const unprefixed = raw.startsWith('v') ? raw.slice(1) : raw
  // `String.split` always returns at least one element, so the destructured first
  // element of a non-empty split is never undefined; the empty-string fallback
  // below exists only to satisfy strict typing, never a reachable runtime path.
  const core = unprefixed.split('-')[0] as string
  const parts = core.split('.').map(part => Number.parseInt(part, 10))
  if (parts.length === 0 || parts.some(part => Number.isNaN(part))) return undefined
  return parts
}

/**
 * Whether `latest` is a newer version than `current`. A release this cannot
 * parse as a dotted numeric version never reports as newer, so a malformed or
 * unexpected tag degrades to silence rather than a false positive.
 */
export function isNewerVersion(current: string, latest: string): boolean {
  const currentParts = parseVersionParts(current)
  const latestParts = parseVersionParts(latest)
  if (currentParts === undefined || latestParts === undefined) return false
  const length = Math.max(currentParts.length, latestParts.length)
  for (let index = 0; index < length; index++) {
    const a = latestParts[index] ?? 0
    const b = currentParts[index] ?? 0
    if (a !== b) return a > b
  }
  return false
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of the `updateCheck` Remote namespace. */
    updateCheckController: UpdateCheckController
  }
}

/**
 * Host service backing the generated `ctx.remote.updateCheck` namespace. Polls
 * `GET https://api.github.com/repos/<owner>/<repo>/releases/latest` once at
 * boot and every `intervalHours` after that, and answers the last known result
 * to any caller without triggering a new request.
 */
export class UpdateCheckController extends TypertRemoteService {
  static Config: z<Config> = z.object({
    repository: z.string(),
    intervalHours: z.number().step(1).min(1).default(6),
    enabled: z.boolean().default(true),
  })

  private readonly config: Config
  private readonly fetchLatest: GitHubLatestReleaseFetcher
  private readonly currentVersion: () => string
  private etag: string | undefined
  private latest: GitHubLatestRelease | undefined
  private lastCheckFailed = false
  private timer: ReturnType<typeof setInterval> | undefined

  /**
   * @param ctx - Host context.
   * @param config - validated `repository`/`intervalHours`/`enabled` fields.
   * @param options - `fetchLatest` replaces the GitHub fetcher (tests); `currentVersion` resolves the running
   *   build's version (tests; defaults to the `DSH_CLIENT_VERSION` environment variable).
   */
  constructor(
    ctx: Context,
    config: Config,
    options: { fetchLatest?: GitHubLatestReleaseFetcher; currentVersion?: () => string } = {},
  ) {
    super(ctx, 'updateCheckController', { namespace: 'updateCheck' })
    this.config = config
    this.fetchLatest = options.fetchLatest ?? fetchGitHubLatestRelease
    this.currentVersion = options.currentVersion ?? (() => process.env['DSH_CLIENT_VERSION'] ?? '0.0.0')
    if (this.shouldPoll()) {
      ctx.effect(() => {
        void this.checkNow()
        this.timer = setInterval(() => { void this.checkNow() }, this.config.intervalHours * 60 * 60 * 1000)
        return () => {
          clearInterval(this.timer)
          this.timer = undefined
        }
      }, 'update-check: periodic poll')
    }
  }

  /**
   * Read the last known result without triggering a new check.
   * @returns whether checking is on, the current and latest versions, and the release page URL when a newer version is known.
   */
  @Remote
  status(): UpdateCheckStatus {
    if (!this.shouldPoll()) return { enabled: false }
    const current = this.currentVersion()
    if (this.latest === undefined) {
      return { enabled: true, checking: !this.lastCheckFailed, current, failed: this.lastCheckFailed }
    }
    const newer = isNewerVersion(current, this.latest.tagName)
    return {
      enabled: true,
      checking: false,
      current,
      failed: false,
      ...newer ? { newerVersion: this.latest.tagName.replace(/^v/u, ''), releaseUrl: this.latest.htmlUrl } : {},
    }
  }

  private shouldPoll(): boolean {
    return this.config.enabled && this.config.repository !== undefined && this.config.repository !== ''
  }

  private async checkNow(): Promise<void> {
    const repository = this.config.repository
    if (repository === undefined) return
    const [owner, repo] = repository.split('/')
    if (owner === undefined || repo === undefined || owner === '' || repo === '') return
    const controller = new AbortController()
    const timeout = setTimeout(() => { controller.abort() }, GITHUB_REQUEST_TIMEOUT_MS)
    try {
      const result = await this.fetchLatest(owner, repo, this.etag, controller.signal)
      if (result.kind === 'unavailable') {
        this.lastCheckFailed = true
        return
      }
      this.lastCheckFailed = false
      if (result.kind === 'not-modified') return
      this.latest = result.release
      this.etag = result.release.etag
    } catch {
      this.lastCheckFailed = true
    } finally {
      clearTimeout(timeout)
    }
  }
}

export default UpdateCheckController
