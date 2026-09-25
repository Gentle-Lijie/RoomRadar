// Read-only client for the UNNC meeting room booking system
// (meetingroombooking.nottingham.edu.cn). The SSO login below submits the
// user's campus credentials to the university ADFS and returns the resulting
// bearer token; the token itself lives in the browser, this proxy never
// stores it. Only timetable/catalog endpoints are used — never booking ones.

const MRB_BASE = process.env.MRB_BASE_URL ?? 'https://meetingroombooking.nottingham.edu.cn';
const SSO_BASE = process.env.SSO_BASE_URL ?? 'https://sso.nottingham.edu.cn';
const MRB_API = `${MRB_BASE}/api/ace-sbms-provider`;

interface StatusError extends Error {
  status?: number;
}

function badRequest(message: string, status = 400): StatusError {
  const error = new Error(message) as StatusError;
  error.status = status;
  return error;
}

function decodeEntities(text: string) {
  return text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

// The campus WAF (F5) rejects requests without browser-like headers, so every
// outbound request carries them.
const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
};

interface GoOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: URLSearchParams;
  signal?: AbortSignal;
}

class Session {
  cookies = new Map<string, Map<string, string>>(); // host -> Map(name -> value)
  url = '';
  referer = '';

  store(response: Response) {
    const host = new URL(response.url ?? this.url).host;
    for (const cookie of response.headers.getSetCookie?.() ?? []) {
      const [pair] = cookie.split(';');
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (!this.cookies.has(host)) this.cookies.set(host, new Map());
      const jar = this.cookies.get(host)!;
      // ADFS acknowledges MFA success with a fresh MSISAuth followed by an
      // empty-value deletion of the same name; honoring the deletion would
      // drop the just-issued session, so empty values never overwrite.
      if (!value && jar.has(name)) continue;
      jar.set(name, value);
    }
  }
  header(url: string) {
    const host = new URL(url).host;
    const jar = this.cookies.get(host);
    return jar ? [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ') : '';
  }
  async go(url: string, options: GoOptions = {}) {
    const cookie = this.header(url);
    const response = await fetch(url, {
      ...options,
      redirect: 'manual',
      signal: options.signal ?? AbortSignal.timeout(30_000),
      headers: { ...BROWSER_HEADERS, ...(options.headers ?? {}), ...(cookie ? { Cookie: cookie } : {}) },
    });
    this.url = url;
    if (!options.method) this.referer = url;
    this.store(response);
    return response;
  }
}

interface FormField {
  value: string;
  type: string;
}

interface ParsedForm {
  action: string;
  fields: Record<string, FormField>;
}

function parseForm(html: string, baseUrl: string): ParsedForm | null {
  // Some ADFS forms (e.g. the MFA interstitial loginForm) carry no action
  // attribute and post back to the current URL.
  const match = /<form[^>]*?>([\s\S]*?)<\/form>/i.exec(html);
  if (!match) return null;
  const tagMatch = /<form[^>]*>/i.exec(html);
  const actionAttr = /action="([^"]*)"/i.exec(tagMatch![0])?.[1];
  const fields: Record<string, FormField> = {};
  for (const input of match[1].matchAll(/<input[^>]*>/gi)) {
    const tag = input[0];
    const name = /name="([^"]*)"/.exec(tag)?.[1];
    if (!name) continue;
    // ADFS MFA pages repeat field names (e.g. AuthMethod twice); keep the
    // first non-empty value so the real method identifier survives.
    if (fields[name] && fields[name].value) continue;
    fields[name] = {
      value: decodeEntities(/value="([^"]*)"/.exec(tag)?.[1] ?? ''),
      type: (/type="([^"]*)"/.exec(tag)?.[1] ?? 'text').toLowerCase(),
    };
  }
  return { action: new URL(decodeEntities(actionAttr ?? ''), baseUrl).href, fields };
}

async function postForm(session: Session, form: ParsedForm, extra?: Record<string, string>) {
  const body = new URLSearchParams();
  for (const [name, { value }] of Object.entries(form.fields)) body.set(name, value);
  for (const [name, value] of Object.entries(extra ?? {})) body.set(name, value);
  // ADFS validates the POST like a real form submission from its own pages.
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Origin: new URL(form.action).origin,
  };
  if (session.referer) headers.Referer = session.referer;
  return session.go(form.action, { method: 'POST', headers, body });
}

