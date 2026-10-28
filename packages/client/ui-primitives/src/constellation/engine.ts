/**
 * Constellation scene model and renderer, free of DOM and timers. Three layers
 * give the field depth: twinkling dust that drifts with pointer parallax, a
 * network of nodes in loose clusters joined by lines, and signals that travel
 * along those lines. Pulses (pointer presses and periodic ambient ones) light
 * the nodes their ring crosses. Every distance is in CSS pixels and every
 * duration in seconds; the canvas component owns timing, size, and colors.
 */

/** One dust particle; position is a fraction of the box so resizes keep the spread. */
export interface Star {
  x: number
  y: number
  /** Depth in [0.15, 1]; near dust is larger, brighter, and moves more with parallax. */
  z: number
  r: number
  alpha: number
  phase: number
  /** Twinkle angular speed in rad/s. */
  twinkle: number
}

/** One network node in CSS pixels. */
export interface Node {
  x: number
  y: number
  /** Depth in [0.25, 1]; deep nodes are smaller, fainter, and slower. */
  z: number
  vx: number
  vy: number
  r: number
  /** Light left by a pulse or a signal, decaying to 0. */
  lit: number
  /** Eased displacement toward the pointer. */
  ox: number
  oy: number
  /** Pointer proximity in [0, 1] from the last step. */
  near: number
}

/** A bright dash travelling from node `from` to node `to`. */
export interface Signal {
  from: number
  to: number
  /** Progress in [0, 1]. */
  t: number
  /** Progress per second. */
  speed: number
}

/** An expanding ring that lights the nodes it crosses. */
export interface Pulse {
  x: number
  y: number
  age: number
  /** 1 for a pointer press, lower for ambient pulses. */
  strength: number
}

/** Pointer position in the scene's box. */
export interface ScenePointer {
  x: number
  y: number
}

/** Mutable scene state advanced by {@link stepScene}. */
export interface Scene {
  width: number
  height: number
  stars: Star[]
  nodes: Node[]
  signals: Signal[]
  pulses: Pulse[]
  /** Eased parallax offset in [-0.5, 0.5] per axis. */
  parallaxX: number
  parallaxY: number
  time: number
  signalClock: number
  ambientClock: number
  rand: () => number
}

/** RGB channels in [0, 255]. */
export type Rgb = readonly [number, number, number]

/** Colors the renderer paints with. */
export interface ScenePalette {
  /** Lines, signals, pulses, and lit nodes. */
  ink: Rgb
  /** Dust and resting nodes. */
  dot: Rgb
}

/** The slice of `CanvasRenderingContext2D` the renderer touches. */
export type SceneTarget = Pick<
  CanvasRenderingContext2D,
  'clearRect' | 'beginPath' | 'moveTo' | 'lineTo' | 'arc' | 'stroke' | 'fill' | 'strokeStyle' | 'fillStyle' | 'lineWidth'
>

const STAR_AREA = 2000
const STAR_MIN = 90
const STAR_MAX = 520
const NODE_AREA = 4000
const NODE_MIN = 40
const NODE_MAX = 240
const CLUSTERS = 5
const CLUSTER_SHARE = 0.4
const WRAP_MARGIN = 24
const LINK_DISTANCE = 132
const POINTER_RADIUS = 190
const POINTER_PULL = 0.13
const POINTER_EASE = 5
const PARALLAX_EASE = 2.5
const PARALLAX_SHIFT = 22
const LIT_DECAY = 0.85
const PULSE_SPEED = 430
const PULSE_BAND = 26
const SIGNAL_MAX = 14
const ALPHA_STEPS = 8
const TAU = Math.PI * 2

/**
 * Scale a count with the box area.
 * @returns the clamped count.
 */
function countFor(width: number, height: number, area: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(width * height / area)))
}

/**
 * Build a scene sized to its box.
 * @param width - box width in CSS pixels.
 * @param height - box height in CSS pixels.
 * @param rand - uniform source in [0, 1); kept for later spawns.
 * @returns a scene with dust and nodes scattered over the box.
 */
