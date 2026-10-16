/**
 * Keep a prose dollar sign — as in `a venda foi R$ 1.435.762` — from opening
 * TeX text math.
 *
 * `micromark-extension-math` opens text math at any `$` that is neither escaped
 * nor preceded by an unescaped `$`, so the only thing that makes a pair of
 * prose dollar signs inert is a rule about their neighbours. Portuguese
 * currency writes them in the open — `R$ 1.435.762 mas as compras somam
 * R$ 238 mil` pairs two of them, and every character between becomes TeX
 * source: KaTeX drops the spaces (`R1.435.762masas`), renders `**` as the
 * asterisk operator, and mangles accented letters. This construct consumes such
 * a `$` as plain text instead, so it survives to the output verbatim.
 */

import { asciiAlphanumeric, markdownSpace } from 'micromark-util-character'
import { codes, types } from 'micromark-util-symbol'
import type { Construct, Extension, Previous, State, Tokenizer } from 'micromark-util-types'

/**
 * The same gate `micromark-extension-math` puts on its own text construct:
 * a `$` directly after an unescaped `$` belongs to the neighbouring run.
 * Mirroring it keeps this construct eligible in exactly the situations the
 * upstream one is, and preserves the `assert` on its `start` state.
 */
const previousDollarSign: Previous = function (code) {
  if (code !== codes.dollarSign) return true
  const tail = this.events.at(-1)
  return tail !== undefined && tail[1].type === types.characterEscape
}

const tokenizeProseDollarSign: Tokenizer = function (effects, ok, nok) {
  const previous = this.previous

  return start

  function start(code: number | null): State | undefined {
    /* v8 ignore next -- this text construct is dispatched only for a dollar sign. */
    if (code !== codes.dollarSign) return nok(code)

    // Glued to what precedes it (`R$`, `US$ 20`) it is prose, whatever follows.
    if (asciiAlphanumeric(previous)) return literal(code)

    effects.enter(types.data)
    effects.consume(code)
    return spaced
  }

  /**
   * A space or tab immediately after the marker cannot open math: TeX's own
   * `tex_math_dollars` and GitHub both refuse it. Reaching here means the `$`
   * stood alone (`custa $ 5 e outro $ 8`), so it is prose as well.
   */
  function spaced(code: number | null): State | undefined {
    if (!markdownSpace(code)) return nok(code)
    effects.exit(types.data)
    return ok(code)
  }

  function literal(code: number | null): State | undefined {
    effects.enter(types.data)
    effects.consume(code)
    effects.exit(types.data)
    return ok(code)
  }
}

const proseDollarSign: Construct = {
  name: 'proseDollarSign',
  previous: previousDollarSign,
  tokenize: tokenizeProseDollarSign,
}

const proseDollarGuardExtension: Extension = {
  text: { [codes.dollarSign]: proseDollarSign },
}

/**
 * Keep prose dollar signs from being parsed as TeX text math, as a micromark
 * syntax extension for `fromMarkdown`. The caller must register it *after*
 * `math()`: combined text constructs run in reverse registration order, so this
 * one has to come last to be tried before the upstream text-math construct.
 * @returns The micromark syntax extension.
 */
export function proseDollarGuard(): Extension {
  return proseDollarGuardExtension
}