function visibleInputs(form: ParsedForm) {
  return Object.entries(form.fields).filter(([, field]) => !['hidden', 'checkbox', 'submit', 'button'].includes(field.type));
}

type LoginOutcome = { token: string } | { mfaForm: ParsedForm } | null;

// Walk the redirect / auto-submit chain after a credential or MFA step.
// ADFS drives its Azure MFA flow through interstitial pages whose forms
// auto-submit via JS: the first one only carries hidden fields (AuthMethod +
// Context) and reposts to the current URL; the next one exposes the
// VerificationCode input. Resolves with the bearer token, `null` for bad
// credentials, or `{ mfaForm }` when a code is required.
async function finishLogin(session: Session, response: Response): Promise<LoginOutcome> {
  let html = await response.text();
  for (let hop = 0; hop < 14; hop += 1) {
    const location = response.headers.get('location');
    if (location) {
      const token = /access_token=([A-Za-z0-9-]+)/.exec(location)?.[1];
      if (token) return { token };
      response = await session.go(new URL(location, session.url).href);
      if (response.status < 300) html = await response.text();
      continue;
    }
    const form = parseForm(html, session.url);
    if (!form) return null;
    if (Object.keys(form.fields).some((name) => /SAMLResponse/i.test(name))) {
      response = await postForm(session, form);
      html = await response.text();
      continue;
    }
    const visible = visibleInputs(form);
    const hasContext = 'Context' in form.fields;
    if (visible.length) {
      if (hasContext || visible.some(([name]) => /verif|otp|code/i.test(name))) return { mfaForm: form };
      return null; // back at the username/password form -> rejected credentials
    }
    if (hasContext && form.fields.AuthMethod?.value) {
      // MFA interstitial: emulate the page's autoSubmit(loginForm).
      response = await postForm(session, form);
      html = await response.text();
      continue;
    }
    return null;
  }
  return null;
}

interface LoginSession {
  session: Session;
  form: ParsedForm;
  createdAt: number;
}

const loginSessions = new Map<string, LoginSession>();
function pruneSessions() {
  const cutoff = Date.now() - 5 * 60_000;
  for (const [id, session] of loginSessions) if (session.createdAt < cutoff) loginSessions.delete(id);
}

async function newLoginSession() {
  pruneSessions();
  const session = new Session();
  const dispose = await session.go(`${MRB_API}/adfs/dispose-redirect-url?endPoint=${encodeURIComponent(MRB_BASE)}&callBackPoint=${encodeURIComponent(`${MRB_API}/adfs/v1/callback`)}`, { headers: { Accept: 'application/json' } });
  const disposeText = await dispose.text();
  let payload: string | null | undefined;
  try {
    payload = (JSON.parse(disposeText) as { data?: string | null }).data;
  } catch {
    if (/Request Rejected/i.test(disposeText)) throw badRequest('请求被校园网防火墙拦截，请稍等一两分钟后重试', 503);
    throw badRequest(`会议室系统登录入口异常（HTTP ${dispose.status}）`, 502);
  }
  if (!payload) throw badRequest('会议室系统未返回登录跳转信息', 502);
  const loginPage = await session.go(`${SSO_BASE}/adfs/ls/?SAMLRequest=${payload}`);
  const loginHtml = await loginPage.text();
  if (/Request Rejected/i.test(loginHtml)) throw badRequest('学校登录页被防火墙拦截，请稍等一两分钟后重试', 503);
  const form = parseForm(loginHtml, session.url);
  if (!form) throw badRequest('无法解析学校登录页，SSO 页面结构可能已变更', 502);
  const stateId = crypto.randomUUID();
  loginSessions.set(stateId, { session, form, createdAt: Date.now() });
  return stateId;
}

