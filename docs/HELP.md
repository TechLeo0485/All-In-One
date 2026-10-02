# Adding your calendars to All-In-One

All-In-One shows your Google, Outlook and Proton calendars together in one place. This guide explains how to add each kind.

All-In-One only **reads** your calendars. It never changes anything in Google, Outlook or Proton. To add or edit an event in
those calendars, use Google, Outlook or Proton as usual; the change shows up in All-In-One after the next sync.

- [Google Calendar](#google-calendar)
- [Outlook Calendar](#outlook-calendar)
- [Proton Calendar](#proton-calendar)
  - [Option A: Connect your Proton account (free or paid)](#option-a-connect-your-proton-account-recommended)
  - [Option B: Share link (paid Proton plans)](#option-b-share-link-paid-proton-plans)
  - [Option C: Exported file (free or paid)](#option-c-exported-file)
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
   if you use it. The window closes by itself once you're in.
4. Click **Sync now**. All-In-One downloads all calendars from that account.

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

## How syncing works

| Calendar type | When it updates |
| --- | --- |
| Google, Outlook (and other web links) | **Automatically**, every 30 minutes by default and shortly after All-In-One starts. |
| Proton (all options) | **Only when you click** refresh, **Sync now** or **Sync all**. |

- Change the automatic interval, or turn it off, in **Settings → Sync → Auto-sync link calendars**.
- Refresh everything at once with the refresh button next to "Calendars" in the sidebar, or **Refresh calendars** in
  the tray icon menu.
- No internet? All-In-One keeps showing the events from the last successful sync.

---

## Problems?

| What you see | What to do |
| --- | --- |
| "Paste the Secret address in iCal format" when adding Google | You copied a different link. Copy **Secret address in iCal format** (see [Google Calendar](#google-calendar)). |
| A Google event is missing or out of date | Wait. Google can take a few hours to update the link. |
| "Paste the ICS link from Outlook" when adding Outlook | Copy the **ICS** link from **Publish a calendar** (see [Outlook Calendar](#outlook-calendar)). |
| Outlook events show only "Busy" | The calendar was published with less than **Can view all details**. Publish it again with full details and add the new link. |
| "Server responded with HTTP 404" | The link is no longer valid (it was reset or deleted). Copy a new one and edit the calendar in All-In-One. |
| "Network error" or "Request timed out" | Check your internet connection, then click refresh. |
| Proton account says "Login needed" | Click **Log in** on the account and sign in again. |
| Proton account says "Sync failed" | Click **Sync now** again. If it keeps failing, use **Open Proton** → **Download ICS** (see [Option A](#option-a-connect-your-proton-account-recommended)). |
| Events show only "Busy" with no titles | The Proton share link was created with **Limited view**. Create a new link with **Full view**. |
| A calendar doesn't appear | In **Manage calendars**, make sure it is not marked **Disabled** (turn its switch on). In the sidebar, make sure it is not hidden. |
