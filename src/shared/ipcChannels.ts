/**
 * Single source of truth for IPC channel names, used by both the preload bridge
 * and the main-process handlers so the two sides can't drift apart.
 */
export const IPC = {
  calendarsList: 'calendars:list',
  calendarsCreate: 'calendars:create',
  calendarsUpdate: 'calendars:update',
  calendarsRemove: 'calendars:remove',
  calendarsPickIcsFile: 'calendars:pickIcsFile',

  eventsListInRange: 'events:listInRange',
  eventsGet: 'events:get',
  eventsCreateLocal: 'events:createLocal',
  eventsUpdateLocal: 'events:updateLocal',
  eventsRemoveLocal: 'events:removeLocal',

  notesGet: 'notes:get',
  notesSave: 'notes:save',
  notesRemove: 'notes:remove',

  syncRunAll: 'sync:runAll',
  syncRunOne: 'sync:runOne',
  syncStatus: 'sync:status',
  /** main -> renderer push */
  syncStatusChanged: 'sync:statusChanged',

  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',

  appInfo: 'app:info',

  notificationsTest: 'notifications:test',
  /** main -> renderer push */
  openEvent: 'app:openEvent',

  protonListAccounts: 'proton:listAccounts',
  protonAddAccount: 'proton:addAccount',
  protonUpdateAccount: 'proton:updateAccount',
  protonRemoveAccount: 'proton:removeAccount',
  protonOpenLogin: 'proton:openLogin',
  protonOpenProton: 'proton:openProton',
  protonSyncAccount: 'proton:syncAccount',
  protonSyncAll: 'proton:syncAll',
  /** main -> renderer push */
  protonAccountsChanged: 'proton:accountsChanged'
} as const
