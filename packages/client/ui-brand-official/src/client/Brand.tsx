import { ForgeLogo, ForgeWordmark } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SidebarBrandMarkOwnerProps, SidebarBrandNameOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'

/**
 * Render the product mark with the presentation requested by its host surface.
 * @param props - Host-supplied mark presentation.
 * @returns the FORGE mark.
 */
export function OfficialBrandMark({ size }: SidebarBrandMarkOwnerProps) {
  return <ForgeLogo size={size} />
}

/**
 * Render the product name artwork without its independently slotted mark.
 * @param props - Host-supplied localized product name.
 * @returns the FORGE wordmark.
 */
export function OfficialBrandName({ label }: SidebarBrandNameOwnerProps) {
  return <ForgeWordmark label={label} />
}
