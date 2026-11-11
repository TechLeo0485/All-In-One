# Adding your calendars to All-In-One

All-In-One shows your Google, Outlook and Proton calendars together in one place. This guide explains how to add each kind.

All-In-One only **reads** your calendars. It never changes anything in Google, Outlook or Proton. To add or edit an event in
those calendars, use Google, Outlook or Proton as usual; the change shows up in All-In-One after the next sync.

Members of a Teamwork workspace can also [share calendars with Teamwork](#sharing-calendars-with-teamwork).

- [Google Calendar](#google-calendar)
- [Outlook Calendar](#outlook-calendar)
- [Proton Calendar](#proton-calendar)
  - [Option A: Connect your Proton account (free or paid)](#option-a-connect-your-proton-account-recommended)
  - [Option B: Share link (paid Proton plans)](#option-b-share-link-paid-proton-plans)
  - [Option C: Exported file (free or paid)](#option-c-exported-file)
- [Sharing calendars with Teamwork](#sharing-calendars-with-teamwork)
- [Sending calendars to other platforms](#sending-calendars-to-other-platforms)
- [How syncing works](#how-syncing-works)
- [Problems?](#problems)

---

## Google Calendar

You need your calendar's **secret address in iCal format**. This is a private link that lets All-In-One read the
calendar.

### 1. Copy the link from Google

1. On a computer, open **[calendar.google.com](https://calendar.google.com)** in your web browser.
   (The phone app does not have this setting.)
2. Click the **gear icon** at the top right, then **Settings**.
3. On the left, under **Settings for my calendars**, click the calendar you want to add.
4. Scroll down to **Integrate calendar**.
5. Find **Secret address in iCal format** and click the **copy** icon next to it.

The link looks like this:

```
https://calendar.google.com/calendar/ical/your.name%40gmail.com/private-1a2b3c…/basic.ics
```

> **Use the secret address, not the public one.** The "Public address in iCal format" just above it only works if you
> made the calendar public, and the "Embed code" will not work at all.

### 2. Add it to All-In-One

1. In All-In-One, click **Manage calendars** in the sidebar.
2. Click **Add calendar** and choose the **Google Calendar** tab.
3. Paste the link, give the calendar a name and a color, and click **Add calendar**.

Your events appear within a few seconds.

Have more than one Google calendar (for example Personal and Work)? Repeat these steps for each one, since every
calendar has its own secret address.

### Good to know

- **Updates can be delayed.** Google can take a few hours to update this link, so an event you just created may not
  show up in All-In-One right away. This is a Google limitation; refreshing All-In-One more often doesn't help.
- **Keep the link private.** Anyone who has it can see that calendar. All-In-One stores it only on your computer. If you
  think someone else has it, click **Reset** next to the secret address in Google, then edit the calendar in All-In-One and
  paste the new link.
- **Work or school accounts:** if you don't see "Secret address in iCal format", your organization has turned it off.
  Ask your IT administrator.

---

## Outlook Calendar

Works with personal Microsoft accounts (Outlook.com, Hotmail, Live) and with work or school Microsoft 365 accounts. You
need the calendar's **published ICS link**, a private link that lets All-In-One read the calendar.

### 1. Publish the calendar in Outlook

1. Open Outlook on the web in your browser: **[outlook.live.com](https://outlook.live.com/calendar)** for personal
   accounts, or **[outlook.office.com](https://outlook.office.com/calendar)** for work or school accounts. The new
   Outlook for Windows has the same settings.
2. Click the **gear icon** at the top right, then **Calendar** → **Shared calendars**.
3. Under **Publish a calendar**, choose the calendar, then choose **Can view all details**, and click **Publish**.
4. Two links appear: **HTML** and **ICS**. Click the **ICS** link and choose **Copy link**.

The link looks like this:

```
https://outlook.live.com/owa/calendar/00000000-…/1a2b3c…/cid-…/calendar.ics
```

> Copied the HTML link by mistake? That's fine: All-In-One switches it to the ICS link automatically.

### 2. Add it to All-In-One

1. In All-In-One, click **Manage calendars** in the sidebar.
2. Click **Add calendar** and choose the **Outlook** tab.
3. Paste the link, give the calendar a name and a color, and click **Add calendar**.

Have more than one Outlook calendar? Publish and add each one separately.

### Good to know

- **Updates can be delayed.** Outlook refreshes published calendars on its own schedule, so a new event can take a while
  to show up in All-In-One.
- **Choose "Can view all details".** With "Can view when I'm busy" or "Can view titles and locations", events show up
  as just "Busy" or without descriptions.
- **Keep the link private.** Anyone who has it can see that calendar. All-In-One stores it only on your computer. To stop
  sharing, click **Unpublish** (or **Reset links**) in the same Outlook setting, then add the new link in All-In-One.
- **Work or school accounts:** if **Publish a calendar** is missing, your organization has turned it off. Ask your IT
  administrator.

---

## Proton Calendar

There are three ways to add a Proton calendar. Pick the one that fits your plan.

| | Free plan | Paid plan | Effort |
| --- | :---: | :---: | --- |
| **A. Connect your account** | ✅ | ✅ | Log in once, then click Sync. Recommended. |
| **B. Share link** | ❌ | ✅ | Copy one link per calendar. |
| **C. Exported file** | ✅ | ✅ | Download a file again each time you want new events. |

### Option A: Connect your Proton account (recommended)

This works with **free accounts** and adds **all calendars** of the account at once. No link needed.

1. In All-In-One, click **Proton accounts** in the sidebar.
2. Click **Add account** and enter a name for it (only shown in All-In-One, for example your email address).
3. Click **Continue to Proton login**. A Proton window opens: sign in as usual, including two-factor authentication
   if you use it. The window closes by itself once you're in. All-In-One remembers the email address you signed in
   with (never the password).
4. Click **Sync now**. All-In-One downloads all calendars from that account.

The email tells All-In-One which guest is you, so invitations show your reply like in Google Calendar: meetings you
haven't answered appear as an outline, "Maybe" is striped, and declined meetings are faded and crossed out. To see or
change it, click **Edit** on the account.

Repeat for each Proton account you have. Later, click **Sync now** (or **Sync all**) whenever you want the latest
events.

Your password goes only to Proton; All-In-One never sees or stores it. It keeps the login session on your computer.

> If Sync stops working (for example after Proton changes its website), click **Open Proton** on the account and click
> **Download ICS** yourself. All-In-One imports the file automatically.

### Option B: Share link (paid Proton plans)

Proton only lets paid plans create share links.

#### 1. Copy the link from Proton

1. Open **[calendar.proton.me](https://calendar.proton.me)** and sign in.
2. Click the **gear icon** → **All settings**.
3. Go to **Calendars** and select the calendar you want to add.
4. Under **Share with anyone**, click **Create link**.
5. Choose **Full view** (shows event titles and details), then click **Create**.
6. Click **Copy link**.

The link looks like this:

```
https://calendar.proton.me/api/calendar/v1/url/AbC123…/calendar.ics?CacheKey=…&PassphraseKey=…
```

> Choose **Full view**. "Limited view" only shows when you're busy, without event titles.

#### 2. Add it to All-In-One

1. Click **Manage calendars** → **Add calendar**.
2. Choose the **Share link** tab and paste the link.
3. Give it a name and color, then click **Add calendar**.

Anyone with this link can see the calendar, so don't share it. To stop a link from working, delete it in Proton under
**Share with anyone**.

### Option C: Exported file

Use this if you only need a snapshot of your calendar, or if Options A and B don't suit you.

1. Open **[calendar.proton.me](https://calendar.proton.me)** → **gear icon** → **All settings** → **Import/export**.
2. Under **Export**, pick the calendar and click **Download ICS**. Save the `.ics` file.
3. In All-In-One, click **Manage calendars** → **Add calendar** → **Exported file** → **Choose file…** and select the file.

The file is a snapshot: it does not update by itself. To get new events, export again and click **Update from file…**
on the calendar in All-In-One.

---

## Sharing calendars with Teamwork

If you work in a Teamwork workspace, you can send some of your calendars there. Each shared calendar belongs to one
profile; its events become that profile's interviews on Teamwork, where company, role and caller are filled in.

1. Click **Connections** in the sidebar. Teamwork has its own card at the top; other platforms are under **Pool**.
2. In the **Teamwork** card, enter the address you open Teamwork at (for example `http://teamwork.newtech.gg`), your
   Teamwork email and password, then click **Sign in**.
3. If you're in several workspaces, pick one under **Workspace**. The card then says **● Connected**.
4. Next to each calendar, pick **Share with** and the profile it belongs to. It's sent right away.

Every time the connection is made (signing in, picking a workspace, the app starting, the network coming back, the
computer waking up), the app checks everything against Teamwork: it reloads the interviews and busy time, and sends again
any shared calendar, picked event or busy time Teamwork doesn't have in its latest copy. Between connections it only
listens for changes; nothing polls. **Disconnect** signs out of Teamwork here; your sharing choices are kept.

**Personal and Team views.** Once Teamwork is connected, the Day view's toolbar has a **Personal / Team** switch.
Personal is your own calendar. In Team, the **Day** view shows the team's day as on the Teamwork website: one column per
caller on a shared time axis (**Unassigned** first), each interview where it falls, and a red line at the current time.
The header says how many interviews each caller has, or "Free all day". Drag a card to another caller to reassign it; a later round asks before it moves. Click a card for its
details. The app remembers which one you used.

Offline, the app shows what Teamwork had when it was last reached. What you do meanwhile (assign a caller, share a link,
upload a resume, change a color) waits under **Waiting to send** in the Teamwork card and goes the moment Teamwork is
back, in order. If someone changed the same thing on Teamwork meanwhile, yours isn't sent (nothing is overwritten) and
a notification says so. **Cancel** drops a waiting item. After being away, one notification sums up what Teamwork told
you meanwhile; click it to open your notifications on Teamwork.

### Good to know

- A calendar shared with a profile sends its events (title, time, guests, place and description). Every other calendar
  is sent as **busy time only**: just when you're busy, with no titles, guests or places, so whoever assigns interviews
  knows when you're free. All-day events and invitations you declined aren't counted. Your calendar links and Proton
  logins stay in All-In-One.
- A shared calendar is sent again every time it syncs (its refresh button, refresh everything, auto-sync, or a Proton
  export). **Sync shared calendars** sends them all now.
- To share just one event, not its whole calendar, open the event and pick **Share with** under **Teamwork** in its
  details card. These are listed in the Teamwork card under **Shared one by one**. They're sent again whenever their
  calendar syncs, so a moved or cancelled invitation follows.
- You can share only with the profiles you work. Owners and the admin can share with any profile.
- To stop sharing with a profile, pick **Busy time only**. Teamwork removes the calendar's upcoming interviews that
  nobody has worked on yet; the calendar then counts as busy time.
- The **Teamwork** group in the sidebar shows the interviews assigned to you, on a calendar named after you. With "All
  interviews in the desktop app" (owners and the admin by default, or any role given it on Teamwork) you see every
  interview, one calendar per caller in their Teamwork color plus **Unassigned**, along with each member's **Busy** time
  from their own calendars: turn callers on or off to see when they're busy before you assign. Reminders only come for
  your own interviews.
- Colors come from Teamwork, so every caller looks the same for everyone, on the website and in the app. Owners, the
  admin and calendar managers can change them: hover a Teamwork calendar in the sidebar, click the palette, pick a
  color (the preview shows an interview in it) and **Save color**. On the website, click a member's color dot on the
  Members page or in the calendar's member list.
  It's read-only and updates by itself whenever something changes on Teamwork; you get a notification when an interview
  is assigned to you. Interviews that came from your own shared events show their Teamwork details on your event instead.
- Each Teamwork interview shows its caller at the end of the event: the caller's first name in their color,
  **You** for yours, or a dashed **Unassigned**. "R2 🔒" marks a later round, which stays with the earlier round's caller.
- An interview's details card starts with **Who joins**: the caller, the profile they speak as and its bidders, the
  company, role and round, the resume (**Download** saves it on your computer) and a shared **Link** (**Open** opens it
  in your browser). If you shared the interview (you work its profile), or you're an owner or the admin, **Upload
  resume** adds the resume (PDF or Word, up to 10 MB) and **Share link** adds one link for everyone on the interview.
  With company and role filled in, every round for them uses the resume; without, it stays with that interview.
- If your role lets you assign interviews, click **Assign** (or **Change**) next to the caller in **Who joins**, pick a
  caller (★ is Teamwork's recommendation) and click **Assign**. A later round stays with the earlier round's caller; only
  the admin can move it, after confirming.
- A Teamwork feed added as a link calendar can't be shared back: its interviews are on Teamwork already.
- Signing out keeps your sharing choices, and removes the Teamwork calendars until you sign in again.

---

## Sending calendars to other platforms

Some platforms can receive calendars from an app through a **calendar connection**. With one, this app sends them
your calendars, including calendars of **free Proton accounts**, which have no link a platform could follow on its
own. It works with any platform that supports calendar connections, and with several at once.

1. On the platform, make a calendar connection and copy its address. (Where exactly depends on the platform; look for
   "connect an app" near its calendar settings.)
2. In this app, click **Connections** in the sidebar, paste the address, then click **Connect**. An API key is
   optional: without one, the platform gives this app a key of its own.
3. On the platform, choose which of this app's calendars it gets. It may suggest the right ones.

That's all. From then on, the chosen calendars stay up to date there by themselves:

- A chosen calendar is sent within seconds whenever it syncs here, and right after you choose it on the platform.
- When the app starts, or the network comes back, it checks with each platform and sends only what it is missing.
- Proton is read only when you sync it, or when someone on the platform asks for a fresh copy (with **Stay in touch** on).
- **Stay in touch** keeps one quiet connection open so the platform can reach the app. Off, calendars still go
  whenever they sync here, and choices made on the platform arrive the next time the app starts.
- **Disconnect** ends the connection here and on the platform at once (if the network is down, the platform is told as
  soon as it can be). The calendars the platform already has stay there, no longer updated.
- If the connection is ended on the platform, it disappears here by itself, with a notification saying why.
- One address works with one app. On another computer, make another connection on the platform.

**For developers:** a platform supports this by answering, at the connection address, `PUT /catalog` (JSON
`{"calendars": [{"id", "name", "group_id", "group_name"}]}`, answering `{"calendars": [{"calendar_id", "wanted",
"client_hash"}]}`), `GET /` (the same answer), `PUT /calendars/<id>` (the calendar as `.ics`, with the app's
fingerprint in `X-Content-Hash`), `DELETE /pairing`, and optionally `GET /requests` (server-sent events: `sync`,
`wanted`, `disconnected`). Every request carries `X-Client-Id` and `X-Client-Name`, plus `X-API-Key` or the
`X-Connection-Key` the platform gave the app when it connected with `X-Pair: new` and no key.

---

## How syncing works

| Calendar type | When it updates |
| --- | --- |
| Google, Outlook (and other web links) | **When you click** refresh. You can also turn on automatic syncing (off by default). |
| Proton (all options) | **Only when you click** refresh, **Sync now** or **Sync all**. |

- Turn on automatic syncing, or change how often it runs, in **Settings → Sync → Auto-sync link calendars**. With many
  Google calendars, choose **Every hour** or **Every 3 hours**.
- **Google calendars sync one at a time**, 15 to 45 seconds apart, so Google doesn't take All-In-One for a bot and block
  it. With several Google calendars, a full refresh takes a few minutes. **Manage calendars** shows which calendar is
  next. The calendar that has gone longest without syncing goes first.
- Clicking a calendar's refresh button again within a minute keeps the events just downloaded.
- Refresh everything at once with the refresh button next to "Calendars" in the sidebar, or **Refresh calendars** in
  the tray icon menu.
- No internet? All-In-One keeps showing the events from the last successful sync.

---

## Problems?

| What you see | What to do |
| --- | --- |
| "Paste the Secret address in iCal format" when adding Google | You copied a different link. Copy **Secret address in iCal format** (see [Google Calendar](#google-calendar)). |
| A Google event is missing or out of date | Wait. Google can take a few hours to update the link. |
| "Google is temporarily limiting requests (HTTP 429). Paused until …" | Google is blocking requests from your computer for a while. All-In-One waits until the time shown and keeps showing your saved events. Don't keep clicking refresh, since every attempt makes the block longer. Turning **Auto-sync link calendars** off, or setting it to **Every 3 hours**, helps it not happen again. |
| "Paste the ICS link from Outlook" when adding Outlook | Copy the **ICS** link from **Publish a calendar** (see [Outlook Calendar](#outlook-calendar)). |
| Outlook events show only "Busy" | The calendar was published with less than **Can view all details**. Publish it again with full details and add the new link. |
| "Server responded with HTTP 404" | The link is no longer valid (it was reset or deleted). Copy a new one and edit the calendar in All-In-One. |
| "Request timed out", "The connection was interrupted" or "Couldn't find the server" | Check your internet connection, then click refresh. If you use a VPN, check that it's connected, or switch to another server. |
| "Couldn't connect through your proxy or VPN" | Your VPN or proxy isn't running or isn't reachable. Start it (or reconnect), then click refresh. All-In-One uses the same proxy settings as your browser. |
| "Secure connection failed" | A VPN, firewall or antivirus program is interfering with the connection. Try another VPN server, or check the program's settings. |
| "Missing or null Origin" when signing in to Teamwork | Update All-In-One to 1.2.0 or later, then sign in again. |
| "You can only share calendars with the profiles you work" | Ask a Teamwork owner to add you to that profile, or share with one of your own profiles. |
| A shared calendar shows an error in the Teamwork card (Connections) | Click **Sync shared calendars**. If Teamwork removed the calendar, it goes back to **Busy time only**; share it again if you still want to. |
| Proton account says "Login needed" | Click **Log in** on the account and sign in again. |
| Proton account says "Sync failed" | Click **Sync now** again. If it keeps failing, use **Open Proton** → **Download ICS** (see [Option A](#option-a-connect-your-proton-account-recommended)). |
| Invitations from Proton you declined or haven't answered look like normal events | Click **Edit** on the Proton account and check **Your email** (accounts added before version 1.0.7 need it entered once). |
| Events show only "Busy" with no titles | The Proton share link was created with **Limited view**. Create a new link with **Full view**. |
| A calendar doesn't appear | In **Manage calendars**, make sure it is not marked **Disabled** (turn its switch on). In the sidebar, make sure it is not hidden. |