export function createScene(width: number, height: number, rand: () => number): Scene {
  const stars: Star[] = []
  for (let i = 0, n = countFor(width, height, STAR_AREA, STAR_MIN, STAR_MAX); i < n; i++) {
    const z = 0.15 + rand() * 0.85
    stars.push({
      x: rand(), y: rand(), z,
      r: 0.35 + rand() * 0.75,
      alpha: 0.3 + rand() * 0.55,
      phase: rand() * TAU,
      twinkle: 0.6 + rand() * 1.8,
    })
  }
  const centers: [number, number][] = []
  for (let i = 0; i < CLUSTERS; i++) centers.push([0.1 + rand() * 0.8, 0.1 + rand() * 0.8])
  const nodes: Node[] = []
  for (let i = 0, n = countFor(width, height, NODE_AREA, NODE_MIN, NODE_MAX); i < n; i++) {
    let fx = rand()
    let fy = rand()
    if (rand() < CLUSTER_SHARE) {
      const [cx, cy] = centers[i % CLUSTERS] as [number, number]
      fx = cx + (fx - 0.5) * 0.3
      fy = cy + (fy - 0.5) * 0.36
    }
    const z = 0.25 + rand() * 0.75
    const speed = 5 + 12 * z
    const angle = rand() * TAU
    nodes.push({
      x: fx * width, y: fy * height, z,
      vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      r: 0.6 + rand() * 0.9,
      lit: 0, ox: 0, oy: 0, near: 0,
    })
  }
  return {
    width, height, stars, nodes, signals: [], pulses: [],
    parallaxX: 0, parallaxY: 0, time: 0,
    signalClock: 0.2, ambientClock: 2 + rand() * 3, rand,
  }
}

/**
 * Start a pulse ring.
 * @param scene - scene to mutate.
 * @param x - ring center x.
 * @param y - ring center y.
 * @param strength - 1 for a pointer press, lower for ambient pulses.
 */
export function addPulse(scene: Scene, x: number, y: number, strength = 1): void {
  scene.pulses.push({ x, y, age: 0, strength })
}

/**
 * Pick a node near `from` to send a signal to.
 * @returns the target index, or -1 when no node is within link distance.
 */
function neighbourOf(scene: Scene, from: number): number {
  const a = scene.nodes[from] as Node
  const start = Math.floor(scene.rand() * scene.nodes.length)
  for (let k = 0; k < scene.nodes.length; k++) {
    const j = (start + k) % scene.nodes.length
    if (j === from) continue
    const b = scene.nodes[j] as Node
    if (Math.hypot(a.x - b.x, a.y - b.y) < LINK_DISTANCE) return j
  }
  return -1
}

/**
 * Advance the scene.
 * @param scene - scene to mutate.
 * @param dt - elapsed seconds (callers cap long frames).
 * @param pointer - pointer in the box, or null when outside.
 */
