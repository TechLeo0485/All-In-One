# All-In-One

**All-In-One** is a personal desktop calendar for Windows that merges several **Proton Calendar** accounts into one view, plus
**local events** and **meeting notes** that live only on your machine.

- Read-only sync of **multiple Proton accounts, free plans included**. Log in once per account, then
  click **Sync** to download all of its calendars. Exported .ics files and share links also work.
  Nothing is ever written back to Proton.
- **Google Calendar** via the calendar's secret iCal address, and **Outlook** (Outlook.com and Microsoft 365)
  via its published ICS link. Any other ICS link works too.
- **Proton syncs manually only:** Proton is never fetched in the background or at startup; it updates
  when you click refresh / **Sync now**. Google, Outlook and other links **auto-sync** (every 30 min by default,
  configurable in Settings).

- **Automatic updates:** the installed app checks GitHub Releases at startup and every few hours,
  downloads new versions in the background and offers **Restart now** (or installs when you quit).

**New users:** see **[docs/HELP.md](docs/HELP.md)** for how to get your Google, Outlook and Proton calendar links.
- Month, week and day views (FullCalendar), with a color per calendar.
- Show or hide calendars from the sidebar; enable or disable syncing per calendar.
- Local events with title, time, description, location, color and desktop reminders. Drag and resize
  them directly in the calendar.
- Markdown notes (with GitHub-style task lists and tables) attached to any event, including Proton
  events. Click a note to edit it. Notes save automatically while you type and when you switch events.
- **Runs in the background:** closing the window keeps the app in the system tray. Right-click the tray
  icon for the next event, Refresh, Pause notifications and Quit. It can also start with Windows.
- **Windows notifications before events**, for Proton events too: default reminder time, all-day
  reminders, sound, per-calendar on/off, and pausing from the tray. Clicking a notification opens the
  event.
- Links in event descriptions and locations are clickable, with an **Open meeting link** button.
- Remembers your last Month/Week/Day view.
- Offline-friendly: everything is cached in SQLite. A failed sync keeps the last good data.

Tech: Electron · React 19 · TypeScript · Vite (electron-vite) · Tailwind CSS 4 · FullCalendar 6 ·
better-sqlite3 · ical.js · Zustand.

---

## Setup

Requirements: **Node.js 20+** (tested with Node 24) on Windows, macOS or Linux.

```bash
npm install
npm run dev
```

`npm install` runs `electron-builder install-app-deps`, which installs a **prebuilt** better-sqlite3
binary matching Electron's ABI, so no C++ toolchain is needed.

> **npm 11 install-script approval.** If npm warns that install scripts are "not yet covered by
> allowScripts", approve them once and reinstall the native deps:
>
> ```bash
> npm install-scripts approve better-sqlite3 electron esbuild
> npm run rebuild
> ```

> **Why Electron 42?** better-sqlite3 v12 publishes prebuilt binaries up to Electron 42 (ABI 146).
> Newer Electron versions build better-sqlite3 from source, which on Windows requires Visual Studio
> Build Tools with "Desktop development with C++". If you install those, you can upgrade Electron
> and run `npm run rebuild`.

### Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the app with hot reload |
| `npm run build` | Type-check and build to `out/` |
| `npm run preview` | Run the production build |
| `npm run typecheck` | Type-check main/preload and renderer |
| `npm run rebuild` | Re-install native deps for the current Electron version |
| `npm run dist` | Build the Windows installer into `release/` (electron-builder) |
| `npm run icons` | Regenerate the app/tray icons in `resources/` (a calendar drawn by `scripts/generate-icons.mjs`) |

### Installing as a normal program

`npm run dist` produces `release\All-In-One-Setup-<version>.exe`. Run it to install All-In-One with
Start menu and desktop shortcuts. The installer isn't code-signed, so Windows SmartScreen may show
"Windows protected your PC": click **More info → Run anyway**.

