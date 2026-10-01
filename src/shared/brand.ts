/**
 * Product identity, shared by main and renderer. Keep in sync with package.json
 * ("productName", "build.appId") and build/installer.nsh.
 */
export const APP_NAME = 'All-In-One'
export const APP_TAGLINE = 'All your Proton calendars, notes and reminders in one place'

/**
 * Windows AppUserModelID. Notifications are attributed to this ID; Windows looks
 * up its display name and icon (see main/services/windowsIdentity.ts). Must equal
 * build.appId so the installer's shortcuts use the same identity.
 */
export const APP_ID = 'com.all-in-one.app'

/** Folder under %APPDATA% holding the database, Proton logins and exports. */
export const DATA_FOLDER = 'All-In-One'
/** Data folder used before the rename; migrated automatically on first start. */
export const LEGACY_DATA_FOLDER = 'unified-calendar'
