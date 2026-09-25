import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import initialRooms from './data/rooms.json';

// 后端地址：开发时走 Vite 代理（留空），部署时由 .env 的 VITE_API_BASE 注入。
const apiBase = import.meta.env.VITE_API_BASE ?? '';

const MS_DAY = 86_400_000;

export type QueryState = 'idle' | 'loading' | 'done' | 'canceled' | 'error';
export type RoomSource = 'scientia' | 'mrb';
export type TimeMode = 'date' | 'week';

export interface Room {
  id: string;
  name: string;
  fullName?: string;
  building: string;
  capacity: number | null;
  source?: RoomSource;
  floor?: number | null;
  spaceNo?: string;
  enabled?: boolean;
  disableReason?: string | null;
}

export interface BookingEvent {
  roomId: string;
  date: string;
  week?: number;
  start: string;
  end: string;
  identifier: string;
  staff?: string;
  title?: string;
  activityType?: string;
  activityCapacity?: string;
  duration?: string;
  location?: string;
  roomDescription?: string;
  roomSize?: string;
  sourceWeeks?: string;
  attendees?: string[];
  rawFields?: Record<string, string>;
}

export interface RoomResult {
  roomId: string;
  events?: BookingEvent[];
  error?: string;
  originalUrl?: string;
  originalGridUrl?: string;
}

export interface MrbUser {
  name?: string;
  userId?: string;
}

export interface QueryProgress {
  completed: number;
  total: number;
}

export interface PeriodOption {
  value: string;
  label: string;
  start: number;
  end: number;
}

const QUERY_TRANSITIONS: Record<QueryState, Set<QueryState>> = {
  idle: new Set(['loading', 'error']),
  loading: new Set(['done', 'canceled', 'error', 'idle']),
  done: new Set(['loading', 'idle', 'error']),
  canceled: new Set(['loading', 'idle', 'error']),
  error: new Set(['loading', 'idle']),
};

export const PERIOD_OPTIONS: PeriodOption[] = [
  { value: '1-20', label: '08:00–18:00', start: 480, end: 1080 },
  { value: '1-32', label: '08:00–24:00', start: 480, end: 1440 },
  { value: '1-8', label: '上午 08:00–12:00', start: 480, end: 720 },
  { value: '9-20', label: '下午 12:00–18:00', start: 720, end: 1080 },
  { value: '21-32', label: '晚上 18:00–24:00', start: 1080, end: 1440 },
];

