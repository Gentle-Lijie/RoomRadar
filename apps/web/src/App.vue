<script setup>
import { computed, onMounted, onUnmounted, ref, watch, watchEffect } from 'vue';
import rooms from './data/rooms.json';
import { previewBookings } from './data/previewBookings.js';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ChevronDown, RotateCcw, Search, ArrowLeftRight, Info } from '@lucide/vue';

const viewNames = ['list', 'building', 'matrix', 'capacity'];
const view = ref(viewNames.includes(window.location.hash.slice(1)) ? window.location.hash.slice(1) : 'list');
watch(view, (value) => window.history.replaceState(null, '', `#${value}`));
function syncViewFromHash() {
  const next = window.location.hash.slice(1);
  if (viewNames.includes(next)) view.value = next;
}
onMounted(() => window.addEventListener('hashchange', syncViewFromHash));
onUnmounted(() => window.removeEventListener('hashchange', syncViewFromHash));
const palette = ref('campus');
const palettes = [
  { id: 'campus', name: '校园绿', swatch: '#286449' },
  { id: 'blue', name: '课表蓝', swatch: '#285f91' },
  { id: 'mono', name: '高对比', swatch: '#242424' },
];
watchEffect(() => { document.documentElement.dataset.palette = palette.value; });

const buildingNames = [...new Set(rooms.map((room) => room.building))].sort();
const previewIds = new Set(previewBookings.map((booking) => booking.roomId));
const previewRooms = rooms.filter((room) => previewIds.has(room.id));
const selectedBuildings = ref([]);
const selectedWeeks = ref([3, 4]);
const selectedDays = ref([1, 2, 3, 4, 5]);
const minimumCapacity = ref('');
const maximumCapacity = ref('');
const dateFrom = ref('2026-10-05');
const dateTo = ref('2026-10-16');
const directorySearch = ref('');
const capacityAscending = ref(true);
const matrixDimension = ref('date');
const transposed = ref(false);
const detailOpen = ref(false);
const detailRoom = ref(null);
const detailBucket = ref(null);
const weekOptions = Array.from({ length: 21 }, (_, index) => ({ value: index + 1, label: `第 ${index + 1} 周` }));
const weekdayNames = ['一', '二', '三', '四', '五', '六', '日'];
const academicStart = Date.UTC(2026, 8, 21);
const msDay = 86400000;

function toggleItem(type, item) {
  const list = type === 'building' ? selectedBuildings : type === 'week' ? selectedWeeks : selectedDays;
  const index = list.value.indexOf(item);
  if (index === -1) list.value = [...list.value, item].sort((a, b) => String(a).localeCompare(String(b), 'zh-CN', { numeric: true }));
  else list.value = list.value.filter((value) => value !== item);
}
function resetFilters() {
  selectedBuildings.value = [];
  selectedWeeks.value = [3, 4];
  selectedDays.value = [1, 2, 3, 4, 5];
  minimumCapacity.value = '';
  maximumCapacity.value = '';
  dateFrom.value = '2026-10-05';
  dateTo.value = '2026-10-16';
}
function roomMatches(room) {
  return (!selectedBuildings.value.length || selectedBuildings.value.includes(room.building))
    && (!minimumCapacity.value || room.capacity >= Number(minimumCapacity.value))
    && (!maximumCapacity.value || room.capacity <= Number(maximumCapacity.value));
}
const visibleRooms = computed(() => previewRooms.filter(roomMatches).sort((a, b) => a.building.localeCompare(b.building) || a.capacity - b.capacity));
const visibleDirectory = computed(() => rooms.filter((room) => roomMatches(room) && (`${room.name} ${room.id} ${room.building}`.toLowerCase().includes(directorySearch.value.toLowerCase()))).sort((a, b) => (capacityAscending.value ? a.capacity - b.capacity : b.capacity - a.capacity) || a.building.localeCompare(b.building)));
const visibleBuildings = computed(() => [...new Set(visibleRooms.value.map((room) => room.building))]);

