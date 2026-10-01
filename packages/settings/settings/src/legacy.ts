/**
 * Compatibility layer for plugins written against the 0.1.x settings API
 * (`ctx.settings.register(...)` and `settingsNamespace(...)`).
 *
 * From 0.2 a plugin's settings are the volatile fields of its own Loader entry, so the namespace
 * registry is gone. Third-party plugins that still register a namespace keep working here: the
 * section lives in `<profile>/legacy-settings/<ns>.json` and resolves through the plugin's schema.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type z from '@deepseek-ai/schemastery'
import { redactSecrets } from './redact.ts'
import type { SettingsNamespace } from './types.ts'

const NAMESPACE_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u

/** Validate and brand a 0.1.x settings namespace. */
export function settingsNamespace<const Namespace extends string>(value: Namespace): SettingsNamespace {
  if (!NAMESPACE_PATTERN.test(value)) {
    throw new TypeError(`settings namespace "${value}" must match ${String(NAMESPACE_PATTERN)}`)
  }
  return value as unknown as SettingsNamespace
}

/** Registration options of the 0.1.x API. */
export interface SettingsRegisterOptions<T> {
  /** Composition-layer values resolved below the stored section. */
  base?: Partial<T>
  /** Effect timing; every legacy namespace applies live. */
  applies?: 'live' | 'restart'
  /** Reject a resolved section the owner could not act on. */
  validate?: (value: T) => void
}

/** Owner-facing handle for one registered namespace. */
export interface SettingsScope<T> {
  /** Current resolved value: schema defaults, then `base`, then the stored section. */
  get(): T
  /** Observe committed changes; callbacks run one at a time in commit order. */
  watch(callback: (next: T, prev: T) => void | Promise<void>): () => void
  /** Merge a partial patch into the stored section and persist it. */
  update(patch: object): Promise<void>
  /** Replace the stored section wholesale; absent keys re-inherit `base` and defaults. */
  replace(section: object): Promise<void>
}

/** Wire-shaped view of a legacy namespace, matching the entry descriptors. */
export interface LegacyDescriptor {
  autoGenerate: boolean
  ns: SettingsNamespace
  schema: unknown
  value: unknown
  revision: number
  base?: unknown
  user?: unknown
  applies: 'live'
  secrets?: ReturnType<typeof redactSecrets>['secrets']
}

interface Watcher {
  callback: (next: never, prev: never) => void | Promise<void>
  tail: Promise<void>
  active: boolean
}

interface Registration {
  ns: SettingsNamespace
  schema: z<unknown>
  base: unknown
  validate?: (value: never) => void
  section: Record<string, unknown>
  resolved: unknown
  revision: number
  watchers: Set<Watcher>
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function merge(under: unknown, over: unknown): unknown {
  if (!isPlainObject(under) || !isPlainObject(over)) return over === undefined ? under : over
  const result: Record<string, unknown> = { ...under }
  for (const [key, value] of Object.entries(over)) {
    if (value === undefined) continue
    result[key] = Object.hasOwn(result, key) ? merge(result[key], value) : value
  }
  return result
}

function jsonShaped(value: object): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>
}

/** Registry of legacy namespaces for one profile. */
export class LegacySettings {
  private readonly registrations = new Map<string, Registration>()

  /**
   * @param directory - folder holding one JSON section per namespace.
   * @param onChange - notified with the namespace and its new revision after each stored change.
   * @param warn - sink for contained watcher failures.
   */
  constructor(
    private readonly directory: string,
    private readonly onChange: (ns: SettingsNamespace, revision: number) => void,
    private readonly warn: (error: unknown) => void,
  ) {}

  /** Whether `ns` is currently registered by a legacy plugin. */
  has(ns: string): boolean { return this.registrations.has(ns) }

