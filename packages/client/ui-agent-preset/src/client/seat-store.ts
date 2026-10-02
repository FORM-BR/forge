/**
 * Hero-chip controller: which preset the NEXT session gets.
 *
 * The new-session screen has no session, so a pick is staged rather than
 * applied. It reaches a session when one becomes current and is still blank —
 * whether the workspace connect created it or reused an existing blank one,
 * which is why staging cannot simply ride along on `sessions.create`.
 *
 * The stage is forgotten once applied. The next new session starts from the
 * Host-effective default again — unless its Workspace has a business profile:
 * then the profile's preset is staged for it, the same way a person's pick
 * is. A person's own pick on a session always wins over the profile, and a
 * profile applies at most once per session and per profile value, so
 * changing the profile later reaches a still-blank session while a
 * hand-picked one is left alone.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the ctx.remote merge into this program.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the Developer tools preference (ctx.configForms) into this program.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type {} from '@deepseek-ai/dsh-agent-preset-registry/types'
import { presetOptions, readRoster } from './settings-store.ts'
import type { AgentPresetOption } from './settings-store.ts'

/** Hero-chip snapshot. */
export interface AgentPresetSeatState {
  /** Presets the deployment supplies; empty means the chip renders nothing. */
  options: readonly AgentPresetOption[]
  /** The staged choice, empty until the roster loads. */
  current: string
  /** A rejected apply's message, cleared by the next attempt. */
  error: string | null
  busy: boolean
  /**
   * One-shot cue that the chip should introduce itself (the creator-draft
   * entry staged the pick from another screen, so the user never touched the
   * chip); the renderer clears it via `introduced()` once played.
   */
  introduce: boolean
}

const INITIAL: AgentPresetSeatState = {
  options: [], current: '', error: null, busy: false, introduce: false,
}

/** Mutable one-shot preset choice shared across Provider-bound seat controllers. */
export interface AgentPresetStage {
  /** Preset awaiting application; absence means no staged choice. */
  id: string | undefined
  /** Whether the receiving chip should announce the applied choice once. */
  introduce: boolean
}

/** Stages the next session's preset and applies it when one appears. */
export class AgentPresetSeatController {
  /** Chip snapshot the renderer subscribes to. */
  readonly store: SnapshotStore<AgentPresetSeatState> = createSnapshotStore(INITIAL)

  /**
   * The Host-effective default, so a consumed stage can fall back to it without
   * re-reading the roster.
   */
  private fallback = ''

  /** Business profiles from the last roster read: Workspace directory path to preset id. */
  private profiles: Readonly<Record<string, string>> = {}
  /** The staged id came from a Workspace profile rather than a person's pick. */
  private profileStaged = false
  /** Sessions where a person picked: the profile never overrides them. */
  private readonly picked = new Set<string>()
  /** Profile preset last applied per session, so one profile value is not retried after a refusal. */
  private readonly profileApplied = new Map<string, string>()

  /** Only the newest roster read may publish after overlapping refreshes. */
  private loadGeneration = 0
  /** Completion of the active Host selection; Settings choices wait before staging. */
  private pendingSelection: Promise<undefined> | undefined

  constructor(
    private readonly ctx: ClientContext,
    /** The session the hero is about to hand over to, when there is one. */
    private readonly currentSession: () => Pick<
      SessionSummary,
      'id' | 'blank' | 'projectionValues'
    > | undefined,
    private readonly staged: AgentPresetStage = { id: undefined, introduce: false },
    /** The Workspace directory path the session belongs to, when it has one. */
    private readonly workspacePathOf: (sessionId: SessionSummary['id']) => string | undefined = () => undefined,
  ) {}

  private set(patch: Partial<AgentPresetSeatState>): void {
    this.store.set({ ...this.store.getSnapshot(), ...patch })
  }

  private clearStage(): void {
    this.staged.id = undefined
    this.staged.introduce = false
    this.profileStaged = false
  }

