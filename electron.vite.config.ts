import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import obfuscator from 'rollup-plugin-obfuscator'

const sharedAlias = { '@shared': resolve(__dirname, 'src/shared') }

// Packages listed under "dependencies" (better-sqlite3, ical.js) are externalized for
// main/preload and loaded from node_modules at runtime. Everything the renderer needs
// lives in "devDependencies" and is bundled by Vite.
//
// Code protection for shipped builds (app.asar can be unpacked by anyone):
// - main: compiled to V8 bytecode, so no JavaScript source is shipped
// - preload: minified (bytecode cannot load in a sandboxed preload)
// - renderer: our own code is obfuscated, then minified with the rest
export default defineConfig({
  main: {
    resolve: { alias: sharedAlias },
    build: {
      bytecode: true,
      minify: true,
      rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts') } }
    }
  },
  preload: {
    resolve: { alias: sharedAlias },
    build: {
      minify: true,
      rollupOptions: { input: { index: resolve(__dirname, 'src/preload/index.ts') } }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: {
      alias: {
        ...sharedAlias,
        '@renderer': resolve(__dirname, 'src/renderer')
      }
    },
    plugins: [react(), tailwindcss(), rendererObfuscator()],
    // Bind IPv4 explicitly: on some Windows setups "localhost" resolves to ::1 for
    // Vite but 127.0.0.1 for Electron, and the window fails to load in dev.
    server: { host: '127.0.0.1' },
    build: {
      minify: true,
      rollupOptions: { input: { index: resolve(__dirname, 'src/renderer/index.html') } }
    }
  }
})

/**
 * Obfuscates our renderer code (not node_modules) in production builds. Runs after
 * TypeScript/JSX is compiled. Heavy options (control-flow flattening, dead code,
 * self-defending) are off: they slow the UI down and can break minified code.
 */
function rendererObfuscator() {
  return {
    ...obfuscator({
      include: [/[\\/]src[\\/](renderer|shared)[\\/].*\.tsx?$/],
      exclude: [/node_modules/],
      options: {
        compact: true,
        identifierNamesGenerator: 'hexadecimal',
        renameGlobals: false,
        stringArray: true,
        stringArrayEncoding: ['base64'],
        stringArrayThreshold: 0.75,
        controlFlowFlattening: false,
        deadCodeInjection: false,
        selfDefending: false,
        sourceMap: false
      }
    }),
    apply: 'build' as const,
    enforce: 'post' as const
  }
}