  /**
   * Register a namespace; the returned disposer removes it (tie it to the calling fiber).
   * @throws when the namespace is malformed, already registered, or its stored section is invalid.
   */
  register<T>(
    ns: string, schema: z<T>, options?: SettingsRegisterOptions<T>,
  ): { scope: SettingsScope<T>; dispose: () => void } {
    const parsed = settingsNamespace(ns)
    if (this.registrations.has(parsed)) throw new Error(`settings namespace "${parsed}" is already registered`)
    const registration: Registration = {
      ns: parsed,
      schema: schema as z<unknown>,
      base: options?.base,
      ...options?.validate === undefined ? {} : { validate: options.validate as (value: never) => void },
      section: this.read(parsed),
      resolved: undefined,
      revision: 0,
      watchers: new Set(),
    }
    registration.resolved = this.resolve(registration, registration.section)
    this.registrations.set(parsed, registration)
    const scope: SettingsScope<T> = {
      get: () => registration.resolved as T,
      watch: (callback) => {
        const watcher: Watcher = { callback: callback as Watcher['callback'], tail: Promise.resolve(), active: true }
        registration.watchers.add(watcher)
        return () => {
          watcher.active = false
          registration.watchers.delete(watcher)
        }
      },
      update: patch => this.write(parsed, merge(registration.section, jsonShaped(patch)) as Record<string, unknown>),
      replace: section => this.write(parsed, jsonShaped(section)),
    }
    return { scope, dispose: () => { if (this.registrations.get(parsed) === registration) this.registrations.delete(parsed) } }
  }

  /** Merge a patch into a registered namespace, refusing a stale revision. */
  update(ns: string, patch: object, expectedRevision?: number): Promise<void> {
    const registration = this.registered(ns, expectedRevision)
    return this.write(registration.ns, merge(registration.section, jsonShaped(patch)) as Record<string, unknown>)
  }

  /** Replace a registered namespace's stored section, refusing a stale revision. */
  replace(ns: string, section: object, expectedRevision?: number): Promise<void> {
    const registration = this.registered(ns, expectedRevision)
    return this.write(registration.ns, jsonShaped(section))
  }

  /** Descriptors of every registered namespace, in the shape configuration UIs already consume. */
  describe(options?: { redactSecrets?: boolean }): LegacyDescriptor[] {
    return [...this.registrations.values()].map((registration) => {
      const schema = registration.schema
      const base = this.resolve(registration, {})
      const redact = (value: unknown) => redactSecrets(schema as z<never>, value as never)
      const value = redact(registration.resolved)
      return {
        autoGenerate: true,
        ns: registration.ns,
        schema: schema.toJSON(),
        value: options?.redactSecrets ? value.value : registration.resolved,
        base: options?.redactSecrets ? redact(base).value : base,
        user: options?.redactSecrets ? redact(registration.section).value : registration.section,
        revision: registration.revision,
        applies: 'live' as const,
        ...options?.redactSecrets ? { secrets: value.secrets } : {},
      }
    })
  }

  private registered(ns: string, expectedRevision?: number): Registration {
    const registration = this.registrations.get(ns)
    if (registration === undefined) throw new Error(`No configurable plugin entry "${ns}"`)
    if (expectedRevision !== undefined && registration.revision !== expectedRevision) {
      throw new Error(`settings namespace "${ns}" changed since it was read (expected revision ${String(expectedRevision)}, now ${String(registration.revision)})`)
    }
    return registration
  }

  private resolve(registration: Registration, section: Record<string, unknown>): unknown {
    const value = registration.schema(merge(registration.base, section) as never)
    registration.validate?.(value as never)
    return value
  }

  private file(ns: string): string { return join(this.directory, `${ns}.json`) }

  private read(ns: string): Record<string, unknown> {
    const file = this.file(ns)
    if (!existsSync(file)) return {}
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
    return isPlainObject(parsed) ? parsed : {}
  }

  private async write(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    const registration = this.registrations.get(ns)
    if (registration === undefined) throw new Error(`No configurable plugin entry "${ns}"`)
    // Validate before persisting so a refused write leaves the stored section untouched.
    const next = this.resolve(registration, section)
    mkdirSync(this.directory, { recursive: true })
    writeFileSync(this.file(ns), `${JSON.stringify(section, null, 2)}\n`)
    const previous = registration.resolved
    registration.section = section
    registration.resolved = next
    registration.revision += 1
    this.onChange(ns, registration.revision)
    if (JSON.stringify(previous) === JSON.stringify(next)) return
    for (const watcher of registration.watchers) {
      watcher.tail = watcher.tail.then(async () => {
        if (!watcher.active) return
        try { await watcher.callback(next as never, previous as never) } catch (error) { this.warn(error) }
      })
    }
  }
}