export async function mrbLogin(username: string, password: string) {
  const stateId = await newLoginSession();
  const { session, form } = loginSessions.get(stateId)!;
  const account = username.includes('@') ? username : `${username}@nottingham.edu.cn`;
  // ADFS shows a progressive form: username first, then the password step
  // posts to the form returned by the first submission.
  const usernameStep = await postForm(session, form, { UserName: account, Kmsi: 'true' });
  const passwordForm = parseForm(await usernameStep.text(), session.url);
  if (!passwordForm) throw badRequest('学校登录页响应异常，请稍后重试', 502);
  const response = await postForm(session, passwordForm, { UserName: account, Password: password, Kmsi: 'true' });
  const outcome = await finishLogin(session, response);
  if (outcome && 'mfaForm' in outcome) {
    loginSessions.set(stateId, { session, form: outcome.mfaForm, createdAt: Date.now() });
    return { stateId, mfaRequired: true };
  }
  loginSessions.delete(stateId);
  if (!outcome || !('token' in outcome)) throw badRequest('学校账号或密码错误，或 SSO 登录被拒绝', 401);
  return verifyToken(outcome.token);
}

export async function mrbLoginMfa(stateId: string, code: string) {
  pruneSessions();
  const state = loginSessions.get(stateId);
  if (!state) throw badRequest('登录会话已过期，请重新登录', 440);
  const names = Object.keys(state.form.fields);
  const target = names.find((name) => /verif|otp|code/i.test(name))
    ?? names.find((name) => !['hidden', 'checkbox', 'submit', 'button'].includes(state.form.fields[name].type));
  if (!target) throw badRequest('未找到验证码输入项，请重新登录', 502);
  // Include the submit button value the way a real button click would.
  const submitField = Object.entries(state.form.fields).find(([, field]) => field.type === 'submit');
  const extra: Record<string, string> = { [target]: code };
  if (submitField) extra[submitField[0]] = submitField[1].value || '登录';
  const response = await postForm(state.session, state.form, extra);
  const outcome = await finishLogin(state.session, response);
  if (outcome && 'mfaForm' in outcome) {
    // Wrong code: ADFS re-renders the prompt with a fresh Context — keep the
    // session alive so the user can simply type the next code.
    loginSessions.set(stateId, { session: state.session, form: outcome.mfaForm, createdAt: Date.now() });
    throw badRequest('验证码不正确，请重试', 401);
  }
  loginSessions.delete(stateId);
  if (!outcome || !('token' in outcome)) throw badRequest('SSO 验证失败，请重新登录', 401);
  return verifyToken(outcome.token);
}

