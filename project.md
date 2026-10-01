Build a desktop calendar application using Electron, React, and TypeScript.

Project goal:
Create a personal unified calendar app that displays multiple Proton Calendar sources in one calendar view. This app is read-only for Proton calendars. Users should be able to see events from multiple calendars together, with different colors for each account/calendar. Users can also create local custom events and attach notes to meetings.

Tech stack:
- Electron
- React + TypeScript
- Vite
- SQLite for local storage
- FullCalendar for calendar UI
- Better-sqlite3 for database access
- Zustand or similar lightweight state management
- Tailwind CSS for styling

Core features:

1. Calendar dashboard
- Show all events in one combined calendar.
- Support Month, Week, and Day views.
- Use FullCalendar.
- Events from different calendars should have different colors.
- Clicking an event opens an event details panel.

2. Calendar sources
Create a calendar management page:
- Add multiple calendar sources.
- Each calendar source has:
  - Name
  - Color
  - Source URL
  - Enabled/disabled toggle
- Allow users to hide/show specific calendars.

3. Proton calendar sync
Implement a read-only calendar sync system:
- Fetch calendar data from ICS URLs.
- Parse ICS files.
- Convert events into internal format.
- Store cached events in SQLite.
- Add manual refresh button.
- Add automatic background sync.

Do not implement writing back to Proton.

4. Local events
Users can create events that only exist inside this app:
- Title
- Start/end time
- Description
- Color
- Reminder support if possible

5. Meeting notes
Users can attach notes to any event:
- Rich text or markdown notes.
- Save notes locally.
- Display notes when opening an event.
- Allow editing and deleting notes.

6. Database design:

Tables:

calendars:
- id
- name
- color
- source_url
- created_at

events:
- id
- calendar_id
- external_id
- title
- description
- start_time
- end_time
- location
- is_local_event
- created_at

notes:
- id
- event_id
- content
- updated_at

settings:
- id
- key
- value


7. Application structure:

Use a clean architecture:

src/
 ├── main/
 │    ├── database/
 │    ├── sync/
 │    ├── ipc/
 │    └── services/
 │
 ├── renderer/
 │    ├── components/
 │    ├── pages/
 │    ├── hooks/
 │    ├── stores/
 │    └── styles/
 │
 └── shared/
      └── types/

8. Security:
- Use Electron contextIsolation.
- Do not expose Node APIs directly to React.
- Use preload scripts and IPC communication.

9. UI design:
Create a clean modern interface:
- Left sidebar:
  - Calendar list
  - Color indicators
  - Toggle visibility
  - Settings button

- Main area:
  - Calendar view

- Right panel:
  - Event details
  - Notes editor

10. Development requirements:
- Write clean maintainable code.
- Add comments where architecture decisions are important.
- Create reusable components.
- Handle sync errors gracefully.
- Include setup instructions in README.md.

Start by creating the project structure, installing dependencies, setting up Electron + React + TypeScript, then implement features step by step.