import express from 'express';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import type { Request, Response } from 'express';
import { getCatalog } from './source.js';
import { queryReports, schedulerStats } from './scheduler.js';
import { mrbLogin, mrbLoginMfa, mrbRooms, mrbTimetable } from './mrb.js';

const app = express();
const port = Number(process.env.PORT ?? 3001);
app.use(express.json({ limit: '32kb' }));

const PERIODS = new Set(['1-8', '1-20', '1-32', '9-20', '21-32']);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function shanghaiToday() {
  return new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
}

function badRequest(message: string) {
  const error = new Error(message) as Error & { status: number };
  error.status = 400;
  return error;
}

function messageOf(error: unknown) { return error instanceof Error ? error.message : String(error); }

function sendError(response: Response, error: unknown) {
  const status = (error as { status?: number } | null)?.status ?? 502;
  response.status(status).json({ error: messageOf(error) });
}

function validDate(value: unknown, label: string) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !ISO_DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) throw badRequest(`${label} must be a valid YYYY-MM-DD date`);
  return value;
}

function normalizeQuery(body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw badRequest('Query body must be an object');
  const raw = body as Record<string, unknown>;
  if (!Array.isArray(raw.roomIds) || raw.roomIds.length > 250 || raw.roomIds.some((id) => typeof id !== 'string' || !/^[A-Za-z0-9 %._+\/#-]{1,128}$/.test(id))) throw badRequest('Select valid room IDs');
  const roomIds = [...new Set(raw.roomIds)] as string[];
  try { roomIds.forEach((id) => decodeURIComponent(id)); }
  catch { throw badRequest('Invalid encoded room ID'); }
  const academicStart = validDate(raw.academicStart, 'academicStart');
  if (!academicStart) throw badRequest('academicStart is required');
  const weeks = [...new Set((raw.weeks as number[] | undefined) ?? [])].sort((a, b) => a - b);
  if (!weeks.length || weeks.some((week) => !Number.isInteger(week) || week < 1 || week > 53)) throw badRequest('Select valid academic weeks');
  const days = [...new Set((raw.days as number[] | undefined) ?? [1, 2, 3, 4, 5])].sort((a, b) => a - b);
  if (!days.length || days.some((day) => !Number.isInteger(day) || day < 1 || day > 7)) throw badRequest('Select valid weekdays');
  const dateFrom = validDate(raw.dateFrom, 'dateFrom');
  const dateTo = validDate(raw.dateTo, 'dateTo');
  if (dateFrom && dateTo && (dateFrom > dateTo || Date.parse(dateTo) - Date.parse(dateFrom) > 200 * 86_400_000)) throw badRequest('Invalid date range');
  const periods = (raw.periods as string | undefined) ?? '1-32';
  if (!PERIODS.has(periods)) throw badRequest('Invalid time range');
  return { rooms: roomIds.map((id) => ({ id })), academicStart, weeks, days, dateFrom, dateTo, periods };
}

app.get('/api/health', (_request: Request, response: Response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.json({ ok: true, sourceConcurrency: schedulerStats() });
});

function mrbToken(request: Request) {
  const header = request.headers.authorization ?? '';
  const token = /^Bearer\s+(.+)$/i.exec(header)?.[1]?.trim();
  if (!token || !/^[A-Za-z0-9-]{10,64}$/.test(token)) throw badRequest('请先连接会议室系统');
  return token;
}

app.post('/api/mrb/login', async (request: Request, response: Response) => {
  response.setHeader('Cache-Control', 'no-store');
  try {
    const { username, password } = (request.body ?? {}) as { username?: unknown; password?: unknown };
    if (typeof username !== 'string' || !username.trim() || typeof password !== 'string' || !password) throw badRequest('请输入学校账号和密码');
    const result = await mrbLogin(username.trim(), password);
    response.json(result);
  } catch (error) {
    sendError(response, error);
  }
});

app.post('/api/mrb/login/mfa', async (request: Request, response: Response) => {
  response.setHeader('Cache-Control', 'no-store');
  try {
    const { stateId, code } = (request.body ?? {}) as { stateId?: unknown; code?: unknown };
    if (typeof stateId !== 'string' || !/^[A-Za-z0-9-]{10,64}$/.test(stateId) || typeof code !== 'string' || !code.trim()) throw badRequest('请输入验证码');
    const result = await mrbLoginMfa(stateId, code.trim());
    response.json(result);
  } catch (error) {
    sendError(response, error);
  }
});

app.get('/api/mrb/rooms', async (request: Request, response: Response) => {
  response.setHeader('Cache-Control', 'no-store');
  try {
    const rooms = await mrbRooms(mrbToken(request));
    response.json({ rooms, updatedAt: new Date().toISOString() });
  } catch (error) {
    sendError(response, error);
  }
});

app.post('/api/mrb/timetable', async (request: Request, response: Response) => {
  response.setHeader('Cache-Control', 'no-store');
  try {
    const body = (request.body ?? {}) as Record<string, unknown>;
    if (!Array.isArray(body.roomIds) || !body.roomIds.length || body.roomIds.length > 250 || body.roomIds.some((id) => typeof id !== 'string' || !/^[A-Za-z0-9]{1,64}$/.test(id))) throw badRequest('请选择有效的会议室');
    const dateFrom = validDate(body.dateFrom, 'dateFrom') ?? shanghaiToday();
    const dateTo = validDate(body.dateTo, 'dateTo') ?? dateFrom;
    if (dateFrom > dateTo || Date.parse(dateTo) - Date.parse(dateFrom) > 200 * 86_400_000) throw badRequest('无效的日期范围');
    const results = await mrbTimetable(mrbToken(request), [...new Set(body.roomIds)] as string[], dateFrom, dateTo);
    response.json({ results, fetchedAt: new Date().toISOString() });
  } catch (error) {
    sendError(response, error);
  }
});

app.get('/api/catalog', async (request: Request, response: Response) => {
  response.setHeader('Cache-Control', 'no-store');
  const controller = new AbortController();
  response.on('close', () => controller.abort());
  try {
    const catalog = await getCatalog(controller.signal);
    response.json(catalog);
  } catch (error) {
    if (!controller.signal.aborted) response.status(502).json({ error: `Could not load Scientia room list: ${messageOf(error)}` });
  }
});

app.post('/api/availability/stream', async (request: Request, response: Response) => {
  const controller = new AbortController();
  response.on('close', () => controller.abort());
  try {
    const query = normalizeQuery(request.body);
    response.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store, no-transform');
    response.setHeader('X-Accel-Buffering', 'no');
    response.flushHeaders();

    const write = (payload: Record<string, unknown>) => {
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
      response.write(`${JSON.stringify({ type: 'error', error: messageOf(error) })}\n`);
      response.end();
    } else {
      sendError(response, error);
    }
  }
});

const webDist = fileURLToPath(new URL('../../web/dist', import.meta.url));
if (existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get('/{*path}', (_request: Request, response: Response) => response.sendFile(join(webDist, 'index.html')));
}

app.listen(port, () => {
  console.log(`Room Check API listening on http://localhost:${port}`);
});
