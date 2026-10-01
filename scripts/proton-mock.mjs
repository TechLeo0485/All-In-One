// Local mock of Proton's login + Calendar "Import/export" page, for testing the
// Proton account sync without a real Proton account.
//
// The page structure mirrors Proton's open-source web client (WebClients:
// CalendarExportSection.tsx / ExportModal.tsx), which is what
// src/main/services/proton/protonExporter.ts automates.
//
// Usage:
//   node scripts/proton-mock.mjs
//   $env:UC_PROTON_BASE_URL = 'http://127.0.0.1:8766'; npm run dev     (PowerShell)
// Then add a Proton account in All-In-One and log in with user "alice", "bob" or
// "carol" (any password). The override only works in development builds.
//
// Extra endpoints:
//   GET /admin/rename   renames alice's "Work" calendar to "Office"
//   GET /admin/expire   signs everyone out (tests "Login needed")
import http from 'node:http'

const PORT = 8766
const sessions = new Map() // token -> user
const calendars = {
  alice: ['My calendar', 'Work'],
  bob: ['My calendar'],
  carol: ['Work', 'Work', 'Family'] // duplicate names on purpose
}

/** Runs in the browser. Renders the export section and simulates Proton's export flow. */
function clientApp(names, user) {
  let selectedIndex = 0
  const app = document.getElementById('app')
  const toIcsTime = (ms) => new Date(ms).toISOString().split('-').join('').split(':').join('').slice(0, 15) + 'Z'

  function render() {
    const selected = names[selectedIndex]
    app.innerHTML = `
      <section><h2>Import</h2>
        <div class="flex"><span><button id="calendar-import" class="select field">${names[0]}</button></span>
        <span><button>Import</button></span></div>
      </section>
      <section><h2>Export</h2>
        <div class="flex">
          <span class="flex-1"><button id="calendar-${selectedIndex}" class="select field"><span>${selected}</span></button></span>
          <span class="shrink-0"><button id="download">Download ICS</button></span>
        </div>
      </section>`

    // Calendar dropdown, rendered at the end of <body> like Proton's portal dropdown.
    document.getElementById(`calendar-${selectedIndex}`).onclick = () => {
      const list = document.createElement('ul')
      names.forEach((name, index) => {
        const item = document.createElement('li')
        item.className = 'dropdown-item'
        const option = document.createElement('button')
        option.title = name
        option.textContent = name
        option.onclick = () => {
          selectedIndex = index
          list.remove()
          render()
        }
        item.appendChild(option)
        list.appendChild(item)
      })
      document.body.appendChild(list)
    }

    // Export modal: "exports" for a moment, then offers "Save ICS file".
    document.getElementById('download').onclick = () => {
      const dialog = document.createElement('div')
      dialog.setAttribute('role', 'dialog')
      dialog.innerHTML = '<p>Exporting…</p><button type="button">Cancel</button>'
      document.body.appendChild(dialog)
      setTimeout(() => {
        const save = document.createElement('button')
        save.type = 'submit'
        save.textContent = 'Save ICS file'
        save.onclick = () => {
          const uid = `${user}-${selectedIndex}`
          const ics = [
            'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Proton AG//WebCalendar 5.0.0.a//EN',
            'BEGIN:VEVENT', `UID:${uid}-1`, 'DTSTART:20261001T150000Z', 'DTEND:20261001T160000Z',
            `SUMMARY:${selected} meeting (${user})`, 'END:VEVENT',
            // Starts in 11 minutes: with the default 10-minute reminder, a notification follows shortly.
            'BEGIN:VEVENT', `UID:${uid}-soon`, `DTSTART:${toIcsTime(Date.now() + 11 * 60000)}`,
            `DTEND:${toIcsTime(Date.now() + 41 * 60000)}`, `SUMMARY:Soon meeting (${selected})`,
            'LOCATION:Room 4', 'END:VEVENT',
            'END:VCALENDAR'
          ].join('\r\n')
          const link = document.createElement('a')
          link.href = URL.createObjectURL(new Blob([ics], { type: 'text/plain;charset=utf-8' }))
          link.download = `${selected}-2026-10-01.ics`
          document.body.appendChild(link)
          link.click()
          link.remove()
          dialog.remove()
        }
        dialog.appendChild(save)
      }, 1500)
    }
  }

  setTimeout(render, 1200) // Proton's app takes a moment to boot and decrypt
}

const page = (body, script = '') => `<!doctype html><html><body>${body}<script>${script}</script></body></html>`
const userFromCookie = (req) => {
  const match = /sess=([\w-]+)/.exec(req.headers.cookie || '')
  return match ? sessions.get(match[1]) : undefined
}

http
  .createServer((req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost')
    const send = (code, html, headers = {}) => {
      res.writeHead(code, { 'Content-Type': 'text/html', ...headers })
      res.end(html)
    }
    console.log(new Date().toISOString().slice(11, 19), req.method, pathname)

    if (pathname === '/login') {
      return send(200, page('<form method="POST" action="/do-login"><input id="username" name="username"><input id="password" name="password" type="password"><button type="submit">Sign in</button></form>'))
    }
    if (pathname === '/do-login' && req.method === 'POST') {
      let body = ''
      req.on('data', (chunk) => (body += chunk))
      req.on('end', () => {
        const token = Math.random().toString(36).slice(2)
        sessions.set(token, new URLSearchParams(body).get('username'))
        send(302, '', { Location: '/u/0/calendar', 'Set-Cookie': `sess=${token}; Path=/; HttpOnly; Max-Age=86400` })
      })
      return
    }
    if (pathname.startsWith('/u/0')) return send(200, page('<h1>Signed in</h1>'))
    if (pathname === '/admin/rename') {
      calendars.alice = calendars.alice.map((n) => (n === 'Work' ? 'Office' : n))
      return send(200, 'renamed')
    }
    if (pathname === '/admin/expire') {
      sessions.clear()
      return send(200, 'all sessions expired')
    }
    if (pathname === '/calendar/import-export') {
      const user = userFromCookie(req)
      if (!user) return send(302, '', { Location: '/login' })
      const script = `(${clientApp})(${JSON.stringify(calendars[user] ?? [])}, ${JSON.stringify(user)})`
      return send(200, page('<div id="app">Loading…</div>', script))
    }
    send(404, 'not found')
  })
  .listen(PORT, '127.0.0.1', () => console.log(`Proton mock running on http://127.0.0.1:${PORT}`))
