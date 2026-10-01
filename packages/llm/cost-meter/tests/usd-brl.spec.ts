/**
 * The PTAX-backed USD→BRL table: bulletin parsing, carrying the latest
 * bulletin over weekends and holidays, the on-disk cache, and how fetch
 * failures and today's pending bulletin are retried.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { ptaxPayloadToBulletins, UsdBrlRateTable } from '@deepseek-ai/dsh-cost-meter'

const roots: string[] = []

afterAll(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function cachePath(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-usd-brl-'))
  roots.push(root)
  return join(root, 'usd-brl-ptax.json')
}

/** A PTAX OData body with one closing bulletin per listed day. */
function ptax(bulletins: Record<string, number>): unknown {
  return { value: Object.entries(bulletins).map(([day, rate]) => ({ cotacaoVenda: rate, dataHoraCotacao: `${day} 13:09:27.123` })) }
}

function respond(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

/** Local noon of a YYYY-MM-DD day, so the table's "today" is that day in any time zone. */
function at(day: string): () => number {
  return () => new Date(`${day}T12:00:00`).getTime()
}

// 2026-09-26/27 is a weekend; Friday's bulletin covers it.
const BULLETINS = { '2026-09-18': 5.1, '2026-09-25': 5.25, '2026-09-28': 5.3, '2026-09-29': 5.32 }

describe('ptaxPayloadToBulletins', () => {
  it('keeps positive rates keyed by bulletin day and skips malformed entries', () => {
    const parsed = ptaxPayloadToBulletins({
      value: [
        { cotacaoVenda: 5.2, dataHoraCotacao: '2026-09-25 13:04:21.5' },
        { cotacaoVenda: 0, dataHoraCotacao: '2026-09-24 13:04:21.5' },
        { cotacaoVenda: '5.1', dataHoraCotacao: '2026-09-23 13:04:21.5' },
        { cotacaoVenda: 5.1 },
      ],
    })
    expect([...parsed]).toEqual([['2026-09-25', 5.2]])
    expect(ptaxPayloadToBulletins(null).size).toBe(0)
    expect(ptaxPayloadToBulletins({ value: 'nope' }).size).toBe(0)
  })
})

describe('UsdBrlRateTable', () => {
  it('fills weekend days with the previous bulletin and queries the PTAX date format', async () => {
    const fetch = vi.fn(async () => respond(ptax(BULLETINS)))
    const table = new UsdBrlRateTable({ cachePath: cachePath(), fetch, now: at('2026-10-01') })
    const rates = await table.rates('2026-09-25', '2026-09-29')
    expect(rates).toEqual([
      { day: '2026-09-25', rate: 5.25, bulletinDay: '2026-09-25' },
      { day: '2026-09-26', rate: 5.25, bulletinDay: '2026-09-25' },
      { day: '2026-09-27', rate: 5.25, bulletinDay: '2026-09-25' },
      { day: '2026-09-28', rate: 5.3, bulletinDay: '2026-09-28' },
      { day: '2026-09-29', rate: 5.32, bulletinDay: '2026-09-29' },
    ])
    const url = String((fetch.mock.calls[0] as unknown[] | undefined)?.[0])
    expect(url).toContain("@dataInicial='09-15-2026'")
    expect(url).toContain("@dataFinalCotacao='09-29-2026'")
  })

  it('serves finished ranges from the disk cache without refetching', async () => {
    const path = cachePath()
    const first = vi.fn(async () => respond(ptax(BULLETINS)))
    await new UsdBrlRateTable({ cachePath: path, fetch: first, now: at('2026-10-01') }).rates('2026-09-25', '2026-09-29')
    expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({ version: 1, coveredThrough: '2026-09-29' })
    const second = vi.fn(async () => respond(ptax({})))
    const rates = await new UsdBrlRateTable({ cachePath: path, fetch: second, now: at('2026-10-01') })
      .rates('2026-09-28', '2026-09-29')
    expect(second).not.toHaveBeenCalled()
    expect(rates.map(row => row.rate)).toEqual([5.3, 5.32])
  })

  it('clamps future days to today and re-queries today only after the throttle', async () => {
    let now = new Date('2026-09-29T12:00:00').getTime()
    const fetch = vi.fn(async () => respond(ptax(BULLETINS)))
    const table = new UsdBrlRateTable({ cachePath: cachePath(), fetch, now: () => now })
    const rates = await table.rates('2026-09-28', '2026-10-05')
    expect(rates.at(-1)?.day).toBe('2026-09-29')
    await table.rates('2026-09-28', '2026-09-29')
    expect(fetch).toHaveBeenCalledTimes(1)
    now += 31 * 60_000
    await table.rates('2026-09-28', '2026-09-29')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('returns no rows when offline with an empty cache, and recovers on a later fetch', async () => {
    let now = new Date('2026-10-01T12:00:00').getTime()
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(respond(ptax(BULLETINS)))
    const table = new UsdBrlRateTable({ cachePath: cachePath(), fetch, now: () => now })
    await expect(table.rates('2026-09-28', '2026-09-29')).resolves.toEqual([])
    now += 31 * 60_000
    expect((await table.rates('2026-09-28', '2026-09-29')).map(row => row.rate)).toEqual([5.3, 5.32])
  })
})
