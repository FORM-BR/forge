/** Resolve public release identifiers supplied by the packaging environment. */

/** Environment variable that supplies the Electron application identifier. */
export const DESKTOP_APP_ID_ENV = 'DSH_DESKTOP_APP_ID'

/** Environment variable that overrides the packaged product name shown to the installer and OS; defaults to 'DeepSeek Harness'. */
export const DESKTOP_PRODUCT_NAME_ENV = 'DSH_DESKTOP_PRODUCT_NAME'

const DEFAULT_PRODUCT_NAME = 'DeepSeek Harness'

/** Environment variable that overrides the Windows installer/app icon path (PNG); defaults to resources/icon-windows.png. */
export const DESKTOP_WINDOWS_ICON_ENV = 'DSH_DESKTOP_WINDOWS_ICON'

/** Environment variable naming the GitHub repository owner electron-updater checks for releases. */
export const DESKTOP_GITHUB_OWNER_ENV = 'DSH_DESKTOP_GITHUB_OWNER'

/** Environment variable naming the GitHub repository electron-updater checks for releases. */
export const DESKTOP_GITHUB_REPO_ENV = 'DSH_DESKTOP_GITHUB_REPO'

const GITHUB_OWNER_REPO_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/u

/** Environment variable that supplies electron-builder's macOS certificate qualifier. */
export const MACOS_SIGNING_IDENTITY_ENV = 'DSH_DESKTOP_MACOS_SIGNING_IDENTITY'

/** Environment variable that supplies the expected Apple Developer Team ID. */
export const MACOS_TEAM_ID_ENV = 'DSH_DESKTOP_MACOS_TEAM_ID'

/** Environment variable that selects the npm registry used for the bundled runtime install. */
export const NPM_REGISTRY_ENV = 'DSH_DESKTOP_NPM_REGISTRY'

const DEFAULT_NPM_REGISTRY = 'https://registry.npmjs.org/'

const APPLE_API_KEY_ENV = 'APPLE_API_KEY'
const APPLE_API_KEY_ID_ENV = 'APPLE_API_KEY_ID'
const APPLE_API_ISSUER_ENV = 'APPLE_API_ISSUER'
const APPLE_ID_ENV = 'APPLE_ID'
const APPLE_APP_SPECIFIC_PASSWORD_ENV = 'APPLE_APP_SPECIFIC_PASSWORD'
const APPLE_TEAM_ID_ENV = 'APPLE_TEAM_ID'
const APPLE_KEYCHAIN_ENV = 'APPLE_KEYCHAIN'
const APPLE_KEYCHAIN_PROFILE_ENV = 'APPLE_KEYCHAIN_PROFILE'

/**
 * Read one required non-empty environment variable.
 * @param {NodeJS.ProcessEnv} env - Packaging environment.
 * @param {string} name - Required variable name.
 * @returns {string} Trimmed variable value.
 */
function requireEnvironmentValue(env, name) {
  const value = env[name]?.trim()
  if (value === undefined || value === '') {
    throw new Error(`desktop release environment: ${name} must be set to a non-empty value`)
  }
  return value
}

/**
 * Resolve the npm registry used to materialize the bundled runtime and its external dependencies.
 * @param {NodeJS.ProcessEnv} env - Packaging environment.
 * @returns {string} Registry origin; the public registry unless a local mirror is configured.
 */
export function resolveNpmRegistry(env) {
  const configured = env[NPM_REGISTRY_ENV]?.trim() ?? ''
  if (configured === '') return DEFAULT_NPM_REGISTRY
  let url
  try { url = new URL(configured) }
  catch { throw new Error(`desktop release environment: ${NPM_REGISTRY_ENV} must be an HTTPS origin`) }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== ''
    || (url.pathname !== '/' && url.pathname !== '')) {
    throw new Error(`desktop release environment: ${NPM_REGISTRY_ENV} must be an HTTPS origin without credentials, path, query, or fragment`)
  }
  return url.origin
}

/**
 * Resolve and validate the application identifier shared by every platform target.
 * @param {NodeJS.ProcessEnv} env - Packaging environment.
 * @returns {string} Reverse-DNS application identifier.
 */
export function resolveDesktopAppId(env) {
  const appId = requireEnvironmentValue(env, DESKTOP_APP_ID_ENV)
  if (!/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/u.test(appId)) {
    throw new Error(`desktop release environment: ${DESKTOP_APP_ID_ENV} must be a reverse-DNS identifier`)
  }
  return appId
}

/**
 * Resolve the packaged product name shown in the installer, Start Menu, and window title.
 * A fork distributing its own build sets this to rebrand the installer without forking
 * every hardcoded 'DeepSeek Harness' path used by macOS packaging and qualification scripts.
 * @param {NodeJS.ProcessEnv} env - Packaging environment.
 * @returns {string} Trimmed product name; 'DeepSeek Harness' unless overridden.
 */
export function resolveDesktopProductName(env) {
  const configured = env[DESKTOP_PRODUCT_NAME_ENV]?.trim() ?? ''
  return configured === '' ? DEFAULT_PRODUCT_NAME : configured
}

/**
 * Resolve an absolute override path for the Windows installer/app icon.
 * @param {NodeJS.ProcessEnv} env - Packaging environment.
 * @returns {string | undefined} Absolute PNG path, or undefined to keep the bundled default icon.
 */
