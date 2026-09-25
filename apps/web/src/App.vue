<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watchEffect } from 'vue';
import type { Ref } from 'vue';
import { useRoomSearch, PERIOD_OPTIONS } from './useRoomSearch';
import type { BookingEvent, Room } from './useRoomSearch';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { ChevronDown, RotateCcw, Search, ArrowLeftRight, Info, RefreshCw, ChevronLeft, ChevronRight, LoaderCircle, X, Building2, LogOut } from '@lucide/vue';

interface MatrixBucket { key: string | number; label: string; kind: 'date' | 'week' }
interface TimelineBar { event: BookingEvent; start: number; end: number }

const viewNames: string[] = ['list', 'building', 'matrix', 'capacity'];
const view = ref<string>(viewNames.includes(window.location.hash.slice(1)) ? window.location.hash.slice(1) : 'list');
watchEffect(() => { window.history.replaceState(null, '', `#${view.value}`); });
function syncViewFromHash() {
  const next = window.location.hash.slice(1);
  if (viewNames.includes(next)) view.value = next;
}
onMounted(() => window.addEventListener('hashchange', syncViewFromHash));
onUnmounted(() => window.removeEventListener('hashchange', syncViewFromHash));
// The chosen palette is the timetable blue theme.
watchEffect(() => { document.documentElement.dataset.palette = 'blue'; });

const {
  rooms, roomResults, academicStart, maxWeek, catalogUpdatedAt, catalogError, loadingCatalog,
  selectedBuildings, selectedRoomIds, selectedWeeks, selectedDays, minimumCapacity, maximumCapacity, dateFrom, dateTo, periods, timeMode,
  directorySearch, capacityAscending, queryState, queryDirty, queryError, progress, fetchedAt,
  buildingNames, weekOptions, effectiveWeeks, visibleDates, validationErrors, canQuery, matchingRooms, visibleDirectory, visibleRooms, visibleBuildings, visibleBookings, failedCount, focusDate,
  dateOf, dayOf, weekOf, bookingsForRoom, isRoomLoaded, roomError, roomUrl, roomGridUrl, freeRanges, cellSummary, loadCatalog, runQuery, cancelActiveQuery,
  mrbToken, mrbUser, mrbLoginOpen, mrbLoginForm, mrbMfa, mrbMfaCode, mrbLoginError, mrbLoggingIn, mrbCatalogLoading, mrbError,
  loginMrb, submitMrbMfa, disconnectMrb, loadMrbCatalog, resetMrbLoginDialog,
} = useRoomSearch();
const matrixDimension = ref<'date' | 'week'>('date');
const matrixView = ref('timeline');
const transposed = ref(false);
const detailOpen = ref(false);
const detailRoom = ref<Room | null>(null);
const detailBucket = ref<MatrixBucket | null>(null);
const detailSlot = ref<{ start: number; end: number; label: string } | null>(null);
const timelineDate = ref<string | null>(null);
const weekdayNames = ['一', '二', '三', '四', '五', '六', '日'];
const periodLabel = computed(() => PERIOD_OPTIONS.find((option) => option.value === periods.value)?.label ?? '08:00–18:00');
const progressPercent = computed(() => progress.value.total ? Math.round(progress.value.completed / progress.value.total * 100) : null);
const emptyResultMessage = computed(() => {
  if (queryState.value === 'idle') return '设置筛选条件后点击“立即查询”。';
  if (queryState.value === 'loading') return '正在等待原站返回首批教室…';
  if (queryState.value === 'canceled') return '查询已取消，尚无已返回的教室。';
  if (queryState.value === 'error') return queryError.value;
  return '当前条件下没有教室。';
});
const matrixBuckets = computed<MatrixBucket[]>(() => matrixDimension.value === 'date'
  ? visibleDates.value.map((date) => ({ key: date, label: shortDate(date), kind: 'date' as const }))
  : effectiveWeeks.value.filter((week) => visibleDates.value.some((date) => weekOf(date) === week)).map((week) => ({ key: week, label: `第 ${week} 周`, kind: 'week' as const })));