export function stepScene(scene: Scene, dt: number, pointer: ScenePointer | null): void {
  const { width, height, nodes } = scene
  scene.time += dt
  const ease = Math.min(1, dt * PARALLAX_EASE)
  const targetX = pointer === null ? 0 : pointer.x / width - 0.5
  const targetY = pointer === null ? 0 : pointer.y / height - 0.5
  scene.parallaxX += (targetX - scene.parallaxX) * ease
  scene.parallaxY += (targetY - scene.parallaxY) * ease

  const pull = Math.min(1, dt * POINTER_EASE)
  for (const node of nodes) {
    node.x += node.vx * dt
    node.y += node.vy * dt
    if (node.x < -WRAP_MARGIN) node.x += width + WRAP_MARGIN * 2
    else if (node.x > width + WRAP_MARGIN) node.x -= width + WRAP_MARGIN * 2
    if (node.y < -WRAP_MARGIN) node.y += height + WRAP_MARGIN * 2
    else if (node.y > height + WRAP_MARGIN) node.y -= height + WRAP_MARGIN * 2
    let tx = 0
    let ty = 0
    node.near = 0
    if (pointer !== null) {
      const dx = pointer.x - node.x
      const dy = pointer.y - node.y
      const d = Math.hypot(dx, dy)
      if (d < POINTER_RADIUS) {
        node.near = 1 - d / POINTER_RADIUS
        tx = dx * node.near * POINTER_PULL
        ty = dy * node.near * POINTER_PULL
      }
    }
    node.ox += (tx - node.ox) * pull
    node.oy += (ty - node.oy) * pull
    node.lit = Math.max(0, node.lit - dt * LIT_DECAY)
  }

  const reach = Math.hypot(width, height)
  scene.pulses = scene.pulses.filter((pulse) => {
    pulse.age += dt
    const radius = pulse.age * PULSE_SPEED
    for (const node of nodes) {
      const d = Math.hypot(node.x + node.ox - pulse.x, node.y + node.oy - pulse.y)
      if (Math.abs(d - radius) < PULSE_BAND) node.lit = Math.max(node.lit, pulse.strength)
    }
    return radius < reach
  })

  scene.signals = scene.signals.filter((signal) => {
    signal.t += signal.speed * dt
    if (signal.t < 1) return true
    const target = nodes[signal.to] as Node
    target.lit = Math.max(target.lit, 0.8)
    return false
  })
  scene.signalClock -= dt
  if (scene.signalClock <= 0 && nodes.length > 1) {
    scene.signalClock = 0.15 + scene.rand() * 0.3
    if (scene.signals.length < SIGNAL_MAX) {
      const from = Math.floor(scene.rand() * nodes.length)
      const to = neighbourOf(scene, from)
      if (to >= 0) scene.signals.push({ from, to, t: 0, speed: 0.7 + scene.rand() * 0.8 })
    }
  }
  scene.ambientClock -= dt
  if (scene.ambientClock <= 0) {
    scene.ambientClock = 6 + scene.rand() * 5
    const origin = nodes[Math.floor(scene.rand() * nodes.length)]
    if (origin !== undefined) addPulse(scene, origin.x, origin.y, 0.55)
  }
}

/**
 * Format one rgba() color string.
 * @returns the CSS color.
 */
function rgba(color: Rgb, alpha: number): string {
  return `rgba(${color[0]},${color[1]},${color[2]},${alpha.toFixed(3)})`
}

/**
 * Bucket index for an alpha in [0, 1].
 * @returns an index in [0, ALPHA_STEPS - 1].
 */
function step(alpha: number): number {
  return Math.min(ALPHA_STEPS - 1, Math.floor(alpha * ALPHA_STEPS))
}

/**
 * Paint the scene. Dust and links are batched into a few alpha buckets so a
 * frame issues tens of fill/stroke calls instead of hundreds.
 * @param target - 2D context (or a recording double in tests).
 * @param scene - scene to paint.
 * @param pointer - pointer in the box, or null.
 * @param palette - ink and dot colors.
 */