function shanghaiToday() {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const read = (type: string) => parts.find((part) => part.type === type)!.value;
  return `${read('year')}-${read('month')}-${read('day')}`;
}
function shiftDate(isoDate: string, days: number) {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * MS_DAY).toISOString().slice(0, 10);
}
function minutes(time: string) { return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)); }
function clock(total: number) { return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`; }
function messageOf(error: unknown, fallback = '请求失败') { return error instanceof Error ? error.message : fallback; }
function safeJsonParse<T>(text: string | null): T | null {
  try { return JSON.parse(text ?? 'null') as T; } catch { return null; }
}

export function useRoomSearch() {
  const today = shanghaiToday();
  const initialEnd = shiftDate(today, 6);
  const initialWeek = (date: string) => Math.floor((Date.parse(`${date}T00:00:00Z`) - Date.parse('2026-09-21T00:00:00Z')) / (7 * MS_DAY)) + 1;
  const scientiaRooms = ref<Room[]>(initialRooms as Room[]);
  const mrbRooms = ref<Room[]>([]);
  const rooms = computed<Room[]>(() => [...scientiaRooms.value, ...mrbRooms.value]);
  const resultRooms = ref<Room[]>([]);
  const roomResults = ref<Record<string, RoomResult>>({});
  const academicStart = ref('2026-09-21');
  const maxWeek = ref(21);
  const catalogUpdatedAt = ref<string | null>(null);
  const catalogError = ref('');
  const loadingCatalog = ref(false);
  const selectedBuildings = ref<string[]>([]);
  const selectedRoomIds = ref<string[]>([]);
  const selectedWeeks = ref<number[]>([Math.max(1, Math.min(21, initialWeek(today)))]);
  const timeMode = ref<TimeMode>('date');
  const selectedDays = ref<number[]>([1, 2, 3, 4, 5]);
  const minimumCapacity = ref('');
  const maximumCapacity = ref('');
  const dateFrom = ref(today);
  const dateTo = ref(initialEnd);
  const periods = ref('1-20');
  const directorySearch = ref('');
  const capacityAscending = ref(true);
  const queryState = ref<QueryState>('idle');
  const queryDirty = ref(false);
  const queryError = ref('');
  const progress = ref<QueryProgress>({ completed: 0, total: 0 });
  const fetchedAt = ref<string | null>(null);
  let activeController: AbortController | null = null;
  let querySequence = 0;

  // ---- Meeting room booking system (SSO, token lives in localStorage) ----
  const mrbToken = ref(localStorage.getItem('mrb.token') ?? '');
  const mrbUser = ref<MrbUser | null>(safeJsonParse<MrbUser>(localStorage.getItem('mrb.user')));
  const mrbLoginOpen = ref(false);
  const mrbLoginForm = ref({ username: '', password: '' });
  const mrbMfa = ref<{ stateId: string } | null>(null);
  const mrbMfaCode = ref('');
  const mrbLoginError = ref('');
  const mrbLoggingIn = ref(false);
  const mrbCatalogLoading = ref(false);
  const mrbError = ref('');

  function applyMrbSession(payload: { token: string; user?: MrbUser | null }) {
    mrbToken.value = payload.token;
    mrbUser.value = payload.user ?? null;
    localStorage.setItem('mrb.token', payload.token);
    localStorage.setItem('mrb.user', JSON.stringify(payload.user ?? null));
    mrbLoginOpen.value = false;
    mrbLoginForm.value.password = '';
    mrbMfa.value = null;
    mrbMfaCode.value = '';
    mrbLoginError.value = '';
    loadMrbCatalog();
  }

  function resetMrbLoginDialog() {
    mrbMfa.value = null;
    mrbMfaCode.value = '';
    mrbLoginError.value = '';
    mrbLoginForm.value.password = '';
  }

  async function loginMrb() {
    mrbLoggingIn.value = true;
    mrbLoginError.value = '';
    try {
      const response = await fetch(`${apiBase}/api/mrb/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mrbLoginForm.value),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? `登录失败（HTTP ${response.status}）`);
      if (payload.mfaRequired) {
        mrbMfa.value = { stateId: payload.stateId };
        return;
      }
      applyMrbSession(payload);
    } catch (error) {
      mrbLoginError.value = messageOf(error, '登录失败');
    } finally {
      mrbLoggingIn.value = false;
    }
  }

  async function submitMrbMfa() {
    mrbLoggingIn.value = true;
    mrbLoginError.value = '';
    try {
      const response = await fetch(`${apiBase}/api/mrb/login/mfa`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stateId: mrbMfa.value?.stateId, code: mrbMfaCode.value }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? `验证失败（HTTP ${response.status}）`);
      applyMrbSession(payload);
    } catch (error) {
      mrbLoginError.value = messageOf(error, '验证失败');
      mrbMfaCode.value = '';
    } finally {
      mrbLoggingIn.value = false;
    }
  }

  function disconnectMrb() {
    mrbToken.value = '';
    mrbUser.value = null;
    mrbError.value = '';
    mrbRooms.value = [];
    localStorage.removeItem('mrb.token');
    localStorage.removeItem('mrb.user');
    if (queryState.value !== 'canceled' && (queryState.value !== 'idle' || resultRooms.value.length)) invalidateQuery();
  }

  async function loadMrbCatalog() {
    if (!mrbToken.value) return;
    mrbCatalogLoading.value = true;
    mrbError.value = '';
    try {
      const response = await fetch(`${apiBase}/api/mrb/rooms`, { headers: { Authorization: `Bearer ${mrbToken.value}` }, cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 401) {
        disconnectMrb();
        mrbError.value = '会议室系统登录已过期，请重新连接';
        return;
      }
      if (!response.ok) throw new Error(payload.error ?? `会议室目录获取失败（HTTP ${response.status}）`);
      mrbRooms.value = payload.rooms.map((room: Omit<Room, 'source'>) => ({
        id: `mrb:${room.id}`,
        name: room.name,
        fullName: room.fullName,
        building: room.building,
        capacity: room.capacity,
        source: 'mrb' as const,
        floor: room.floor,
        spaceNo: room.spaceNo,
        enabled: room.enabled,
        disableReason: room.disableReason,
      }));
      if (queryState.value !== 'canceled' && (queryState.value !== 'idle' || resultRooms.value.length)) invalidateQuery();
    } catch (error) {
      mrbError.value = messageOf(error, '会议室目录获取失败');
    } finally {
      mrbCatalogLoading.value = false;
    }
  }

  function transitionQuery(next: QueryState) {
    if (queryState.value === next) return;
    if (!QUERY_TRANSITIONS[queryState.value]?.has(next)) throw new Error(`Invalid query transition: ${queryState.value} → ${next}`);
    queryState.value = next;
  }

  function weekOf(isoDate: string) {
    return Math.floor((Date.parse(`${isoDate}T00:00:00Z`) - Date.parse(`${academicStart.value}T00:00:00Z`)) / (7 * MS_DAY)) + 1;
  }
  function dayOf(isoDate: string) { return ((new Date(`${isoDate}T00:00:00Z`).getUTCDay() + 6) % 7) + 1; }
  function dateOf(week: number, day: number) { return shiftDate(academicStart.value, (week - 1) * 7 + day - 1); }
  const buildingNames = computed<string[]>(() => [...new Set(rooms.value.map((room) => room.building))].sort());
  const weekOptions = computed(() => Array.from({ length: maxWeek.value }, (_, index) => ({ value: index + 1, label: `第 ${index + 1} 周` })));
  const effectiveWeeks = computed<number[]>(() => {
    if (timeMode.value === 'week') return [...new Set(selectedWeeks.value)].sort((a, b) => a - b);
    const from = Date.parse(`${dateFrom.value}T00:00:00Z`);
    const to = Date.parse(`${dateTo.value}T00:00:00Z`);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to < from || to - from > 200 * MS_DAY) return [];
    const weeks = new Set<number>();
    for (let time = from; time <= to; time += MS_DAY) weeks.add(weekOf(new Date(time).toISOString().slice(0, 10)));
    return [...weeks].sort((a, b) => a - b);
  });
  const visibleDates = computed<string[]>(() => {
    if (timeMode.value === 'week') return effectiveWeeks.value.flatMap((week) => selectedDays.value.map((day) => dateOf(week, day))).sort();
    const dates: string[] = [];
    const from = Date.parse(`${dateFrom.value}T00:00:00Z`);
    const to = Date.parse(`${dateTo.value}T00:00:00Z`);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to < from || to - from > 200 * MS_DAY) return dates;
    for (let time = from; time <= to; time += MS_DAY) {
      const date = new Date(time).toISOString().slice(0, 10);
      if (selectedDays.value.includes(dayOf(date))) dates.push(date);
    }
    return dates;
  });
  const validationErrors = computed<Record<string, string>>(() => {
    const errors: Record<string, string> = {};
    const min = minimumCapacity.value === '' ? null : Number(minimumCapacity.value);
    const max = maximumCapacity.value === '' ? null : Number(maximumCapacity.value);
    if (min !== null && (!Number.isInteger(min) || min < 0 || min > 5000)) errors.minimumCapacity = '最小容量须为 0–5000 的整数';
    if (max !== null && (!Number.isInteger(max) || max < 0 || max > 5000)) errors.maximumCapacity = '最大容量须为 0–5000 的整数';
    if (!errors.minimumCapacity && !errors.maximumCapacity && min !== null && max !== null && min > max) errors.maximumCapacity = '最大容量不能小于最小容量';
    if (!selectedDays.value.length) errors.days = '至少选择一个星期';
    if (!PERIOD_OPTIONS.some((option) => option.value === periods.value)) errors.periods = '请选择有效时段';
    if (timeMode.value !== 'date' && timeMode.value !== 'week') errors.timeMode = '请选择有效时间筛选方式';
    if (timeMode.value === 'week') {
      if (!selectedWeeks.value.length || selectedWeeks.value.some((week) => !Number.isInteger(week) || week < 1 || week > maxWeek.value)) errors.weeks = '至少选择一个有效周次';
    } else {
      const valid = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(`${date}T00:00:00Z`)) && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
      if (!valid(dateFrom.value)) errors.dateFrom = '请选择有效开始日期';
      if (!valid(dateTo.value)) errors.dateTo = '请选择有效结束日期';
      if (!errors.dateFrom && !errors.dateTo) {
        const span = Date.parse(`${dateTo.value}T00:00:00Z`) - Date.parse(`${dateFrom.value}T00:00:00Z`);
        if (span < 0) errors.dateTo = '结束日期不能早于开始日期';
        else if (span > 200 * MS_DAY) errors.dateTo = '日期跨度不能超过 200 天';
        else if (effectiveWeeks.value.some((week) => week < 1 || week > maxWeek.value)) errors.dateTo = '日期须在当前学年可查询周次内';
        else if (!errors.days && !visibleDates.value.length) errors.days = '日期范围内没有已选星期';
      }
    }
    return errors;
  });
  const canQuery = computed(() => !Object.keys(validationErrors.value).length);
  function roomMatches(room: Room) {
    return (!selectedBuildings.value.length || selectedBuildings.value.includes(room.building))
      && (!minimumCapacity.value || (room.capacity ?? 0) >= Number(minimumCapacity.value))
      && (!maximumCapacity.value || (room.capacity ?? 0) <= Number(maximumCapacity.value));
  }
  const matchingRooms = computed<Room[]>(() => rooms.value.filter((room) => roomMatches(room) && (!selectedRoomIds.value.length || selectedRoomIds.value.includes(room.id)))
    .sort((a, b) => a.building.localeCompare(b.building) || (a.capacity ?? 0) - (b.capacity ?? 0)));
  const visibleDirectory = computed<Room[]>(() => rooms.value.filter((room) => roomMatches(room) && `${room.name} ${room.id} ${room.building}`.toLowerCase().includes(directorySearch.value.toLowerCase())).sort((a, b) => (capacityAscending.value ? (a.capacity ?? 0) - (b.capacity ?? 0) : (b.capacity ?? 0) - (a.capacity ?? 0)) || a.building.localeCompare(b.building)));
  const visibleRooms = computed<Room[]>(() => resultRooms.value);
  const visibleBuildings = computed<string[]>(() => [...new Set(visibleRooms.value.map((room) => room.building))]);
  const visibleBookings = computed<BookingEvent[]>(() => {
    const option = PERIOD_OPTIONS.find((item) => item.value === periods.value);
    if (!option) return [];
    const selectedDates = new Set(visibleDates.value);
    return Object.values(roomResults.value).flatMap((result) => result.events ?? [])
      .filter((event) => selectedDates.has(event.date) && minutes(event.start) < option.end && minutes(event.end) > option.start);
  });
  const bookingsIndex = computed(() => {
    const byRoom = new Map<string, BookingEvent[]>();
    const byRoomDate = new Map<string, Map<string, BookingEvent[]>>();
    for (const event of visibleBookings.value) {
      let events = byRoom.get(event.roomId);
      if (!events) { events = []; byRoom.set(event.roomId, events); }
      events.push(event);
      let dates = byRoomDate.get(event.roomId);
      if (!dates) { dates = new Map(); byRoomDate.set(event.roomId, dates); }
      let dayEvents = dates.get(event.date);
      if (!dayEvents) { dayEvents = []; dates.set(event.date, dayEvents); }
      dayEvents.push(event);
    }
    const byTime = (left: BookingEvent, right: BookingEvent) => left.date.localeCompare(right.date) || left.start.localeCompare(right.start);
    for (const events of byRoom.values()) events.sort(byTime);
    for (const dates of byRoomDate.values()) for (const events of dates.values()) events.sort(byTime);
    return { byRoom, byRoomDate };
  });
  const failedCount = computed(() => Object.values(roomResults.value).filter((result) => result.error).length);
  const focusDate = computed(() => visibleDates.value[0] ?? dateFrom.value);

  function bookingsForRoom(roomId: string, date: string | null = null): BookingEvent[] {
    return date ? bookingsIndex.value.byRoomDate.get(roomId)?.get(date) ?? [] : bookingsIndex.value.byRoom.get(roomId) ?? [];
  }
  function isRoomLoaded(roomId: string) { return Boolean(roomResults.value[roomId] && !roomResults.value[roomId].error); }
  function roomError(roomId: string) { return roomResults.value[roomId]?.error ?? ''; }
  function roomUrl(roomId: string) { return roomResults.value[roomId]?.originalUrl ?? null; }
  function roomGridUrl(roomId: string) { return roomResults.value[roomId]?.originalGridUrl ?? null; }
  function freeRanges(roomId: string, date: string) {
    if (!isRoomLoaded(roomId) || !visibleDates.value.includes(date)) return [];
    const option = PERIOD_OPTIONS.find((item) => item.value === periods.value);
    if (!option) return [];
    let cursor = option.start;
    const free: string[] = [];
    for (const event of bookingsForRoom(roomId, date)) {
      const start = Math.max(option.start, Math.min(option.end, minutes(event.start)));
      const end = Math.max(option.start, Math.min(option.end, minutes(event.end)));
      if (end <= start) continue;
      if (start > cursor) free.push(`${clock(cursor)}–${clock(start)}`);
      cursor = Math.max(cursor, end);
    }
    if (cursor < option.end) free.push(`${clock(cursor)}–${clock(option.end)}`);
    return free;
  }
  function cellSummary(roomId: string, bucket: { key: string | number; kind: 'date' | 'week' }) {
    if (!isRoomLoaded(roomId)) return null;
    const events = bookingsForRoom(roomId).filter((event) => bucket.kind === 'date' ? event.date === bucket.key : event.week === bucket.key);
    const option = PERIOD_OPTIONS.find((item) => item.value === periods.value);
    if (!option) return null;
    const dayCount = bucket.kind === 'date' ? 1 : visibleDates.value.filter((date) => weekOf(date) === bucket.key).length;
    const hours = dayCount * (option.end - option.start) / 60;
    const eventsByDate = new Map<string, BookingEvent[]>();
    for (const event of events) {
      let dayEvents = eventsByDate.get(event.date);
      if (!dayEvents) { dayEvents = []; eventsByDate.set(event.date, dayEvents); }
      dayEvents.push(event);
    }
    const occupied = [...eventsByDate.values()].reduce((total, dateEvents) => {
      const intervals = dateEvents
        .map((event) => [Math.max(option.start, minutes(event.start)), Math.min(option.end, minutes(event.end))])
        .filter(([start, end]) => end > start)
        .sort((left, right) => left[0] - right[0]);
      let occupiedMinutes = 0;
      let currentStart: number | null = null;
      let currentEnd: number | null = null;
      for (const [start, end] of intervals) {
        if (currentStart === null) {
          currentStart = start;
          currentEnd = end;
        } else if (start <= currentEnd!) {
          currentEnd = Math.max(currentEnd!, end);
        } else {
          occupiedMinutes += currentEnd! - currentStart;
          currentStart = start;
          currentEnd = end;
        }
      }
      if (currentStart !== null) occupiedMinutes += currentEnd! - currentStart;
      return total + occupiedMinutes / 60;
    }, 0);
    return { count: events.length, freeHours: Math.max(0, Math.round((hours - occupied) * 10) / 10) };
  }

  async function loadCatalog() {
    loadingCatalog.value = true;
    catalogError.value = '';
    try {
      const response = await fetch(`${apiBase}/api/catalog`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? '教室目录查询失败');
      const previousIds = scientiaRooms.value.map((room) => room.id).join('\u0000');
      const directoryChanged = (payload.academicStart && payload.academicStart !== academicStart.value)
        || (Array.isArray(payload.rooms) && payload.rooms.map((room: Room) => room.id).join('\u0000') !== previousIds);
      if (Array.isArray(payload.rooms)) {
        scientiaRooms.value = payload.rooms;
        catalogUpdatedAt.value = payload.updatedAt;
      }
      if (payload.academicStart) academicStart.value = payload.academicStart;
      if (payload.maxWeek) maxWeek.value = payload.maxWeek;
      if (payload.issues?.length) catalogError.value = payload.issues.join('; ');
      if (directoryChanged && queryState.value !== 'canceled' && (queryState.value !== 'idle' || resultRooms.value.length)) invalidateQuery();
    } catch (error) {
      catalogError.value = messageOf(error, '教室目录查询失败');
    } finally {
      loadingCatalog.value = false;
    }
  }

  function cancelQuery() {
    activeController?.abort();
    activeController = null;
  }

  function cancelActiveQuery() {
    if (queryState.value !== 'loading') return;
    cancelQuery();
    querySequence += 1;
    resultRooms.value = resultRooms.value.filter((room) => Object.hasOwn(roomResults.value, room.id));
    queryError.value = '';
    transitionQuery('canceled');
  }

  async function runQuery() {
    cancelQuery();
    const sequence = ++querySequence;
    const chosenRooms = matchingRooms.value;
    const scientiaChosen = chosenRooms.filter((room) => !room.id.startsWith('mrb:'));
    const mrbChosen = chosenRooms.filter((room) => room.id.startsWith('mrb:'));
    resultRooms.value = chosenRooms;
    roomResults.value = {};
    progress.value = { completed: 0, total: chosenRooms.length };
    fetchedAt.value = null;
    queryError.value = '';
    if (!canQuery.value) {
      transitionQuery('error');
      queryError.value = Object.values(validationErrors.value)[0];
      return;
    }
    queryDirty.value = false;
    const controller = new AbortController();
    activeController = controller;
    transitionQuery('loading');

    let scientiaCompleted = 0;
    let mrbCompleted = 0;
    const updateProgress = () => {
      if (sequence === querySequence) progress.value = { completed: scientiaCompleted + mrbCompleted, total: chosenRooms.length };
    };
    const mergeResults = (results: RoomResult[]) => {
      if (sequence !== querySequence) return;
      const next = { ...roomResults.value };
      for (const result of results) next[result.roomId] = result;
      roomResults.value = next;
    };

    const scientiaTask = (async () => {
      if (!scientiaChosen.length) return;
      const response = await fetch(`${apiBase}/api/availability/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        signal: controller.signal,
        body: JSON.stringify({
          roomIds: scientiaChosen.map((room) => room.id),
          academicStart: academicStart.value,
          weeks: effectiveWeeks.value,
          days: selectedDays.value,
          dateFrom: timeMode.value === 'date' ? dateFrom.value : null,
          dateTo: timeMode.value === 'date' ? dateTo.value : null,
          periods: periods.value,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? `查询失败（HTTP ${response.status}）`);
      }
      if (!response.body) throw new Error('当前浏览器不支持流式响应');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done || value === undefined) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim() || sequence !== querySequence) continue;
          const message = JSON.parse(line);
          if (message.type === 'meta') {
            updateProgress();
          } else if (message.type === 'batch') {
            mergeResults(message.results);
            scientiaCompleted = message.completed;
            updateProgress();
            fetchedAt.value = message.fetchedAt;
          } else if (message.type === 'error') {
            throw new Error(message.error);
          }
        }
      }
    })();

    const mrbTask = (async () => {
      if (!mrbChosen.length) return;
      const complete = (results: RoomResult[]) => {
        mergeResults(results);
        mrbCompleted = mrbChosen.length;
        updateProgress();
      };
      if (!mrbToken.value) {
        complete(mrbChosen.map((room) => ({ roomId: room.id, error: '未连接会议室系统' })));
        return;
      }
      const dates = visibleDates.value;
      try {
        const response = await fetch(`${apiBase}/api/mrb/timetable`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${mrbToken.value}` },
          cache: 'no-store',
          signal: controller.signal,
          body: JSON.stringify({
            roomIds: mrbChosen.map((room) => room.id.slice(4)),
            dateFrom: dates[0] ?? dateFrom.value,
            dateTo: dates[dates.length - 1] ?? dateTo.value,
          }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error ?? `会议室查询失败（HTTP ${response.status}）`);
        complete(payload.results.map((result: RoomResult) => ({
          ...result,
          events: (result.events ?? []).map((event) => ({ ...event, week: weekOf(event.date) })),
        })));
        fetchedAt.value = payload.fetchedAt;
      } catch (error) {
        if (controller.signal.aborted || sequence !== querySequence) return;
        complete(mrbChosen.map((room) => ({ roomId: room.id, error: messageOf(error, '会议室查询失败') })));
      }
    })();

    try {
      await Promise.all([scientiaTask, mrbTask]);
      if (sequence === querySequence && queryState.value === 'loading') transitionQuery('done');
    } catch (error) {
      if (sequence !== querySequence || controller.signal.aborted) return;
      transitionQuery('error');
      queryError.value = messageOf(error, '查询失败');
    } finally {
      if (activeController === controller) activeController = null;
    }
  }

  function invalidateQuery() {
    cancelQuery();
    querySequence += 1;
    resultRooms.value = [];
    roomResults.value = {};
    progress.value = { completed: 0, total: 0 };
    fetchedAt.value = null;
    queryDirty.value = true;
    queryError.value = canQuery.value ? '' : Object.values(validationErrors.value)[0];
    transitionQuery(canQuery.value ? 'idle' : 'error');
  }
  watch([selectedBuildings, selectedRoomIds, selectedDays, minimumCapacity, maximumCapacity, periods, timeMode], invalidateQuery);
  watch(selectedWeeks, () => { if (timeMode.value === 'week') invalidateQuery(); });
  watch([dateFrom, dateTo], () => { if (timeMode.value === 'date') invalidateQuery(); });
  onMounted(() => {
    loadCatalog();
    if (mrbToken.value) loadMrbCatalog();
  });
  onUnmounted(cancelQuery);

  return {
    rooms, resultRooms, roomResults, academicStart, maxWeek, catalogUpdatedAt, catalogError, loadingCatalog,
    selectedBuildings, selectedRoomIds, selectedWeeks, selectedDays, minimumCapacity, maximumCapacity, dateFrom, dateTo, periods, timeMode,
    directorySearch, capacityAscending, queryState, queryDirty, queryError, progress, fetchedAt,
    buildingNames, weekOptions, effectiveWeeks, visibleDates, validationErrors, canQuery, matchingRooms, visibleDirectory, visibleRooms, visibleBuildings, visibleBookings, failedCount, focusDate,
    dateOf, dayOf, weekOf, bookingsForRoom, isRoomLoaded, roomError, roomUrl, roomGridUrl, freeRanges, cellSummary, loadCatalog, runQuery, cancelActiveQuery,
    mrbToken, mrbUser, mrbRooms, mrbLoginOpen, mrbLoginForm, mrbMfa, mrbMfaCode, mrbLoginError, mrbLoggingIn, mrbCatalogLoading, mrbError,
    loginMrb, submitMrbMfa, disconnectMrb, loadMrbCatalog, resetMrbLoginDialog,
  };
}
