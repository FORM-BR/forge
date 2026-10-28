// Shared IconActions chrome for user and assistant messages: copy
// live, optional rewind/branch wiring, and an optional date-aware clock.

import {
  useCallback, useEffect, useId, useRef, useState, type ReactNode,
} from 'react'
import {
  Button, IconBranchOutlineRegular, IconCheckOutlineRegular, IconCopyOutlineRegular, IconRewindOutlineRegular,
  Menu, Tooltip, writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import { formatMessageClock } from './message-chrome.ts'
import { useCalendarDay } from './use-calendar-day.ts'
import css from './MessageIconActions.module.css'

/** Rewind and branch share availability and the disabled-while-running reason; each keeps its own click handler. */
export interface MessageHistoryActions {
  onRewind?: (() => void) | undefined
  onBranch?: (() => void) | undefined
  /** The message is not eligible from the current loaded window (later non-rendered evidence follows it). */
  unavailable?: boolean | undefined
  /** A turn is running; both actions stay visible but inert with a dedicated reason. */
  disabledWhileRunning?: boolean | undefined
  /**
   * Rewind requires confirmation when more than one turn follows the cut
   * point; branch never asks. Ignored when `onRewind` is absent.
   */
  rewindConfirmRequired?: boolean | undefined
}

export interface MessageIconActionsProps extends MessageHistoryActions {
  /** Plain text the copy action writes. */
  text: string
  /** Unix epoch ms for the clock label; omitted for transient messages. */
  time?: number | undefined
  /** Clock before icons (user) or after (assistant). */
  clock: 'start' | 'end'
  /** Parent layout class composed onto the actions row. */
  className?: string | undefined
  /**
   * Slot-rendered actions owned by independent plugins, placed between the
   * built-in copy and rewind/branch controls.
   */
  extraActions?: ReactNode
  /**
   * Icon-row Turn-usage trigger (the TurnUsagePanel pill), seated after the
   * rewind/branch controls at the end of the icon cluster.
   */
  usageAction?: ReactNode
  /** The owning view's locale seat, passed down as a plain prop. */
  t: ChatViewSlotProps['t']
}

/**
 * Copy / branch (/ clock) IconActions row shared by user and assistant chrome.
 * @param props - Copy text, event time, clock side, rewind/branch callbacks, className.
 * @returns The actions row element.
 */
export function MessageIconActions({
  text, time, clock, onRewind, onBranch, unavailable = false, disabledWhileRunning = false,
  rewindConfirmRequired = false, className, extraActions, usageAction, t,
}: MessageIconActionsProps) {
  const day = useCalendarDay()
  const branchReasonId = useId()
  const rewindReasonId = useId()
  const [confirming, setConfirming] = useState(false)
  // Same success chrome as CodeBlock: a short check swap after the write,
  // gated so re-clicks during the window neither re-copy nor stack timers.
  const [copied, setCopied] = useState(false)
  const copyPending = useRef(false)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const copyEpoch = useRef(0)
  useEffect(() => () => {
    copyEpoch.current += 1
    copyPending.current = false
    if (copyTimer.current !== null) clearTimeout(copyTimer.current)
  }, [])
  const onCopy = useCallback(() => {
    if (copied || copyPending.current) return
    const epoch = copyEpoch.current
    copyPending.current = true
    void writeClipboard(text).then((ok) => {
      if (epoch !== copyEpoch.current) return
      copyPending.current = false
      if (!ok) return
      setCopied(true)
      copyTimer.current = window.setTimeout(() => {
        copyTimer.current = null
        setCopied(false)
      }, 1000)
    })
  }, [copied, text])
  const clockEl = time === undefined ? null : (
    <span className={clock === 'start' ? css.timeStart : css.timeEnd}>
      {formatMessageClock(time, t, day)}
    </span>
  )
  const inert = unavailable || disabledWhileRunning
  const branchLabel = disabledWhileRunning
    ? t('message.actionsDisabledWhileRunning')
    : unavailable ? t('message.branchUnavailable') : t('message.branch')
  const rewindLabel = disabledWhileRunning
    ? t('message.actionsDisabledWhileRunning')
    : unavailable ? t('message.rewindUnavailable') : t('message.rewind')
  const confirmRewind = useCallback(() => {
    setConfirming(false)
    onRewind?.()
  }, [onRewind])
  const rewindClick = useCallback(() => {
    if (inert) return
    if (rewindConfirmRequired) setConfirming(true)
    else onRewind?.()
  }, [inert, onRewind, rewindConfirmRequired])
  // Menu's own effects key on onClose identity; an inline arrow here would
  // recreate it every render and loop (see Menu.tsx's open-gated effects).
  const closeConfirm = useCallback(() => { setConfirming(false) }, [])
  return (
    <div className={className === undefined ? css.actions : `${css.actions} ${className}`} data-clock={clock}>
      {clock === 'start' ? clockEl : null}
      <Tooltip label={copied ? t('copied') : t('copy')} side="bottom">
        <button type="button" className={css.action} aria-label={copied ? t('copied') : t('copy')} onClick={onCopy}>
          {copied ? <IconCheckOutlineRegular /> : <IconCopyOutlineRegular />}
        </button>
      </Tooltip>
      {extraActions}
      {onRewind !== undefined && (
        <Menu
          open={confirming}
          onClose={closeConfirm}
          anchor={(
            <Tooltip label={rewindLabel} side="bottom">
              {/* Native disabled buttons do not deliver the hover/focus events Tooltip needs. */}
              <button
                type="button"
                className={css.action}
                aria-label={t('message.rewind')}
                aria-disabled={inert || undefined}
                aria-describedby={inert ? rewindReasonId : undefined}
                data-unavailable={inert || undefined}
                onClick={rewindClick}
              >
                <IconRewindOutlineRegular />
              </button>
            </Tooltip>
          )}
        >
          <div className={css.confirmPopover}>
            <p className={css.confirmText}>{t('message.rewindConfirm.body')}</p>
            <div className={css.confirmButtons}>
              <Button variant="outline" size="sm" onClick={closeConfirm}>
                {t('message.rewindConfirm.cancel')}
              </Button>
              <Button variant="primary" size="sm" onClick={confirmRewind}>
                {t('message.rewindConfirm.accept')}
              </Button>
            </div>
          </div>
        </Menu>
      )}
      {onRewind !== undefined && inert && (
        <span id={rewindReasonId} className={css.visuallyHidden}>{rewindLabel}</span>
      )}
      {onBranch !== undefined && (
        <Tooltip label={branchLabel} side="bottom">
          {/* Native disabled buttons do not deliver the hover/focus events Tooltip needs. */}
          <button
            type="button"
            className={css.action}
            aria-label={t('message.branch')}
            aria-disabled={inert || undefined}
            aria-describedby={inert ? branchReasonId : undefined}
            data-unavailable={inert || undefined}
            onClick={inert ? undefined : onBranch}
          >
            <IconBranchOutlineRegular />
          </button>
        </Tooltip>
      )}
      {onBranch !== undefined && inert && (
        <span id={branchReasonId} className={css.visuallyHidden}>{branchLabel}</span>
      )}
      {clock === 'end'
        ? <span className={css.endInfo}>{usageAction}{clockEl}</span>
        : usageAction}
    </div>
  )
}
