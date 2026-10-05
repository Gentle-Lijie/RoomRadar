// Scientia room names arrive as compound strings ("YANG Fujia Building
// Seminar Room 418 - Level 4", "IAMET-202 (Aerospace Project Room)"); rebuild
// them as "CODE - ROOM NO - TYPE[- NOTE]" so both catalog sources share the
// same display format as the MRB channel.
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const BUILDING_CODES: Record<string, string> = {
  'YANG Fujia Building': 'YFB',
  'Portland Building': 'PB',
  'The Sir Peter Mansfield Building': 'PMB',
  'The Lord Dearing Building': 'DB',
  'Sir David and Lady Susan Greenaway Building (IAMET)': 'IAMET',
  'Trent Building': 'Trent',
  'D.H Lawrence Auditorium': 'AUDI',
  'Siyuan Auditorium': 'SIYUAN',
};

// Room numbers: "418", "303-1", "406+", "A04", "314A"…
const NO = String.raw`\d{1,4}[A-Za-z]?(?:-\d+)?\+?|[A-Za-z]\d{2}(?:-\d+)?`;

export function formatScientiaName(building: string, raw: string): string {
  const code = BUILDING_CODES[building] ?? (building.replace(/\s*\(.*\)\s*/, '').trim() || building.trim());
  let n = raw.trim()
    // building full name or its code word as a prefix
    .replace(new RegExp(`^(?:${esc(building)}|${esc(code)})[\\s\\-–—]*`, 'i'), '')
    // normalise dash separators that have a space on either side; tight
    // hyphens ("303-1", "Lab-XRD") stay part of the token
    .replace(/(?<=\s)[-–—]\s*|\s*[-–—](?=\s)/g, ' - ')
    .replace(/(?: - )+/g, ' - ')
    // floor markers carry no information the directory doesn't already show
    .replace(/\s*-\s*Level\s*\d+|(?<=\d)\s+Level\s+\d+/gi, '')
    .replace(/^[\s–—-]+|[\s–—-]+$/g, '')
    // recurring typos in the source data
    .replace(/Lectue/g, 'Lecture').replace(/Interpretetation/gi, 'Interpretation').replace(/Chemisty/gi, 'Chemistry')
    .replace(/\s{2,}/g, ' ');
  if (!n) return /auditorium/i.test(building) ? `${code} - Auditorium` : code;
  // "<Type> <No>[- Note]" — the common teaching-room shape
  const typed = new RegExp(`^(?<type>[A-Za-z].*?)\\s*[-\\s]\\s*(?<no>${NO})\\s*(?:-\\s*(?<note>.+))?$`, 'i').exec(n);
  // "<No>[- Note]" — the IAMET style ("202 (Aerospace Project Room)")
  const numbered = new RegExp(`^(?<no>${NO})\\s*[-]?\\s*(?<note>.+)?$`, 'i').exec(n);
  // Display order: CODE - ROOM NO - TYPE - NOTE.
  const parts = typed?.groups?.no
    ? [typed.groups.no, typed.groups.type?.trim(), shortNote(typed.groups.note)]
    : numbered?.groups?.no
      ? [numbered.groups.no, shortNote(numbered.groups.note)]
      : [n];
  return [code, ...parts.filter(Boolean)].join(' - ');
}

// Long booking-policy notes ("Priority by Faculty Office … - Dry lab in …")
// collapse to their first chunk; short ones ("Analysis Lab - XRD LCMS") stay.
function shortNote(note: string | undefined) {
  const text = note?.trim().replace(/^\((.*)\)$/, '$1').trim();
  if (!text) return '';
  return text.length <= 48 ? text : text.split(' - ')[0].trim();
}
