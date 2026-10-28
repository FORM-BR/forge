/** The shipped Browser entry polls the FORGE repository for new releases. */
import { fileURLToPath } from 'node:url'
import { loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { expect, it } from 'vitest'

it('configures the update check for FORM-BR/forge', () => {
  const rows = loadOverlayPatches('update-check', fileURLToPath(new URL('../cordis.patch.yml', import.meta.url)))
    .flatMap(patch => patch.insert ?? []).filter(row => row.id === 'update-check')
  expect(rows).toHaveLength(1)
  expect(rows[0]!.name).toBe('@deepseek-ai/dsh-api-settings-controller/update-check')
  expect(rows[0]!.config).toMatchObject({ repository: 'FORM-BR/forge', intervalHours: 6 })
})
