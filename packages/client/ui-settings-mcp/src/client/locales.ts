/** Copy dictionaries for the MCP servers Settings tab. */

/** Simplified Chinese dictionary and key source of truth. */
export const zh = {
  tab: 'MCP 服务器',
  loading: '正在读取 MCP 服务器…',
  error: '暂时无法读取 MCP 服务器状态。',
  retry: '重试',
  refresh: '刷新',
  refreshLabel: '刷新 MCP 服务器状态',
  summary: '共 {count} 个服务器',
  summaryOne: '共 {count} 个服务器',
  emptyTitle: '尚未配置 MCP 服务器',
  emptyBody: '在当前配置档（profile）的 cordis.patch.yml 中为每个服务器添加一条 dsh-mcp-client，重启后即会出现在这里。示例：',
  stateConnecting: '连接中',
  stateConnected: '已连接',
  stateError: '出错',
  stateDisabled: '已停用',
  transportStdio: 'stdio',
  transportHttp: 'HTTP',
  toolsOne: '{count} 个工具',
  toolsMany: '{count} 个工具',
  lastError: '最近的错误',
  retrying: '正在重连，第 {attempt}/{max} 次尝试',
  haltReconnectDisabled: '已关闭自动重连。重新加载插件或重启后才会再次连接。',
  haltAttemptsExhausted: '连续重连失败，已放弃。重新加载配置或重启后才会再次连接。',
  haltTransportUnconfirmed: '旧连接未能确认关闭，为避免重复进程已停止重连。请重启后重试。',
  haltLoadFailed: '插件启动失败，原因请查看服务端日志。',
  disabledHint: '此条目在配置中已停用，不会连接。',
} satisfies Record<string, string>

/** MCP settings locale key union. */
export type McpSettingsLocaleKey = keyof typeof zh

/** English dictionary checked against the Chinese key set. */
export const en = {
  tab: 'MCP servers',
  loading: 'Reading MCP servers…',
  error: 'MCP server status is temporarily unavailable.',
  retry: 'Retry',
  refresh: 'Refresh',
  refreshLabel: 'Refresh MCP server status',
  summary: '{count} servers',
  summaryOne: '{count} server',
  emptyTitle: 'No MCP servers configured',
  emptyBody: 'Add one dsh-mcp-client entry per server to your profile\'s cordis.patch.yml and restart; it will show up here. Example:',
  stateConnecting: 'Connecting',
  stateConnected: 'Connected',
  stateError: 'Error',
  stateDisabled: 'Disabled',
  transportStdio: 'stdio',
  transportHttp: 'HTTP',
  toolsOne: '{count} tool',
  toolsMany: '{count} tools',
  lastError: 'Last error',
  retrying: 'Reconnecting, attempt {attempt} of {max}',
  haltReconnectDisabled: 'Automatic reconnect is off. It connects again only after the plugin reloads or the app restarts.',
  haltAttemptsExhausted: 'Gave up after repeated failed attempts. It connects again only after the configuration reloads or the app restarts.',
  haltTransportUnconfirmed: 'Reconnect stopped because the old connection never confirmed it closed. Restart to try again.',
  haltLoadFailed: 'The plugin failed to start. See the Host log for the reason.',
  disabledHint: 'This entry is disabled in the configuration and does not connect.',
} satisfies Record<McpSettingsLocaleKey, string>