The installed app and `npm run dev` share the same data folder (`%APPDATA%\All-In-One`), so your
accounts, calendars and notes carry over. Only one of them can run at a time.

### Icon

The app icon is a calendar page drawn in code by `scripts/generate-icons.mjs`. `npm run icons` writes:

- `icon.png` (256 px): the window, installer and `.exe` icon, sidebar, About, and the large image on
  notifications.
- `tray-16…48.png`: tray icons. The 16 and 24 px versions use fewer, bigger day cells so they stay
  readable.
- `identity.png` (64 px): the small icon in the notification header. Windows only renders small, simple
  PNGs there.

To change the icon, edit the colors or shapes at the top of the script, run `npm run icons`, and rebuild.

### Tray and notifications

- Closing the window hides the app to the tray. Quit from the tray icon's menu. You can turn this off in
  **Settings → App**.
- On Windows 11, new tray icons start in the hidden overflow (the **^** next to the clock). Drag the icon
  onto the taskbar, or enable it under **Windows Settings → Personalization → Taskbar → Other system tray
  icons**.
- **Settings → Notifications** has a **Send test notification** button. If nothing appears, check
  **Windows Settings → System → Notifications** and Focus / Do not disturb.
- Notifications show **All-In-One** and its icon, in development and in the installed app. The app registers its
  name and icon with Windows under `HKCUSoftwareClassesAppUserModelIdm.all-in-one.app`, and the uninstaller
  removes that entry.
- Reminders only fire while the app is running, in the window or in the tray. Turn on **Start with
  Windows** to have it running after you sign in. It starts hidden and doesn't download anything.

### Troubleshooting

- **Window opens and closes immediately, or `app` is undefined.** The `ELECTRON_RUN_AS_NODE`
  environment variable is set (some editors and tools set it). Unset it before running:
  `Remove-Item Env:ELECTRON_RUN_AS_NODE` (PowerShell) or `unset ELECTRON_RUN_AS_NODE` (bash).
- **"was compiled against a different Node.js version" (better-sqlite3).** Run `npm run rebuild`.

---

## Adding a Proton calendar

Proton offers no API or CalDAV access. The recommended way works with **free accounts** and any number
of them.

### Recommended: connect your Proton accounts (free plans OK)

1. Open **Proton accounts → Add account**, type a name for it (e.g. the email address), and click
   **Continue to Proton login**.
2. Sign in on Proton's own login page, including 2FA. The window closes by itself once you're in, and
   the account shows **Logged in · not synced yet**.
3. Click **Sync now** to download every calendar of that account.

Repeat for each account. Each one gets its own isolated, persistent login session, like a separate
browser profile. Your password goes only to Proton, never to the app.

**Updating:** click the refresh button next to "Calendars" in the sidebar to sync all accounts, or
**Sync now** / **Sync all** on the Proton accounts page. Nothing is downloaded automatically.

How it works: when you sync, the app opens Proton's **Import/export** settings page in a hidden window
with the saved session and clicks **Download ICS** for each calendar, exactly as you would. New Proton
calendars are added on sync. A renamed calendar keeps its app calendar, color and notes.

> **Proton's terms of service** prohibit operating many free accounts per person (§2.9) and automated
> access that deviates from normal usage (§2.10). Syncing only on demand keeps automation to a minimum,
> but it is still automation of Proton's website. For no automation at all, use **Open Proton** and
> click **Download ICS** yourself. That file is imported too.

- **"Login needed"**: Proton ended the session. You get a notification. Click **Log in** on the account,
  and cached events stay visible until then.
- **"Sync failed"**: usually means Proton changed its web page. Use **Open Proton** and click
  **Download ICS** yourself. The file is captured and imported automatically. Automation selectors live
  in `src/main/services/proton/protonExporter.ts`.
- To hide an account calendar you don't want, disable it under **Manage calendars**. Removing it would
  bring it back on the next sync.
- **Remove** on an account deletes its calendars and notes from the app and clears its saved login.

### Manual alternatives

