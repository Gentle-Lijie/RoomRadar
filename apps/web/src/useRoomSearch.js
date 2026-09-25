import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import initialRooms from './data/rooms.json';

const MS_DAY = 86_400_000;
export const PERIOD_OPTIONS = [
  { value: '1-20', label: '08:00–18:00', start: 480, end: 1080 },
  { value: '1-32', label: '08:00–24:00', start: 480, end: 1440 },
  { value: '1-8', label: '上午 08:00–12:00', start: 480, end: 720 },
  { value: '9-20', label: '下午 12:00–18:00', start: 720, end: 1080 },
  { value: '21-32', label: '晚上 18:00–24:00', start: 1080, end: 1440 },
];

function shanghaiToday() {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const read = (type) => parts.find((part) => part.type === type).value;
  return `${read('year')}-${read('month')}-${read('day')}`;
}
function shiftDate(isoDate, days) {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * MS_DAY).toISOString().slice(0, 10);
}
function minutes(time) { return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)); }
function clock(total) { return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`; }

export function useRoomSearch() {
  const today = shanghaiToday();
  const initialEnd = shiftDate(today, 6);
  const initialWeek = (date) => Math.floor((Date.parse(`${date}T00:00:00Z`) - Date.parse('2026-09-21T00:00:00Z')) / (7 * MS_DAY)) + 1;
  const rooms = ref(initialRooms);
  const resultRooms = ref([]);
  const roomResults = ref({});
  const academicStart = ref('2026-09-21');
  const maxWeek = ref(21);
  const catalogUpdatedAt = ref(null);
  const catalogError = ref('');
  const loadingCatalog = ref(false);
  const selectedBuildings = ref([]);
  const selectedRoomIds = ref([]);
  const selectedWeeks = ref([Math.max(1, Math.min(21, initialWeek(today)))]);
  const timeMode = ref('date');
  const selectedDays = ref([1, 2, 3, 4, 5]);
  const minimumCapacity = ref('');
  const maximumCapacity = ref('');
  const dateFrom = ref(today);
  const dateTo = ref(initialEnd);
  const periods = ref('1-20');
  const directorySearch = ref('');
  const capacityAscending = ref(true);
  const queryState = ref('idle');
  const queryError = ref('');
  const progress = ref({ completed: 0, total: 0 });
  const fetchedAt = ref(null);
  let activeController = null;
  let debounceTimer = null;
  let ready = true;
  let querySequence = 0;

  function weekOf(isoDate) {
    return Math.floor((Date.parse(`${isoDate}T00:00:00Z`) - Date.parse(`${academicStart.value}T00:00:00Z`)) / (7 * MS_DAY)) + 1;
  }
  function dayOf(isoDate) { return ((new Date(`${isoDate}T00:00:00Z`).getUTCDay() + 6) % 7) + 1; }
  function dateOf(week, day) { return shiftDate(academicStart.value, (week - 1) * 7 + day - 1); }
  const buildingNames = computed(() => [...new Set(rooms.value.map((room) => room.building))].sort());
  const weekOptions = computed(() => Array.from({ length: maxWeek.value }, (_, index) => ({ value: index + 1, label: `第 ${index + 1} 周` })));
  const effectiveWeeks = computed(() => {
    if (timeMode.value === 'week') return [...new Set(selectedWeeks.value)].sort((a, b) => a - b);
    const from = Date.parse(`${dateFrom.value}T00:00:00Z`);
    const to = Date.parse(`${dateTo.value}T00:00:00Z`);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to < from || to - from > 200 * MS_DAY) return [];
    const weeks = new Set();
    for (let time = from; time <= to; time += MS_DAY) weeks.add(weekOf(new Date(time).toISOString().slice(0, 10)));
    return [...weeks].sort((a, b) => a - b);
  });
  const visibleDates = computed(() => {
    if (timeMode.value === 'week') return effectiveWeeks.value.flatMap((week) => selectedDays.value.map((day) => dateOf(week, day))).sort();
    const dates = [];
    const from = Date.parse(`${dateFrom.value}T00:00:00Z`);
    const to = Date.parse(`${dateTo.value}T00:00:00Z`);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to < from || to - from > 200 * MS_DAY) return dates;
    for (let time = from; time <= to; time += MS_DAY) {
      const date = new Date(time).toISOString().slice(0, 10);
      if (selectedDays.value.includes(dayOf(date))) dates.push(date);
    }
    return dates;
  });
  const validationErrors = computed(() => {
    const errors = {};
    const min = minimumCapacity.value === '' ? null : Number(minimumCapacity.value);
    const max = maximumCapacity.value === '' ? null : Number(maximumCapacity.value);
    if (min !== null && (!Number.isInteger(min) || min < 0 || min > 5000)) errors.minimumCapacity = '最小容量须为 0–5000 的整数';
    if (max !== null && (!Number.isInteger(max) || max < 0 || max > 5000)) errors.maximumCapacity = '最大容量须为 0–5000 的整数';
    if (!errors.minimumCapacity && !errors.maximumCapacity && min !== null && max !== null && min > max) errors.maximumCapacity = '最大容量不能小于最小容量';
    if (!selectedDays.value.length) errors.days = '至少选择一个星期';
    if (!PERIOD_OPTIONS.some((option) => option.value === periods.value)) errors.periods = '请选择有效时段';
    if (!['date', 'week'].includes(timeMode.value)) errors.timeMode = '请选择有效时间筛选方式';
    if (timeMode.value === 'week') {
      if (!selectedWeeks.value.length || selectedWeeks.value.some((week) => !Number.isInteger(week) || week < 1 || week > maxWeek.value)) errors.weeks = '至少选择一个有效周次';
    } else {
      const valid = (date) => /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(`${date}T00:00:00Z`)) && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
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
  function roomMatches(room) {
    return (!selectedBuildings.value.length || selectedBuildings.value.includes(room.building))
      && (!minimumCapacity.value || room.capacity >= Number(minimumCapacity.value))
      && (!maximumCapacity.value || room.capacity <= Number(maximumCapacity.value));
  }
  const visibleDirectory = computed(() => rooms.value.filter((room) => roomMatches(room) && `${room.name} ${room.id} ${room.building}`.toLowerCase().includes(directorySearch.value.toLowerCase())).sort((a, b) => (capacityAscending.value ? a.capacity - b.capacity : b.capacity - a.capacity) || a.building.localeCompare(b.building)));
  const visibleRooms = computed(() => resultRooms.value);
  const visibleBuildings = computed(() => [...new Set(visibleRooms.value.map((room) => room.building))]);
  const visibleBookings = computed(() => {
    const option = PERIOD_OPTIONS.find((item) => item.value === periods.value);
    if (!option) return [];
    const selectedDates = new Set(visibleDates.value);
    return Object.values(roomResults.value).flatMap((result) => result.events ?? [])
      .filter((event) => selectedDates.has(event.date) && minutes(event.start) < option.end && minutes(event.end) > option.start);
  });
  const bookingsIndex = computed(() => {
    const byRoom = new Map();
    const byRoomDate = new Map();
    for (const event of visibleBookings.value) {
      if (!byRoom.has(event.roomId)) byRoom.set(event.roomId, []);
      byRoom.get(event.roomId).push(event);
      if (!byRoomDate.has(event.roomId)) byRoomDate.set(event.roomId, new Map());
      const dates = byRoomDate.get(event.roomId);
      if (!dates.has(event.date)) dates.set(event.date, []);
      dates.get(event.date).push(event);
    }
    const byTime = (left, right) => left.date.localeCompare(right.date) || left.start.localeCompare(right.start);
    for (const events of byRoom.values()) events.sort(byTime);
    for (const dates of byRoomDate.values()) for (const events of dates.values()) events.sort(byTime);
    return { byRoom, byRoomDate };
  });
  const failedCount = computed(() => Object.values(roomResults.value).filter((result) => result.error).length);
  const focusDate = computed(() => visibleDates.value[0] ?? dateFrom.value);

  function bookingsForRoom(roomId, date = null) {
    return date ? bookingsIndex.value.byRoomDate.get(roomId)?.get(date) ?? [] : bookingsIndex.value.byRoom.get(roomId) ?? [];
  }
  function isRoomLoaded(roomId) { return Boolean(roomResults.value[roomId] && !roomResults.value[roomId].error); }
  function roomError(roomId) { return roomResults.value[roomId]?.error ?? ''; }
  function roomUrl(roomId) { return roomResults.value[roomId]?.originalUrl ?? null; }
  function roomGridUrl(roomId) { return roomResults.value[roomId]?.originalGridUrl ?? null; }
  function freeRanges(roomId, date) {
    if (!isRoomLoaded(roomId) || !visibleDates.value.includes(date)) return [];
    const option = PERIOD_OPTIONS.find((item) => item.value === periods.value);
    let cursor = option.start;
    const free = [];
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
  function cellSummary(roomId, bucket) {
    if (!isRoomLoaded(roomId)) return null;
    const events = bookingsForRoom(roomId).filter((event) => bucket.kind === 'date' ? event.date === bucket.key : event.week === bucket.key);
    const option = PERIOD_OPTIONS.find((item) => item.value === periods.value);
    const dayCount = bucket.kind === 'date' ? 1 : visibleDates.value.filter((date) => weekOf(date) === bucket.key).length;
    const hours = dayCount * (option.end - option.start) / 60;
    const eventsByDate = new Map();
    for (const event of events) {
      if (!eventsByDate.has(event.date)) eventsByDate.set(event.date, []);
      eventsByDate.get(event.date).push(event);
    }
    const occupied = [...eventsByDate.values()].reduce((total, dateEvents) => {
      const intervals = dateEvents
        .map((event) => [Math.max(option.start, minutes(event.start)), Math.min(option.end, minutes(event.end))])
        .filter(([start, end]) => end > start)
        .sort((left, right) => left[0] - right[0]);
      let occupiedMinutes = 0;
      let currentStart = null;
      let currentEnd = null;
      for (const [start, end] of intervals) {
        if (currentStart === null) {
          currentStart = start;
          currentEnd = end;
        } else if (start <= currentEnd) {
          currentEnd = Math.max(currentEnd, end);
        } else {
          occupiedMinutes += currentEnd - currentStart;
          currentStart = start;
          currentEnd = end;
        }
      }
      if (currentStart !== null) occupiedMinutes += currentEnd - currentStart;
      return total + occupiedMinutes / 60;
    }, 0);
    return { count: events.length, freeHours: Math.max(0, Math.round((hours - occupied) * 10) / 10) };
  }

  async function loadCatalog() {
    loadingCatalog.value = true;
    catalogError.value = '';
    try {
      const response = await fetch('/api/catalog', { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? '教室目录查询失败');
      const previousIds = rooms.value.map((room) => room.id).join('\u0000');
      const directoryChanged = (payload.academicStart && payload.academicStart !== academicStart.value)
        || (Array.isArray(payload.rooms) && payload.rooms.map((room) => room.id).join('\u0000') !== previousIds);
      if (Array.isArray(payload.rooms)) {
        rooms.value = payload.rooms;
        catalogUpdatedAt.value = payload.updatedAt;
      }
      if (payload.academicStart) academicStart.value = payload.academicStart;
      if (payload.maxWeek) maxWeek.value = payload.maxWeek;
      if (payload.issues?.length) catalogError.value = payload.issues.join('; ');
      ready = true;
      if (directoryChanged && queryState.value !== 'idle') scheduleQuery();
    } catch (error) {
      catalogError.value = error.message;
    } finally {
      loadingCatalog.value = false;
    }
  }

  function cancelQuery() {
    if (debounceTimer) clearTimeout(debounceTimer);
    activeController?.abort();
  }

  async function runQuery() {
    if (debounceTimer) clearTimeout(debounceTimer);
    activeController?.abort();
    const sequence = ++querySequence;
    const chosenRooms = rooms.value.filter((room) => roomMatches(room) && (!selectedRoomIds.value.length || selectedRoomIds.value.includes(room.id)))
      .sort((a, b) => a.building.localeCompare(b.building) || a.capacity - b.capacity);
    resultRooms.value = chosenRooms;
    roomResults.value = {};
    progress.value = { completed: 0, total: chosenRooms.length };
    fetchedAt.value = null;
    queryError.value = '';
    if (!canQuery.value) {
      queryState.value = 'error';
      queryError.value = Object.values(validationErrors.value)[0];
      return;
    }
    const controller = new AbortController();
    activeController = controller;
    queryState.value = 'loading';
    try {
      const response = await fetch('/api/availability/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        signal: controller.signal,
        body: JSON.stringify({
          roomIds: chosenRooms.map((room) => room.id),
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
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.trim() || sequence !== querySequence) continue;
          const message = JSON.parse(line);
          if (message.type === 'meta') {
            progress.value = { completed: 0, total: message.roomIds.length };
          } else if (message.type === 'batch') {
            const next = { ...roomResults.value };
            for (const result of message.results) next[result.roomId] = result;
            roomResults.value = next;
            progress.value = { completed: message.completed, total: message.total };
            fetchedAt.value = message.fetchedAt;
          } else if (message.type === 'error') {
            throw new Error(message.error);
          } else if (message.type === 'done') {
            queryState.value = 'done';
            fetchedAt.value = message.completedAt;
          }
        }
      }
      if (sequence === querySequence && queryState.value === 'loading') queryState.value = 'done';
    } catch (error) {
      if (sequence !== querySequence || controller.signal.aborted) return;
      queryState.value = 'error';
      queryError.value = error.message;
    }
  }

  function scheduleQuery() {
    if (!ready) return;
    cancelQuery();
    resultRooms.value = [];
    roomResults.value = {};
    progress.value = { completed: 0, total: 0 };
    if (!canQuery.value) {
      queryState.value = 'error';
      queryError.value = Object.values(validationErrors.value)[0];
      return;
    }
    queryState.value = 'loading';
    queryError.value = '';
    debounceTimer = setTimeout(runQuery, 450);
  }
  watch([selectedBuildings, selectedRoomIds, selectedDays, minimumCapacity, maximumCapacity, periods, timeMode], scheduleQuery);
  watch(selectedWeeks, () => { if (timeMode.value === 'week') scheduleQuery(); });
  watch([dateFrom, dateTo], () => { if (timeMode.value === 'date') scheduleQuery(); });
  onMounted(loadCatalog);
  onUnmounted(cancelQuery);

  return {
    rooms, resultRooms, roomResults, academicStart, maxWeek, catalogUpdatedAt, catalogError, loadingCatalog,
    selectedBuildings, selectedRoomIds, selectedWeeks, selectedDays, minimumCapacity, maximumCapacity, dateFrom, dateTo, periods, timeMode,
    directorySearch, capacityAscending, queryState, queryError, progress, fetchedAt,
    buildingNames, weekOptions, effectiveWeeks, visibleDates, validationErrors, canQuery, visibleDirectory, visibleRooms, visibleBuildings, visibleBookings, failedCount, focusDate,
    dateOf, dayOf, weekOf, bookingsForRoom, isRoomLoaded, roomError, roomUrl, roomGridUrl, freeRanges, cellSummary, loadCatalog, runQuery,
  };
}
