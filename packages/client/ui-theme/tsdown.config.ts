import { clientBundle } from '../tsdown.client.ts'

export default clientBundle(
  '@deepseek-ai/dsh-client-ui-theme',
  ['lib/types/index.js'],
  {
    lib: {
      copy: [{
        from: 'src/styles/{brand-font.css,pack-fonts.css,montserrat-*.woff2,inter-variable.woff2,jetbrainsmono-variable.woff2,Montserrat-OFL.txt,Inter-OFL.txt,JetBrainsMono-OFL.txt}',
        to: 'lib/styles',
      }],
    },
  },
)
