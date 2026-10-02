// Runs scripts/migrations.test.ts inside Electron's bundled Node, because
// better-sqlite3 is compiled for Electron (not for the system Node).
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import electronPath from 'electron'

const testFile = fileURLToPath(new URL('./migrations.test.ts', import.meta.url))
const result = spawnSync(electronPath, ['--no-warnings', '--test', testFile], {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
})
process.exit(result.status ?? 1)
