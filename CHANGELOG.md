# What's new in All-In-One

<!--
How to use this file:
- Write notes for the next release under "## Unreleased" while you work.
- When you release, rename that heading to the new version (e.g. "## 1.0.7") and bump
  "version" in package.json to match. The app shows every "## x.y.z" section up to its
  own version; "Unreleased" is never shown.
- Write for users: what they can now do, or what works better. Not file names or code.
-->

## Unreleased
- New Help window: click the All-In-One logo at the top of the sidebar to open the setup guide and the list of what changed in each version.
- After an update, a "What's new" window shows what changed since your last version.
- For invitations, the calendar now shows your own reply the way Google Calendar does. Accepted meetings stay filled in. Meetings you haven't answered are shown as an outline. "Maybe" meetings are striped. Declined meetings are faded and crossed out.
- Event statuses now appear as a small colored circle with the status's first letter, next to the event title. Before, the whole event was outlined.
- While an event is selected, its calendar stays highlighted in the sidebar. The highlight goes away once you close the event.

## 1.0.6
- Syncing Google calendars is more reliable. Links on the same server are now downloaded one after another, not all at once. If you click refresh again within a minute, the app reuses the result it just downloaded.
- When Google (or another server) reports too many requests, All-In-One pauses syncing that server for a while. The calendar shows how long the pause lasts, so a short slowdown doesn't turn into a longer block.
- When you select an event, its calendar briefly flashes in the sidebar so you can see which calendar it belongs to.
- Press Escape to close the event details panel.
- The period summary at the top of the sidebar now lists every status, including those with zero events.

## 1.0.5
- New Pipeline page: a board with one column per status that lists every event you've given a status, such as interviews you're tracking. Drag a card to another column to change its status. Each card shows the company (guessed from the organizer's email), the date, the first line of your notes and which round it is. You can also search the board and filter it by time period.
- New "How did it go?" notification. It appears 5 minutes after a meeting ends without a status, with a button for each status. In Settings you can turn it on for meetings with guests only, for all events, or off.
- The sidebar now shows event counts for the week, month or day on screen (total, done and scheduled), with a progress bar and a count per status.
- Hovering over an event shows a preview card with its full title, time, location, calendar and status.
- The app works better in small windows. The sidebar can shrink to a narrow icon bar, and on narrow windows event details open as a pop-up.
- Proton accounts that haven't been synced for a few days get a gentle reminder to sync.

## 1.0.4
- Time zone settings. You can choose the main time zone for the calendar and add a second time zone, shown as an extra column of times in Week and Day views. Each zone can have a short label such as "Home", and a button swaps the two.
- You can change how tall one hour appears in Week and Day views, with a slider in Settings or by holding Ctrl and scrolling over the calendar.
- Updates now ask before downloading. A pop-up offers "Download and install" or "Skip", shows the download progress, and then restarts the app into the new version by itself.
- Each calendar in the sidebar now has its own sync button. Proton calendars sync per account.

## 1.0.3
- Local events can now repeat: daily, weekly, monthly, or on a custom schedule. A repeat can end on a date, after a set number of times, or never. When you edit, move or delete one date, you choose whether the change applies to that event only, that event and later ones, or all of them.
- Follow-up reminders. Events marked Follow-Up can remind you later: tomorrow, in 3 days, next week, or at a time you pick.
- A system-wide keyboard shortcut (Alt+Shift+C by default) shows or hides All-In-One. You can change it in Settings.
- Event descriptions with formatting (bold text, links, lists) now display properly.
- Proton sync is more reliable on slow connections: it waits longer and retries automatically when something goes wrong.
- Calendars containing a badly formatted invitation now still load. Before, one broken entry could stop the whole calendar from syncing.

## 1.0.2
- First public release of All-In-One: your calendars in one desktop app.
- Connect Proton (sign in to your account, use a link, or pick an exported file), Google, Outlook, or any other calendar link or calendar file.
- Create your own local events, and keep meeting notes attached to any event.
- Search all your events.
- Desktop reminders before events. The app can keep running in the system tray and start with Windows.
- Mark events with your own color-coded statuses (Follow-Up, Passed and Failed are set up by default).
