/**
 * Cross-session cost report panel, host half: the browser bundle carries the
 * whole panel, so this Node half only exists to satisfy the plugin entry's
 * `apply` contract.
 */

/** The host half has nothing to mount; the browser bundle registers the panel. */
export function apply(): void {}