export function drawScene(target: SceneTarget, scene: Scene, pointer: ScenePointer | null, palette: ScenePalette): void {
  const { width, height, nodes, time } = scene
  target.clearRect(0, 0, width, height)

  const starBuckets: Star[][] = Array.from({ length: ALPHA_STEPS }, () => [])
  for (const star of scene.stars) {
    const alpha = star.alpha * (0.55 + 0.45 * Math.sin(time * star.twinkle + star.phase))
    starBuckets[step(alpha)]?.push(star)
  }
  starBuckets.forEach((bucket, index) => {
    if (bucket.length === 0) return
    target.fillStyle = rgba(palette.dot, (index + 0.5) / ALPHA_STEPS)
    target.beginPath()
    for (const star of bucket) {
      const x = star.x * width - scene.parallaxX * PARALLAX_SHIFT * star.z
      const y = star.y * height - scene.parallaxY * PARALLAX_SHIFT * star.z
      const r = star.r * (0.6 + 0.6 * star.z)
      target.moveTo(x + r, y)
      target.arc(x, y, r, 0, TAU)
    }
    target.fill()
  })

  const sx = nodes.map(node => node.x + node.ox - scene.parallaxX * PARALLAX_SHIFT * 0.5 * node.z)
  const sy = nodes.map(node => node.y + node.oy - scene.parallaxY * PARALLAX_SHIFT * 0.5 * node.z)
  const linkBuckets: number[][] = Array.from({ length: ALPHA_STEPS }, () => [])
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i] as Node
    const ax = sx[i] as number
    const ay = sy[i] as number
    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j] as Node
      const dx = ax - (sx[j] as number)
      const dy = ay - (sy[j] as number)
      const d2 = dx * dx + dy * dy
      if (d2 > LINK_DISTANCE * LINK_DISTANCE) continue
      const k = 1 - Math.sqrt(d2) / LINK_DISTANCE
      const depth = (a.z + b.z) * 0.5
      const alpha = k * (0.12 + 0.26 * depth + 0.5 * (a.lit + b.lit) * 0.5)
      if (alpha < 0.02) continue
      linkBuckets[step(alpha)]?.push(i, j)
    }
  }
  target.lineWidth = 0.7
  linkBuckets.forEach((bucket, index) => {
    if (bucket.length === 0) return
    target.strokeStyle = rgba(palette.ink, (index + 0.5) / ALPHA_STEPS)
    target.beginPath()
    for (let p = 0; p < bucket.length; p += 2) {
      const i = bucket[p] as number
      const j = bucket[p + 1] as number
      target.moveTo(sx[i] as number, sy[i] as number)
      target.lineTo(sx[j] as number, sy[j] as number)
    }
    target.stroke()
  })

  if (pointer !== null) {
    target.lineWidth = 0.8
    nodes.forEach((node, i) => {
      if (node.near < 0.02) return
      target.strokeStyle = rgba(palette.ink, 0.42 * node.near * (0.4 + 0.6 * node.z))
      target.beginPath()
      target.moveTo(pointer.x, pointer.y)
      target.lineTo(sx[i] as number, sy[i] as number)
      target.stroke()
    })
  }

  const reach = Math.hypot(width, height)
  target.lineWidth = 1
  for (const pulse of scene.pulses) {
    const radius = pulse.age * PULSE_SPEED
    target.strokeStyle = rgba(palette.ink, 0.28 * pulse.strength * (1 - radius / reach))
    target.beginPath()
    target.arc(pulse.x, pulse.y, radius, 0, TAU)
    target.stroke()
  }

  target.lineWidth = 1.9
  for (const signal of scene.signals) {
    const x0 = sx[signal.from] as number
    const y0 = sy[signal.from] as number
    const dx = (sx[signal.to] as number) - x0
    const dy = (sy[signal.to] as number) - y0
    const length = Math.hypot(dx, dy) || 1
    const ux = dx / length * 7
    const uy = dy / length * 7
    const x = x0 + dx * signal.t
    const y = y0 + dy * signal.t
    target.strokeStyle = rgba(palette.ink, 0.9 * Math.sin(Math.PI * signal.t))
    target.beginPath()
    target.moveTo(x - ux, y - uy)
    target.lineTo(x + ux, y + uy)
    target.stroke()
  }

  nodes.forEach((node, i) => {
    const glow = Math.max(node.lit, node.near * 0.6)
    const r = node.r * (0.7 + 0.6 * node.z) + node.lit * 1.4
    const alpha = Math.min(1, (0.38 + 0.5 * node.z) + 0.45 * glow)
    target.fillStyle = rgba(glow > 0.05 ? palette.ink : palette.dot, alpha)
    target.beginPath()
    target.arc(sx[i] as number, sy[i] as number, r, 0, TAU)
    target.fill()
  })
}

/**
 * Parse a computed CSS color (`rgb()`, `rgba()`, or `color(srgb …)`).
 * @param value - computed color string.
 * @param fallback - channels used when the string is not one of those forms.
 * @returns RGB channels in [0, 255].
 */
export function parseRgb(value: string, fallback: Rgb): Rgb {
  const srgb = /color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(value)
  if (srgb !== null) return channels(srgb, 255)
  const rgb = /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(value)
  if (rgb !== null) return channels(rgb, 1)
  return fallback
}

/**
 * Read three captured channel numbers.
 * @returns rounded channels scaled by `scale`.
 */
function channels(match: RegExpExecArray, scale: number): Rgb {
  return [
    Math.round(Number(match[1]) * scale),
    Math.round(Number(match[2]) * scale),
    Math.round(Number(match[3]) * scale),
  ]
}
