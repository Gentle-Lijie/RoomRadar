# UNNC Room Check

A lightweight room availability browser for the University of Nottingham Ningbo China.

## Stack

- Frontend: Vue 3 + Vite + Tailwind CSS 4 + shadcn-vue.
- Backend scaffold: Node.js + Express.
- No database.

## Current stage

The frontend is a design preview with four views: room list, building groups,
date/week comparison, and the complete capacity directory. The directory is a
snapshot of 197 rooms from the source room list. Booking entries are illustrative
preview data; they are not live availability results. See [UI_AUDIT.md](UI_AUDIT.md)
for the review and three selectable color palettes.

## Development

```sh
npm install
npm run dev:web
```

The upstream room list is at `http://timetablingunnc.nottingham.ac.uk:8017/room.htm`.
It loads room metadata from `/js/filter.js` and builds timetable report URLs under
`/reporting/Individual;location;id;...`. The upstream report endpoint accepts GET requests;
the local frontend will POST query parameters to the Node API, which will fetch that report.