const activeTimelineDate = computed(() => visibleDates.value.includes(timelineDate.value ?? '') ? timelineDate.value : visibleDates.value[0] ?? null);
const activeTimelineIndex = computed(() => visibleDates.value.indexOf(activeTimelineDate.value ?? ''));
const timelineSlots = computed(() => {
  const option = PERIOD_OPTIONS.find((item) => item.value === periods.value);
  if (!option) return [];
  return Array.from({ length: (option.end - option.start) / 30 }, (_, index) => {
    const start = option.start + index * 30;
    return { start, end: start + 30, label: `${String(Math.floor(start / 60)).padStart(2, '0')}:${String(start % 60).padStart(2, '0')}` };
  });
});
const timelineHours = computed(() => timelineSlots.value.filter((slot) => slot.start % 60 === 0));
const timelineRange = computed(() => PERIOD_OPTIONS.find((item) => item.value === periods.value) ?? { start: 480, end: 1080 });
const timelineSpan = computed(() => timelineRange.value.end - timelineRange.value.start);
const timelineGroups = computed(() => {
  const groups: { building: string; rooms: Room[] }[] = [];
  for (const room of visibleRooms.value) {
    const last = groups[groups.length - 1];
    if (last && last.building === room.building) last.rooms.push(room);
    else groups.push({ building: room.building, rooms: [room] });
  }
  return groups;
});
function timelineBars(roomId: string): TimelineBar[] {
  const option = timelineRange.value;
  if (!isRoomLoaded(roomId) || !activeTimelineDate.value) return [];
  return bookingsForRoom(roomId, activeTimelineDate.value)
    .map((event) => ({ event, start: Math.max(option.start, Math.min(option.end, minutes(event.start))), end: Math.max(option.start, Math.min(option.end, minutes(event.end))) }))
    .filter((bar) => bar.end > bar.start)
    .sort((a, b) => a.start - b.start || a.event.identifier.localeCompare(b.event.identifier));
}
function minutes(time: string) { return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)); }
function barLabel(booking: BookingEvent) {
  const who = booking.staff || booking.identifier.replace(/^\S+\s*\[[^\]]*\]\s*-\s*/, '');
  return `${booking.start}–${booking.end} ${who}`;
}
function moveTimelineDate(offset: number) {
  timelineDate.value = visibleDates.value[activeTimelineIndex.value + offset] ?? activeTimelineDate.value;
}
function hhmm(total: number) { return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`; }
// 详情弹窗顶部的筛选摘要：让人们明白"为什么晚上是空的"——时段上限就在这里。
const activeFilters = computed(() => {
  const capacity = minimumCapacity.value || maximumCapacity.value
    ? `${minimumCapacity.value || 0}–${maximumCapacity.value || '∞'}`
    : '不限';
  const filters: ({ label: string; value: string } | null)[] = [
    { label: '楼栋', value: selectedBuildings.value.length ? selectedBuildings.value.join('、') : '全部' },
    selectedRoomIds.value.length ? { label: '指定教室', value: selectedRoomIds.value.join('、') } : null,
    { label: '容量', value: capacity },
    { label: timeMode.value === 'week' ? '周次' : '日期', value: timeMode.value === 'week' ? selectedWeeks.value.map((week) => `第${week}周`).join('、') : `${dateFrom.value} ~ ${dateTo.value}` },
    { label: '星期', value: selectedDays.value.map((day) => `周${weekdayNames[day - 1]}`).join('、') },
    { label: '时段', value: periodLabel.value },
  ];
  if (detailSlot.value) filters.push({ label: '时间槽', value: `${detailSlot.value.label}–${hhmm(detailSlot.value.end)}` });
  return filters.filter((item): item is { label: string; value: string } => item !== null);
});
const detailBookings = computed<BookingEvent[]>(() => {
  if (!detailRoom.value) return [];
  const events = bookingsForRoom(detailRoom.value.id);
  const bucket = detailBucket.value;
  const inBucket = bucket ? events.filter((event) => bucket.kind === 'date' ? event.date === bucket.key : event.week === bucket.key) : events;
  const slot = detailSlot.value;
  return slot ? inBucket.filter((event) => minutes(event.start) < slot.end && minutes(event.end) > slot.start) : inBucket;
});
function toggleItem(type: 'building' | 'week' | 'day', item: string | number) {
  if (type === 'building') selectedRoomIds.value = [];
  const list: Ref<string[] | number[]> = type === 'building' ? selectedBuildings : type === 'week' ? selectedWeeks : selectedDays;
  const current: (string | number)[] = list.value;
  const next = current.includes(item) ? current.filter((value) => value !== item) : [...current, item];
  next.sort((a, b) => String(a).localeCompare(String(b), 'zh-CN', { numeric: true }));
  if (type === 'building') selectedBuildings.value = next as string[];
  else if (type === 'week') selectedWeeks.value = next as number[];
  else selectedDays.value = next as number[];
}
function resetFilters() {
  selectedBuildings.value = [];
  selectedRoomIds.value = [];
  selectedDays.value = [1, 2, 3, 4, 5];
  minimumCapacity.value = '';
  maximumCapacity.value = '';
  periods.value = '1-20';
  timeMode.value = 'date';
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const read = (type: string) => parts.find((part) => part.type === type)!.value;
  const today = `${read('year')}-${read('month')}-${read('day')}`;
  dateFrom.value = today;
  dateTo.value = new Date(Date.parse(`${today}T00:00:00Z`) + 6 * 86_400_000).toISOString().slice(0, 10);
  const currentWeek = Math.max(1, Math.min(maxWeek.value, weekOf(today)));
  selectedWeeks.value = [currentWeek];
}
function shortDate(isoDate: string | null) {
  if (!isoDate) return '—';
  return `${isoDate.slice(5, 7)}/${isoDate.slice(8, 10)} 周${weekdayNames[dayOf(isoDate) - 1]}`;
}
function shortName(room: Room) {
  return room.name.replace(new RegExp(`^${room.building.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s-]*`, 'i'), '').trim() || room.name;
}
function displayId(room: Room) {
  return room.source === 'mrb' ? (room.spaceNo || room.id.slice(4)) : room.id;
}
function refreshCatalogs() {
  loadCatalog();
  if (mrbToken.value) loadMrbCatalog();
}
function openDetails(room: Room, bucket: MatrixBucket | null = null, slot: { start: number; end: number; label: string } | null = null) {
  detailRoom.value = room;
  detailBucket.value = bucket;
  detailSlot.value = slot;
  detailOpen.value = true;
}
function inspectRoom(room: Room) {
  selectedBuildings.value = [room.building];
  selectedRoomIds.value = [room.id];
  minimumCapacity.value = '';
  maximumCapacity.value = '';
  view.value = 'list';
}
const matrixColumns = computed<(Room | MatrixBucket)[]>(() => (transposed.value ? visibleRooms.value : matrixBuckets.value));
function columnKey(column: Room | MatrixBucket) { return 'id' in column ? column.id : column.key; }
function columnLabel(column: Room | MatrixBucket) { return 'id' in column ? shortName(column) : column.label; }
function columnCapacity(column: Room | MatrixBucket) { return 'id' in column ? column.capacity : null; }
function cellStatus(roomId: string, bucket: MatrixBucket) {
  const summary = cellSummary(roomId, bucket);
  return {
    cls: !summary ? 'status-pending' : summary.count ? 'status-booked' : 'status-free',
    text: !summary ? '待查询' : summary.count ? `${summary.count} 条预约` : '无预约',
    free: summary ? `空闲 ${summary.freeHours}h` : '—',
  };
}
</script>
<template>
  <div class="app-shell">
    <header class="app-header">
      <div class="app-title">
        <strong>UNNC 教室查询</strong>
        <span>Room availability · {{ academicStart.slice(0, 4) }}/{{ Number(academicStart.slice(0, 4)) + 1 }}</span>
        <Badge variant="outline">实时课表</Badge><Badge variant="outline">{{ catalogUpdatedAt ? '目录已同步' : '目录快照' }}</Badge>
      </div>
      <div class="header-right">
        <template v-if="mrbUser">
          <Badge variant="secondary" class="mrb-user-badge" :title="mrbUser.name || mrbUser.userId"><Building2 :size="12" /><span class="mrb-user-name">{{ mrbUser.name || mrbUser.userId }}</span></Badge>
          <Button size="sm" variant="ghost" @click="disconnectMrb"><LogOut :size="14" /> 断开</Button>
        </template>
        <Button v-else size="sm" variant="outline" @click="mrbLoginOpen = true"><Building2 :size="14" /> 连接会议室系统</Button>
        <Button size="sm" variant="outline" :disabled="loadingCatalog || mrbCatalogLoading" @click="refreshCatalogs"><RefreshCw :size="14" /> 更新目录</Button>
      </div>
    </header>

    <div v-if="queryState === 'loading'" class="query-progress" role="status" aria-live="polite">
      <div class="query-progress-label"><span>正在查询 Scientia</span><span>{{ progress.completed }} / {{ progress.total || '…' }} 间 · {{ progressPercent === null ? '准备中' : `${progressPercent}%` }}</span></div>
      <Progress :model-value="progressPercent" aria-label="教室查询进度" class="query-progress-track" />
    </div>

    <div class="query-notice" role="status" aria-live="polite">
      <Info :size="14" />
      <span v-if="queryState === 'loading'">实时查询中：已返回 {{ progress.completed }} / {{ progress.total || '…' }} 间教室。更改筛选会取消旧查询。</span>
      <span v-else-if="queryState === 'canceled'">查询已取消，保留已返回的 {{ visibleRooms.length }} / {{ progress.total }} 间教室；可再次点击“立即查询”。</span>
      <span v-else-if="queryState === 'error'">{{ queryError }}</span>
      <span v-else-if="queryState === 'done'">查询完成：{{ progress.completed }} 间教室 · {{ visibleBookings.length }} 条预约<span v-if="failedCount"> · {{ failedCount }} 间失败</span> · {{ fetchedAt ? new Date(fetchedAt).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '' }}。课表每次查询均从原站获取。</span>
      <span v-else-if="loadingCatalog">正在从 Scientia 更新楼栋、容量和周次；可用当前目录直接查询实时课表…</span>
      <span v-else-if="catalogError">原站部分目录信息未更新：{{ catalogError }}。仍可查询实时课表。<Button variant="link" size="xs" @click="loadCatalog">重试</Button></span>
      <span v-else-if="mrbCatalogLoading">正在从会议室系统读取会议室目录（{{ rooms.filter((room) => room.source === 'mrb').length }} 间）…</span>
      <span v-else-if="mrbError">会议室系统：{{ mrbError }}。<Button v-if="!mrbToken" variant="link" size="xs" @click="mrbLoginOpen = true">连接</Button><Button v-else variant="link" size="xs" @click="loadMrbCatalog">重试</Button></span>
      <span v-else-if="queryDirty">筛选条件已改变，符合条件 {{ matchingRooms.length }} 间教室；点击“立即查询”获取最新课表。</span>
      <span v-else>设置筛选条件后点击“立即查询”。课表每次查询都直接访问 Scientia。</span>
    </div>

    <section class="query-bar" aria-label="查询条件">
      <div class="filter-grid">
        <div class="control-group building-control">
          <label>楼栋（可多选）</label>
          <Popover>
            <PopoverTrigger as-child><Button variant="outline" class="filter-trigger"><span>{{ selectedBuildings.length ? `已选 ${selectedBuildings.length} 栋` : '全部楼栋' }}</span><ChevronDown :size="15" /></Button></PopoverTrigger>
            <PopoverContent align="start" class="filter-popover">
              <div class="popover-heading">选择楼栋 <Button variant="ghost" size="xs" @click="selectedBuildings = []; selectedRoomIds = []">全部</Button></div>
              <label v-for="(name, index) in buildingNames" :key="name" class="check-option"><Checkbox :id="`building-${index}`" :model-value="selectedBuildings.includes(name)" @update:model-value="toggleItem('building', name)" /><span>{{ name }}</span></label>
            </PopoverContent>
          </Popover>
        </div>
        <div class="control-group"><label for="min-capacity">最小容量</label><Input id="min-capacity" v-model="minimumCapacity" type="number" min="0" placeholder="不限" :aria-invalid="!!validationErrors.minimumCapacity" /><small v-if="validationErrors.minimumCapacity" class="field-error" role="alert">{{ validationErrors.minimumCapacity }}</small></div>
        <div class="control-group"><label for="max-capacity">最大容量</label><Input id="max-capacity" v-model="maximumCapacity" type="number" min="0" placeholder="不限" :aria-invalid="!!validationErrors.maximumCapacity" /><small v-if="validationErrors.maximumCapacity" class="field-error" role="alert">{{ validationErrors.maximumCapacity }}</small></div>
        <div class="control-group time-mode-control"><label>时间筛选</label><div class="time-mode-buttons" role="group" aria-label="时间筛选方式"><Button size="sm" :variant="timeMode === 'date' ? 'secondary' : 'outline'" :aria-pressed="timeMode === 'date'" @click="timeMode = 'date'">按日期</Button><Button size="sm" :variant="timeMode === 'week' ? 'secondary' : 'outline'" :aria-pressed="timeMode === 'week'" @click="timeMode = 'week'">按周次</Button></div></div>
        <div class="control-group time-value-control">
          <template v-if="timeMode === 'week'">
            <label>周次（可多选）</label>
            <Popover>
              <PopoverTrigger as-child><Button variant="outline" class="filter-trigger"><span>{{ selectedWeeks.length ? selectedWeeks.map((week) => `第${week}周`).join('、') : '选择周次' }}</span><ChevronDown :size="15" /></Button></PopoverTrigger>
              <PopoverContent align="start" class="filter-popover week-popover">
                <div class="popover-heading">选择对比周次</div>
                <label v-for="option in weekOptions" :key="option.value" class="check-option"><Checkbox :model-value="selectedWeeks.includes(option.value)" @update:model-value="toggleItem('week', option.value)" /><span>{{ option.label }}</span><small>{{ dateOf(option.value, 1).slice(5) }} 起</small></label>
              </PopoverContent>
            </Popover>
            <small v-if="validationErrors.weeks" class="field-error" role="alert">{{ validationErrors.weeks }}</small>
          </template>
          <div v-else class="date-range-controls">
            <div class="control-group date-control"><label for="date-from">开始日期</label><Input id="date-from" v-model="dateFrom" type="date" :aria-invalid="!!validationErrors.dateFrom" /><small v-if="validationErrors.dateFrom" class="field-error" role="alert">{{ validationErrors.dateFrom }}</small></div>
            <div class="control-group date-control"><label for="date-to">结束日期</label><Input id="date-to" v-model="dateTo" type="date" :aria-invalid="!!validationErrors.dateTo" /><small v-if="validationErrors.dateTo" class="field-error" role="alert">{{ validationErrors.dateTo }}</small></div>
          </div>
        </div>
        <div class="control-group period-control">
          <label>时段</label>
          <Popover>
            <PopoverTrigger as-child><Button variant="outline" class="filter-trigger"><span>{{ periodLabel }}</span><ChevronDown :size="15" /></Button></PopoverTrigger>
            <PopoverContent align="start" class="period-popover"><Button v-for="option in PERIOD_OPTIONS" :key="option.value" size="sm" :variant="periods === option.value ? 'secondary' : 'ghost'" class="period-option" @click="periods = option.value">{{ option.label }}</Button></PopoverContent>
          </Popover>
        </div>
        <div class="query-actions">
          <Button size="sm" class="query-action" :disabled="queryState === 'loading' || !rooms.length || !canQuery" @click="runQuery"><LoaderCircle v-if="queryState === 'loading'" :size="14" class="animate-spin" /><Search v-else :size="14" /> {{ queryState === 'loading' ? '查询中' : '立即查询' }}</Button>
          <Button v-if="queryState === 'loading'" variant="ghost" size="sm" class="reset-filters" @click="cancelActiveQuery"><X :size="14" /> 取消</Button>
          <Button v-else variant="ghost" size="sm" class="reset-filters" @click="resetFilters"><RotateCcw :size="14" /> 重置</Button>
        </div>
      </div>
      <div class="filter-bottom">
        <span class="filter-bottom-label">星期</span>
        <Button v-for="day in 7" :key="day" size="xs" :variant="selectedDays.includes(day) ? 'secondary' : 'ghost'" :aria-pressed="selectedDays.includes(day)" @click="toggleItem('day', day)">周{{ weekdayNames[day - 1] }}</Button>
        <small v-if="validationErrors.days" class="field-error" role="alert">{{ validationErrors.days }}</small>
        <Badge v-if="selectedRoomIds.length" variant="outline">指定教室：{{ selectedRoomIds[0] }} <Button size="xs" variant="ghost" @click="selectedRoomIds = []">×</Button></Badge>
        <span class="query-summary">目录 {{ rooms.length }} 间 · 符合筛选 {{ matchingRooms.length }} 间 · 已返回 {{ progress.completed }} 间 · {{ visibleDates.length }} 个日期</span>
      </div>
    </section>

    <Tabs v-model="view" class="view-tabs">
      <TabsList variant="line" class="view-tabs-list"><TabsTrigger value="list">教室列表</TabsTrigger><TabsTrigger value="building">楼栋分组</TabsTrigger><TabsTrigger value="matrix">时间对比</TabsTrigger><TabsTrigger value="capacity">容量目录</TabsTrigger></TabsList>

      <TabsContent value="list" class="view-content">
        <div class="view-heading"><div><h2>教室列表</h2><p>按所选日期查看预约和空闲时段；点击教室可查看原始课表字段。</p></div><Badge variant="secondary">{{ shortDate(focusDate) }}</Badge></div>
        <div class="table-panel"><Table><TableHeader><TableRow><TableHead class="room-name-col">教室 / ID</TableHead><TableHead>楼栋</TableHead><TableHead class="number-col">Capacity</TableHead><TableHead>当天预约</TableHead><TableHead>当天空闲时段</TableHead><TableHead class="number-col">区间预约数</TableHead></TableRow></TableHeader><TableBody>
          <TableRow v-for="room in visibleRooms" :key="room.id">
            <TableCell><Button variant="link" class="room-link" @click="openDetails(room)">{{ shortName(room) }}</Button><Badge v-if="room.source === 'mrb'" variant="outline" class="source-badge">会议室</Badge><small class="code-line">{{ displayId(room) }}</small></TableCell>
            <TableCell class="secondary-cell">{{ room.building }}</TableCell><TableCell class="number-col capacity-number">{{ room.capacity }}</TableCell>
            <TableCell><span v-if="!isRoomLoaded(room.id)" class="secondary-cell">{{ roomError(room.id) || '查询中…' }}</span><template v-else><div v-for="booking in bookingsForRoom(room.id, focusDate).slice(0, 2)" :key="`${booking.identifier}${booking.start}`" class="dense-line"><span>{{ booking.start }}–{{ booking.end }}</span><span class="booking-code">{{ booking.staff || booking.identifier }}</span></div><span v-if="!bookingsForRoom(room.id, focusDate).length" class="secondary-cell">无预约</span><Button v-if="bookingsForRoom(room.id, focusDate).length > 2" variant="link" size="xs" @click="openDetails(room, { kind: 'date', key: focusDate, label: shortDate(focusDate) })">查看全部 {{ bookingsForRoom(room.id, focusDate).length }} 条</Button></template></TableCell>
            <TableCell><template v-if="isRoomLoaded(room.id)"><span v-for="range in freeRanges(room.id, focusDate).slice(0, 2)" :key="range" class="free-line inline-range">{{ range }}</span><span v-if="!freeRanges(room.id, focusDate).length" class="secondary-cell">无空闲时段</span><span v-if="freeRanges(room.id, focusDate).length > 2" class="secondary-cell">+{{ freeRanges(room.id, focusDate).length - 2 }} 段</span></template><span v-else class="secondary-cell">—</span></TableCell>
            <TableCell class="number-col"><Button variant="ghost" size="sm" :disabled="!isRoomLoaded(room.id)" @click="openDetails(room)">{{ isRoomLoaded(room.id) ? `${bookingsForRoom(room.id).length} 条 ›` : '—' }}</Button></TableCell>
          </TableRow>
          <TableRow v-if="!visibleRooms.length"><TableCell colspan="6" class="empty-cell">{{ emptyResultMessage }}</TableCell></TableRow>
        </TableBody></Table></div>
      </TabsContent>

      <TabsContent value="building" class="view-content">
        <div class="view-heading"><div><h2>楼栋分组</h2><p>按楼栋比较容量、所选日期的预约与空闲情况。</p></div><Badge variant="secondary">{{ visibleBuildings.length }} 栋楼</Badge></div>
        <section v-for="name in visibleBuildings" :key="name" class="building-section"><div class="building-section-head"><h3>{{ name }}</h3><span>{{ visibleRooms.filter((room) => room.building === name).length }} 间教室</span></div><Table><TableHeader><TableRow><TableHead class="room-name-col">教室</TableHead><TableHead class="number-col">容量</TableHead><TableHead>日期</TableHead><TableHead>预约时间 / 活动代码</TableHead><TableHead>空闲时间</TableHead><TableHead class="number-col">详情</TableHead></TableRow></TableHeader><TableBody>
          <TableRow v-for="room in visibleRooms.filter((item) => item.building === name)" :key="room.id"><TableCell><strong>{{ shortName(room) }}</strong><Badge v-if="room.source === 'mrb'" variant="outline" class="source-badge">会议室</Badge><small class="code-line">{{ displayId(room) }}</small></TableCell><TableCell class="number-col capacity-number">{{ room.capacity }}</TableCell><TableCell class="secondary-cell">{{ shortDate(focusDate) }}</TableCell><TableCell><span v-if="!isRoomLoaded(room.id)" class="secondary-cell">{{ roomError(room.id) || '查询中…' }}</span><template v-else><div v-for="booking in bookingsForRoom(room.id, focusDate).slice(0, 2)" :key="`${booking.identifier}${booking.start}`" class="dense-line">{{ booking.start }}–{{ booking.end }} <span class="booking-code">{{ booking.staff || booking.identifier }}</span></div><span v-if="!bookingsForRoom(room.id, focusDate).length" class="secondary-cell">无预约</span></template></TableCell><TableCell><span v-for="range in freeRanges(room.id, focusDate).slice(0, 2)" :key="range" class="free-line inline-range">{{ range }}</span><span v-if="!isRoomLoaded(room.id)" class="secondary-cell">—</span></TableCell><TableCell class="number-col"><Button size="xs" variant="outline" :disabled="!isRoomLoaded(room.id)" @click="openDetails(room)">查看</Button></TableCell></TableRow>
        </TableBody></Table></section>
        <div v-if="!visibleBuildings.length" class="empty-cell">{{ emptyResultMessage }}</div>
      </TabsContent>

      <TabsContent value="matrix" class="view-content">
        <div class="view-heading"><div><h2>时间对比</h2><p>行程条按实际时间绘制，点击条目查看预约详情；按楼栋分组，选日期可逐日查看。汇总视图支持横纵比较。</p></div><div class="matrix-toolbar"><Button size="sm" :variant="matrixView === 'timeline' ? 'secondary' : 'ghost'" @click="matrixView = 'timeline'">半小时时间轴</Button><Button size="sm" :variant="matrixView === 'summary' ? 'secondary' : 'ghost'" @click="matrixView = 'summary'">汇总对比</Button></div></div>
        <div v-if="matrixView === 'timeline'" class="timeline-pane">
          <div class="timeline-toolbar">
            <div class="timeline-date-nav"><Button size="icon-sm" variant="outline" aria-label="上一日期" :disabled="activeTimelineIndex <= 0" @click="moveTimelineDate(-1)"><ChevronLeft :size="14" /></Button><Popover><PopoverTrigger as-child><Button variant="outline" size="sm" :disabled="!activeTimelineDate">{{ activeTimelineDate ? `${activeTimelineDate} · ${shortDate(activeTimelineDate)}` : '没有符合筛选的日期' }}<ChevronDown :size="14" /></Button></PopoverTrigger><PopoverContent align="start" class="timeline-date-popover"><Button v-for="date in visibleDates" :key="date" variant="ghost" size="sm" class="timeline-date-option" @click="timelineDate = date">{{ date }} · {{ shortDate(date) }}</Button></PopoverContent></Popover><Button size="icon-sm" variant="outline" aria-label="下一日期" :disabled="activeTimelineIndex < 0 || activeTimelineIndex >= visibleDates.length - 1" @click="moveTimelineDate(1)"><ChevronRight :size="14" /></Button></div>
            <Badge variant="outline" class="timeline-period-badge">{{ periodLabel }}</Badge><div class="matrix-legend"><span class="legend-busy"></span> 占用 <span class="legend-free"></span> 空闲 <span class="legend-empty"></span> 查询中或失败</div>
          </div>
          <div class="table-panel timeline-scroll"><Table><TableHeader><TableRow><TableHead class="timeline-room-col">教室 <span class="timeline-head-muted">/ 容量</span></TableHead><TableHead v-for="hour in timelineHours" :key="hour.start" colspan="2" class="timeline-hour-head">{{ hour.label }}</TableHead></TableRow></TableHeader><TableBody>
            <template v-for="group in timelineGroups" :key="group.building">
              <TableRow class="timeline-group-row"><TableCell :colspan="timelineHours.length * 2 + 1">{{ group.building }}<span class="timeline-group-count">{{ group.rooms.length }} 间</span></TableCell></TableRow>
              <TableRow v-for="room in group.rooms" :key="room.id" class="timeline-row"><TableCell class="timeline-room-col"><strong class="timeline-room-name" :title="room.fullName">{{ shortName(room) }}</strong><small class="timeline-room-meta">{{ displayId(room) }} · {{ room.capacity }} 人</small></TableCell><TableCell :colspan="Math.max(1, timelineHours.length * 2)" class="timeline-track-cell"><div v-if="!isRoomLoaded(room.id)" class="timeline-track timeline-track-pending">{{ roomError(room.id) || '查询中…' }}</div><div v-else class="timeline-track" :style="{ '--tl-hours': timelineHours.length }"><Button v-for="bar in timelineBars(room.id)" :key="`${bar.event.identifier}-${bar.event.start}`" variant="ghost" class="timeline-bar" :style="{ '--bar-left': `${(bar.start - timelineRange.start) / timelineSpan * 100}%`, '--bar-width': `${Math.max(1.5, (bar.end - bar.start) / timelineSpan * 100)}%` }" :disabled="!activeTimelineDate" :aria-label="`${shortName(room)} ${shortDate(activeTimelineDate)} ${barLabel(bar.event)}`" :title="`${barLabel(bar.event)}，点击查看详情`" @click="openDetails(room, { kind: 'date', key: activeTimelineDate ?? '', label: shortDate(activeTimelineDate) }, { start: bar.start, end: bar.end, label: bar.event.start })"><span class="timeline-bar-text">{{ barLabel(bar.event) }}</span></Button></div></TableCell></TableRow>
            </template>
            <TableRow v-if="!visibleRooms.length || !activeTimelineDate"><TableCell :colspan="timelineHours.length * 2 + 1" class="empty-cell">{{ !activeTimelineDate ? '当前筛选没有可显示的日期。' : emptyResultMessage }}</TableCell></TableRow>
          </TableBody></Table></div>
        </div>
        <div v-else class="summary-pane"><div class="matrix-toolbar summary-toolbar"><Button size="sm" :variant="matrixDimension === 'date' ? 'secondary' : 'ghost'" @click="matrixDimension = 'date'">按日期</Button><Button size="sm" :variant="matrixDimension === 'week' ? 'secondary' : 'ghost'" @click="matrixDimension = 'week'">按周次</Button><Button size="sm" variant="outline" @click="transposed = !transposed"><ArrowLeftRight :size="14" /> 交换横纵轴</Button></div>
        <div class="matrix-legend"><span class="legend-free"></span> 无预约 <span class="legend-busy"></span> 有预约 <span class="legend-empty"></span> 查询中或失败</div>
        <div class="table-panel matrix-scroll"><Table><TableHeader><TableRow><TableHead class="matrix-label-col">{{ transposed ? (matrixDimension === 'date' ? '日期' : '周次') : '教室 / 容量' }}</TableHead><TableHead v-for="column in matrixColumns" :key="columnKey(column)" class="matrix-data-col">{{ columnLabel(column) }}<small v-if="transposed" class="code-line">{{ columnCapacity(column) }} 人</small></TableHead></TableRow></TableHeader><TableBody>
          <template v-if="!transposed"><TableRow v-for="room in visibleRooms" :key="room.id"><TableCell class="matrix-label-col"><strong>{{ shortName(room) }}</strong><small class="code-line">{{ displayId(room) }} · {{ room.capacity }} 人</small></TableCell><TableCell v-for="bucket in matrixBuckets" :key="bucket.key" class="matrix-cell"><Button class="matrix-cell-button" variant="ghost" :disabled="!isRoomLoaded(room.id)" @click="openDetails(room, bucket)"><span :class="['status-chip', cellStatus(room.id, bucket).cls]">{{ cellStatus(room.id, bucket).text }}</span><small>{{ cellStatus(room.id, bucket).free }}</small></Button></TableCell></TableRow></template>
          <template v-else><TableRow v-for="bucket in matrixBuckets" :key="bucket.key"><TableCell class="matrix-label-col"><strong>{{ bucket.label }}</strong><small class="code-line">{{ bucket.kind === 'week' ? '周次对比' : '日期对比' }}</small></TableCell><TableCell v-for="room in visibleRooms" :key="room.id" class="matrix-cell"><Button class="matrix-cell-button" variant="ghost" :disabled="!isRoomLoaded(room.id)" @click="openDetails(room, bucket)"><span :class="['status-chip', cellStatus(room.id, bucket).cls]">{{ cellStatus(room.id, bucket).text }}</span><small>{{ cellStatus(room.id, bucket).free }}</small></Button></TableCell></TableRow></template>
          <TableRow v-if="!matrixBuckets.length || !visibleRooms.length"><TableCell :colspan="(transposed ? visibleRooms.length : matrixBuckets.length) + 1" class="empty-cell">{{ !matrixBuckets.length ? '当前筛选没有可显示的日期或周次。' : emptyResultMessage }}</TableCell></TableRow>
        </TableBody></Table></div></div>
      </TabsContent>

      <TabsContent value="capacity" class="view-content"><div class="view-heading"><div><h2>全部教室 Capacity</h2><p>{{ catalogUpdatedAt ? '已从原站读取最新房间名称与容量。' : '当前显示随项目提供的目录快照；点击右上角更新可向原站获取最新目录。' }}</p></div><div class="directory-actions"><div class="directory-search"><Search :size="14" /><Input v-model="directorySearch" placeholder="搜索教室、编号、楼栋" aria-label="搜索教室" /></div><Button size="sm" variant="outline" @click="capacityAscending = !capacityAscending">容量 {{ capacityAscending ? '↑' : '↓' }}</Button><Badge variant="secondary">{{ visibleDirectory.length }} / {{ rooms.length }}</Badge></div></div><div class="table-panel directory-panel"><Table><TableHeader><TableRow><TableHead class="number-col">#</TableHead><TableHead>教室名称</TableHead><TableHead>楼栋</TableHead><TableHead>原站房间 ID</TableHead><TableHead class="number-col">Capacity</TableHead><TableHead class="number-col">操作</TableHead></TableRow></TableHeader><TableBody><TableRow v-for="(room, index) in visibleDirectory" :key="room.id"><TableCell class="number-col secondary-cell">{{ index + 1 }}</TableCell><TableCell><strong>{{ shortName(room) }}</strong><Badge v-if="room.source === 'mrb'" variant="outline" class="source-badge">会议室</Badge><Badge v-if="room.source === 'mrb' && room.enabled === false" variant="outline" class="source-badge source-badge-off">停用</Badge><small class="code-line">{{ room.fullName }}</small></TableCell><TableCell class="secondary-cell">{{ room.building }}</TableCell><TableCell class="code-cell">{{ displayId(room) }}</TableCell><TableCell class="number-col capacity-number">{{ room.capacity ?? '—' }}</TableCell><TableCell class="number-col"><Button size="xs" variant="outline" @click="inspectRoom(room)">筛选此教室</Button></TableCell></TableRow><TableRow v-if="!visibleDirectory.length"><TableCell colspan="6" class="empty-cell">{{ loadingCatalog ? '正在加载教室目录…' : '没有匹配的教室。' }}</TableCell></TableRow></TableBody></Table></div></TabsContent>
    </Tabs>

    <Dialog v-model:open="mrbLoginOpen" @update:open="resetMrbLoginDialog">
      <DialogContent class="mrb-login-dialog">
        <DialogHeader>
          <DialogTitle>连接会议室系统</DialogTitle>
          <DialogDescription>使用学校 SSO 账号登录，仅用于只读查询会议室占用，不会执行任何预订操作。账号密码只提交给学校登录服务。</DialogDescription>
        </DialogHeader>
        <div v-if="!mrbMfa" class="login-fields">
          <div class="login-field"><label for="mrb-username">学校账号</label><Input id="mrb-username" v-model="mrbLoginForm.username" autocomplete="username" placeholder="如 scylz12" @keyup.enter="loginMrb" /></div>
          <div class="login-field"><label for="mrb-password">密码</label><Input id="mrb-password" v-model="mrbLoginForm.password" type="password" autocomplete="current-password" @keyup.enter="loginMrb" /></div>
        </div>
        <div v-else class="login-fields">
          <div class="login-field"><label for="mrb-code">MFA 验证码</label><Input id="mrb-code" v-model="mrbMfaCode" inputmode="numeric" autocomplete="one-time-code" placeholder="输入学校 SSO 要求的验证码" @keyup.enter="submitMrbMfa" /></div>
        </div>
        <small v-if="mrbLoginError" class="field-error" role="alert">{{ mrbLoginError }}</small>
        <div class="login-actions">
          <Button variant="outline" size="sm" :disabled="mrbLoggingIn" @click="mrbLoginOpen = false">取消</Button>
          <Button size="sm" :disabled="mrbLoggingIn || (!mrbMfa && (!mrbLoginForm.username.trim() || !mrbLoginForm.password)) || (mrbMfa && !mrbMfaCode.trim())" @click="mrbMfa ? submitMrbMfa() : loginMrb()"><LoaderCircle v-if="mrbLoggingIn" :size="14" class="animate-spin" />{{ mrbMfa ? '提交验证码' : '登录' }}</Button>
        </div>
      </DialogContent>
    </Dialog>

    <Dialog v-model:open="detailOpen"><DialogContent class="detail-dialog"><DialogHeader><DialogTitle>{{ detailRoom ? shortName(detailRoom) : '预约详情' }}</DialogTitle><DialogDescription>{{ detailRoom?.building }} · {{ detailRoom ? displayId(detailRoom) : '' }} · Capacity {{ detailRoom?.capacity }} <span v-if="detailRoom?.source === 'mrb' && detailRoom.enabled === false">· 已停用{{ detailRoom.disableReason ? `（${detailRoom.disableReason}）` : '' }}</span> <span v-if="detailBucket">· {{ detailBucket.label }}</span></DialogDescription></DialogHeader><div class="detail-filters"><span class="detail-filters-label">当前筛选</span><span v-for="filter in activeFilters" :key="filter.label" class="detail-filter"><b>{{ filter.label }}</b>{{ filter.value }}</span></div><div class="detail-note">显示 Scientia 列表报告中的全部字段。Staff 可能是授课人员；空白时不推断预约人。<a v-if="detailRoom && roomUrl(detailRoom.id)" :href="roomUrl(detailRoom.id) ?? undefined" target="_blank" rel="noopener noreferrer">原始列表 ↗</a><a v-if="detailRoom && roomGridUrl(detailRoom.id)" :href="roomGridUrl(detailRoom.id) ?? undefined" target="_blank" rel="noopener noreferrer">原始网格 ↗</a></div><div class="detail-table"><Table><TableHeader><TableRow><TableHead>日期 / 时间</TableHead><TableHead>Staff / 活动代码</TableHead><TableHead>活动类型 / 名称</TableHead><TableHead>位置 / 适用周次</TableHead></TableRow></TableHeader><TableBody><TableRow v-for="(booking, index) in detailBookings" :key="`${booking.identifier}-${index}`"><TableCell><strong>{{ shortDate(booking.date) }}</strong><small class="code-line">{{ booking.start }}–{{ booking.end }} · {{ booking.duration }}</small></TableCell><TableCell class="code-cell"><strong>{{ booking.staff || '原站未提供 Staff' }}</strong><small class="code-line">{{ booking.identifier }}</small></TableCell><TableCell>{{ booking.activityType }}<small class="code-line">{{ booking.title }}</small><small class="code-line">活动人数 {{ booking.activityCapacity || '—' }}</small></TableCell><TableCell>{{ booking.location }}<small class="code-line">{{ booking.roomDescription }}</small><small class="code-line">房间容量 {{ booking.roomSize || detailRoom?.capacity }}<template v-if="booking.sourceWeeks"> · 第 {{ booking.sourceWeeks }} 周</template></small><small v-if="booking.attendees?.length" class="code-line">参加者 {{ booking.attendees.join('、') }}</small><details v-if="booking.rawFields" class="source-fields"><summary>原始字段</summary><pre>{{ JSON.stringify(booking.rawFields, null, 2) }}</pre></details></TableCell></TableRow><TableRow v-if="!detailBookings.length"><TableCell colspan="4" class="empty-cell">所选区间没有预约。</TableCell></TableRow></TableBody></Table></div></DialogContent></Dialog>

    <footer class="app-footer">Made with ❤️ by GentleLijie</footer>
  </div>
</template>
