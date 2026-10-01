import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { CostLedger, dayOf } from '@deepseek-ai/dsh-cost-meter/src/ledger.ts'
import type { CostLedgerRow } from '@deepseek-ai/dsh-cost-meter/src/ledger.ts'

function row(overrides: Partial<CostLedgerRow> & Pick<CostLedgerRow, 'sessionId' | 'seq'>): CostLedgerRow {
  return {
    day: '2026-01-05',
    time: 1_768_694_400_000,
    provider: 'openrouter',
    model: 'vendor/model',
    costUsd: 0.001,
    unpriced: false,
    inputTokens: 1000,
    outputTokens: 100,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    ...overrides,
  }
}

describe('dayOf', () => {
  it('formats an epoch millisecond as the local YYYY-MM-DD calendar day', () => {
    const day = dayOf(1_768_694_400_000)
    expect(day).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('CostLedger', () => {
  it('round-trips rows and aggregates by day ascending', () => {
    const ledger = new CostLedger(':memory:')
    try {
      ledger.upsert(row({ sessionId: 's1', seq: 0, day: '2026-01-05', costUsd: 0.001 }))
      ledger.upsert(row({ sessionId: 's1', seq: 1, day: '2026-01-05', costUsd: 0.002 }))
      ledger.upsert(row({ sessionId: 's2', seq: 0, day: '2026-01-06', costUsd: 0.004 }))
      expect(ledger.byDay()).toEqual([
        { day: '2026-01-05', costUsd: 0.003, attempts: 2, inputTokens: 2000, outputTokens: 200, cacheReadTokens: 0 },
        { day: '2026-01-06', costUsd: 0.004, attempts: 1, inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0 },
      ])
    } finally {
      ledger.close()
    }
  })

  it('re-upserting the same (session, seq) replaces instead of duplicating', () => {
    const ledger = new CostLedger(':memory:')
    try {
      ledger.upsert(row({ sessionId: 's1', seq: 0, costUsd: 0.001, inputTokens: 1000 }))
      // Replay of the same event: the settlement corrected its tokens.
      ledger.upsert(row({ sessionId: 's1', seq: 0, costUsd: 0.002, inputTokens: 2000 }))
      expect(ledger.byDay()).toEqual([
        { day: '2026-01-05', costUsd: 0.002, attempts: 1, inputTokens: 2000, outputTokens: 100, cacheReadTokens: 0 },
      ])
    } finally {
      ledger.close()
    }
  })

  it('aggregates by provider/model, most expensive first', () => {
    const ledger = new CostLedger(':memory:')
    try {
      ledger.upsert(row({ sessionId: 's1', seq: 0, provider: 'openrouter', model: 'a', costUsd: 0.001 }))
      ledger.upsert(row({ sessionId: 's1', seq: 1, provider: 'openrouter', model: 'b', costUsd: 0.005 }))
      ledger.upsert(row({ sessionId: 's2', seq: 0, provider: 'openrouter', model: 'a', costUsd: 0.002 }))
      expect(ledger.byModel()).toEqual([
        { provider: 'openrouter', model: 'b', costUsd: 0.005, attempts: 1, inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0 },
        { provider: 'openrouter', model: 'a', costUsd: 0.003, attempts: 2, inputTokens: 2000, outputTokens: 200, cacheReadTokens: 0 },
      ])
    } finally {
      ledger.close()
    }
  })

  it('sums cache-read tokens separately from input tokens', () => {
    const ledger = new CostLedger(':memory:')
    try {
      ledger.upsert(row({ sessionId: 's1', seq: 0, inputTokens: 100, cacheReadTokens: 900 }))
      ledger.upsert(row({ sessionId: 's1', seq: 1, inputTokens: 50, cacheReadTokens: 450 }))
      expect(ledger.report('day')).toEqual([
        { day: '2026-01-05', costUsd: 0.002, attempts: 2, inputTokens: 150, outputTokens: 200, cacheReadTokens: 1350 },
      ])
    } finally {
      ledger.close()
    }
  })

  it('treats unpriced settlements as costs of zero', () => {
    const ledger = new CostLedger(':memory:')
    try {
      ledger.upsert(row({ sessionId: 's1', seq: 0, costUsd: 0, unpriced: true }))
      expect(ledger.byDay()).toEqual([
        { day: '2026-01-05', costUsd: 0, attempts: 1, inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0 },
      ])
    } finally {
      ledger.close()
    }
  })

  it('stores the session cwd and reports per workspace', () => {
    const ledger = new CostLedger(':memory:')
    try {
      ledger.upsert(row({ sessionId: 's1', seq: 0, cwd: 'C:\\work\\one', costUsd: 0.001 }))
      ledger.upsert(row({ sessionId: 's2', seq: 0, cwd: 'C:\\work\\two', costUsd: 0.004 }))
      ledger.upsert(row({ sessionId: 's3', seq: 0, costUsd: 0.002 }))
      expect(ledger.report('cwd')).toEqual([
        { cwd: 'C:\\work\\two', costUsd: 0.004, attempts: 1, inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0 },
        { costUsd: 0.002, attempts: 1, inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0 },
        { cwd: 'C:\\work\\one', costUsd: 0.001, attempts: 1, inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0 },
      ])
      expect(ledger.workspaces()).toEqual(['C:\\work\\one', 'C:\\work\\two'])
    } finally {
      ledger.close()
    }
  })

  it('reports per session and per day with the same filter surface', () => {
    const ledger = new CostLedger(':memory:')
    try {
      ledger.upsert(row({ sessionId: 's1', seq: 0, day: '2026-01-05', cwd: 'C:\\a', model: 'm1', costUsd: 0.001 }))
      ledger.upsert(row({ sessionId: 's1', seq: 1, day: '2026-01-06', cwd: 'C:\\a', model: 'm2', costUsd: 0.002 }))
      ledger.upsert(row({ sessionId: 's2', seq: 0, day: '2026-01-06', cwd: 'C:\\b', model: 'm1', costUsd: 0.004 }))
      expect(ledger.report('session')).toEqual([
        // A single-route session reports its route; a mixed one leaves it unset.
        {
          sessionId: 's2', day: '2026-01-06', cwd: 'C:\\b', provider: 'openrouter', model: 'm1',
          costUsd: 0.004, attempts: 1, inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0,
        },
        { sessionId: 's1', day: '2026-01-06', cwd: 'C:\\a', costUsd: 0.003, attempts: 2, inputTokens: 2000, outputTokens: 200, cacheReadTokens: 0 },
      ])
      expect(ledger.report('model')).toEqual([
        { provider: 'openrouter', model: 'm1', costUsd: 0.005, attempts: 2, inputTokens: 2000, outputTokens: 200, cacheReadTokens: 0 },
        { provider: 'openrouter', model: 'm2', costUsd: 0.002, attempts: 1, inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0 },
      ])
      expect(ledger.models()).toEqual([
        { provider: 'openrouter', model: 'm1' },
        { provider: 'openrouter', model: 'm2' },
      ])
    } finally {
      ledger.close()
    }
  })

  it('scopes a report with day, cwd, model and session filters', () => {
    const ledger = new CostLedger(':memory:')
    try {
      ledger.upsert(row({ sessionId: 's1', seq: 0, day: '2026-01-05', cwd: 'C:\\a', model: 'm1', costUsd: 0.001 }))
      ledger.upsert(row({ sessionId: 's1', seq: 1, day: '2026-01-06', cwd: 'C:\\a', model: 'm2', costUsd: 0.002 }))
      ledger.upsert(row({ sessionId: 's1', seq: 2, day: '2026-01-07', cwd: 'C:\\a', model: 'm2', costUsd: 0.003 }))
      ledger.upsert(row({ sessionId: 's2', seq: 0, day: '2026-01-06', cwd: 'C:\\b', model: 'm1', costUsd: 0.004 }))
      expect(ledger.report('day', { fromDay: '2026-01-06', toDay: '2026-01-06' })).toEqual([
        { day: '2026-01-06', costUsd: 0.006, attempts: 2, inputTokens: 2000, outputTokens: 200, cacheReadTokens: 0 },
      ])
      expect(ledger.report('day', { cwd: 'C:\\a' })).toEqual([
        { day: '2026-01-05', costUsd: 0.001, attempts: 1, inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0 },
        { day: '2026-01-06', costUsd: 0.002, attempts: 1, inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0 },
        { day: '2026-01-07', costUsd: 0.003, attempts: 1, inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0 },
      ])
      expect(ledger.report('day', { model: 'm1' })).toEqual([
        { day: '2026-01-05', costUsd: 0.001, attempts: 1, inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0 },
        { day: '2026-01-06', costUsd: 0.004, attempts: 1, inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0 },
      ])
      expect(ledger.report('day', { sessionId: 's1' })).toEqual([
        { day: '2026-01-05', costUsd: 0.001, attempts: 1, inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0 },
        { day: '2026-01-06', costUsd: 0.002, attempts: 1, inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0 },
        { day: '2026-01-07', costUsd: 0.003, attempts: 1, inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0 },
      ])
    } finally {
      ledger.close()
    }
  })

  it('migrates a v1 database by adding the cwd column without touching rows', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-cost-ledger-'))
    const path = join(dir, 'costs.sqlite')
    try {
      const legacy = new DatabaseSync(path)
      legacy.exec(`
        CREATE TABLE cost_events (
          session_id TEXT NOT NULL,
          seq INTEGER NOT NULL,
          day TEXT NOT NULL,
          time INTEGER NOT NULL,
          provider TEXT NOT NULL,
          model TEXT NOT NULL,
          cost_usd REAL NOT NULL,
          unpriced INTEGER NOT NULL,
          input_tokens INTEGER NOT NULL,
          cache_read_tokens INTEGER NOT NULL DEFAULT 0,
          cache_write_tokens INTEGER NOT NULL DEFAULT 0,
          output_tokens INTEGER NOT NULL,
          PRIMARY KEY (session_id, seq)
        ) STRICT
      `)
      legacy.exec('PRAGMA user_version = 1')
      legacy.close()

      const ledger = new CostLedger(path)
      try {
        ledger.upsert(row({ sessionId: 's1', seq: 1, cwd: 'C:\\migrated', costUsd: 0.007 }))
        expect(ledger.report('cwd')).toEqual([
          { cwd: 'C:\\migrated', costUsd: 0.007, attempts: 1, inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0 },
        ])
        expect(ledger.workspaces()).toEqual(['C:\\migrated'])
      } finally {
        ledger.close()
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
