# UNNC Room Check

A lightweight room availability browser for the University of Nottingham Ningbo China.

## Stack

- Frontend: Vue 3 + Vite + Tailwind CSS 4 + shadcn-vue.
- Backend: Node.js + Express; it fetches Scientia reports directly.
- No database.

## Data flow

The frontend has four views: room list, building groups, date/week comparison,
and a capacity directory. Blue is the selected default color scheme.

`GET /api/catalog` reads the current room list and academic week configuration
from Scientia. The checked-in room list provides immediate filter options until
that request succeeds; the UI labels it as a directory snapshot meanwhile.
`POST /api/availability/stream` receives selected room IDs, weeks, days, dates,
and time range and fetches a fresh report from Scientia for every request.
No timetable responses are cached or stored.

To reduce waiting on Scientia, the backend combines multiple rooms and a range
of weeks in one upstream request, limits upstream requests to two at a time,
and streams completed batches back to the UI. Changing a filter cancels the
previous browser request. The source's report endpoint accepts GET; the browser
talks only to the local POST endpoint.

Scientia's list report exposes a booking/activity identifier, type, name,
activity capacity, location, room size, Staff, time, duration, and applicable
weeks. Staff can be blank for a booking. The detail view retains every source
field and links to both original list and grid reports.

## Development

```sh
npm install
npm run dev
```

The Vite frontend is at `http://localhost:5173`; the API is at
`http://localhost:3001`. Build the frontend with `npm run build` and then run
the single-origin production server with `npm start`.

The upstream room list is at `http://timetablingunnc.nottingham.ac.uk:8017/room.htm`.
It loads room metadata from `/js/filter.js` and fetches detailed records under
`/reporting/TextSpreadsheet;location;id;...`.
