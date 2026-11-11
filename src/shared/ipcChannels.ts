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
  eventsSearch: 'events:search',
  eventsCreateLocal: 'events:createLocal',
  eventsUpdateLocal: 'events:updateLocal',
  eventsRemoveLocal: 'events:removeLocal',
  eventsSetStatus: 'events:setStatus',
  eventsSetImportant: 'events:setImportant',
  eventsSetFollowUpReminder: 'events:setFollowUpReminder',
  eventsListWithStatus: 'events:listWithStatus',
  /** main -> renderer push */
  eventsChanged: 'events:changed',

  notesGet: 'notes:get',
  notesSave: 'notes:save',
  notesRemove: 'notes:remove',
  notesPreviews: 'notes:previews',
  notesAddImage: 'notes:add-image',

  syncRunAll: 'sync:runAll',
  syncRunOne: 'sync:runOne',
  syncStatus: 'sync:status',
  /** main -> renderer push */
  syncStatusChanged: 'sync:statusChanged',

  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',

  appInfo: 'app:info',
  appSuspendShortcut: 'app:suspendShortcut',
  appWhatsNew: 'app:whatsNew',
  appWhatsNewSeen: 'app:whatsNewSeen',

  updatesStatus: 'updates:status',
  updatesCheck: 'updates:check',
  updatesDownload: 'updates:download',
  updatesSkip: 'updates:skip',
  updatesInstall: 'updates:install',
  /** main -> renderer push */
  updatesStatusChanged: 'updates:statusChanged',

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
  protonAccountsChanged: 'proton:accountsChanged',

  callerStatus: 'caller:status',
  callerSignIn: 'caller:signIn',
  callerSignOut: 'caller:signOut',
  callerSelectWorkspace: 'caller:selectWorkspace',
  callerListShares: 'caller:listShares',
  callerShare: 'caller:share',
  callerUnshare: 'caller:unshare',
  callerSyncShared: 'caller:syncShared',
  callerInterviews: 'caller:interviews',
  callerEventShare: 'caller:eventShare',
  callerShareEvent: 'caller:shareEvent',
  callerTags: 'caller:tags',
  callerDownloadResume: 'caller:downloadResume',
  callerUploadResume: 'caller:uploadResume',
  callerShareLink: 'caller:shareLink',
  callerSetColor: 'caller:setColor',
  callerCandidates: 'caller:candidates',
  callerAssign: 'caller:assign',
  callerChanged: 'caller:changed',
  connectionsStatus: 'connections:status',
  connectionsConnect: 'connections:connect',
  connectionsDisconnect: 'connections:disconnect',
  connectionsRefresh: 'connections:refresh',
  connectionsSync: 'connections:sync',
  connectionsChanged: 'connections:changed'
} as const
