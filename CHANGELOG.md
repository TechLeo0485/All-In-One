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
- **Connections**: a new page in the sidebar sends calendars to other platforms that support calendar connections, free Proton accounts included. Paste the connection address and API key the platform gives you. The app tells it which calendars it has, by Proton account; on the platform, choose the ones it should get; **Sync & send** here sends them, and they're sent again whenever they sync with something changed. Calendars a platform didn't choose are never sent to it, and with no connection the app contacts nobody. You can connect several platforms at once.

## 1.2.2
- Teamwork calendars now always match the colors set on Teamwork, and change the moment someone changes a color there. If you're an owner, the admin or manage the calendar, hover a caller's Teamwork calendar in the sidebar and click the palette to change their color (or the Unassigned color) for everyone: a preview shows how interviews will look before you save.
- Every calendar that isn't shared with a profile is now sent to Teamwork as **busy time only**: just when you're busy, with no titles, guests or places. All-day events and declined invitations aren't counted. Teamwork uses it when recommending a caller ("busy then"), and members who assign see it as **Busy** on each caller's calendar in the app. On the Teamwork page, **Not shared** is now **Busy time only**.
- The Teamwork calendar is now one calendar per caller, grouped under **Teamwork** in the sidebar, each in the caller's Teamwork color, plus **Unassigned**. If your role sees all interviews ("All interviews in the desktop app", owners and the admin by default), turn callers on or off to see when each one is busy before you assign. Reminders only come for your own interviews.
- You can upload a resume before the company and role are filled in. It then stays with that one interview; once they're filled in, it keeps showing, and the next resume uploaded is used by every round for that company and role.
- A **Link** in **Who joins**: if you shared the interview (you work its profile), or you're an owner or the admin, **Share link** adds one link to it (a job post, a doc, anything), and everyone on the interview can **Open** it in the browser. **Change** or **Remove** it any time. The caller gets a notification.

## 1.2.1
- Teamwork interviews now show who takes them: a tag at the end of the event with the caller's first name in their color, **You** when it's yours, or a dashed **Unassigned** when nobody has it yet. Later rounds show "R2 🔒", since they stay with the earlier round's caller.
- New **Who joins** at the top of a Teamwork interview's details card: the caller, the profile they speak as and its bidders, the company, role and round, then the guests from the invitation.
- Resumes in **Who joins**: if you shared the interview (you work its profile), or you're an owner or the admin, **Upload resume** adds the resume sent to the company (PDF or Word, up to 10 MB) and **Replace** swaps it. Every round for that company and role uses it. Everyone on the interview can **Download** it to their computer (Downloads by default). When it arrives on an interview assigned to you, a notification tells you; click it to save the file.
- If your Teamwork role lets you assign interviews, **Assign** or **Change** next to the caller in **Who joins** lets you pick who takes it. Callers are listed as Teamwork ranks them, with ★ on the recommended one, whether they're free then and how many interviews they have. **Unassign** takes it back. A later round stays with the earlier round's caller: only the admin can move it, after confirming. The caller gets a notification.
- Interviews from calendars or events you shared now show their Teamwork details (caller, round, resume) even when they aren't assigned to you.
- Events shorter than 30 minutes in Week and Day views now fit their block, like on the Teamwork website: one compact line with the title and start time in a smaller font, centred, at any hour height.

## 1.2.0
- New **Teamwork** page in the sidebar, for members of a Teamwork workspace. Sign in with your Teamwork account, then pick, for each of your calendars, which profile to share it with. Only shared calendars are sent to Teamwork, where their events become that profile's interviews. Calendars you don't share, your calendar links and your Proton logins never leave your computer.
- A shared calendar is sent again every time it syncs: when you click its refresh button, refresh everything, when auto-sync runs, or after a Proton export. **Sync shared calendars** on the Teamwork page sends them all at once. To stop sharing, set the calendar back to **Not shared**.
- You can also share single events without sharing their calendar: open an event and pick **Share with** and a profile under **Teamwork** in its details card. The Teamwork page lists them under **Shared one by one**, where **Stop sharing** takes one back. A shared event follows its calendar: when the invitation moves or is cancelled, Teamwork gets the change at the next sync.
- New **Teamwork** calendar in the sidebar: interviews assigned to you on Teamwork appear on your calendar, read-only, with company, role, round and caller in their details and **Open on Teamwork**. Owners and the admin (or anyone the admin allows) see every workspace interview there. It updates by itself the moment something changes on Teamwork, without refreshing, and a desktop notification tells you when an interview is assigned to you.
- When an interview came from one of your own shared calendars or events, it isn't shown twice: your own event shows the Teamwork details instead.
- Shared calendars are only sent when something in them actually changed, so syncing uses less of your connection.
- The Teamwork page also lists your workspace's interviews from yesterday to two weeks ahead, with company, role, round, profile and caller, as your role in the workspace lets you see them. **Join** opens the meeting and **Open** shows the interview on the Teamwork website.