  /**
   * The preset a blank session's Workspace profile asks for, when it still has
   * something to say: a healthy preset the session does not already run, not
   * yet applied for this profile value, on a session no person picked for.
   * @param session - the session the staged choice would land on.
   * @returns the preset id to start the session with, or undefined.
   */
  private profileFor(session: Pick<SessionSummary, 'id' | 'blank' | 'projectionValues'>): string | undefined {
    if (!session.blank || this.picked.has(session.id)) return undefined
    const path = this.workspacePathOf(session.id)
    const wanted = path === undefined ? undefined : this.profiles[path]
    if (wanted === undefined || wanted === presetOf(session) || wanted === this.profileApplied.get(session.id)) return undefined
    // A removed or broken preset cannot compose a session; leave the default in place.
    return this.store.getSnapshot().options.some(option => option.id === wanted) ? wanted : undefined
  }

  /** Developer tools are the single gate over preset selection. */
  private selectionAvailable(): boolean {
    return this.ctx.configForms.developerTools.enabled.getSnapshot()
  }

  /**
   * Read the roster and open the chip on the Host-effective default.
  * @returns once the snapshot reflects the host.
  */
  async load(): Promise<void> {
    const generation = ++this.loadGeneration
    const roster = await readRoster(this.ctx)
    if (generation !== this.loadGeneration) return
    if (!roster.ok) {
      this.set({ error: roster.error })
      return
    }
    const { presets } = roster.value
    // A stage outlives the screen that made it; Developer tools may have gone off since.
    if (!this.selectionAvailable()) this.clearStage()
    this.fallback = presets.find(preset => preset.isDefault)?.id ?? presets[0]?.id ?? ''
    this.profiles = roster.value.workspacePresets ?? {}
    const session = this.currentSession()
    this.set({
      options: presetOptions(presets),
      // Staged pick first, then the composition the current session
      // already carries, then the Host-effective default. The middle term is
      // what keeps a late-landing load from regressing the display after
      // an applied stage was consumed — the chip mounts (and loads) only
      // once the flow's session is current, so the reply can arrive after
      // apply() already composed it.
      current: this.staged.id ?? (session === undefined ? this.fallback : presetOf(session) ?? ''),
      error: null,
      introduce: this.staged.introduce,
    })
    await this.apply()
  }

  /**
   * Stage one preset for the next session, applying it immediately when a
   * blank session is already current.
   *
   * The refusal is returned as well as stored, because the two readers need
   * different things from it: the chip's own label carries the standing state,
   * while the caller that made this pick is the one that has to say why the
   * label came back — and only it knows the pick was a person's, not the
   * applier catching up with a session that just became current.
   * @param id - the preset to stage.
   * @returns the refusal text, or undefined once the pick settled.
   */
  async select(id: string): Promise<string | undefined> {
    if (this.store.getSnapshot().busy) return undefined
    this.stage(id)
    return await this.apply()
  }

  /**
   * Stage a pick WITHOUT the immediate apply, for a flow that starts the
   * receiving session after the pick (the settings section's creator entry).
   * `select()`'s immediate apply would meet the still-current running session
   * and drop the stage as unservable; staging alone leaves it for the
   * list-change applier, which fires when the started session becomes
   * current.
   * @param id - the preset to stage.
   * @param introduce - true when the stage came from another screen and the
   * chip should announce itself on the session it lands on.
   */
  stage(id: string, introduce = false): void {
    this.profileStaged = false
    this.staged.id = id
    this.staged.introduce = introduce
    this.set({ current: id, error: null, introduce })
  }

  /**
   * Capture the exact blank Session a Settings action may bring along.
   * @returns its id, or undefined outside a blank Session.
   */
  blankSessionId(): SessionSummary['id'] | undefined {
    const session = this.currentSession()
    return session?.blank === true ? session.id : undefined
  }

