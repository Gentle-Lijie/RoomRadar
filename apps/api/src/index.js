import express from 'express';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { getCatalog } from './source.js';
import { queryReports, schedulerStats } from './scheduler.js';

const app = express();
const port = Number(process.env.PORT ?? 3001);
app.use(express.json({ limit: '32kb' }));

const PERIODS = new Set(['1-8', '1-20', '1-32', '9-20', '21-32']);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function validDate(value, label) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !ISO_DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) throw badRequest(`${label} must be a valid YYYY-MM-DD date`);
  return value;
}

function normalizeQuery(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw badRequest('Query body must be an object');
  if (!Array.isArray(body.roomIds) || body.roomIds.length > 250 || body.roomIds.some((id) => typeof id !== 'string' || !/^[A-Za-z0-9 %._+\/#-]{1,128}$/.test(id))) throw badRequest('Select valid room IDs');
  const roomIds = [...new Set(body.roomIds)];
  try { roomIds.forEach((id) => decodeURIComponent(id)); }
  catch { throw badRequest('Invalid encoded room ID'); }
  const academicStart = validDate(body.academicStart, 'academicStart');
  if (!academicStart) throw badRequest('academicStart is required');
  const weeks = [...new Set(body.weeks ?? [])].sort((a, b) => a - b);
  if (!weeks.length || weeks.some((week) => !Number.isInteger(week) || week < 1 || week > 53)) throw badRequest('Select valid academic weeks');
  const days = [...new Set(body.days ?? [1, 2, 3, 4, 5])].sort((a, b) => a - b);
  if (!days.length || days.some((day) => !Number.isInteger(day) || day < 1 || day > 7)) throw badRequest('Select valid weekdays');
  const dateFrom = validDate(body.dateFrom, 'dateFrom');
  const dateTo = validDate(body.dateTo, 'dateTo');
  if (dateFrom && dateTo && (dateFrom > dateTo || Date.parse(dateTo) - Date.parse(dateFrom) > 200 * 86_400_000)) throw badRequest('Invalid date range');
  const periods = body.periods ?? '1-32';
  if (!PERIODS.has(periods)) throw badRequest('Invalid time range');
  return { rooms: roomIds.map((id) => ({ id })), academicStart, weeks, days, dateFrom, dateTo, periods };
}

app.get('/api/health', (_request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.json({ ok: true, sourceConcurrency: schedulerStats() });
});

app.get('/api/catalog', async (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  const controller = new AbortController();
  response.on('close', () => controller.abort());
  try {
    const catalog = await getCatalog(controller.signal);
    response.json(catalog);
  } catch (error) {
    if (!controller.signal.aborted) response.status(502).json({ error: `Could not load Scientia room list: ${error.message}` });
  }
});

app.post('/api/availability/stream', async (request, response) => {
  const controller = new AbortController();
  response.on('close', () => controller.abort());
  try {
    const query = normalizeQuery(request.body);
    response.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store, no-transform');
    response.setHeader('X-Accel-Buffering', 'no');
    response.flushHeaders();

    const write = (payload) => {
      if (!controller.signal.aborted && !response.writableEnded) response.write(`${JSON.stringify(payload)}\n`);
    };
    write({
      type: 'meta', roomIds: query.rooms.map((room) => room.id), academicStart: query.academicStart,
      weeks: query.weeks, days: query.days, periods: query.periods,
    });
    if (query.rooms.length) {
      await queryReports({
        ...query,
        signal: controller.signal,
        onBatch: (batch) => write({ type: 'batch', ...batch }),
      });
    }
    write({ type: 'done', total: query.rooms.length, completedAt: new Date().toISOString() });
    if (!response.writableEnded) response.end();
  } catch (error) {
    if (controller.signal.aborted) return;
    if (response.headersSent) {
      response.write(`${JSON.stringify({ type: 'error', error: error.message })}\n`);
      response.end();
    } else {
      response.status(error.status ?? 502).json({ error: error.message });
    }
  }
});

const webDist = fileURLToPath(new URL('../../web/dist', import.meta.url));
if (existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get('/{*path}', (_request, response) => response.sendFile(join(webDist, 'index.html')));
}

app.listen(port, () => {
  console.log(`Room Check API listening on http://localhost:${port}`);
});
