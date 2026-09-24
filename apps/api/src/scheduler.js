import { fetchReport, reportUrl } from './source.js';
import { parseReport } from './report.js';

// Limit total simultaneous requests across all browser clients.
const MAX_SOURCE_REQUESTS = 2;
const queue = [];
let active = 0;

function drain() {
  while (active < MAX_SOURCE_REQUESTS && queue.length) {
    const item = queue.shift();
    if (item.signal.aborted) {
      item.reject(item.signal.reason);
      continue;
    }
    active += 1;
    item.work().then(item.resolve, item.reject).finally(() => {
      active -= 1;
      drain();
    });
  }
}

function limited(work, signal) {
  return new Promise((resolve, reject) => {
    queue.push({ work, signal, resolve, reject });
    drain();
  });
}

function dateFor(academicStart, week, day) {
  const start = Date.parse(`${academicStart}T00:00:00Z`);
  return new Date(start + ((week - 1) * 7 + day - 1) * 86_400_000).toISOString().slice(0, 10);
}

function splitRooms(rooms) {
  if (!rooms.length) return [];
  const special = rooms.filter((room) => decodeURIComponent(room.id).startsWith('#SPLUS'));
  const regular = rooms.filter((room) => !decodeURIComponent(room.id).startsWith('#SPLUS'));
  const batches = [];
  if (regular.length) batches.push(regular.slice(0, 4));
  if (special.length) batches.push([special.shift()]);
  for (let index = 4; index < regular.length; index += 10) batches.push(regular.slice(index, index + 10));
  batches.push(...special.map((room) => [room]));
  return batches;
}

export async function queryReports({ rooms, weeks, days, periods, academicStart, dateFrom, dateTo, signal, onBatch }) {
  const firstWeek = Math.min(...weeks);
  const lastWeek = Math.max(...weeks);
  const firstDay = Math.min(...days);
  const lastDay = Math.max(...days);
  const dayRange = firstDay === lastDay ? String(firstDay) : `${firstDay}-${lastDay}`;
  const weekSet = new Set(weeks);
  const daySet = new Set(days);
  const batches = splitRooms(rooms);
  let completed = 0;

  await Promise.all(batches.map((batch) => limited(async () => {
    let parsed;
    let failure;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const html = await fetchReport(batch.map((room) => room.id), firstWeek, lastWeek, dayRange, periods, signal);
        parsed = parseReport(html, batch.map((room) => room.id), firstWeek, lastWeek);
        if (!parsed.size) throw new Error('Scientia returned no room timetables');
        break;
      } catch (error) {
        failure = error;
        if (signal.aborted) throw error;
        if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    const results = batch.map((room) => {
      const events = parsed?.get(room.id);
      if (!events) return { roomId: room.id, error: failure?.message ?? 'Scientia omitted this room' };
      return {
        roomId: room.id,
        events: events.flatMap((event) => event.weeks.filter((week) => weekSet.has(week) && daySet.has(event.day)).map((week) => {
          const date = dateFor(academicStart, week, event.day);
          if ((dateFrom && date < dateFrom) || (dateTo && date > dateTo)) return null;
          const { weeks: _weeks, ...details } = event;
          return { ...details, week, date };
        }).filter(Boolean)),
        originalUrl: reportUrl([room.id], firstWeek, lastWeek, dayRange, periods),
        originalGridUrl: reportUrl([room.id], firstWeek, lastWeek, dayRange, periods, 'Individual'),
      };
    });
    completed += batch.length;
    onBatch({ results, completed, total: rooms.length, fetchedAt: new Date().toISOString() });
  }, signal).catch((error) => {
    if (signal.aborted) return;
    completed += batch.length;
    onBatch({
      results: batch.map((room) => ({ roomId: room.id, error: error.message })),
      completed,
      total: rooms.length,
      fetchedAt: new Date().toISOString(),
    });
  })));
}

export function schedulerStats() {
  return { active, queued: queue.length, maxConcurrent: MAX_SOURCE_REQUESTS };
}
