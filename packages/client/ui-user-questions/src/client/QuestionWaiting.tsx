/** Composer seat while a question is pending: the answer surface is pinned above the transcript. */
import { IconChevronUpOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { PendingQuestion } from './contract/slots.ts'
import css from './QuestionWaiting.module.css'

/** Props of the composer seat that stands in for the question card. */
export type QuestionWaitingProps =
  PropsRuntime<'conversation.composer'>
  & { matched: PendingQuestion }
  & PropsLocale<'question'>

/**
 * Hold the composer seat while the Session waits for an answer. The question
 * itself is pinned above the transcript, so this seat names where to look
 * instead of rendering a second copy of the same question.
 * @param props - the matched pending question and the standard locale seat.
 * @returns the waiting strip that replaces the composer.
 */
export function QuestionWaiting({ t }: QuestionWaitingProps) {
  return (
    <div className={css.waiting} role="status" data-question-waiting="">
      <IconChevronUpOutlineRegular size={14} />
      <span className={css.text}>{t('composer.waiting')}</span>
    </div>
  )
}
