/** pt-BR dictionary for the `settings.shell` namespace. */
export const pt: Record<string, string> = {
  'title': 'Shell',
  'description': 'Limite quanto tempo cada comando pode ser executado e quanto pode gerar de saída.',
  'timeoutMs': 'Tempo limite do comando (ms)',
  'timeoutMsHint': 'Quanto tempo um comando pode ser executado antes de ser encerrado.',
  'maxOutputBytes': 'Limite de saída por fluxo (bytes)',
  'maxOutputBytesHint': 'A saída além desse limite é gravada em um arquivo temporário em vez de ser perdida.',
  'overridden': 'Substituído',
  'reset': 'Restaurar padrão',
  'readOnly': 'Esta instalação armazena as configurações como somente leitura.',
  'unavailable': 'Este plugin não está carregado, portanto não pode ser configurado agora.',
  'save': 'Salvar',
  'saving': 'Salvando…',
  'saveFailed': 'A instalação não aceitou estes valores; eles foram mantidos para você corrigir.',
  'invalidNumber': 'Insira um número ou deixe em branco para usar o padrão.',
}