async function mrbApi(path: string, token: string, init: RequestInit = {}) {
  const response = await fetch(`${MRB_API}${path}`, {
    ...init,
    headers: {
      ...BROWSER_HEADERS,
      ...(init.headers as Record<string, string> | undefined),
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
    signal: init.signal ?? AbortSignal.timeout(45_000),
  });
  if (response.status === 401) throw badRequest('会议室系统登录已过期，请重新连接', 401);
  const text = await response.text();
  if (/Request Rejected/i.test(text)) throw badRequest('请求被校园网防火墙拦截，请稍后重试', 503);
  if (!response.ok) throw badRequest(`会议室系统返回 HTTP ${response.status}`, 502);
  let payload: { code?: number; msg?: string; data?: any };
  try {
    payload = JSON.parse(text);
  } catch {
    throw badRequest(`会议室系统返回了非 JSON 响应（HTTP ${response.status}）`, 502);
  }
  if (payload.code !== 200) throw badRequest(`会议室系统错误：${payload.msg ?? payload.code}`, 502);
  return payload.data;
}

async function verifyToken(token: string) {
  const response = await fetch(`${MRB_BASE}/api/ace-upms-provider/sys-user/info`, {
    headers: { ...BROWSER_HEADERS, Authorization: `Bearer ${token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null);
  let name = '';
  let userId = '';
  if (response?.ok) {
    const payload = await response.json().catch(() => null) as { data?: { sysUser?: { name?: string; userId?: string } } } | null;
    name = payload?.data?.sysUser?.name ?? '';
    userId = payload?.data?.sysUser?.userId ?? '';
  }
  return { token, user: { name, userId } };
}

// The nodeStruct tree stores floors; a space's building is the top-level
// ancestor of the floor node it references.
async function buildingIndex(token: string, signal?: AbortSignal) {
  const tree = await mrbApi('/nodeStruct/listNodeStructTree', token, { signal });
  interface BuildingNode { name: string; parent: string | null }
  interface TreeNode { id: string; nodeName: string; children?: unknown[] }
  const nodes = new Map<string, BuildingNode>();
  const walk = (node: TreeNode, parent: string | null) => {
    nodes.set(node.id, { name: node.nodeName, parent });
    for (const child of (node.children ?? []) as TreeNode[]) walk(child, node.id);
  };
  for (const root of tree ?? []) walk(root, null);
  return (nodeId: string) => {
    let node = nodes.get(nodeId);
    while (node?.parent) node = nodes.get(node.parent);
    return node?.name ?? '其他会议室';
  };
}

const SHANGHAI_OFFSET = 8 * 3_600_000;
function shanghai(ms: number) {
  return new Date(ms + SHANGHAI_OFFSET).toISOString();
}

interface MrbSpace {
  id: string;
  spaceName: string;
  nodeStructIdList?: string[];
  capacity?: number | null;
  floor?: number | null;
  spaceNo?: string;
  description?: string;
  enabled?: number;
  disableReason?: string | null;
}

export async function mrbRooms(token: string, signal?: AbortSignal) {
  const [page, buildingOf] = await Promise.all([
    mrbApi('/v3.0/space/userPageSpace', token, {
      method: 'POST',
      signal,
      body: JSON.stringify({ entity: {}, pageObject: { pageNum: 1, size: -1, ascs: [], descs: [] } }),
    }),
    buildingIndex(token, signal),
  ]);
  const spaces: MrbSpace[] = page?.records ?? [];
  if (!Array.isArray(spaces) || !spaces.length) throw badRequest('会议室目录为空', 502);
  return spaces.map((space) => ({
    id: space.id,
    name: space.spaceName.trim(),
    fullName: space.spaceName.trim(),
    building: buildingOf(space.nodeStructIdList?.[0] ?? ''),
    capacity: space.capacity ?? null,
    floor: space.floor ?? null,
    spaceNo: space.spaceNo ?? '',
    description: space.description ?? '',
    enabled: space.enabled === 1,
    disableReason: space.disableReason || null,
  }));
}

const STATUS_LABELS: Record<number, string> = { 1: '待确认', 2: '已预约', 3: '已使用', 5: '使用中', 6: '已结束' };

export async function mrbTimetable(token: string, rawIds: string[], dateFrom: string, dateTo: string, signal?: AbortSignal) {
  const start = Date.parse(`${dateFrom}T00:00:00+08:00`);
  const end = Date.parse(`${dateTo}T00:00:00+08:00`) + 86_400_000;
  const data = await mrbApi('/v3.0/order/pageTimeTable', token, {
    method: 'POST',
    signal,
    body: JSON.stringify({
      entity: { startTime: start, endTime: end, spaceIdList: rawIds },
      pageObject: { ascs: [], descs: [], pageNum: 1, size: -1 },
    }),
  });
  const bySpace = new Map<string, any[]>((data ?? []).map((space: { id: string; cakeOrderViewList?: any[] }) => [space.id, space.cakeOrderViewList ?? []]));
  return rawIds.map((rawId) => {
    const orders = bySpace.get(rawId) ?? [];
    return {
      roomId: `mrb:${rawId}`,
      events: orders
        .filter((order) => STATUS_LABELS[order.status] && order.startTime && order.endTime)
        .map((order) => ({
          roomId: `mrb:${rawId}`,
          date: shanghai(order.startTime).slice(0, 10),
          start: shanghai(order.startTime).slice(11, 16),
          end: shanghai(Math.max(order.startTime + 60_000, order.endTime)).slice(11, 16),
          identifier: order.subject || '会议室预约',
          staff: order.hide === 1 ? '私密预约' : order.organizer?.name ?? order.userId ?? '',
          title: order.subject || '会议室预约',
          activityType: `会议室预约 · ${STATUS_LABELS[order.status]}`,
          activityCapacity: order.attendeeList?.length ? String(order.attendeeList.length + 1) : '',
          duration: `${Math.round((order.endTime - order.startTime) / 60_000)} 分钟`,
          location: order.spaceView?.spaceName ?? '',
          roomDescription: order.spaceView?.spaceNo ? `房间编号 ${order.spaceView.spaceNo}` : '',
          roomSize: order.spaceView?.capacity ? String(order.spaceView.capacity) : '',
          sourceWeeks: '',
          attendees: order.hide === 1 ? [] : (order.attendeeList ?? []).map((person: { name?: string }) => person.name).filter(Boolean),
        })),
    };
  });
}
