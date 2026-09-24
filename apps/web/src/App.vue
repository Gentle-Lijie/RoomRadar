<script setup>
import { computed, onMounted, onUnmounted, ref, watchEffect } from 'vue';
import { useRoomSearch, PERIOD_OPTIONS } from './useRoomSearch.js';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ChevronDown, RotateCcw, Search, ArrowLeftRight, Info, RefreshCw } from '@lucide/vue';

const viewNames = ['list', 'building', 'matrix', 'capacity'];
const view = ref(viewNames.includes(window.location.hash.slice(1)) ? window.location.hash.slice(1) : 'list');
watchEffect(() => window.history.replaceState(null, '', `#${view.value}`));
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
  selectedBuildings, selectedRoomIds, selectedWeeks, selectedDays, minimumCapacity, maximumCapacity, dateFrom, dateTo, periods,
  directorySearch, capacityAscending, queryState, queryError, progress, fetchedAt,
  buildingNames, weekOptions, visibleDates, visibleDirectory, visibleRooms, visibleBuildings, visibleBookings, failedCount, focusDate,
  dateOf, dayOf, weekOf, bookingsForRoom, isRoomLoaded, roomError, roomUrl, roomGridUrl, freeRanges, cellSummary, loadCatalog, runQuery,
} = useRoomSearch();
const matrixDimension = ref('date');
const transposed = ref(false);
const detailOpen = ref(false);
const detailRoom = ref(null);
const detailBucket = ref(null);
const weekdayNames = ['一', '二', '三', '四', '五', '六', '日'];
const periodLabel = computed(() => PERIOD_OPTIONS.find((option) => option.value === periods.value)?.label ?? '08:00–18:00');
const matrixBuckets = computed(() => matrixDimension.value === 'date'
  ? visibleDates.value.map((date) => ({ key: date, label: shortDate(date), kind: 'date' }))
  : selectedWeeks.value.filter((week) => visibleDates.value.some((date) => weekOf(date) === week)).map((week) => ({ key: week, label: `第 ${week} 周`, kind: 'week' })));
