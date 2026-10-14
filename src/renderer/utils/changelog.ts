import changelogText from '../../../CHANGELOG.md?raw'
import { compareVersions } from '@shared/version'

export interface ReleaseNotes {
  version: string
  /** Markdown of the section (without its heading) */
  notes: string
}

/**
 * Release notes from CHANGELOG.md (bundled into the app), newest first. Only
 * "## 1.2.3" sections up to `currentVersion` are kept, so notes written ahead of
 * a release (or under "## Unreleased") never show early.
 */
export function releaseNotes(currentVersion: string): ReleaseNotes[] {
  const releases: ReleaseNotes[] = []
  // Split at each level-2 heading; the part before the first one is the file's intro.
  for (const section of changelogText.replace(/<!--[\s\S]*?-->/g, '').split(/^## /m).slice(1)) {
    const newline = section.indexOf('\n')
    const heading = (newline === -1 ? section : section.slice(0, newline)).trim()
    const version = /^v?(\d+(?:\.\d+)*)$/.exec(heading)?.[1]
    if (!version || compareVersions(version, currentVersion) > 0) continue
    releases.push({ version, notes: newline === -1 ? '' : section.slice(newline + 1).trim() })
  }
  return releases.sort((a, b) => compareVersions(b.version, a.version))
}
