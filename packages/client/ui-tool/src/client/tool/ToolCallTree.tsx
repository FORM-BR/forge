/** Root/subcall Tool composition with one keyed atomic dispatch path. */
import { memo, useMemo, type ReactNode } from 'react'
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ToolCallHookContext, ToolCallOwnerProps, ToolCallPhaseProps, ToolTreeProps } from '../contract/slots.ts'
import { toolRowModel } from './models/tool-call-model.ts'
import { GenericToolCard } from './toolviews/GenericToolCard.tsx'
import css from './ToolCallTree.module.css'

function toolCallPhase(block: ToolCallBlock): ToolCallPhaseProps {
  if ('kind' in block) return { phase: 'result', block }
  return block.phase === 'preparing' ? { phase: 'preparing', block } : { phase: 'start', block }
}

/** Cua Driver computer-use tools: any tool whose name lands in this MCP namespace. */
const CUA_PREFIX = 'mcp__cua-driver-mcp__'
function isCuaDriver(toolName: string): boolean {
  return toolName.startsWith(CUA_PREFIX)
}

/**
 * Capture scope of a Cua Driver call, as a hook for the frame's CSS variants:
 * whole-screen shots vs single-window/action captures. Every fallback call
 * still gets the teal frame; the scope only tunes it later if we want to
 * distinguish "agent owns the whole desktop" from "agent is in one window".
 */
function cuaScope(toolName: string): string {
  if (toolName.endsWith('get_desktop_state')) return 'desktop'
  if (
    toolName.endsWith('get_window_state') ||
    toolName.endsWith('get_browser_state') ||
    toolName.endsWith('get_screen_size')
  ) return 'window'
  return 'action'
}

/** Resolve a Tool call's wire name from its current stage. */
function callName(call: ToolCallPhaseProps): string {
  return call.phase === 'result' ? call.block.call?.name ?? '' : call.block.name
}

/** One atomic call dispatched through the Tool-owned keyed slot. */
const ToolCall = memo(function ToolCall({
  renderSlot, callId, toolName, call, assistant, openFile, cwd, home, inspectCall, loadImage, useDisclosure, t, children,
}: Pick<ToolTreeProps, 'renderSlot' | 'openFile' | 'cwd' | 'inspectCall' | 'loadImage' | 'useDisclosure' | 't'> & {
  callId: string
  toolName: string
  call: ToolCallPhaseProps
  assistant: ToolCallHookContext['assistant']
  home?: string | undefined
  children?: ReactNode
}) {
  const preparing = call.phase === 'preparing'
  const hookContext = useMemo<ToolCallHookContext>(() => ({
    callId, assistant: preparing ? assistant : undefined,
  }), [assistant, callId, preparing])
  const owner: ToolCallOwnerProps = useMemo(() => ({
    callId,
    toolName,
    ...call,
    openFile,
    cwd,
    home,
    loadImage,
    useDisclosure,
    inspect: inspectCall === undefined ? undefined : () => { inspectCall(callId) },
  }), [callId, toolName, call, openFile, cwd, home, loadImage, inspectCall, useDisclosure])
  const autoReviewDenied = useMemo(
    () => call.phase === 'result' && toolRowModel(toolName, call.block).autoReviewDenial !== null,
    [toolName, call],
  )
  const cua = isCuaDriver(toolName)
  return (
    <div
      className={cua ? `${css.callRow} ${css.cuaFrame}` : css.callRow}
      data-chat-anchor-key={`call:${callId}`}
      data-chat-call-id={callId}
      data-cua-scope={cua ? cuaScope(toolName) : undefined}
    >
      {autoReviewDenied
        ? <GenericToolCard {...owner} t={t} />
        : renderSlot('tool.call.toolview', owner, {
          entryKey: toolName,
          hookContext,
          fallback: <GenericToolCard {...owner} t={t} />,
        })}
      {children}
    </div>
  )
})

const ToolCallBranch = memo(function ToolCallBranch({
  renderSlot, block, assistant, cwd, home, openFile, inspectCall, loadImage, useDisclosure, t,
}: Pick<ToolTreeProps, 'renderSlot' | 'cwd' | 'openFile' | 'inspectCall' | 'loadImage' | 'useDisclosure' | 't'> & {
  block: ToolCallBlock
  assistant: ToolCallHookContext['assistant']
  home?: string | undefined
}) {
  const call = useMemo(() => toolCallPhase(block), [block])
  return (
    <ToolCall
      renderSlot={renderSlot}
      callId={call.block.callId}
      toolName={callName(call)}
      call={call}
      assistant={assistant}
      openFile={openFile}
      cwd={cwd}
      home={home}
      inspectCall={inspectCall}
      useDisclosure={useDisclosure}
      loadImage={loadImage}
      t={t}
    >
      {call.phase !== 'preparing' && call.block.subCalls.length > 0 ? (
        <div className={css.subCalls} data-subcalls>
          {call.block.subCalls.map(child => (
            <ToolCallBranch
              key={child.callId}
              renderSlot={renderSlot}
              block={child}
              assistant={assistant}
              cwd={cwd}
              home={home}
              openFile={openFile}
              inspectCall={inspectCall}
              useDisclosure={useDisclosure}
              loadImage={loadImage}
              t={t}
            />
          ))}
        </div>
      ) : null}
    </ToolCall>
  )
})

/**
 * Render one root Tool call and its recursive children through the same
 * atomic keyed dispatch.
 * @param props - whole-Tool owner data and the Tool-owned child-slot share.
 * @returns the Tool call tree.
 */
export function ToolCallTree({
  renderSlot, node, cwd, openFile, inspectCall, loadImage, useDisclosure, useHostInfo, t,
}: ToolTreeProps) {
  const home = useHostInfo(info => info.home)
  const assistant = node.location.kind === 'step' ? node.location.step.data.source('assistant-step') : undefined
  return (
    <ToolCallBranch
      renderSlot={renderSlot}
      block={node.data.root}
      assistant={assistant}
      cwd={cwd}
      home={home}
      openFile={openFile}
      inspectCall={inspectCall}
      useDisclosure={useDisclosure}
      loadImage={loadImage}
      t={t}
    />
  )
}