const detailBookings = computed(() => {
  if (!detailRoom.value) return [];
  const events = bookingsForRoom(detailRoom.value.id);
  if (!detailBucket.value) return events;
  return events.filter((event) => detailBucket.value.kind === 'date' ? event.date === detailBucket.value.key : event.week === detailBucket.value.key);
});
function toggleItem(type, item) {
  const list = type === 'building' ? selectedBuildings : type === 'week' ? selectedWeeks : selectedDays;
  if (type === 'building') selectedRoomIds.value = [];
  list.value = list.value.includes(item) ? list.value.filter((value) => value !== item) : [...list.value, item].sort((a, b) => String(a).localeCompare(String(b), 'zh-CN', { numeric: true }));
}
function resetFilters() {
  selectedBuildings.value = [];
  selectedRoomIds.value = [];
  selectedDays.value = [1, 2, 3, 4, 5];
  minimumCapacity.value = '';
  maximumCapacity.value = '';
  periods.value = '1-20';
  const currentWeek = Math.max(1, Math.min(maxWeek.value, weekOf(dateFrom.value)));
  selectedWeeks.value = [currentWeek];
}
function shortDate(isoDate) {
  if (!isoDate) return '—';
  return `${isoDate.slice(5, 7)}/${isoDate.slice(8, 10)} 周${weekdayNames[dayOf(isoDate) - 1]}`;
}
function shortName(room) {
  return room.name.replace(new RegExp(`^${room.building.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s-]*`, 'i'), '').trim() || room.name;
}
function openDetails(room, bucket = null) {
  detailRoom.value = room;
  detailBucket.value = bucket;
  detailOpen.value = true;
}
function inspectRoom(room) {
  selectedBuildings.value = [room.building];
  selectedRoomIds.value = [room.id];
  minimumCapacity.value = '';
  maximumCapacity.value = '';
  view.value = 'list';
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
        <span>配色：课表蓝</span>
        <Button size="sm" variant="outline" :disabled="loadingCatalog" @click="loadCatalog"><RefreshCw :size="14" /> 更新教室目录</Button>
      </div>
    </header>

    <div class="query-notice" role="status" aria-live="polite">
      <Info :size="14" />
      <span v-if="queryState === 'loading'">实时查询中：已返回 {{ progress.completed }} / {{ progress.total || '…' }} 间教室。更改筛选会取消旧查询。</span>
      <span v-else-if="queryState === 'error'">{{ queryError }}</span>
      <span v-else-if="queryState === 'done'">查询完成：{{ progress.completed }} 间教室 · {{ visibleBookings.length }} 条预约<span v-if="failedCount"> · {{ failedCount }} 间失败</span> · {{ fetchedAt ? new Date(fetchedAt).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '' }}。课表每次查询均从原站获取。</span>
      <span v-else-if="loadingCatalog">正在从 Scientia 更新楼栋、容量和周次；可用当前目录直接查询实时课表…</span>
      <span v-else-if="catalogError">原站部分目录信息未更新：{{ catalogError }}。仍可查询实时课表。<Button variant="link" size="xs" @click="loadCatalog">重试</Button></span>
      <span v-else>选择楼栋、容量、周次和日期即可自动查询，也可点击“立即查询”。每次查询都直接访问 Scientia。</span>
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
        <div class="control-group"><label for="min-capacity">最小容量</label><Input id="min-capacity" v-model="minimumCapacity" type="number" min="0" placeholder="不限" /></div>
        <div class="control-group"><label for="max-capacity">最大容量</label><Input id="max-capacity" v-model="maximumCapacity" type="number" min="0" placeholder="不限" /></div>
        <div class="control-group week-control">
          <label>周次（可多选）</label>
          <Popover>
            <PopoverTrigger as-child><Button variant="outline" class="filter-trigger"><span>{{ selectedWeeks.length ? selectedWeeks.map((week) => `第${week}周`).join('、') : '选择周次' }}</span><ChevronDown :size="15" /></Button></PopoverTrigger>
            <PopoverContent align="start" class="filter-popover week-popover">
              <div class="popover-heading">选择对比周次</div>
              <label v-for="option in weekOptions" :key="option.value" class="check-option"><Checkbox :model-value="selectedWeeks.includes(option.value)" @update:model-value="toggleItem('week', option.value)" /><span>{{ option.label }}</span><small>{{ dateOf(option.value, 1).slice(5) }} 起</small></label>
            </PopoverContent>
          </Popover>
        </div>
        <div class="control-group date-control"><label for="date-from">开始日期</label><Input id="date-from" v-model="dateFrom" type="date" /></div>
        <div class="control-group date-control"><label for="date-to">结束日期</label><Input id="date-to" v-model="dateTo" type="date" /></div>
        <div class="control-group period-control">
          <label>时段</label>
          <Popover>
            <PopoverTrigger as-child><Button variant="outline" class="filter-trigger"><span>{{ periodLabel }}</span><ChevronDown :size="15" /></Button></PopoverTrigger>
            <PopoverContent align="start" class="period-popover"><Button v-for="option in PERIOD_OPTIONS" :key="option.value" size="sm" :variant="periods === option.value ? 'secondary' : 'ghost'" class="period-option" @click="periods = option.value">{{ option.label }}</Button></PopoverContent>
          </Popover>
        </div>
        <Button size="sm" class="query-action" :disabled="!rooms.length" @click="runQuery"><Search :size="14" /> 立即查询</Button>
        <Button variant="ghost" size="sm" class="reset-filters" @click="resetFilters"><RotateCcw :size="14" /> 重置</Button>
      </div>
      <div class="filter-bottom">
        <span class="filter-bottom-label">星期</span>
        <Button v-for="day in 7" :key="day" size="xs" :variant="selectedDays.includes(day) ? 'secondary' : 'ghost'" :aria-pressed="selectedDays.includes(day)" @click="toggleItem('day', day)">周{{ weekdayNames[day - 1] }}</Button>
        <Badge v-if="selectedRoomIds.length" variant="outline">指定教室：{{ selectedRoomIds[0] }} <Button size="xs" variant="ghost" @click="selectedRoomIds = []">×</Button></Badge>
        <span class="query-summary">目录 {{ rooms.length }} 间 · 已选 {{ visibleRooms.length }} 间 · {{ visibleDates.length }} 个日期</span>
      </div>
    </section>

    <Tabs v-model="view" class="view-tabs">
      <TabsList variant="line" class="view-tabs-list"><TabsTrigger value="list">教室列表</TabsTrigger><TabsTrigger value="building">楼栋分组</TabsTrigger><TabsTrigger value="matrix">时间对比</TabsTrigger><TabsTrigger value="capacity">容量目录</TabsTrigger></TabsList>

      <TabsContent value="list" class="view-content">
        <div class="view-heading"><div><h2>教室列表</h2><p>按所选日期查看预约和空闲时段；点击教室可查看原始课表字段。</p></div><Badge variant="secondary">{{ shortDate(focusDate) }}</Badge></div>
        <div class="table-panel"><Table><TableHeader><TableRow><TableHead class="room-name-col">教室 / ID</TableHead><TableHead>楼栋</TableHead><TableHead class="number-col">Capacity</TableHead><TableHead>当天预约</TableHead><TableHead>当天空闲时段</TableHead><TableHead class="number-col">区间预约数</TableHead></TableRow></TableHeader><TableBody>
          <TableRow v-for="room in visibleRooms" :key="room.id">
            <TableCell><Button variant="link" class="room-link" @click="openDetails(room)">{{ shortName(room) }}</Button><small class="code-line">{{ room.id }}</small></TableCell>
            <TableCell class="secondary-cell">{{ room.building }}</TableCell><TableCell class="number-col capacity-number">{{ room.capacity }}</TableCell>
            <TableCell><span v-if="!isRoomLoaded(room.id)" class="secondary-cell">{{ roomError(room.id) || '查询中…' }}</span><template v-else><div v-for="booking in bookingsForRoom(room.id, focusDate).slice(0, 2)" :key="`${booking.identifier}${booking.start}`" class="dense-line"><span>{{ booking.start }}–{{ booking.end }}</span><span class="booking-code">{{ booking.staff || booking.identifier }}</span></div><span v-if="!bookingsForRoom(room.id, focusDate).length" class="secondary-cell">无预约</span><Button v-if="bookingsForRoom(room.id, focusDate).length > 2" variant="link" size="xs" @click="openDetails(room, { kind: 'date', key: focusDate, label: shortDate(focusDate) })">查看全部 {{ bookingsForRoom(room.id, focusDate).length }} 条</Button></template></TableCell>
            <TableCell><template v-if="isRoomLoaded(room.id)"><span v-for="range in freeRanges(room.id, focusDate).slice(0, 2)" :key="range" class="free-line inline-range">{{ range }}</span><span v-if="!freeRanges(room.id, focusDate).length" class="secondary-cell">无空闲时段</span><span v-if="freeRanges(room.id, focusDate).length > 2" class="secondary-cell">+{{ freeRanges(room.id, focusDate).length - 2 }} 段</span></template><span v-else class="secondary-cell">—</span></TableCell>
            <TableCell class="number-col"><Button variant="ghost" size="sm" :disabled="!isRoomLoaded(room.id)" @click="openDetails(room)">{{ isRoomLoaded(room.id) ? `${bookingsForRoom(room.id).length} 条 ›` : '—' }}</Button></TableCell>
          </TableRow>
          <TableRow v-if="!visibleRooms.length"><TableCell colspan="6" class="empty-cell">{{ queryState === 'idle' ? '选择筛选条件并点击“立即查询”。' : queryState === 'loading' ? '正在获取教室目录…' : '当前条件下没有教室。' }}</TableCell></TableRow>
        </TableBody></Table></div>
      </TabsContent>

      <TabsContent value="building" class="view-content">
        <div class="view-heading"><div><h2>楼栋分组</h2><p>按楼栋比较容量、所选日期的预约与空闲情况。</p></div><Badge variant="secondary">{{ visibleBuildings.length }} 栋楼</Badge></div>
        <section v-for="name in visibleBuildings" :key="name" class="building-section"><div class="building-section-head"><h3>{{ name }}</h3><span>{{ visibleRooms.filter((room) => room.building === name).length }} 间教室</span></div><Table><TableHeader><TableRow><TableHead class="room-name-col">教室</TableHead><TableHead class="number-col">容量</TableHead><TableHead>日期</TableHead><TableHead>预约时间 / 活动代码</TableHead><TableHead>空闲时间</TableHead><TableHead class="number-col">详情</TableHead></TableRow></TableHeader><TableBody>
          <TableRow v-for="room in visibleRooms.filter((item) => item.building === name)" :key="room.id"><TableCell><strong>{{ shortName(room) }}</strong><small class="code-line">{{ room.id }}</small></TableCell><TableCell class="number-col capacity-number">{{ room.capacity }}</TableCell><TableCell class="secondary-cell">{{ shortDate(focusDate) }}</TableCell><TableCell><span v-if="!isRoomLoaded(room.id)" class="secondary-cell">{{ roomError(room.id) || '查询中…' }}</span><template v-else><div v-for="booking in bookingsForRoom(room.id, focusDate).slice(0, 2)" :key="`${booking.identifier}${booking.start}`" class="dense-line">{{ booking.start }}–{{ booking.end }} <span class="booking-code">{{ booking.staff || booking.identifier }}</span></div><span v-if="!bookingsForRoom(room.id, focusDate).length" class="secondary-cell">无预约</span></template></TableCell><TableCell><span v-for="range in freeRanges(room.id, focusDate).slice(0, 2)" :key="range" class="free-line inline-range">{{ range }}</span><span v-if="!isRoomLoaded(room.id)" class="secondary-cell">—</span></TableCell><TableCell class="number-col"><Button size="xs" variant="outline" :disabled="!isRoomLoaded(room.id)" @click="openDetails(room)">查看</Button></TableCell></TableRow>
        </TableBody></Table></section>
        <div v-if="!visibleBuildings.length" class="empty-cell">{{ queryState === 'idle' ? '选择筛选条件并点击“立即查询”。' : '当前条件下没有教室。' }}</div>
      </TabsContent>

      <TabsContent value="matrix" class="view-content">
        <div class="view-heading"><div><h2>时间对比</h2><p>按日期或周次比较，并可交换横纵轴。点击单元格查看完整预约。</p></div><div class="matrix-toolbar"><Button size="sm" :variant="matrixDimension === 'date' ? 'secondary' : 'ghost'" @click="matrixDimension = 'date'">按日期</Button><Button size="sm" :variant="matrixDimension === 'week' ? 'secondary' : 'ghost'" @click="matrixDimension = 'week'">按周次</Button><Button size="sm" variant="outline" @click="transposed = !transposed"><ArrowLeftRight :size="14" /> 交换横纵轴</Button></div></div>
        <div class="matrix-legend"><span class="legend-free"></span> 无预约 <span class="legend-busy"></span> 有预约 <span class="legend-empty"></span> 查询中或失败</div>
        <div class="table-panel matrix-scroll"><Table><TableHeader><TableRow><TableHead class="matrix-label-col">{{ transposed ? (matrixDimension === 'date' ? '日期' : '周次') : '教室 / 容量' }}</TableHead><TableHead v-for="column in transposed ? visibleRooms : matrixBuckets" :key="transposed ? column.id : column.key" class="matrix-data-col">{{ transposed ? shortName(column) : column.label }}<small v-if="transposed" class="code-line">{{ column.capacity }} 人</small></TableHead></TableRow></TableHeader><TableBody>
          <template v-if="!transposed"><TableRow v-for="room in visibleRooms" :key="room.id"><TableCell class="matrix-label-col"><strong>{{ shortName(room) }}</strong><small class="code-line">{{ room.id }} · {{ room.capacity }} 人</small></TableCell><TableCell v-for="bucket in matrixBuckets" :key="bucket.key" class="matrix-cell"><Button class="matrix-cell-button" variant="ghost" :disabled="!isRoomLoaded(room.id)" @click="openDetails(room, bucket)"><span :class="['status-chip', !cellSummary(room.id, bucket) ? 'status-pending' : cellSummary(room.id, bucket).count ? 'status-booked' : 'status-free']">{{ !cellSummary(room.id, bucket) ? '待查询' : cellSummary(room.id, bucket).count ? `${cellSummary(room.id, bucket).count} 条预约` : '无预约' }}</span><small>{{ cellSummary(room.id, bucket) ? `空闲 ${cellSummary(room.id, bucket).freeHours}h` : '—' }}</small></Button></TableCell></TableRow></template>
          <template v-else><TableRow v-for="bucket in matrixBuckets" :key="bucket.key"><TableCell class="matrix-label-col"><strong>{{ bucket.label }}</strong><small class="code-line">{{ bucket.kind === 'week' ? '周次对比' : '日期对比' }}</small></TableCell><TableCell v-for="room in visibleRooms" :key="room.id" class="matrix-cell"><Button class="matrix-cell-button" variant="ghost" :disabled="!isRoomLoaded(room.id)" @click="openDetails(room, bucket)"><span :class="['status-chip', !cellSummary(room.id, bucket) ? 'status-pending' : cellSummary(room.id, bucket).count ? 'status-booked' : 'status-free']">{{ !cellSummary(room.id, bucket) ? '待查询' : cellSummary(room.id, bucket).count ? `${cellSummary(room.id, bucket).count} 条预约` : '无预约' }}</span><small>{{ cellSummary(room.id, bucket) ? `空闲 ${cellSummary(room.id, bucket).freeHours}h` : '—' }}</small></Button></TableCell></TableRow></template>
          <TableRow v-if="!matrixBuckets.length || !visibleRooms.length"><TableCell :colspan="(transposed ? visibleRooms.length : matrixBuckets.length) + 1" class="empty-cell">{{ queryState === 'idle' ? '设置筛选条件并查询。' : '请调整周次、日期或楼栋筛选。' }}</TableCell></TableRow>
        </TableBody></Table></div>
      </TabsContent>

      <TabsContent value="capacity" class="view-content"><div class="view-heading"><div><h2>全部教室 Capacity</h2><p>{{ catalogUpdatedAt ? '已从原站读取最新房间名称与容量。' : '当前显示随项目提供的目录快照；点击右上角更新可向原站获取最新目录。' }}</p></div><div class="directory-actions"><div class="directory-search"><Search :size="14" /><Input v-model="directorySearch" placeholder="搜索教室、编号、楼栋" aria-label="搜索教室" /></div><Button size="sm" variant="outline" @click="capacityAscending = !capacityAscending">容量 {{ capacityAscending ? '↑' : '↓' }}</Button><Badge variant="secondary">{{ visibleDirectory.length }} / {{ rooms.length }}</Badge></div></div><div class="table-panel directory-panel"><Table><TableHeader><TableRow><TableHead class="number-col">#</TableHead><TableHead>教室名称</TableHead><TableHead>楼栋</TableHead><TableHead>原站房间 ID</TableHead><TableHead class="number-col">Capacity</TableHead><TableHead class="number-col">课表</TableHead></TableRow></TableHeader><TableBody><TableRow v-for="(room, index) in visibleDirectory" :key="room.id"><TableCell class="number-col secondary-cell">{{ index + 1 }}</TableCell><TableCell><strong>{{ shortName(room) }}</strong><small class="code-line">{{ room.fullName }}</small></TableCell><TableCell class="secondary-cell">{{ room.building }}</TableCell><TableCell class="code-cell">{{ room.id }}</TableCell><TableCell class="number-col capacity-number">{{ room.capacity ?? '—' }}</TableCell><TableCell class="number-col"><Button size="xs" variant="outline" @click="inspectRoom(room)">查询此教室</Button></TableCell></TableRow><TableRow v-if="!visibleDirectory.length"><TableCell colspan="6" class="empty-cell">{{ loadingCatalog ? '正在加载教室目录…' : '没有匹配的教室。' }}</TableCell></TableRow></TableBody></Table></div></TabsContent>
    </Tabs>

    <Dialog v-model:open="detailOpen"><DialogContent class="detail-dialog"><DialogHeader><DialogTitle>{{ detailRoom ? shortName(detailRoom) : '预约详情' }}</DialogTitle><DialogDescription>{{ detailRoom?.building }} · {{ detailRoom?.id }} · Capacity {{ detailRoom?.capacity }} <span v-if="detailBucket">· {{ detailBucket.label }}</span></DialogDescription></DialogHeader><div class="detail-note">显示 Scientia 列表报告中的全部字段。Staff 可能是授课人员；空白时不推断预约人。<a v-if="detailRoom && roomUrl(detailRoom.id)" :href="roomUrl(detailRoom.id)" target="_blank" rel="noopener noreferrer">原始列表 ↗</a><a v-if="detailRoom && roomGridUrl(detailRoom.id)" :href="roomGridUrl(detailRoom.id)" target="_blank" rel="noopener noreferrer">原始网格 ↗</a></div><div class="detail-table"><Table><TableHeader><TableRow><TableHead>日期 / 时间</TableHead><TableHead>Staff / 活动代码</TableHead><TableHead>活动类型 / 名称</TableHead><TableHead>位置 / 适用周次</TableHead></TableRow></TableHeader><TableBody><TableRow v-for="(booking, index) in detailBookings" :key="`${booking.identifier}-${index}`"><TableCell><strong>{{ shortDate(booking.date) }}</strong><small class="code-line">{{ booking.start }}–{{ booking.end }} · {{ booking.duration }}</small></TableCell><TableCell class="code-cell"><strong>{{ booking.staff || '原站未提供 Staff' }}</strong><small class="code-line">{{ booking.identifier }}</small></TableCell><TableCell>{{ booking.activityType }}<small class="code-line">{{ booking.title }}</small><small class="code-line">活动人数 {{ booking.activityCapacity || '—' }}</small></TableCell><TableCell>{{ booking.location }}<small class="code-line">{{ booking.roomDescription }}</small><small class="code-line">房间容量 {{ booking.roomSize || detailRoom?.capacity }} · 第 {{ booking.sourceWeeks }} 周</small><details class="source-fields"><summary>原始字段</summary><pre>{{ JSON.stringify(booking.rawFields, null, 2) }}</pre></details></TableCell></TableRow><TableRow v-if="!detailBookings.length"><TableCell colspan="4" class="empty-cell">所选区间没有预约。</TableCell></TableRow></TableBody></Table></div></DialogContent></Dialog>
  </div>
</template>