export function resolveDesktopWindowsIconOverride(env) {
  const configured = env[DESKTOP_WINDOWS_ICON_ENV]?.trim() ?? ''
  return configured === '' ? undefined : configured
}

/**
 * Resolve a GitHub-provider auto-update publish target, when configured.
 * A build that sets both DSH_DESKTOP_GITHUB_OWNER and DSH_DESKTOP_GITHUB_REPO publishes
 * electron-updater metadata (latest.yml) against that repository's GitHub Releases instead
 * of the DeepSeek-owned Tencent COS deployment selected by DSH_DESKTOP_AUTO_UPDATE_ENV. This
 * lets a fork distributing its own installer point its users at its own release feed without
 * hardcoding an owner/repo in source (see the AGENTS.md rule against hardcoded tunables).
 * @param {NodeJS.ProcessEnv} env - Packaging environment.
 * @returns {{ owner: string, repo: string } | undefined} GitHub coordinates, or undefined to keep the default deployment.
 */
export function resolveDesktopGitHubPublishTarget(env) {
  const owner = env[DESKTOP_GITHUB_OWNER_ENV]?.trim() ?? ''
  const repo = env[DESKTOP_GITHUB_REPO_ENV]?.trim() ?? ''
  if (owner === '' && repo === '') return undefined
  if (owner === '' || repo === '') {
    throw new Error(`desktop release environment: ${DESKTOP_GITHUB_OWNER_ENV} and ${DESKTOP_GITHUB_REPO_ENV} must both be set or both omitted`)
  }
  if (!GITHUB_OWNER_REPO_PATTERN.test(owner)) {
    throw new Error(`desktop release environment: ${DESKTOP_GITHUB_OWNER_ENV} must be a valid GitHub owner name`)
  }
  if (!GITHUB_OWNER_REPO_PATTERN.test(repo)) {
    throw new Error(`desktop release environment: ${DESKTOP_GITHUB_REPO_ENV} must be a valid GitHub repository name`)
  }
  return { owner, repo }
}

/**
 * Resolve and validate the public identity expected on a macOS release.
 * @param {NodeJS.ProcessEnv} env - Packaging environment.
 * @returns {{ signingIdentity: string, teamId: string }} Expected certificate qualifier and Team ID.
 */
export function resolveMacOSSigningEnvironment(env) {
  const signingIdentity = requireEnvironmentValue(env, MACOS_SIGNING_IDENTITY_ENV)
  if (signingIdentity.startsWith('Developer ID Application:')) {
    throw new Error(`desktop release environment: ${MACOS_SIGNING_IDENTITY_ENV} must omit the "Developer ID Application:" prefix`)
  }
  const teamId = requireEnvironmentValue(env, MACOS_TEAM_ID_ENV)
  if (!/^[A-Z0-9]{10}$/u.test(teamId)) {
    throw new Error(`desktop release environment: ${MACOS_TEAM_ID_ENV} must contain 10 uppercase letters or digits`)
  }
  return { signingIdentity, teamId }
}

/**
 * Resolve one complete credential set accepted by Apple's notary service.
 * @param {NodeJS.ProcessEnv} env - Packaging environment.
 * @returns {{ appleId: string, appleIdPassword: string, teamId: string } | { appleApiKey: string, appleApiKeyId: string, appleApiIssuer: string } | { keychainProfile: string, keychain?: string }} Notary credentials without the submitted artifact path.
 */
export function resolveMacOSNotarizationEnvironment(env) {
  const appleIdValues = [env[APPLE_ID_ENV], env[APPLE_APP_SPECIFIC_PASSWORD_ENV], env[APPLE_TEAM_ID_ENV]]
  if (appleIdValues.some(value => value !== undefined)) {
    return {
      appleId: requireEnvironmentValue(env, APPLE_ID_ENV),
      appleIdPassword: requireEnvironmentValue(env, APPLE_APP_SPECIFIC_PASSWORD_ENV),
      teamId: requireEnvironmentValue(env, APPLE_TEAM_ID_ENV),
    }
  }

  const apiKeyValues = [env[APPLE_API_KEY_ENV], env[APPLE_API_KEY_ID_ENV], env[APPLE_API_ISSUER_ENV]]
  if (apiKeyValues.some(value => value !== undefined)) {
    return {
      appleApiKey: requireEnvironmentValue(env, APPLE_API_KEY_ENV),
      appleApiKeyId: requireEnvironmentValue(env, APPLE_API_KEY_ID_ENV),
      appleApiIssuer: requireEnvironmentValue(env, APPLE_API_ISSUER_ENV),
    }
  }

  const keychainProfile = env[APPLE_KEYCHAIN_PROFILE_ENV]?.trim()
  if (keychainProfile !== undefined && keychainProfile !== '') {
    const keychain = env[APPLE_KEYCHAIN_ENV]?.trim()
    return keychain === undefined || keychain === ''
      ? { keychainProfile }
      : { keychainProfile, keychain }
  }

  throw new Error('desktop release environment: macOS packaging requires APPLE_API_KEY, APPLE_API_KEY_ID, and APPLE_API_ISSUER; APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, and APPLE_TEAM_ID; or APPLE_KEYCHAIN_PROFILE')
}