function dateOf(week, day) {
  return new Date(academicStart + (week - 1) * 7 * msDay + (day - 1) * msDay).toISOString().slice(0, 10);
}
function weekOf(isoDate) {
  return Math.floor((Date.parse(`${isoDate}T00:00:00Z`) - academicStart) / (7 * msDay)) + 1;
}
function dayOf(isoDate) {
  return ((new Date(`${isoDate}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
}
function shortDate(isoDate) {
  return `${isoDate.slice(5, 7)}/${isoDate.slice(8, 10)} 周${weekdayNames[dayOf(isoDate) - 1]}`;
}
function shortName(room) {
  return room.name.replace(new RegExp(`^${room.building.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s-]*`, 'i'), '').trim() || room.name;
}
const visibleDates = computed(() => {
  const dates = [];
  const from = Date.parse(`${dateFrom.value}T00:00:00Z`);
  const to = Date.parse(`${dateTo.value}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return dates;
  for (let time = from; time <= Math.min(to, from + 34 * msDay); time += msDay) {
    const isoDate = new Date(time).toISOString().slice(0, 10);
    if (selectedWeeks.value.includes(weekOf(isoDate)) && selectedDays.value.includes(dayOf(isoDate))) dates.push(isoDate);
  }
  return dates;
});
const visibleBookings = computed(() => previewBookings.map((booking) => ({ ...booking, date: dateOf(booking.week, booking.day) })).filter((booking) => visibleDates.value.includes(booking.date) && visibleRooms.value.some((room) => room.id === booking.roomId)));
const focusDate = computed(() => visibleDates.value[0] ?? dateFrom.value);
function bookingsForRoom(roomId, date = null) {
  return visibleBookings.value.filter((booking) => booking.roomId === roomId && (!date || booking.date === date)).sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
}
function minutes(time) { return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)); }
function clock(totalMinutes) { return `${String(Math.floor(totalMinutes / 60)).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}`; }
function freeRanges(roomId, date) {
  let cursor = 480;
  const free = [];
  for (const booking of bookingsForRoom(roomId, date)) {
    const start = Math.max(480, minutes(booking.start));
    const end = Math.min(1080, minutes(booking.end));
    if (start > cursor) free.push(`${clock(cursor)}–${clock(start)}`);
    cursor = Math.max(cursor, end);
  }
  if (cursor < 1080) free.push(`${clock(cursor)}–18:00`);
  return free;
}

const matrixBuckets = computed(() => matrixDimension.value === 'date'
  ? visibleDates.value.map((date) => ({ key: date, label: shortDate(date), kind: 'date' }))
  : selectedWeeks.value.map((week) => ({ key: week, label: `第 ${week} 周`, kind: 'week' })));
function bookingsInBucket(roomId, bucket) {
  if (!bucket) return bookingsForRoom(roomId);
  return visibleBookings.value.filter((booking) => booking.roomId === roomId && (bucket.kind === 'date' ? booking.date === bucket.key : booking.week === bucket.key));
}
function cellSummary(roomId, bucket) {
  const bookings = bookingsInBucket(roomId, bucket);
  const occupied = bookings.reduce((sum, booking) => sum + (minutes(booking.end) - minutes(booking.start)), 0) / 60;
  const total = bucket.kind === 'date' ? 10 : visibleDates.value.filter((date) => weekOf(date) === bucket.key).length * 10;
  return { count: bookings.length, freeHours: Math.max(0, total - occupied) };
}
function openDetails(room, bucket = null) {
  detailRoom.value = room;
  detailBucket.value = bucket;
  detailOpen.value = true;
}
const detailBookings = computed(() => detailRoom.value ? bookingsInBucket(detailRoom.value.id, detailBucket.value) : []);
</script>

