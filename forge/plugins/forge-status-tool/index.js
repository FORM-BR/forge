// @forge/status-tool — plugin exemplo do fluxo FORGE.
// Mostra o estado das duas trilhas e das versões. Só LÊ arquivos/estado:
// não altera nada, então é um exemplo seguro de plugin aditivo.

import { execFileSync } from 'node:child_process'

const REPO = 'C:\\Users\\Felipe\\Dev\\deepseek-harness'
const STAGING = 'C:\\Users\\Felipe\\Dev\\dsh-staging'

function git(cwd, ...args) {
  try {
    return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim()
  } catch {
    return '(falhou)'
  }
}

function dirtyCount(cwd) {
  const out = git(cwd, 'status', '--porcelain')
  if (out === '(falhou)') return -1
  if (out === '') return 0
  return out.split('\n').length
}

export const name = 'forge-status-tool'
export const inject = ['tools']

export function apply(ctx) {
  ctx.tools.register({
    name: 'forge_status',
    description:
      'Mostra o estado do fluxo FORGE: branch e sujeira da Trilha A (o harness em uso) '
      + 'e da Trilha B (staging de edição), além das versões (tags) existentes.',
    parameters: { type: 'object', properties: {} },
    output: {
      schema: { type: 'object' },
      render: (_args, value) => [
        { type: 'text', text: JSON.stringify(value, null, 2) },
      ],
    },
    async execute() {
      const tags = git(REPO, 'tag', '--list', 'forge/v*')
      return {
        trilhaA: {
          checkout: REPO,
          branch: git(REPO, 'branch', '--show-current'),
          dirtyFiles: dirtyCount(REPO),
        },
        trilhaB: {
          checkout: STAGING,
          branch: git(STAGING, 'branch', '--show-current'),
          dirtyFiles: dirtyCount(STAGING),
        },
        versoes: tags === '(falhou)' || tags === '' ? [] : tags.split('\n'),
        dica:
          'Master limpa e você na master = versão estável. Mudanças vivem na Trilha B '
          + 'até você validar (forge release).',
      }
    },
  })
}