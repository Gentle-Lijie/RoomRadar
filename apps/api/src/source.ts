const SOURCE = process.env.SCIENTIA_BASE_URL ?? 'http://timetablingunnc.nottingham.ac.uk:8017';
const decoder = new TextDecoder('windows-1252');

export interface CatalogRoom {
  id: string;
  name: string;
  fullName: string;
  building: string;
  capacity: number | null;
}

export interface Catalog {
  rooms: CatalogRoom[] | null;
  academicStart?: string;
  maxWeek?: number;
  source: 'partial' | 'live';
  issues: string[];
  updatedAt: string;
}

function messageOf(error: unknown) { return error instanceof Error ? error.message : String(error); }

function requestSignal(signal: AbortSignal | undefined, timeoutMs: number) {
  return signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
}

export async function fetchSource(path: string, signal: AbortSignal | undefined, timeoutMs = 45000) {
  const response = await fetch(`${SOURCE}${path}`, {
    signal: requestSignal(signal, timeoutMs),
    headers: { Accept: 'text/html, application/javascript;q=0.9, */*;q=0.8' },
  });
  if (!response.ok) throw new Error(`Scientia returned HTTP ${response.status}`);
  return decoder.decode(await response.arrayBuffer());
}

function parseValue(text: string) {
  try { return JSON.parse(`"${text}"`); }
  catch { return text; }
}

function parseRooms(script: string): CatalogRoom[] {
  const rows = new Map<number, Record<number, string>>();
  const pattern = /roomarray\[(\d+)\]\s*\[(\d+)\]\s*=\s*"((?:\\.|[^"\\])*)";/g;
  for (const match of script.matchAll(pattern)) {
    const index = Number(match[1]);
    if (!rows.has(index)) rows.set(index, {});
    rows.get(index)![Number(match[2])] = parseValue(match[3]);
  }
  const rooms = [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([, entry]) => {
    const fullName = entry[0];
    const capacity = /\((\d+)\)\s*$/.exec(fullName)?.[1];
    return {
      id: entry[2],
      name: fullName.replace(/\s*\(\d+\)\s*$/, '').trim(),
      fullName,
      building: entry[1].replace(/^01-BUILDING\s*-\s*/i, '').replace(/\s*-\s*all\s*$/i, '').trim(),
      capacity: capacity ? Number(capacity) : null,
    };
  });
  if (rooms.length < 50 || rooms.some((room) => !room.id || !room.name)) throw new Error('Scientia room list is incomplete');
  return rooms;
}

function parseAcademicPage(html: string) {
  const match = /AddGenWeeks\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*\d+\s*,\s*(\d+)/.exec(html);
  if (!match) throw new Error('Scientia academic week configuration is missing');
  const [, day, month, year, maxWeek] = match;
  const academicStart = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))).toISOString().slice(0, 10);
  return { academicStart, maxWeek: Number(maxWeek) };
}

export async function getCatalog(signal: AbortSignal): Promise<Catalog> {
  const [script, html] = await Promise.allSettled([
    fetchSource('/js/filter.js', signal, 60000),
    fetchSource('/room.htm', signal, 60000),
  ]);
  const issues: string[] = [];
  let rooms: CatalogRoom[] | null = null;
  let academic: { academicStart?: string; maxWeek?: number } = {};
  if (script.status === 'fulfilled') {
    try { rooms = parseRooms(script.value); }
    catch (error) { issues.push(`Room list: ${messageOf(error)}`); }
  } else issues.push(`Room list: ${messageOf(script.reason)}`);
  if (html.status === 'fulfilled') {
    try { academic = parseAcademicPage(html.value); }
    catch (error) { issues.push(`Academic weeks: ${messageOf(error)}`); }
  } else issues.push(`Academic weeks: ${messageOf(html.reason)}`);
  if (!rooms && !academic.academicStart) throw new Error(issues.join('; '));
  return {
    rooms,
    ...academic,
    source: issues.length ? 'partial' : 'live',
    issues,
    updatedAt: new Date().toISOString(),
  };
}

export function reportUrl(roomIds: string[], firstWeek: number, lastWeek: number, days = '1-7', periods = '1-32', style = 'TextSpreadsheet') {
  // Scientia only processes the final selected room if the ID list lacks its trailing CRLF.
  const encodedIds = roomIds.map((id) => encodeURIComponent(decodeURIComponent(id))).join('%0D%0A') + '%0D%0A';
  const weeks = firstWeek === lastWeek ? String(firstWeek) : `${firstWeek}-${lastWeek}`;
  return `${SOURCE}/reporting/${style};location;id;${encodedIds}?days=${days}&weeks=${weeks}&periods=${periods}&template=SWSCUST+location+${style}&height=100&week=100`;
}

export async function fetchReport(roomIds: string[], firstWeek: number, lastWeek: number, days: string, periods: string, signal: AbortSignal | undefined) {
  const url = reportUrl(roomIds, firstWeek, lastWeek, days, periods);
  const response = await fetch(url, { signal: requestSignal(signal, 60_000) });
  if (!response.ok) throw new Error(`Scientia report returned HTTP ${response.status}`);
  return decoder.decode(await response.arrayBuffer());
}