  /**
   * Apply a Settings choice only if its captured Session is still current and
   * blank after any pending selection settles. The selection uses the existing stage/apply path.
   * @param expectedSessionId - blank Session captured before the Settings write.
   * @param id - the effective default that the write persisted.
   * @returns the Host refusal text, or undefined when applied or no longer relevant.
   */
  async syncBlankSession(
    expectedSessionId: SessionSummary['id'],
    id: string,
  ): Promise<string | undefined> {
    while (this.pendingSelection !== undefined) await this.pendingSelection
    const session = this.currentSession()
    if (session === undefined || !session.blank || session.id !== expectedSessionId) return undefined
    this.stage(id)
    return await this.apply()
  }

  /** Acknowledge the introduction cue once the chip has played it. */
  introduced(): void {
    if (!this.store.getSnapshot().introduce) return
    this.staged.introduce = false
    this.set({ introduce: false })
  }

  /**
   * Hand the staged choice to the current session, if there is one to take it.
   *
   * Called both by `select()` and by whoever observes the current session
   * changing, because the session may appear either before or after the pick.
   * List updates do not repeat a selection while its response is pending.
   * @returns this attempt's Host refusal, or undefined when successful or no switch starts.
   */
  async apply(): Promise<string | undefined> {
    if (this.store.getSnapshot().busy) return
    const available = this.selectionAvailable()
    // A stage made while Developer tools were on must not outlive them.
    if (!available) this.clearStage()
    const session = this.currentSession()
    // A Workspace profile is staged exactly like a person's pick, so it takes
    // the same apply path (and the same refusal handling) below.
    if (available && this.staged.id === undefined && session !== undefined) {
      const profile = this.profileFor(session)
      if (profile !== undefined) {
        this.stage(profile)
        this.profileStaged = true
      }
    }
    const staged = this.staged.id
    if (staged === undefined) {
      const current = session === undefined ? this.fallback : presetOf(session) ?? ''
      const shown = this.store.getSnapshot()
      // Hiding the chip also withdraws the introduction cue armed for it;
      // ordinary list movement leaves that cue to the chip that plays it.
      if (!available && shown.introduce) this.set({ current, introduce: false })
      else if (current !== shown.current) this.set({ current })
      return
    }
    if (session === undefined) return
    // A started session's history was produced under its own composition; the
    // host refuses the swap, so the stage is no longer meaningful.
    if (!session.blank || presetOf(session) === staged) {
      // A pick that changes nothing is still the person's word on this session
      // (a profile is only staged for a blank session that differs from it).
      this.picked.add(session.id)
      this.clearStage()
      return
    }
    // The choice is consumed by this session: a person's pick shields it from
    // the profile for good, a profile's own application is remembered so a
    // refusal is not retried on every list change.
    if (this.profileStaged) this.profileApplied.set(session.id, staged)
    else this.picked.add(session.id)
    const completion = Promise.withResolvers<undefined>()
    this.pendingSelection = completion.promise
    this.clearStage()
    try {
      this.set({ busy: true, error: null })
      const result = await this.ctx.remote.agentPresets.select(session.id, staged)
      if (!result.ok) {
        const { error } = result
        const refusal = 'reason' in error.details && typeof error.details.reason === 'string'
          ? error.details.reason
          : error.message
        this.set({
          // A refusal carries its cause twice: `message` wraps it in the
          // roster's own frame, which names the preset the surface reporting
          // this already names, and a `reason` detail holds the same cause
          // without it. Read by the detail rather than by the code, because
          // every refusal that has a cause to give names it the same way.
          error: refusal,
          current: this.staged.id ?? presetOf(session) ?? '',
        })
        return refusal
      }
      this.set({ current: this.staged.id ?? result.value })
    } finally {
      this.pendingSelection = undefined
      this.set({ busy: false })
      completion.resolve(undefined)
    }
  }
}

function presetOf(
  session: Pick<SessionSummary, 'projectionValues'> | undefined,
): string | undefined {
  const value = session?.projectionValues?.agentPreset
  return typeof value === 'string' ? value : undefined
}