#### Exported .ics file

1. At **calendar.proton.me**, open **Settings → All settings → Import/export**. Under Export, pick a
   calendar and click **Download ICS**.
2. In the app, go to **Manage calendars → Add calendar → Exported file → Choose file…**, then pick a
   name and color.

The file is a snapshot, so update it from time to time:

- **Option 1:** export again, then click **Update from file…** on the calendar card and choose the new
  download.
- **Option 2:** save the new export **over the same file**, then click refresh. Tip: set your browser
  to ask where to save downloads, so you can overwrite the file.

The calendar card shows how old the export is, and warns after 7 days. Notes stay attached to events
across updates. If the file is moved or deleted, the app keeps the cached events and shows an error.
For security, files can only be added through the app's file picker.

#### Paid plan: share link

1. At **calendar.proton.me**, open **Settings → All settings → Calendars**, select a calendar, scroll
   to **Share with anyone** and click **Create link**. Choose **Full view** (Limited view hides event
   details), then click **Copy link**.
2. In the app, go to **Manage calendars → Add calendar → Share link**, paste the link, and pick a name
   and color.

The share link works like a password, since anyone with it can read the calendar. It is stored only in
the local database, and the UI masks it. Proton says changes can take **up to 8 hours** to show up
through the link. You can revoke a link in Proton with **Actions → Delete link**.

Recurring events are expanded into individual occurrences from **6 months back to 18 months ahead**.
Each occurrence has a stable ID, so notes stay attached across syncs, even if one instance is moved
in Proton.

---

## Project structure

```
build/installer.nsh           Installer extras (uninstall cleanup)
resources/                    The generated icons
scripts/
├── generate-icons.mjs        npm run icons: draws all the icons
└── proton-mock.mjs           Local mock of Proton's export page for testing (see Development)
src/
├── main/                     Electron main process (Node)
│   ├── index.ts              App lifecycle, window, tray, close-to-tray, login item
│   ├── dataFolder.ts         %APPDATA%\All-In-One + migration from the pre-rename folder
│   ├── database/             SQLite: connection, migrations, one repository per table
│   ├── sync/
│   │   ├── icsParser.ts      ICS → internal events (recurrences, exceptions, time zones)
│   │   └── syncService.ts    Read feeds/files into SQLite (on demand only), status events
│   ├── ipc/
│   │   ├── registerHandlers.ts  ipcMain.handle endpoints (thin)
│   │   └── validation.ts        Validates every payload coming from the renderer
│   └── services/
│       ├── reminderService.ts   Windows notifications before events (all calendars)
│       ├── trayService.ts       System-tray icon + menu (next event, refresh, pause, quit)
│       ├── windowsIdentity.ts   Registers All-In-One's name and icon with Windows for notifications
│       ├── fileSourceService.ts .ics file picker allowlist
│       └── proton/
│           ├── protonSession.ts        Per-account persistent sessions, navigation lockdown
│           ├── protonExporter.ts       Drives Proton's Import/export page in a hidden window
│           └── protonAccountService.ts Login windows, on-demand exports, export → calendar mapping
├── preload/
│   └── index.ts              contextBridge: exposes the typed `window.api` only
├── renderer/                 React UI (no Node access)
│   ├── components/           Sidebar, EventDetailsPanel, NotesEditor, dialogs, UI primitives
│   ├── pages/                CalendarPage, AccountsPage, CalendarsPage, SettingsPage
│   ├── hooks/                useEventDetails, useSyncSubscription, useNow
│   ├── stores/appStore.ts    Zustand store wrapping IPC calls
│   ├── utils/                Date, color, link, source and error helpers
│   └── styles/index.css      Tailwind + FullCalendar theme
└── shared/
    ├── brand.ts              Product name, Windows app id, data folder
    ├── types/index.ts        Types shared by all layers (incl. the CalendarApi contract)
    ├── ipcChannels.ts        IPC channel names (single source of truth)
    └── colors.ts             Calendar color palette
```

