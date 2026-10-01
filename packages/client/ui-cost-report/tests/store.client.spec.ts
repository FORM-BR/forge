/**
 * The panel filter store: the inclusive day range and the workspace/model
 * toggles, and how each mutation reads back.
 */
import { describe, expect, it } from 'vitest'
import { createCostReportStore } from '../src/client/cost-report-store.ts'

function snapshotOf() {
  const instance = createCostReportStore().create()
  return { actions: instance.actions, snapshot: () => instance.getSnapshot() }
}

describe('cost report filter store', () => {
  it('starts with an open range and no toggles', () => {
    const { actions, snapshot } = snapshotOf()
    expect(snapshot()).toEqual({ fromDay: '', toDay: '', cwd: null, model: null, currency: 'USD' })
    actions.setRange('2026-09-01', '2026-09-30')
    expect(snapshot()).toEqual({ fromDay: '2026-09-01', toDay: '2026-09-30', cwd: null, model: null, currency: 'USD' })
    actions.setRange('', '')
    expect(snapshot()).toEqual({ fromDay: '', toDay: '', cwd: null, model: null, currency: 'USD' })
  })

  it('replaces both bounds together and keeps an empty string as an open bound', () => {
    const { actions, snapshot } = snapshotOf()
    actions.setRange('2026-09-01', '')
    expect(snapshot().fromDay).toBe('2026-09-01')
    expect(snapshot().toDay).toBe('')
    actions.setRange('', '2026-10-31')
    expect(snapshot().fromDay).toBe('')
    expect(snapshot().toDay).toBe('2026-10-31')
  })

  it('toggles the workspace and model filters on and off', () => {
    const { actions, snapshot } = snapshotOf()
    actions.setCwd('/w1')
    actions.setModel('deepseek/deepseek-v4-flash')
    expect(snapshot()).toEqual({ fromDay: '', toDay: '', cwd: '/w1', model: 'deepseek/deepseek-v4-flash', currency: 'USD' })
    actions.setCwd(null)
    expect(snapshot().cwd).toBeNull()
    expect(snapshot().model).toBe('deepseek/deepseek-v4-flash')
    actions.setModel(null)
    expect(snapshot().model).toBeNull()
  })

  it('keeps a previous selection explicit so a later open range stays distinct', () => {
    const { actions, snapshot } = snapshotOf()
    actions.setRange('2026-09-01', '2026-09-30')
    actions.setCwd('/w1')
    actions.setRange('', '')
    expect(snapshot()).toEqual({ fromDay: '', toDay: '', cwd: '/w1', model: null, currency: 'USD' })
  })

  it('switches the display currency without touching the filters', () => {
    const { actions, snapshot } = snapshotOf()
    actions.setCwd('/w1')
    actions.setCurrency('BRL')
    expect(snapshot()).toEqual({ fromDay: '', toDay: '', cwd: '/w1', model: null, currency: 'BRL' })
  })
})