## 1.1.2
- Calendar links now download more reliably behind a VPN or proxy (for example Astrill): All-In-One uses your computer's proxy settings like your browser does. Slow connections get more time, a dropped connection is tried once more, and errors now say when your VPN or proxy is the likely cause.
- Google calendars are now much less likely to be blocked ("Google is temporarily limiting requests"). When you refresh, Google links are downloaded one at a time, 15 to 45 seconds apart, starting with the one that has gone longest without syncing, so every calendar gets its turn. Waiting calendars show when they're next on **Manage calendars**.
- **Auto-sync link calendars** is now off by default, and was turned off once on this update. Click refresh when you want new events, or turn it back on in **Settings → Sync**. When it's on, restarting the app no longer starts an extra sync.
- Clicking a calendar's refresh button again within a minute keeps the events just downloaded instead of asking Google again. While Google is pausing requests, all your Google calendars now show the same "Paused until" time, and that pause now lasts at most 2 hours instead of up to 6. Installing an update also ends any pause, so you can refresh your Google calendars right away.

## 1.1.1
- The Pipeline now shows one **Week** or **Month** at a time, with arrows to go to the previous or next week or month and a **Today** button to come back. **All time** and **Custom range** are still there; **Past month** and **Past 3 months** were replaced by **Month**.
- The event details card is now at most 70% of the window's height, so it covers less of the calendar. Long details scroll inside the card.
- Meeting notes can now have pictures: paste a screenshot with Ctrl+V, drag images onto the note, or click **Add image** while editing. Click a picture to see it big, like in chat apps: click it again for full size, use the arrows or ← → to go through the note's pictures, and press Escape or click outside to close. You can also drop text files or text from another app onto a note to add their text.
- In Week and Day views, each hour label now sits centred on its hour line, like Google Calendar, and the line no longer runs through the time column, so it's easier to see which line is which hour. This applies to the secondary time zone column too.

## 1.1.0
- New **Important** mark for key events, like final interview rounds: open an event and click **Important** to give it an outline on the calendar (yellow at first). Click it again to remove the mark. If the event also has a status, the status stays on the left edge and the outline goes around the other three sides. To change the outline color, go to **Settings → Event status**, where **Important** is at the top of the list.
- The status stripe on the left edge of events is now much wider, so it's easier to see.

## 1.0.9
- Events with a status now have a thick stripe in the status's color on their left edge instead of a small circle with a letter, so you can see the status at a glance. Events that have ended are shown darker, but their stripe keeps its full color.
- New periods on the Pipeline: **This week**, **Past month**, **Past 3 months**, **All time** and **Custom range**. With **Custom range**, pick the first and last day to show; the Pipeline remembers your range.
- Event details now open in a card right next to the event you click, like Google Calendar, instead of a panel on the side. The calendar keeps its full width. Close the card with the X, Escape, or a click anywhere outside it. While the card is open, clicking another event shows that event's details instead, and clicking an empty spot in the calendar or Pipeline only closes the card, so you don't start a new event by accident.

## 1.0.8
- New light theme: pick **Dark** or **Light** in **Settings → Appearance → Theme**. The whole app switches right away, including the window's title bar, and remembers your choice.
- You can now choose which statuses appear on the Pipeline. In **Settings → Event status**, click the pin next to a status to show it as a column on the Pipeline, or click it again to hide it there. Your existing statuses stay pinned. New statuses start unpinned.
- Clicking an empty spot in the calendar to create an event now closes the details of the event you had open.
- **Open meeting link** now finds the real video-call link (Google Meet, Zoom, Teams, Webex and others) instead of the first link in the invite, which was sometimes a scheduling, reschedule or help page. If an invite has no recognized meeting link, the button only appears when the event's location is a link.

## 1.0.7
- New Help window: click the All-In-One logo at the top of the sidebar to open the setup guide and the list of what changed in each version.
- After an update, a "What's new" window shows what changed since your last version.
- For invitations, the calendar now shows your own reply the way Google Calendar does. Accepted meetings stay filled in. Meetings you haven't answered are shown as an outline. "Maybe" meetings are striped. Declined meetings are faded and crossed out.
- Proton accounts now remember your email address, so the app knows which guest is you in their invitations. It's filled in when you log in, and you can change it with the new Edit button on the account. For accounts you already had, click Edit and enter your email once.
- Event statuses now appear as a small colored circle with the status's first letter, next to the event title. Before, the whole event was outlined. Events that have ended are shown darker, but their status circle keeps its full color.
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