<template>
  <div class="app-shell">
    <header class="app-header">
      <div class="app-title"><strong>UNNC 教室查询</strong><span>Room availability · 2026/27</span><Badge variant="outline">设计预览</Badge></div>
      <div class="palette-picker" aria-label="配色方案">
        <span class="palette-label">配色</span>
        <Button v-for="scheme in palettes" :key="scheme.id" size="sm" :variant="palette === scheme.id ? 'secondary' : 'ghost'" :aria-pressed="palette === scheme.id" @click="palette = scheme.id"><i class="palette-swatch" :style="{ background: scheme.swatch }"></i>{{ scheme.name }}</Button>
      </div>
    </header>

    <div class="preview-notice"><Info :size="14" /> 页面使用示例预约数据展示交互；容量目录包含原站抓取的 197 间教室资料。个人预约姓名仅在原站提供时才会展示。</div>

    <section class="query-bar" aria-label="查询条件">
      <div class="filter-grid">
        <div class="control-group building-control"><label>楼栋（可多选）</label><Popover><PopoverTrigger as-child><Button variant="outline" class="filter-trigger"><span>{{ selectedBuildings.length ? `已选 ${selectedBuildings.length} 栋` : '全部楼栋' }}</span><ChevronDown :size="15" /></Button></PopoverTrigger><PopoverContent align="start" class="filter-popover"><div class="popover-heading">选择楼栋 <Button variant="ghost" size="xs" @click="selectedBuildings = []">全部</Button></div><label v-for="(name, index) in buildingNames" :key="name" class="check-option"><Checkbox :id="`building-${index}`" :model-value="selectedBuildings.includes(name)" @update:model-value="toggleItem('building', name)" /><span>{{ name }}</span></label></PopoverContent></Popover></div>
        <div class="control-group"><label for="min-capacity">最小容量</label><Input id="min-capacity" v-model="minimumCapacity" type="number" min="1" placeholder="不限" /></div>
        <div class="control-group"><label for="max-capacity">最大容量</label><Input id="max-capacity" v-model="maximumCapacity" type="number" min="1" placeholder="不限" /></div>
        <div class="control-group week-control"><label>周次（可多选）</label><Popover><PopoverTrigger as-child><Button variant="outline" class="filter-trigger"><span>{{ selectedWeeks.length ? selectedWeeks.map((week) => `第${week}周`).join('、') : '选择周次' }}</span><ChevronDown :size="15" /></Button></PopoverTrigger><PopoverContent align="start" class="filter-popover week-popover"><div class="popover-heading">对比周次</div><label v-for="option in weekOptions" :key="option.value" class="check-option"><Checkbox :model-value="selectedWeeks.includes(option.value)" @update:model-value="toggleItem('week', option.value)" /><span>{{ option.label }}</span><small>{{ dateOf(option.value, 1).slice(5) }} 起</small></label></PopoverContent></Popover></div>
        <div class="control-group date-control"><label for="date-from">开始日期</label><Input id="date-from" v-model="dateFrom" type="date" /></div>
        <div class="control-group date-control"><label for="date-to">结束日期</label><Input id="date-to" v-model="dateTo" type="date" /></div>
        <Button variant="ghost" size="sm" class="reset-filters" @click="resetFilters"><RotateCcw :size="14" /> 重置</Button>
      </div>
      <div class="filter-bottom"><span class="filter-bottom-label">星期</span><Button v-for="day in 7" :key="day" size="xs" :variant="selectedDays.includes(day) ? 'secondary' : 'ghost'" :aria-pressed="selectedDays.includes(day)" @click="toggleItem('day', day)">周{{ weekdayNames[day - 1] }}</Button><span class="query-summary">{{ visibleBuildings.length }} 栋 · {{ visibleRooms.length }} 间预览教室 · {{ visibleDates.length }} 个日期 · {{ visibleBookings.length }} 条预约示例</span></div>
    </section>

    <Tabs v-model="view" class="view-tabs">
      <TabsList variant="line" class="view-tabs-list"><TabsTrigger value="list">教室列表</TabsTrigger><TabsTrigger value="building">楼栋分组</TabsTrigger><TabsTrigger value="matrix">时间对比</TabsTrigger><TabsTrigger value="capacity">容量目录</TabsTrigger></TabsList>

      <TabsContent value="list" class="view-content"><div class="view-heading"><div><h2>教室列表</h2><p>按所选日期和周次查看教室、预约与空闲时段；点击教室查看完整信息。</p></div><Badge variant="secondary">当前日期 {{ shortDate(focusDate) }}</Badge></div><div class="table-panel"><Table><TableHeader><TableRow><TableHead class="room-name-col">教室 / ID</TableHead><TableHead>楼栋</TableHead><TableHead class="number-col">Capacity</TableHead><TableHead>当前日期已预约</TableHead><TableHead>当前日期空闲时段</TableHead><TableHead class="number-col">区间预约数</TableHead></TableRow></TableHeader><TableBody><TableRow v-for="room in visibleRooms" :key="room.id"><TableCell><Button variant="link" class="room-link" @click="openDetails(room)">{{ shortName(room) }}</Button><small class="code-line">{{ room.id }}</small></TableCell><TableCell class="secondary-cell">{{ room.building }}</TableCell><TableCell class="number-col capacity-number">{{ room.capacity }}</TableCell><TableCell><div v-for="booking in bookingsForRoom(room.id, focusDate).slice(0, 2)" :key="`${booking.identifier}${booking.start}`" class="dense-line"><span>{{ booking.start }}–{{ booking.end }}</span><span class="booking-code">{{ booking.identifier }}</span></div><span v-if="!bookingsForRoom(room.id, focusDate).length" class="secondary-cell">示例中无预约</span></TableCell><TableCell><div v-for="range in freeRanges(room.id, focusDate).slice(0, 2)" :key="range" class="free-line">{{ range }}</div><span v-if="freeRanges(room.id, focusDate).length > 2" class="secondary-cell">+{{ freeRanges(room.id, focusDate).length - 2 }} 段</span></TableCell><TableCell class="number-col"><Button variant="ghost" size="sm" @click="openDetails(room)">{{ bookingsForRoom(room.id).length }} 条 ›</Button></TableCell></TableRow><TableRow v-if="!visibleRooms.length"><TableCell colspan="6" class="empty-cell">当前筛选条件下没有预览教室。容量目录仍可查看所有匹配教室。</TableCell></TableRow></TableBody></Table></div></TabsContent>

      <TabsContent value="building" class="view-content"><div class="view-heading"><div><h2>楼栋分组</h2><p>在每栋楼内直接比较容量、日期与预约标识。</p></div><Badge variant="secondary">{{ visibleBuildings.length }} 栋楼</Badge></div><section v-for="name in visibleBuildings" :key="name" class="building-section"><div class="building-section-head"><h3>{{ name }}</h3><span>{{ visibleRooms.filter((room) => room.building === name).length }} 间教室</span></div><Table><TableHeader><TableRow><TableHead class="room-name-col">教室</TableHead><TableHead class="number-col">容量</TableHead><TableHead>选定日期</TableHead><TableHead>预约时间 / 活动代码</TableHead><TableHead>空闲时间</TableHead><TableHead class="number-col">详情</TableHead></TableRow></TableHeader><TableBody><TableRow v-for="room in visibleRooms.filter((item) => item.building === name)" :key="room.id"><TableCell><strong>{{ shortName(room) }}</strong><small class="code-line">{{ room.id }}</small></TableCell><TableCell class="number-col capacity-number">{{ room.capacity }}</TableCell><TableCell class="secondary-cell">{{ shortDate(focusDate) }}</TableCell><TableCell><div v-for="booking in bookingsForRoom(room.id, focusDate).slice(0, 2)" :key="booking.identifier" class="dense-line">{{ booking.start }}–{{ booking.end }} <span class="booking-code">{{ booking.identifier }}</span></div><span v-if="!bookingsForRoom(room.id, focusDate).length" class="secondary-cell">示例中无预约</span></TableCell><TableCell><span v-for="range in freeRanges(room.id, focusDate).slice(0, 2)" :key="range" class="free-line inline-range">{{ range }}</span></TableCell><TableCell class="number-col"><Button size="xs" variant="outline" @click="openDetails(room)">查看</Button></TableCell></TableRow></TableBody></Table></section><div v-if="!visibleBuildings.length" class="empty-cell">当前筛选条件下没有预览教室。</div></TabsContent>

      <TabsContent value="matrix" class="view-content"><div class="view-heading"><div><h2>时间对比</h2><p>按日期或周次比较，也可交换横纵轴。点击单元格查看对应预约。</p></div><div class="matrix-toolbar"><Button size="sm" :variant="matrixDimension === 'date' ? 'secondary' : 'ghost'" @click="matrixDimension = 'date'">按日期</Button><Button size="sm" :variant="matrixDimension === 'week' ? 'secondary' : 'ghost'" @click="matrixDimension = 'week'">按周次</Button><Button size="sm" variant="outline" @click="transposed = !transposed"><ArrowLeftRight :size="14" /> 交换横纵轴</Button></div></div><div class="matrix-legend"><span class="legend-free"></span> 空闲较多 <span class="legend-busy"></span> 有预约 <span class="legend-empty"></span> 无预览日期</div><div class="table-panel matrix-scroll"><Table><TableHeader><TableRow><TableHead class="matrix-label-col">{{ transposed ? (matrixDimension === 'date' ? '日期' : '周次') : '教室 / 容量' }}</TableHead><TableHead v-for="column in transposed ? visibleRooms : matrixBuckets" :key="transposed ? column.id : column.key" class="matrix-data-col">{{ transposed ? shortName(column) : column.label }}<small v-if="transposed" class="code-line">{{ column.capacity }} 人</small></TableHead></TableRow></TableHeader><TableBody><template v-if="!transposed"><TableRow v-for="room in visibleRooms" :key="room.id"><TableCell class="matrix-label-col"><strong>{{ shortName(room) }}</strong><small class="code-line">{{ room.id }} · {{ room.capacity }} 人</small></TableCell><TableCell v-for="bucket in matrixBuckets" :key="bucket.key" class="matrix-cell"><Button class="matrix-cell-button" variant="ghost" @click="openDetails(room, bucket)"><span :class="['status-chip', cellSummary(room.id, bucket).count ? 'status-booked' : 'status-free']">{{ cellSummary(room.id, bucket).count ? `${cellSummary(room.id, bucket).count} 条预约` : '无预约' }}</span><small>空闲 {{ cellSummary(room.id, bucket).freeHours }}h</small></Button></TableCell></TableRow></template><template v-else><TableRow v-for="bucket in matrixBuckets" :key="bucket.key"><TableCell class="matrix-label-col"><strong>{{ bucket.label }}</strong><small class="code-line">{{ bucket.kind === 'week' ? '周次对比' : '日期对比' }}</small></TableCell><TableCell v-for="room in visibleRooms" :key="room.id" class="matrix-cell"><Button class="matrix-cell-button" variant="ghost" @click="openDetails(room, bucket)"><span :class="['status-chip', cellSummary(room.id, bucket).count ? 'status-booked' : 'status-free']">{{ cellSummary(room.id, bucket).count ? `${cellSummary(room.id, bucket).count} 条预约` : '无预约' }}</span><small>空闲 {{ cellSummary(room.id, bucket).freeHours }}h</small></Button></TableCell></TableRow></template><TableRow v-if="!matrixBuckets.length || !visibleRooms.length"><TableCell :colspan="(transposed ? visibleRooms.length : matrixBuckets.length) + 1" class="empty-cell">请调整周次、日期或楼栋筛选。</TableCell></TableRow></TableBody></Table></div></TabsContent>

      <TabsContent value="capacity" class="view-content"><div class="view-heading"><div><h2>全部教室 Capacity</h2><p>原站房间名称末尾括号中的数字；目录列出全部 197 间教室。</p></div><div class="directory-actions"><div class="directory-search"><Search :size="14" /><Input v-model="directorySearch" placeholder="搜索教室、编号、楼栋" aria-label="搜索教室" /></div><Button size="sm" variant="outline" @click="capacityAscending = !capacityAscending">容量 {{ capacityAscending ? '↑' : '↓' }}</Button><Badge variant="secondary">{{ visibleDirectory.length }} / {{ rooms.length }}</Badge></div></div><div class="table-panel directory-panel"><Table><TableHeader><TableRow><TableHead class="number-col">#</TableHead><TableHead>教室名称</TableHead><TableHead>楼栋</TableHead><TableHead>原站房间 ID</TableHead><TableHead class="number-col">Capacity</TableHead></TableRow></TableHeader><TableBody><TableRow v-for="(room, index) in visibleDirectory" :key="room.id"><TableCell class="number-col secondary-cell">{{ index + 1 }}</TableCell><TableCell><strong>{{ shortName(room) }}</strong><small class="code-line">{{ room.fullName }}</small></TableCell><TableCell class="secondary-cell">{{ room.building }}</TableCell><TableCell class="code-cell">{{ room.id }}</TableCell><TableCell class="number-col capacity-number">{{ room.capacity ?? '—' }}</TableCell></TableRow><TableRow v-if="!visibleDirectory.length"><TableCell colspan="5" class="empty-cell">没有匹配的教室。</TableCell></TableRow></TableBody></Table></div></TabsContent>
    </Tabs>

    <Dialog v-model:open="detailOpen"><DialogContent class="detail-dialog"><DialogHeader><DialogTitle>{{ detailRoom ? shortName(detailRoom) : '预约详情' }}</DialogTitle><DialogDescription>{{ detailRoom?.building }} · {{ detailRoom?.id }} · Capacity {{ detailRoom?.capacity }} <span v-if="detailBucket">· {{ detailBucket.label }}</span></DialogDescription></DialogHeader><div class="detail-note">原站公开的预约信息包含活动代码、活动类型、名称、教室位置、周次和时间；没有个人姓名字段时不推断预约人。</div><div class="detail-table"><Table><TableHeader><TableRow><TableHead>日期 / 时间</TableHead><TableHead>预约方或活动代码</TableHead><TableHead>活动类型 / 名称</TableHead><TableHead>原站位置 / 周次</TableHead></TableRow></TableHeader><TableBody><TableRow v-for="(booking, index) in detailBookings" :key="`${booking.identifier}-${index}`"><TableCell><strong>{{ shortDate(booking.date) }}</strong><small class="code-line">{{ booking.start }}–{{ booking.end }}</small></TableCell><TableCell class="code-cell">{{ booking.identifier }}<small class="code-line">具体个人：原站未提供</small></TableCell><TableCell>{{ booking.activityType }}<small class="code-line">{{ booking.title }}</small></TableCell><TableCell>{{ booking.location }}<small class="code-line">第 {{ booking.sourceWeeks }} 周</small></TableCell></TableRow><TableRow v-if="!detailBookings.length"><TableCell colspan="4" class="empty-cell">所选区间没有预约示例。</TableCell></TableRow></TableBody></Table></div></DialogContent></Dialog>
  </div>
</template>
