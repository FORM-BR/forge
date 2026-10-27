/** Persisted viewing preference of the model menu card: the size the user dragged it to. */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'

/** Local-storage key of the saved card size. */
const MODEL_MENU_STORE_KEY = 'dsh.model-menu'

/** Menu card preferences; `size` is null until the user first resizes the card. */
export type ModelMenuState = {
  size: { width: number; height: number } | null
}

/** Declared write set of the model menu store. */
type ModelMenuActions = {
  setSize: (draft: ModelMenuState, width: number, height: number) => void
}

/**
 * Declare the model menu preference store. The seat registers one shared
 * instance, so every composer in the page reads and writes the same size.
 * @returns the store handle.
 */
export function createModelMenuStore(): EngineStoreHandle<ModelMenuState, ModelMenuActions> {
  return defineStore({
    init: (): ModelMenuState => ({ size: null }),
    persist: MODEL_MENU_STORE_KEY,
    actions: {
      setSize: (d, width: number, height: number) => { d.size = { width, height } },
    },
  })
}
