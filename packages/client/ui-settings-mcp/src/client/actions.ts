/** Failure of one panel write, with the Remote error code and the form field it points at. */
export class McpActionError extends Error {
  /**
   * @param message - the Host's explanation; it never quotes a submitted secret.
   * @param code - Remote error code, for example `mcpStatus/invalid`.
   * @param field - form field named by the Host, when it named one.
   */
  constructor(message: string, readonly code: string, readonly field?: string) {
    super(message)
    this.name = 'McpActionError'
  }
}

/**
 * Pull the field name out of a Remote failure's details.
 * @param details - the failure's `details` object.
 * @returns the `field` string when there is one.
 */
export function fieldOf(details: object): string | undefined {
  return 'field' in details && typeof details.field === 'string' ? details.field : undefined
}
