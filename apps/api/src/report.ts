import { load } from 'cheerio';

export interface ReportEvent {
  roomId: string;
  day: number;
  start: string;
  end: string;
  identifier: string;
  activityType: string;
  activityCapacity: string;
  title: string;
  duration: string;
  location: string;
  roomDescription: string;
  roomSize: string;
  staff: string;
  sourceWeeks: string;
  sourceRoomLabel: string;
  rawFields: Record<string, string>;
  weeks: number[];
}

const DAY_NUMBERS: Record<string, number> = { Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6, Sunday: 7 };

function tidy(text: string) {
  return text.replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
}

function normalTime(value: string) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  return match ? `${match[1].padStart(2, '0')}:${match[2]}` : value;
}

export function expandWeeks(specification: string, firstWeek: number, lastWeek: number) {
  const weeks = new Set<number>();
  for (const match of specification.matchAll(/\b(\d+)(?:\s*-\s*(\d+))?\b/g)) {
    const first = Number(match[1]);
    const last = Number(match[2] ?? match[1]);
    if (last - first > 60) continue;
    for (let week = first; week <= last; week += 1) {
      if (week >= firstWeek && week <= lastWeek) weeks.add(week);
    }
  }
  if (!weeks.size && !specification.trim()) {
    for (let week = firstWeek; week <= lastWeek; week += 1) weeks.add(week);
  }
  return weeks;
}

export function parseReport(html: string, requestedIds: string[], firstWeek: number, lastWeek: number) {
  const $ = load(html);
  const requested = requestedIds.map((id) => ({ original: id, decoded: decodeURIComponent(id).toLowerCase() }));
  const reportHeaders = $('body > table').filter((_, table) => /Room:\s*/.test($(table).text())).toArray();
  const orderIsComplete = reportHeaders.length === requested.length;
  const parsed = new Map<string, ReportEvent[]>();
  let headerIndex = -1;
  let currentRoom: { original: string; decoded: string } | null = null;
  let sourceRoomLabel = '';

  for (const element of $('body').children().toArray()) {
    if (element.tagName !== 'table') continue;
    const $table = $(element);
    const header = /Room:\s*([^<]+)/.exec($table.html() ?? '');
    if (header) {
      headerIndex += 1;
      sourceRoomLabel = tidy(header[1]);
      currentRoom = requested
        .filter((candidate) => sourceRoomLabel.toLowerCase().startsWith(candidate.decoded))
        .sort((a, b) => b.decoded.length - a.decoded.length)[0]
        ?? (orderIsComplete ? requested[headerIndex] : null);
      if (currentRoom) parsed.set(currentRoom.original, []);
      continue;
    }
    if ($table.attr('border') !== '1' || !currentRoom) continue;
    const rows = $table.children('tbody').children('tr').toArray();
    if (!rows.length) continue;
    const headers = $(rows[0]).children('td').toArray().map((cell) => tidy($(cell).text()));
    if (headers[0] !== 'Activity' || headers.length < 13) continue;

    for (const row of rows.slice(1)) {
      const values = $(row).children('td').toArray().map((cell) => tidy($(cell).text()));
      if (values.length < 13) continue;
      const day = DAY_NUMBERS[values[4]];
      if (!day) continue;
      parsed.get(currentRoom.original)!.push({
        roomId: currentRoom.original,
        day,
        start: normalTime(values[5]),
        end: normalTime(values[6]),
        identifier: values[0],
        activityType: values[1],
        activityCapacity: values[2],
        title: values[3],
        duration: values[7],
        location: values[8],
        roomDescription: values[9],
        roomSize: values[10],
        staff: values[11],
        sourceWeeks: values[12],
        sourceRoomLabel,
        rawFields: Object.fromEntries(headers.slice(0, values.length).map((label, index) => [label, values[index]])),
        weeks: [...expandWeeks(values[12], firstWeek, lastWeek)],
      });
    }
  }
  return parsed;
}
