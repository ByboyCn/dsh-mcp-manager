import { defineConfig } from 'tsdown'

export default defineConfig([
  {
    // Host half: a Node ESM cordis plugin; @deepseek-ai/* stay external and
    // resolve through the profile's module graph at runtime.
    entry: ['src/index.ts'],
    outDir: 'lib',
    format: 'esm',
    platform: 'node',
    dts: { sourcemap: true },
    external: [/^@deepseek-ai\//],
    outputOptions: { entryFileNames: 'index.js' },
  },
  {
    // Client half: single-file CJS factory wrapped for the browser
    // __ModuleLoader__; react and the UI primitives come from the frozen
    // platform module table as externals.
    entry: ['src/client/index.ts'],
    outDir: 'client',
    format: 'cjs',
    platform: 'browser',
    external: [
      'react',
      'react-dom',
      'react/jsx-runtime',
      '@deepseek-ai/dsh-client-ui-primitives',
    ],
    outputOptions: { entryFileNames: 'client.js' },
    banner: `window.__ModuleLoader__.load({ id: "dsh-mcp-manager", factory: (require) => {\nvar module = { exports: {} };\nvar exports = module.exports;\n`,
    footer: `\nreturn module.exports;\n}});\n`,
  },
])