### Key decisions

- **Security.** `contextIsolation: true`, `nodeIntegration: false` and `sandbox: true`. The renderer
  can only call the functions in `window.api`. The main process validates all inputs, and a strict
  CSP is set in `index.html`. Links open in the system browser, and the app window cannot navigate
  away. Notes are rendered with react-markdown, which does not render raw HTML.
- **Stable event IDs.** Synced events use `sha1(calendarId + UID [+ RECURRENCE-ID])` as their
  primary key. Re-syncing upserts rows instead of recreating them, so notes keep pointing at the
  right meeting.
- **Notes outlive feed hiccups.** `notes.event_id` has no foreign key on purpose. If an event briefly
  disappears from a feed, its note re-attaches when the event comes back. Notes are deleted
  explicitly when you delete a local event or remove a calendar.
- **Graceful sync errors.** Each calendar syncs independently. On failure (network, HTTP error,
  non-ICS response, parse error), the message is stored on the calendar and shown in the UI, and the
  cached events stay untouched. Sync runs are serialized, so they never write concurrently.
- **Time handling.** Timed events are stored as ISO UTC, and all-day events as `YYYY-MM-DD` with an
  exclusive end date (the iCalendar and FullCalendar convention). Embedded `VTIMEZONE` blocks are
  used when present. Otherwise IANA `TZID`s are resolved with `Intl`, including DST changes.
- **Reminders.** A 15-second poll in the main process (instead of one timer per event) handles
  edits, deletions, sleep and resume, and clock changes. Reminders fire only while the app is running.
  One that came due in the last 10 minutes is still shown at startup.

- **Proton automation.** Proton windows run sandboxed with no preload, in a partition per account
  (`persist:proton-<id>`). They can only navigate to Proton domains, and all permission requests are
  denied. Automation selectors are structural (ids, classes, attributes taken from Proton's open-source
  WebClients), so they work in any UI language.

### Database

Stored at `<userData>/calendar.db` (on Windows: `%APPDATA%\All-In-One\calendar.db`). Data from the pre-rename
folder `%APPDATA%\unified-calendar` is moved there automatically on first start.
Migrations are tracked with SQLite's `user_version` (see `src/main/database/migrations.ts`).

| Table | Columns |
| --- | --- |
| `calendars` | id, name, color, source_url, enabled, last_synced_at, last_sync_error, created_at |
| `events` | id, calendar_id, external_id, title, description, start_time, end_time, all_day, location, is_local_event, color, reminder_minutes, created_at |
| `notes` | id, event_id (unique), content, updated_at |
| `settings` | id, key (unique), value (JSON) |
| `proton_accounts` | id, label, auto_sync, status, last_export_at, last_error, created_at |

Migration 2 also adds `calendars.account_id` and `calendars.proton_calendar_name`. Migration 3 adds
`calendars.notify` (per-calendar reminders). Shown reminders are remembered in `settings` under
`internal:reminders.fired`, so restarting the app does not repeat them.

Beyond the spec, `events` adds `all_day`, `color` and `reminder_minutes` for local events. `calendars`
adds `enabled` and sync status columns.

---

## Development

- `npm run dev` runs All-In-One from source with live reload. It uses the same data as the installed app, so
  close one before starting the other.
- **Testing the Proton sync without a real account:** run `node scripts/proton-mock.mjs`, then in
  another PowerShell window run `$env:UC_PROTON_BASE_URL = 'http://127.0.0.1:8766'; npm run dev`.
  Add an account and log in as `alice`, `bob` or `carol` with any password. The override only works in
  development builds.
- If Proton changes its export page, update the selectors in
  `src/main/services/proton/protonExporter.ts`, and the mock to match.

## Possible next steps

- Search across events and notes
- Export notes as Markdown files
- Unit tests for `icsParser.ts` (it is pure and has no Electron imports, so it is easy to test)
- Code-sign the installer to avoid the SmartScreen warning
