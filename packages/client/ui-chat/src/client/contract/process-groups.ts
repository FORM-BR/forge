/** Business data for Chat process groups; source Nodes remain in the Chat store. */
export type ProcessActivity = 'read' | 'readImage' | 'search' | 'write' | 'edit' | 'commands' | 'code'
  | 'webSearch' | 'webFetch' | 'subagents' | 'plan' | 'questions' | 'tools'

/** A process member the work trail can name: a tool category or recorded reasoning. */
export type ProcessStepKind = ProcessActivity | 'thinking'

/** One ordered member of the work trail inside a group. */
export interface ProcessStep {
  readonly kind: ProcessStepKind
  readonly state: 'running' | 'done' | 'error'
  /** One-line task detail (path, command, query, reasoning line); empty when none. */
  readonly detail: string
}

/** Distinct-call category ranking, the live task detail, and the ordered work trail. */
export interface ProcessActivitySummary {
  readonly counts: readonly { readonly kind: ProcessActivity; readonly count: number }[]
  readonly running: ProcessActivity | undefined
  readonly runningDetail: string
  /** Present only while the selected live activity has not reached tool/call. */
  readonly preparing?: true
  /** Ordered members of this group; the trail renders the newest few. */
  readonly steps: readonly ProcessStep[]
}

/** Presentation facts for one group between independent replies or input. */
export interface ProcessGroupData {
  readonly turn: number
  readonly closed: boolean
  readonly summary: ProcessActivitySummary
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ConversationGroupDataMap {
    chat: ProcessGroupData
  }
}
