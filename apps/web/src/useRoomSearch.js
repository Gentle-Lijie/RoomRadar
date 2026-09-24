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
  const selectedWeeks = ref([...new Set([initialWeek(today), initialWeek(initialEnd)].map((week) => Math.max(1, Math.min(21, week))))]);
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
  const visibleDates = computed(() => {
    const dates = [];
    const from = Date.parse(`${dateFrom.value}T00:00:00Z`);
    const to = Date.parse(`${dateTo.value}T00:00:00Z`);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return dates;
    for (let time = from; time <= to; time += MS_DAY) {
      const date = new Date(time).toISOString().slice(0, 10);
      if (selectedWeeks.value.includes(weekOf(date)) && selectedDays.value.includes(dayOf(date))) dates.push(date);
    }
    return dates;
  });
  function roomMatches(room) {
    return (!selectedBuildings.value.length || selectedBuildings.value.includes(room.building))
      && (!minimumCapacity.value || room.capacity >= Number(minimumCapacity.value))
      && (!maximumCapacity.value || room.capacity <= Number(maximumCapacity.value));
  }
  const visibleDirectory = computed(() => rooms.value.filter((room) => roomMatches(room) && `${room.name} ${room.id} ${room.building}`.toLowerCase().includes(directorySearch.value.toLowerCase())).sort((a, b) => (capacityAscending.value ? a.capacity - b.capacity : b.capacity - a.capacity) || a.building.localeCompare(b.building)));
  const visibleRooms = computed(() => resultRooms.value);
  const visibleBuildings = computed(() => [...new Set(visibleRooms.value.map((room) => room.building))]);
  const visibleBookings = computed(() => Object.values(roomResults.value).flatMap((result) => result.events ?? []).filter((event) => visibleDates.value.includes(event.date)));
  const failedCount = computed(() => Object.values(roomResults.value).filter((result) => result.error).length);
  const focusDate = computed(() => visibleDates.value[0] ?? dateFrom.value);

  function bookingsForRoom(roomId, date = null) {
    return visibleBookings.value.filter((event) => event.roomId === roomId && (!date || event.date === date)).sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
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
      const start = Math.max(option.start, minutes(event.start));
      const end = Math.min(option.end, minutes(event.end));
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
      syncWeeksToDates();
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

  function syncWeeksToDates() {
    const from = Date.parse(`${dateFrom.value}T00:00:00Z`);
    const to = Date.parse(`${dateTo.value}T00:00:00Z`);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return;
    const weeks = new Set();
    for (let time = from; time <= to && weeks.size <= maxWeek.value; time += MS_DAY) {
      const week = weekOf(new Date(time).toISOString().slice(0, 10));
      if (week >= 1 && week <= maxWeek.value) weeks.add(week);
    }
    const next = [...weeks].sort((a, b) => a - b);
    if (next.length !== selectedWeeks.value.length || next.some((week, index) => week !== selectedWeeks.value[index])) selectedWeeks.value = next;
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
    if (!selectedWeeks.value.length || !selectedDays.value.length || !visibleDates.value.length) {
      queryState.value = 'error';
      queryError.value = '请选择有效的周次、日期范围和星期。';
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
          weeks: selectedWeeks.value,
          days: selectedDays.value,
          dateFrom: dateFrom.value,
          dateTo: dateTo.value,
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
    queryState.value = 'loading';
    queryError.value = '';
    resultRooms.value = [];
    roomResults.value = {};
    progress.value = { completed: 0, total: 0 };
    debounceTimer = setTimeout(runQuery, 450);
  }
  watch([dateFrom, dateTo], syncWeeksToDates);
  watch([selectedBuildings, selectedRoomIds, selectedWeeks, selectedDays, minimumCapacity, maximumCapacity, dateFrom, dateTo, periods], scheduleQuery);
  onMounted(loadCatalog);
  onUnmounted(cancelQuery);

  return {
    rooms, resultRooms, roomResults, academicStart, maxWeek, catalogUpdatedAt, catalogError, loadingCatalog,
    selectedBuildings, selectedRoomIds, selectedWeeks, selectedDays, minimumCapacity, maximumCapacity, dateFrom, dateTo, periods,
    directorySearch, capacityAscending, queryState, queryError, progress, fetchedAt,
    buildingNames, weekOptions, visibleDates, visibleDirectory, visibleRooms, visibleBuildings, visibleBookings, failedCount, focusDate,
    dateOf, dayOf, weekOf, bookingsForRoom, isRoomLoaded, roomError, roomUrl, roomGridUrl, freeRanges, cellSummary, loadCatalog, runQuery,
  };
}
