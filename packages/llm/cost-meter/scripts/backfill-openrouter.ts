#!/usr/bin/env node
/**
 * OpenRouter cost backfill CLI.
 *
 * Replays every stored durable session under the dsh sessions root, prices
 * each assistant settlement against the same lookup the live meter uses (live
 * OpenRouter prices, then the pi-ai catalog), and upserts one row per event
 * into the SQLite cost ledger. The ledger is keyed by (session id, event seq)
 * with an upsert, so re-running the backfill never double counts.
 *
 * Usage (from the repository root):
 *   node packages/llm/cost-meter/scripts/backfill-openrouter.ts               # dry-run
 *   node packages/llm/cost-meter/scripts/backfill-openrouter.ts --apply       # write the ledger
 *
 * Flags:
 *   --apply          write rows to the ledger (default: dry-run)
 *   --root <dir>     sessions root (default: ~/.dsh/sessions)
 *   --ledger <path>  cost ledger SQLite path (default: ~/.dsh/statistics/costs.sqlite)
 *   --cache <path>   OpenRouter price cache path (default: ~/.dsh/statistics/openrouter-prices.json)
 *   --ttl-ms <n>     price cache freshness window (default: 86400000)
 *   --help           print this usage and exit
 */

import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { backfillOpenRouter } from '../src/backfill.ts'
import { catalogPriceLookup } from '../src/pricing.ts'
import { composePriceLookup, OpenRouterPriceTable, DEFAULT_PRICE_CACHE_TTL_MS } from '../src/openrouter.ts'

interface Flags {
  readonly apply: boolean
  readonly help: boolean
  readonly root: string | undefined
  readonly ledger: string | undefined
  readonly cachePath: string | undefined
  readonly ttlMs: number | undefined
}

function printUsage(): void {
  const usage = [
    'OpenRouter cost backfill',
    '',
    'Usage: node packages/llm/cost-meter/scripts/backfill-openrouter.ts [flags]',
    '',
    'Flags:',
    '  --apply          write rows to the ledger (default: dry-run)',
    '  --root <dir>     sessions root (default: ~/.dsh/sessions)',
    '  --ledger <path>  cost ledger SQLite path (default: ~/.dsh/statistics/costs.sqlite)',
    '  --cache <path>   OpenRouter price cache path (default: ~/.dsh/statistics/openrouter-prices.json)',
    '  --ttl-ms <n>     price cache freshness window (default: 86400000)',
    '  --help           print this usage and exit',
  ]
  console.log(usage.join('\n'))
}

function parseFlags(argv: readonly string[]): Flags {
  const flags: Flags = { apply: false, help: false, root: undefined, ledger: undefined, cachePath: undefined, ttlMs: undefined }
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]!
    const value = (): string => {
      const next = argv[index + 1]
      if (next === undefined) throw new Error(`flag ${flag} requires a value`)
      index += 1
      return next
    }
    switch (flag) {
      case '--apply': flags.apply = true; break
      case '--help': flags.help = true; break
      case '--root': flags.root = value(); break
      case '--ledger': flags.ledger = value(); break
      case '--cache': flags.cachePath = value(); break
      case '--ttl-ms': flags.ttlMs = Number(value()); break
      default: throw new Error(`unknown flag "${flag}"`)
    }
  }
  return flags
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2))
  if (flags.help) {
    printUsage()
    return
  }

  const openRouter = new OpenRouterPriceTable({
    cachePath: flags.cachePath,
    ttlMs: flags.ttlMs,
  })
  await openRouter.ensureLoaded()
  const price = composePriceLookup(openRouter.asPriceLookup(), catalogPriceLookup())

  const result = await backfillOpenRouter({
    sessionsRoot: flags.root ?? dshHomePath('sessions'),
    ledgerPath: flags.ledger ?? dshHomePath('statistics', 'costs.sqlite'),
    price,
    apply: flags.apply,
  })

  console.log(`sessions:        ${result.sessions} (${result.sessionsFailed} failed to read)`)
  console.log(`priced events:   ${result.pricedEvents} / ${result.settleableEvents} (` +
    `${result.unpricedEvents} unpriced)`)
  console.log(`total cost:      $${result.totalCostUsd.toFixed(4)}`)
  console.log(`mode:            ${flags.apply ? 'apply' : 'dry-run'}`)
  console.log('by model:')
  for (const route of result.byModel) {
    console.log(`  ${route.provider} / ${route.model}: $${route.costUsd.toFixed(4)} ` +
      `(${route.attempts} attempts, ${route.unpriced} unpriced)`)
  }
}

main().catch((error: unknown) => {
  if (error instanceof Error) {
    console.error(`backfill failed: ${error.message}`)
  } else {
    console.error('backfill failed with a non-Error value')
  }
  process.exitCode = 1
})