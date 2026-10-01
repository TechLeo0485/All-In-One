/**
 * Electron prefixes errors thrown in ipcMain handlers with
 * "Error invoking remote method 'channel': Error: ". Strip that so users see
 * the actual message from the main process.
 */
export function errorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  return raw.replace(/^Error invoking remote method '[^']+':\s*(\w*Error:\s*)?/, '')
}
