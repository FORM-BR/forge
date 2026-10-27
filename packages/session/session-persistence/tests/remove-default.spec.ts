import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'

/** A backend that implements only the abstract surface. */
class ReadOnlyBackend extends SessionPersistence {
  create = (): never => { throw new Error('unused') }
  open = (): never => { throw new Error('unused') }
  flush = (): Promise<void> => Promise.resolve()
  stat = (): Promise<undefined> => Promise.resolve(undefined)
  list = (): Promise<[]> => Promise.resolve([])
}

describe('SessionPersistence.remove default', () => {
  it('rejects for a backend that cannot remove sessions', async () => {
    const backend = new ReadOnlyBackend(new Context())
    await expect(backend.remove(SessionId('any')))
      .rejects.toThrow('session "any" cannot be removed: this session persistence backend does not support removal')
  })
})
