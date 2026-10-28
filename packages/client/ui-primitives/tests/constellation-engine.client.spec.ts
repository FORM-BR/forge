import { describe, expect, it } from 'vitest'
import {
  addPulse, createScene, drawScene, parseRgb, stepScene,
  type Node, type Scene, type ScenePalette, type SceneTarget,
} from '../src/constellation/engine.ts'

const TAU = Math.PI * 2
const PALETTE: ScenePalette = { ink: [10, 20, 30], dot: [200, 210, 220] }

/** Deterministic uniform source (mulberry32). */
function seeded(seed: number): () => number {
  let state = seed
  return () => {
    state = (state + 0x6D2B79F5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function node(x: number, y: number, over: Partial<Node> = {}): Node {
  return { x, y, z: 1, vx: 0, vy: 0, r: 1, lit: 0, ox: 0, oy: 0, near: 0, ...over }
}

/** A scene whose contents the test owns; clocks are parked far in the future. */
function sceneOf(nodes: Node[], over: Partial<Scene> = {}, rand: () => number = () => 0): Scene {
  const scene = createScene(400, 300, rand)
  return Object.assign(scene, { stars: [], nodes, signals: [], pulses: [], signalClock: 99, ambientClock: 99 }, over)
}

interface Call {
  op: string
  args: number[]
  stroke: string
  fill: string
  width: number
}

/** A drawing target that records every call with the style state at that moment. */
function recorder() {
  const calls: Call[] = []
  let stroke = ''
  let fill = ''
  let width = 0
  const log = (op: string, ...args: number[]) => { calls.push({ op, args, stroke, fill, width }) }
  const target: SceneTarget = {
    clearRect: (...args: number[]) => { log('clearRect', ...args) },
    beginPath: () => { log('beginPath') },
    moveTo: (x: number, y: number) => { log('moveTo', x, y) },
    lineTo: (x: number, y: number) => { log('lineTo', x, y) },
    arc: (x: number, y: number, r: number, from: number, to: number) => { log('arc', x, y, r, from, to) },
    stroke: () => { log('stroke') },
    fill: () => { log('fill') },
    get strokeStyle() { return stroke },
    set strokeStyle(value: string) { stroke = value },
    get fillStyle() { return fill },
    set fillStyle(value: string) { fill = value },
    get lineWidth() { return width },
    set lineWidth(value: number) { width = value },
  }
  return { target, calls, ops: (op: string) => calls.filter(call => call.op === op) }
}

describe('createScene', () => {
  it('clamps star and node counts at the lower limit for a small box', () => {
    const scene = createScene(100, 100, seeded(1))
    expect(scene.stars).toHaveLength(90)
    expect(scene.nodes).toHaveLength(40)
  })

  it('clamps star and node counts at the upper limit for a large box', () => {
    const scene = createScene(4000, 3000, seeded(1))
    expect(scene.stars).toHaveLength(520)
    expect(scene.nodes).toHaveLength(240)
  })

  it('scales the counts with the box area in between', () => {
    const scene = createScene(1000, 700, seeded(2))
    expect(scene.stars).toHaveLength(350)
    expect(scene.nodes).toHaveLength(175)
  })

  it('spreads dust and nodes with depth in range and starts idle', () => {
    const scene = createScene(1000, 700, seeded(3))
    for (const star of scene.stars) {
      expect(star.z).toBeGreaterThanOrEqual(0.15)
      expect(star.z).toBeLessThanOrEqual(1)
      expect(star.x).toBeGreaterThanOrEqual(0)
      expect(star.x).toBeLessThan(1)
    }
    for (const n of scene.nodes) {
      expect(n.z).toBeGreaterThanOrEqual(0.25)
      expect(n.z).toBeLessThanOrEqual(1)
      expect(Math.hypot(n.vx, n.vy)).toBeCloseTo(5 + 12 * n.z, 6)
      expect(n).toMatchObject({ lit: 0, ox: 0, oy: 0, near: 0 })
    }
    expect(scene).toMatchObject({ width: 1000, height: 700, signals: [], pulses: [], time: 0, parallaxX: 0, parallaxY: 0 })
    expect(scene.ambientClock).toBeGreaterThanOrEqual(2)
    expect(scene.ambientClock).toBeLessThan(5)
  })

  it('places a clustered node around a cluster center and a loose one uniformly', () => {
    // rand = 0.1: every node falls in the cluster share; the centers sit at 0.18.
    const clustered = createScene(1000, 1000, () => 0.1)
    expect(clustered.nodes[0]?.x).toBeCloseTo((0.18 + (0.1 - 0.5) * 0.3) * 1000, 6)
    expect(clustered.nodes[0]?.y).toBeCloseTo((0.18 + (0.1 - 0.5) * 0.36) * 1000, 6)
    // rand = 0.9: above the cluster share, so the node keeps its uniform position.
    const loose = createScene(1000, 1000, () => 0.9)
    expect(loose.nodes[0]?.x).toBeCloseTo(900, 6)
    expect(loose.nodes[0]?.y).toBeCloseTo(900, 6)
  })

  it('keeps the source for later spawns', () => {
    const rand = seeded(4)
    expect(createScene(100, 100, rand).rand).toBe(rand)
  })
})

describe('addPulse', () => {
  it('appends a fresh ring with full strength by default', () => {
    const scene = sceneOf([])
    addPulse(scene, 10, 20)
    addPulse(scene, 30, 40, 0.5)
    expect(scene.pulses).toEqual([
      { x: 10, y: 20, age: 0, strength: 1 },
      { x: 30, y: 40, age: 0, strength: 0.5 },
    ])
  })
})

describe('stepScene', () => {
  it('moves nodes along their velocity and advances time', () => {
    const scene = sceneOf([node(100, 100, { vx: 10, vy: -20 })])
    stepScene(scene, 0.5, null)
    expect(scene.time).toBe(0.5)
    expect(scene.nodes[0]).toMatchObject({ x: 105, y: 90 })
  })

  it('wraps nodes across all four borders', () => {
    const scene = sceneOf([node(-30, 100), node(430, 100), node(100, -30), node(100, 330)])
    stepScene(scene, 0.1, null)
    expect(scene.nodes.map(n => [n.x, n.y])).toEqual([[418, 100], [-18, 100], [100, 318], [100, -18]])
  })

  it('pulls nearby nodes toward the pointer and lets them settle without it', () => {
    const scene = sceneOf([node(100, 100), node(100, 290)])
    stepScene(scene, 0.1, { x: 150, y: 100 })
    const [near, far] = scene.nodes as [Node, Node]
    expect(near.near).toBeCloseTo(1 - 50 / 190, 6)
    expect(near.ox).toBeGreaterThan(0)
    expect(near.oy).toBeCloseTo(0, 9)
    expect(far.near).toBe(0)
    expect(far.ox).toBe(0)
    const pulled = near.ox
    stepScene(scene, 0.1, null)
    expect(near.near).toBe(0)
    expect(near.ox).toBeLessThan(pulled)
    expect(near.ox).toBeGreaterThan(0)
  })

  it('eases the parallax toward the pointer and back', () => {
    const scene = sceneOf([])
    stepScene(scene, 0.1, { x: 400, y: 0 })
    expect(scene.parallaxX).toBeCloseTo(0.5 * 0.25, 9)
    expect(scene.parallaxY).toBeCloseTo(-0.5 * 0.25, 9)
    const x = scene.parallaxX
    stepScene(scene, 0.1, null)
    expect(scene.parallaxX).toBeLessThan(x)
    stepScene(scene, 5, { x: 400, y: 0 })
    expect(scene.parallaxX).toBeCloseTo(0.5, 9)
  })

  it('decays the light of a node toward zero', () => {
    const scene = sceneOf([node(100, 100, { lit: 1 })])
    stepScene(scene, 0.5, null)
    expect(scene.nodes[0]?.lit).toBeCloseTo(1 - 0.5 * 0.85, 9)
    stepScene(scene, 5, null)
    expect(scene.nodes[0]?.lit).toBe(0)
  })

  it('lights the nodes a pulse ring crosses and drops it past the diagonal', () => {
    const scene = sceneOf([node(86, 0), node(300, 0)])
    addPulse(scene, 0, 0)
    stepScene(scene, 0.2, null)
    expect(scene.nodes[0]?.lit).toBe(1)
    expect(scene.nodes[1]?.lit).toBe(0)
    expect(scene.pulses).toHaveLength(1)
    expect(scene.pulses[0]?.age).toBeCloseTo(0.2, 9)
    stepScene(scene, 1.2, null)
    expect(scene.pulses).toHaveLength(0)
  })

  it('keeps the brighter of two lights on a node', () => {
    const scene = sceneOf([node(86, 0)])
    addPulse(scene, 0, 0, 0.3)
    stepScene(scene, 0.2, null)
    expect(scene.nodes[0]?.lit).toBe(0.3)
  })

  it('advances a signal and lights its target on arrival', () => {
    const scene = sceneOf([node(0, 0), node(50, 0)], {
      signals: [{ from: 0, to: 1, t: 0.1, speed: 1 }, { from: 0, to: 1, t: 0.9, speed: 1 }],
    })
    stepScene(scene, 0.2, null)
    expect(scene.signals).toHaveLength(1)
    expect(scene.signals[0]?.t).toBeCloseTo(0.3, 9)
    expect(scene.nodes[1]?.lit).toBeCloseTo(0.8, 9)
  })

  it('spawns a signal toward a neighbour when the clock runs out', () => {
    // rand = 0 picks node 0, starts the neighbour scan at node 0 (skipped as the source), and finds node 1.
    const scene = sceneOf([node(0, 0), node(50, 0)], { signalClock: 0 }, () => 0)
    stepScene(scene, 0.01, null)
    expect(scene.signals).toEqual([{ from: 0, to: 1, t: 0, speed: 0.7 }])
    expect(scene.signalClock).toBeCloseTo(0.15, 9)
  })

  it('spawns nothing when no node is within link distance', () => {
    const scene = sceneOf([node(0, 0), node(300, 0)], { signalClock: 0 }, () => 0)
    stepScene(scene, 0.01, null)
    expect(scene.signals).toHaveLength(0)
    expect(scene.signalClock).toBeCloseTo(0.15, 9)
  })

  it('caps the number of signals in flight', () => {
    const flying = Array.from({ length: 14 }, () => ({ from: 0, to: 1, t: 0.5, speed: 0.01 }))
    const scene = sceneOf([node(0, 0), node(50, 0)], { signalClock: 0, signals: flying }, () => 0)
    stepScene(scene, 0.01, null)
    expect(scene.signals).toHaveLength(14)
    expect(scene.signalClock).toBeCloseTo(0.15, 9)
  })

  it('does not spawn signals with fewer than two nodes', () => {
    const scene = sceneOf([node(0, 0)], { signalClock: 0 }, () => 0)
    stepScene(scene, 0.01, null)
    expect(scene.signals).toHaveLength(0)
    expect(scene.signalClock).toBeLessThan(0)
  })

  it('sends a faint ambient pulse from a node and rearms the clock', () => {
    const scene = sceneOf([node(120, 80)], { ambientClock: 0 }, () => 0)
    stepScene(scene, 0.01, null)
    expect(scene.pulses).toEqual([{ x: 120, y: 80, age: 0, strength: 0.55 }])
    expect(scene.ambientClock).toBe(6)
  })

  it('skips the ambient pulse when there is no node', () => {
    const scene = sceneOf([], { ambientClock: 0 }, () => 0)
    stepScene(scene, 0.01, null)
    expect(scene.pulses).toHaveLength(0)
    expect(scene.ambientClock).toBe(6)
  })

  it('runs a whole seeded scene for a while without leaving the box or the caps', () => {
    const scene = createScene(600, 400, seeded(9))
    for (let i = 0; i < 600; i++) stepScene(scene, 1 / 60, i % 2 === 0 ? { x: 300, y: 200 } : null)
    expect(scene.signals.length).toBeLessThanOrEqual(14)
    for (const n of scene.nodes) {
      expect(n.x).toBeGreaterThanOrEqual(-24 - 1)
      expect(n.x).toBeLessThanOrEqual(624 + 1)
    }
  })
})

describe('drawScene', () => {
  const rgba = (color: readonly number[], alpha: string) => `rgba(${color.join(',')},${alpha})`

  it('clears the box first', () => {
    const rec = recorder()
    drawScene(rec.target, sceneOf([]), null, PALETTE)
    expect(rec.calls[0]).toMatchObject({ op: 'clearRect', args: [0, 0, 400, 300] })
  })

  it('batches dust by twinkled alpha and skips empty buckets', () => {
    const rec = recorder()
    const half = Math.PI / 2
    const scene = sceneOf([], {
      stars: [
        { x: 0.5, y: 0.5, z: 1, r: 1, alpha: 0.8, phase: half, twinkle: 0 },
        { x: 0.25, y: 0.5, z: 1, r: 1, alpha: 0.1, phase: half, twinkle: 0 },
        { x: 0.75, y: 0.5, z: 0.5, r: 1, alpha: 0.1, phase: half, twinkle: 0 },
        { x: 0.1, y: 0.1, z: 1, r: 1, alpha: 5, phase: half, twinkle: 0 },
      ],
    })
    drawScene(rec.target, scene, null, PALETTE)
    const fills = rec.ops('fill')
    // alpha 0.8 -> bucket 6, 0.1 -> bucket 0 (two stars), 5 clamps to the last bucket.
    expect(fills.map(f => f.fill)).toEqual([rgba(PALETTE.dot, '0.063'), rgba(PALETTE.dot, '0.813'), rgba(PALETTE.dot, '0.938')])
    // A star at full depth draws at 1.2x its radius from its box position.
    expect(rec.ops('moveTo').some(c => c.args[0] === 200 + 1.2 && c.args[1] === 150)).toBe(true)
    expect(rec.ops('arc').some(c => c.args[0] === 200 && c.args[1] === 150 && c.args[2] === 1.2)).toBe(true)
  })

  it('shifts dust and nodes with the parallax by depth', () => {
    const rec = recorder()
    const scene = sceneOf([node(100, 100, { z: 1 })], {
      parallaxX: 0.5,
      parallaxY: -0.5,
      stars: [{ x: 0.5, y: 0.5, z: 1, r: 1, alpha: 0.5, phase: Math.PI / 2, twinkle: 0 }],
    })
    drawScene(rec.target, scene, null, PALETTE)
    const arcs = rec.ops('arc')
    expect(arcs[0]?.args.slice(0, 2)).toEqual([200 - 0.5 * 22, 150 + 0.5 * 22])
    expect(arcs.at(-1)?.args.slice(0, 2)).toEqual([100 - 0.5 * 22 * 0.5, 100 + 0.5 * 22 * 0.5])
  })

  it('links nodes within range by distance and drops distant pairs', () => {
    const rec = recorder()
    drawScene(rec.target, sceneOf([node(0, 0), node(66, 0), node(300, 0)]), null, PALETTE)
    const strokes = rec.ops('stroke').filter(c => c.width === 0.7)
    // Only the pair at distance 66 survives: k = 0.5, depth 1 -> alpha 0.19 -> bucket 1.
    expect(strokes).toHaveLength(1)
    expect(strokes[0]?.stroke).toBe(rgba(PALETTE.ink, '0.188'))
    const lines = rec.ops('lineTo')
    expect(lines).toHaveLength(1)
    expect(lines[0]?.args).toEqual([66, 0])
  })

  it('drops a link that would be too faint to see', () => {
    const rec = recorder()
    drawScene(rec.target, sceneOf([node(0, 0), node(131.9, 0)]), null, PALETTE)
    expect(rec.ops('stroke')).toHaveLength(0)
    expect(rec.ops('lineTo')).toHaveLength(0)
  })

  it('brightens a link whose nodes are lit', () => {
    const rec = recorder()
    drawScene(rec.target, sceneOf([node(0, 0, { lit: 1 }), node(66, 0, { lit: 1 })]), null, PALETTE)
    const stroke = rec.ops('stroke').find(c => c.width === 0.7)
    // alpha = 0.5 * (0.12 + 0.26 + 0.5) = 0.44 -> bucket 3.
    expect(stroke?.stroke).toBe(rgba(PALETTE.ink, '0.438'))
  })

  it('draws pointer lines only for nodes near the pointer', () => {
    const rec = recorder()
    const scene = sceneOf([node(100, 100, { near: 0.5, z: 1 }), node(300, 250, { near: 0.01 }), node(200, 250)])
    drawScene(rec.target, scene, { x: 90, y: 80 }, PALETTE)
    const strokes = rec.ops('stroke').filter(c => c.width === 0.8)
    expect(strokes).toHaveLength(1)
    expect(strokes[0]?.stroke).toBe(rgba(PALETTE.ink, '0.210'))
    const moves = rec.ops('moveTo').filter(c => c.args[0] === 90 && c.args[1] === 80)
    expect(moves).toHaveLength(1)
    expect(rec.ops('lineTo')).toContainEqual(expect.objectContaining({ args: [100, 100] }))
  })

  it('leaves pointer lines out without a pointer', () => {
    const rec = recorder()
    drawScene(rec.target, sceneOf([node(100, 100, { near: 0.9 })]), null, PALETTE)
    expect(rec.ops('stroke').filter(c => c.width === 0.8)).toHaveLength(0)
  })

  it('draws pulse rings that fade as they reach the diagonal', () => {
    const rec = recorder()
    const scene = sceneOf([], { pulses: [{ x: 50, y: 60, age: 0.2, strength: 1 }] })
    drawScene(rec.target, scene, null, PALETTE)
    const radius = 0.2 * 430
    const ring = rec.ops('arc').find(c => c.args[2] === radius)
    expect(ring?.args).toEqual([50, 60, radius, 0, TAU])
    expect(ring?.width).toBe(1)
    const stroke = rec.ops('stroke').find(c => c.width === 1)
    expect(stroke?.stroke).toBe(rgba(PALETTE.ink, (0.28 * (1 - radius / 500)).toFixed(3)))
  })

  it('draws a signal dash centered on its travelled position', () => {
    const rec = recorder()
    const scene = sceneOf([node(0, 0), node(100, 0)], { signals: [{ from: 0, to: 1, t: 0.5, speed: 1 }] })
    drawScene(rec.target, scene, null, PALETTE)
    const stroke = rec.ops('stroke').find(c => c.width === 1.9)
    expect(stroke?.stroke).toBe(rgba(PALETTE.ink, '0.900'))
    const moves = rec.ops('moveTo')
    const dashStart = moves.find(c => c.args[0] === 43 && c.args[1] === 0)
    expect(dashStart).toBeDefined()
    expect(rec.ops('lineTo').some(c => c.args[0] === 57 && c.args[1] === 0)).toBe(true)
  })

  it('draws a signal between coincident nodes without dividing by zero', () => {
    const rec = recorder()
    const scene = sceneOf([node(20, 20), node(20, 20)], { signals: [{ from: 0, to: 1, t: 0.5, speed: 1 }] })
    drawScene(rec.target, scene, null, PALETTE)
    const dash = rec.ops('moveTo').filter(c => c.width === 1.9)
    expect(dash).toHaveLength(1)
    expect(dash[0]?.args.every(Number.isFinite)).toBe(true)
  })

  it('paints resting nodes with the dot tone and lit or near nodes with the ink tone', () => {
    const rec = recorder()
    const scene = sceneOf([
      node(10, 10, { z: 1, r: 1 }),
      node(200, 10, { z: 1, r: 1, lit: 1 }),
      node(300, 200, { z: 0.5, r: 2, near: 1 }),
    ])
    drawScene(rec.target, scene, null, PALETTE)
    const fills = rec.ops('fill')
    // Resting: alpha 0.38 + 0.5 = 0.88; lit: min(1, 0.88 + 0.45) = 1; near (glow 0.6): 0.38 + 0.25 + 0.27 = 0.9.
    expect(fills.map(f => f.fill)).toEqual([
      rgba(PALETTE.dot, '0.880'),
      rgba(PALETTE.ink, '1.000'),
      rgba(PALETTE.ink, '0.900'),
    ])
    const arcs = rec.ops('arc')
    expect(arcs[0]?.args[2]).toBeCloseTo(1.3, 9)
    expect(arcs[1]?.args[2]).toBeCloseTo(1.3 + 1.4, 9)
    expect(arcs[2]?.args[2]).toBeCloseTo(2 * 1 + 0, 9)
  })
})

describe('parseRgb', () => {
  const fallback = [1, 2, 3] as const

  it('reads comma and space rgb forms and ignores alpha', () => {
    expect(parseRgb('rgb(10, 20, 30)', fallback)).toEqual([10, 20, 30])
    expect(parseRgb('rgba(10, 20, 30, 0.5)', fallback)).toEqual([10, 20, 30])
    expect(parseRgb('rgb(10 20 30 / 50%)', fallback)).toEqual([10, 20, 30])
  })

  it('scales color(srgb ...) channels to bytes', () => {
    expect(parseRgb('color(srgb 1 0.5 0)', fallback)).toEqual([255, 128, 0])
    expect(parseRgb('color(srgb 0.2 0.4 0.6 / 0.3)', fallback)).toEqual([51, 102, 153])
  })

  it('falls back for anything else', () => {
    expect(parseRgb('', fallback)).toBe(fallback)
    expect(parseRgb('#ff0000', fallback)).toBe(fallback)
    expect(parseRgb('oklch(0.5 0.1 200)', fallback)).toBe(fallback)
  })
})
