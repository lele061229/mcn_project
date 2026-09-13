/* ============================================================
 * MCN 达人培育后台 V1 · 自建后端服务（零依赖，Node 原生）
 *
 * 架构：前端 → 本服务 /api/* → 存储适配层
 * 存储二选一（自动判断）：
 *   1) Mock 模式（默认）：本地 JSON（v1/data/db.json），字段结构与飞书多维表格一致
 *   2) 飞书模式：配置以下环境变量后自动启用，直接读写飞书多维表格
 *      FEISHU_APP_ID / FEISHU_APP_SECRET
 *      FEISHU_BITABLE_APP_TOKEN      多维表格 app_token
 *      FEISHU_TABLE_TALENTS          达人表 table_id（tbl 开头）
 *      FEISHU_TABLE_TASKS            寄拍任务表 table_id
 *      FEISHU_TABLE_FOLLOWUPS        跟进记录表 table_id
 *      FEISHU_TABLE_LOGS             操作日志表 table_id
 *      （表内字段名必须与下方 FIELD_MAPS 中的中文名一致）
 *
 * 启动：node v1/server.js  →  http://localhost:3000
 * 前端永远不会接触 App Secret，只调用本服务 API。
 * ============================================================ */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'db.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const LEGACY_DIR = path.join(__dirname, '..'); // 原 MVP 演示系统（根目录 8 页），保持文件原位、原样服务

const ENV = process.env;
const USE_FEISHU = !!(ENV.FEISHU_APP_ID && ENV.FEISHU_APP_SECRET && ENV.FEISHU_BITABLE_APP_TOKEN &&
  ENV.FEISHU_TABLE_TALENTS && ENV.FEISHU_TABLE_TASKS && ENV.FEISHU_TABLE_FOLLOWUPS && ENV.FEISHU_TABLE_LOGS);

/* ---------------- 业务常量 ---------------- */
const TALENT_STATUSES = ['待联系', '已联系', '有意向', '已报名', '待审核', '已通过', '已拒绝', '合作中', '暂停合作', '已流失'];
const TASK_STATUSES = ['待确认', '待寄出', '已寄出', '已签收', '待拍摄', '待提交', '待审核', '内容修改中', '待发布', '已发布', '已完成', '达人拒绝', '超时', '商品异常', '内容不合格', '已取消'];
const ACTIVE_TASK = ['待确认', '待寄出', '已寄出', '已签收', '待拍摄', '待提交', '待审核', '内容修改中', '待发布', '已发布'];
const PENDING_TASK = ['待确认', '待审核', '内容修改中', '超时', '内容不合格'];

// 任务操作定义：from=允许的当前状态，to=目标状态，fields=必填/选填表单，stamp=自动写入的时间字段，audit=需要主管及以上权限
const ACTIONS = {
  confirm:       { label: '确认接单',     from: ['待确认'],             to: '待寄出',     fields: [] },
  send:          { label: '已寄出',       from: ['待寄出'],             to: '已寄出',     fields: [{ key: 'trackingNo', label: '快递单号', required: true }], stamp: 'sentAt' },
  sign:          { label: '确认签收',     from: ['已寄出'],             to: '已签收',     fields: [], stamp: 'signedAt' },
  startShoot:    { label: '开始拍摄',     from: ['已签收'],             to: '待拍摄',     fields: [] },
  submitContent: { label: '提交内容',     from: ['待拍摄', '待提交'],   to: '待审核',     fields: [{ key: 'contentUrl', label: '视频/笔记链接', required: true }, { key: 'contentNote', label: '内容说明', required: false }], stamp: 'contentAt' },
  resubmit:      { label: '重新提交审核', from: ['内容修改中'],         to: '待审核',     fields: [], stamp: 'contentAt' },
  auditPass:     { label: '审核通过',     from: ['待审核'],             to: '待发布',     fields: [], audit: true },
  auditReject:   { label: '审核不通过',   from: ['待审核'],             to: '内容修改中', fields: [{ key: 'auditOpinion', label: '修改意见', required: true }], audit: true },
  publish:       { label: '标记已发布',   from: ['待发布'],             to: '已发布',     fields: [{ key: 'contentUrl', label: '内容链接', required: true }], stamp: 'publishedAt' },
  complete:      { label: '完成任务',     from: ['已发布'],             to: '已完成',     fields: [] },
  markException: { label: '标记异常',     from: ACTIVE_TASK,            to: null,         options: ['达人拒绝', '超时', '商品异常', '内容不合格'], fields: [{ key: 'issue', label: '异常说明', required: true }] },
  cancel:        { label: '取消任务',     from: ACTIVE_TASK,            to: '已取消',     fields: [{ key: 'issue', label: '取消原因', required: true }] },
};

/* ---------------- 字段映射（系统字段 ↔ 飞书中文字段名） ---------------- */
const FIELD_MAPS = {
  talents: {
    id: '达人ID', name: '达人昵称', douyin: '抖音号', contact: '手机号/微信', channel: '来源渠道',
    level: '达人等级', status: '达人状态', contentTypes: '内容类型', categories: '擅长品类',
    fans: '粉丝量', coopCount: '历史合作次数', fulfillmentRate: '履约率',
    lastFollowAt: '最近跟进时间', owner: '负责人', tags: '标签', note: '备注',
    createdAt: '创建时间', rejectReason: '拒绝原因', auditAt: '审核时间', auditBy: '审核人', isActive: '启用状态',
  },
  tasks: {
    id: '任务ID', campaignId: '商单ID', talentId: '达人ID', talentName: '达人昵称', product: '商品名称',
    status: '任务状态', trackingNo: '快递单号', sentAt: '寄出时间', signedAt: '签收时间',
    contentAt: '内容提交时间', publishedAt: '发布时间', contentUrl: '内容链接', contentNote: '内容说明',
    auditOpinion: '审核意见', commission: '佣金', owner: '负责人', issue: '异常情况', createdAt: '创建时间',
  },
  followups: {
    id: '记录ID', talentId: '达人ID', talentName: '达人昵称', content: '跟进内容',
    method: '跟进方式', nextAt: '下次跟进时间', operator: '操作人', createdAt: '创建时间',
  },
  logs: {
    id: '日志ID', operator: '操作人', at: '操作时间', target: '操作对象', type: '操作类型', before: '修改前', after: '修改后',
  },
};
const DATE_FIELDS = {
  talents: new Set(['lastFollowAt', 'createdAt', 'auditAt']),
  tasks: new Set(['sentAt', 'signedAt', 'contentAt', 'publishedAt', 'createdAt']),
  followups: new Set(['nextAt', 'createdAt']),
  logs: new Set(['at']),
};

/* ---------------- 时间工具 ---------------- */
const p2 = n => String(n).padStart(2, '0');
function fmtDate(d) { return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; }
function fmtDateTime(d) { return `${fmtDate(d)} ${p2(d.getHours())}:${p2(d.getMinutes())}`; }
function nowStr() { return fmtDateTime(new Date()); }
function daysAgo(n, h = 10) { const d = new Date(); d.setDate(d.getDate() - n); d.setHours(h, 0, 0, 0); return fmtDateTime(d); }
function daysAhead(n, h = 10) { return daysAgo(-n, h); }

/* ============================================================
 * 存储适配层 —— 两个实现拥有相同接口：list / get / insert / update
 * ============================================================ */

/* ---------- Mock 存储（本地 JSON） ---------- */
let mockDb = null;
function seedDb() {
  const T = (id, name, status, channel, level, fans, cats, owner, tags, dAgo, extra = {}) => ({
    id, name, douyin: extra.douyin || 'dy_' + id.toLowerCase(), contact: extra.contact || 'wx_' + name,
    channel, level, status, contentTypes: extra.contentTypes || ['穿搭'], categories: cats, fans,
    coopCount: extra.coopCount || 0, fulfillmentRate: extra.rate || 0, owner, tags,
    lastFollowAt: daysAgo(dAgo), note: extra.note || '', createdAt: daysAgo(dAgo, 9),
    rejectReason: '', auditAt: '', auditBy: '', isActive: true,
  });
  const talents = [
    T('T0001', '小王', '待审核', '抖音直播', 'B', 12800, ['女装', '鞋靴'], '李婷', ['新达人'], 2, { coopCount: 0, rate: 0, douyin: 'xiaowang_2026', contact: 'wx_xiaowang99' }),
    T('T0002', '王芳Fiona', '合作中', '私聊邀约', 'A', 86000, ['女装', '鞋靴'], '李婷', ['核心达人', '高履约'], 6, { coopCount: 12, rate: 96 }),
    T('T0003', '阿泽', '合作中', '达人推荐', 'B', 45000, ['男装', '鞋靴'], '王浩', ['男装'], 5, { coopCount: 6, rate: 92 }),
    T('T0004', '桃子peach', '合作中', '抖音直播', 'A', 152000, ['美妆', '女装'], '张萌', ['美妆', '高转化'], 4, { coopCount: 9, rate: 98 }),
    T('T0005', '大熊的鞋柜', '合作中', '表单', 'B', 68000, ['鞋靴', '数码'], '王浩', ['鞋靴'], 4, { coopCount: 5, rate: 88 }),
    T('T0006', '蕾蕾Lena', '合作中', '微信', 'B', 32000, ['女装', '包袋'], '李婷', ['女装'], 3, { coopCount: 4, rate: 100 }),
    T('T0007', '周周有好货', '已通过', '抖音直播', 'C', 21000, ['女装'], '李婷', ['新达人'], 3),
    T('T0008', '小鹿乱撞', '已通过', '表单', 'C', 18000, ['包袋', '手表'], '张萌', ['新达人'], 2),
    T('T0009', '糖糖不甜', '有意向', '微信', 'B', 54000, ['女装', '美妆'], '王浩', [], 2),
    T('T0010', '柠檬不酸', '有意向', '达人推荐', 'A', 210000, ['女装', '包袋'], '李婷', ['高转化'], 1),
    T('T0011', '慢慢', '已联系', '表单', 'C', 15000, ['数码'], '张萌', [], 1),
    T('T0012', '果果', '已联系', '微信', 'C', 9000, ['女装'], '张萌', [], 0),
    T('T0013', 'KK不想上班', '待联系', '人工拓展', 'C', 7600, ['男装'], '王浩', [], 0),
    T('T0014', '橙子味汽水', '暂停合作', '抖音直播', 'B', 47000, ['女装'], '王浩', [], 7, { coopCount: 3, rate: 67 }),
    T('T0015', 'xx数据服务', '已流失', '人工拓展', 'C', 5000, [], '王浩', [], 7, { note: '同行广告号' }),
    T('T0016', '七喜', '待审核', '达人推荐', 'B', 28000, ['包袋', '女装'], '张萌', ['新达人'], 1),
  ];
  const TK = (id, tid, tname, product, commission, status, extra = {}) => ({
    id, campaignId: extra.campaignId || 'SP2026001', talentId: tid, talentName: tname, product, status,
    trackingNo: extra.trackingNo || '', sentAt: extra.sentAt || '', signedAt: extra.signedAt || '',
    contentAt: extra.contentAt || '', publishedAt: extra.publishedAt || '', contentUrl: extra.contentUrl || '',
    contentNote: '', auditOpinion: '', commission, owner: extra.owner || '李婷', issue: '', createdAt: extra.createdAt || daysAgo(extra.dAgo ?? 3, 14),
  });
  const tasks = [
    TK('TK1001', 'T0002', '王芳Fiona', '复古慢跑鞋（米白翻毛皮）', 600, '已完成', { dAgo: 6, publishedAt: daysAgo(3), contentUrl: 'https://v.douyin.com/demo1001' }),
    TK('TK1002', 'T0002', '王芳Fiona', '奶油云感针织卫衣', 520, '已完成', { dAgo: 5, publishedAt: daysAgo(2), contentUrl: 'https://v.douyin.com/demo1002' }),
    TK('TK1003', 'T0003', '阿泽', '316不锈钢保温杯', 380, '已完成', { campaignId: 'SP2026002', dAgo: 4, publishedAt: daysAgo(1), contentUrl: 'https://v.douyin.com/demo1003', owner: '王浩' }),
    TK('TK1004', 'T0004', '桃子peach', '丝绒口红礼盒', 800, '已完成', { campaignId: 'SP2026003', dAgo: 4, publishedAt: daysAgo(0, 12), contentUrl: 'https://v.douyin.com/demo1004', owner: '张萌' }),
    TK('TK1005', 'T0004', '桃子peach', '头层牛皮托特包', 650, '已发布', { campaignId: 'SP2026003', dAgo: 5, publishedAt: '', contentUrl: 'https://v.douyin.com/demo1005', owner: '张萌' }),
    TK('TK1006', 'T0005', '大熊的鞋柜', '主动降噪蓝牙耳机', 450, '待审核', { campaignId: 'SP2026002', dAgo: 6, contentAt: daysAgo(0, 11), contentUrl: 'https://v.douyin.com/demo1006', owner: '王浩' }),
    TK('TK1007', 'T0006', '蕾蕾Lena', '羊毛针织开衫', 420, '待审核', { dAgo: 7, contentAt: daysAgo(0, 10), contentUrl: 'https://v.douyin.com/demo1007' }),
    TK('TK1008', 'T0002', '王芳Fiona', '珍珠锁骨项链', 300, '待发布', { dAgo: 4, contentAt: daysAgo(1) }),
    TK('TK1009', 'T0003', '阿泽', '加绒直筒卫裤', 350, '待提交', { campaignId: 'SP2026002', dAgo: 4, owner: '王浩' }),
    TK('TK1010', 'T0005', '大熊的鞋柜', '客制化机械键盘', 520, '待拍摄', { campaignId: 'SP2026002', dAgo: 3, signedAt: daysAgo(0, 9), owner: '王浩', trackingNo: 'SF1380000110', sentAt: daysAgo(2) }),
    TK('TK1011', 'T0001', '小王', '猫爪板鞋（奶白）', 400, '待拍摄', { dAgo: 2, signedAt: daysAgo(0, 9), trackingNo: 'SF1380000221', sentAt: daysAgo(1) }),
    TK('TK1012', 'T0006', '蕾蕾Lena', '香薰机（白瓷款）', 280, '已寄出', { dAgo: 2, trackingNo: 'YT4200330055', sentAt: daysAgo(0, 9) }),
    TK('TK1013', 'T0007', '周周有好货', '高腰瑜伽裤', 260, '已寄出', { dAgo: 2, trackingNo: 'YT4200330066', sentAt: daysAgo(0, 10) }),
    TK('TK1014', 'T0008', '小鹿乱撞', ' minimalist 石英腕表', 900, '已签收', { dAgo: 3, trackingNo: 'JD0005512233', sentAt: daysAgo(2), signedAt: daysAgo(0, 14) }),
    TK('TK1015', 'T0007', '周周有好货', '鲨鱼夹发饰套装', 180, '待寄出', { dAgo: 1 }),
    TK('TK1016', 'T0008', '小鹿乱撞', '液态玻璃手机壳', 150, '待确认', { dAgo: 0, createdAt: daysAgo(0, 9) }),
    TK('TK1017', 'T0006', '蕾蕾Lena', '车载香氛挂件', 160, '超时', { dAgo: 5, trackingNo: 'YT4200330077', sentAt: daysAgo(4), owner: '张萌', issue: `[${daysAgo(1, 18)}] 达人超 48 小时未确认拍摄档期` }),
  ];
  const followups = [
    { id: 'F0001', talentId: 'T0001', talentName: '小王', content: '达人表示本周可以接女包商单。', method: '电话', nextAt: daysAhead(1), operator: '张萌', createdAt: daysAgo(0, 15) },
    { id: 'F0002', talentId: 'T0001', talentName: '小王', content: '已发送寄拍流程与佣金说明，达人回复感兴趣。', method: '微信', nextAt: daysAhead(2), operator: '李婷', createdAt: daysAgo(1, 11) },
    { id: 'F0003', talentId: 'T0001', talentName: '小王', content: '抖音私信首次触达，互留微信。', method: '私信', nextAt: '', operator: '李婷', createdAt: daysAgo(2, 20) },
  ];
  const logs = [
    { id: 'LOG0001', operator: '李婷', at: daysAgo(2, 10), target: '达人：小王', type: '新增达人', before: '', after: '状态=待审核' },
    { id: 'LOG0002', operator: '李婷', at: daysAgo(1, 16), target: '任务：TK1011', type: '已寄出', before: '待寄出', after: '已寄出' },
  ];
  return { talents, tasks, followups, logs };
}
function saveDb() { fs.writeFileSync(DATA_FILE, JSON.stringify(mockDb, null, 2)); }

const mockStore = {
  mode: 'mock',
  async list(coll, filter) {
    const arr = JSON.parse(JSON.stringify(mockDb[coll]));
    return filter ? arr.filter(filter) : arr;
  },
  async get(coll, id) {
    const r = mockDb[coll].find(r => String(r.id) === String(id));
    return r ? JSON.parse(JSON.stringify(r)) : null; // 返回克隆，避免 update 原地修改污染「修改前」日志
  },
  async insert(coll, obj) { mockDb[coll].push(obj); saveDb(); return obj; },
  async update(coll, id, patch) {
    const rec = mockDb[coll].find(r => String(r.id) === String(id));
    if (!rec) throw new Error('记录不存在: ' + id);
    Object.assign(rec, patch); saveDb();
    return JSON.parse(JSON.stringify(rec));
  },
};

/* ---------- 飞书存储（多维表格） ---------- */
const FEISHU_HOST = 'https://open.feishu.cn';
const TABLES = { talents: ENV.FEISHU_TABLE_TALENTS, tasks: ENV.FEISHU_TABLE_TASKS, followups: ENV.FEISHU_TABLE_FOLLOWUPS, logs: ENV.FEISHU_TABLE_LOGS };
let _tok = null;
async function feishuApi(method, pathname, body) {
  if (!_tok || _tok.exp < Date.now() + 60000) {
    const r = await fetch(FEISHU_HOST + '/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: ENV.FEISHU_APP_ID, app_secret: ENV.FEISHU_APP_SECRET }),
    }).then(x => x.json());
    if (r.code !== 0) throw new Error('飞书 token 获取失败: ' + r.msg);
    _tok = { token: r.tenant_access_token, exp: Date.now() + ((r.exp || 3600) - 300) * 1000 };
  }
  const res = await fetch(FEISHU_HOST + pathname, {
    method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + _tok.token },
    body: body ? JSON.stringify(body) : undefined,
  }).then(x => x.json());
  if (res.code !== 0) throw new Error('飞书 API 错误 ' + res.code + ': ' + res.msg);
  return res.data;
}
function toFeishu(coll, obj) { // 系统字段 → 飞书字段（日期→毫秒时间戳）
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const cn = FIELD_MAPS[coll][k];
    if (!cn) continue;
    out[cn] = DATE_FIELDS[coll].has(k) ? (v ? new Date(String(v).replace(' ', 'T')).getTime() : '') : v;
  }
  return out;
}
function fromFeishu(coll, fields) { // 飞书字段 → 系统字段（时间戳→字符串）
  const rev = {};
  for (const [k, v] of Object.entries(FIELD_MAPS[coll])) rev[v] = k;
  const out = {};
  for (const [cn, v] of Object.entries(fields)) {
    const en = rev[cn];
    if (!en) continue;
    out[en] = (DATE_FIELDS[coll].has(en) && typeof v === 'number') ? fmtDateTime(new Date(v)) : v;
  }
  return out;
}
const feishuStore = {
  mode: 'feishu',
  async list(coll) { // V1 数据量小（<1000 行）直接全量拉取，后续可加筛选条件
    const data = await feishuApi('POST', `/open-apis/bitable/v1/apps/${ENV.FEISHU_BITABLE_APP_TOKEN}/tables/${TABLES[coll]}/records/search?page_size=500`, {});
    return (data.items || []).map(it => ({ _rid: it.record_id, ...fromFeishu(coll, it.fields || {}) }));
  },
  async get(coll, id) { return (await this.list(coll)).find(r => String(r.id) === String(id)) || null; },
  async insert(coll, obj) {
    await feishuApi('POST', `/open-apis/bitable/v1/apps/${ENV.FEISHU_BITABLE_APP_TOKEN}/tables/${TABLES[coll]}/records`, { fields: toFeishu(coll, obj) });
    return obj;
  },
  async update(coll, id, patch) {
    const rec = (await this.list(coll)).find(r => String(r.id) === String(id));
    if (!rec) throw new Error('记录不存在: ' + id);
    await feishuApi('PUT', `/open-apis/bitable/v1/apps/${ENV.FEISHU_BITABLE_APP_TOKEN}/tables/${TABLES[coll]}/records/${rec._rid}`, { fields: toFeishu(coll, patch) });
    return { ...rec, ...patch };
  },
};

const db = USE_FEISHU ? feishuStore : mockStore;
async function addLog(operator, target, type, before, after) {
  const arr = await db.list('logs');
  const next = arr.reduce((m, r) => Math.max(m, parseInt(String(r.id).replace(/\D/g, '')) || 0), 0) + 1;
  await db.insert('logs', { id: 'LOG' + String(next).padStart(4, '0'), operator, at: nowStr(), target, type, before: String(before ?? ''), after: String(after ?? '') });
}
async function nextId(coll, prefix, width) {
  const arr = await db.list(coll);
  const max = arr.reduce((m, r) => Math.max(m, parseInt(String(r.id).replace(/\D/g, '')) || 0), 0);
  return prefix + String(max + 1).padStart(width, '0');
}

/* ---------------- 权限（V1 简易版） ---------------- */
const ROLES = {
  '运营': { mutate: true, audit: false },
  '主管': { mutate: true, audit: true },
  '财务': { mutate: false, audit: false },
  '管理员': { mutate: true, audit: true },
};

/* ---------------- HTTP 工具 ---------------- */
function json(res, code, data) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); }
function ok(res, data) { json(res, 200, { ok: true, data }); }
function fail(res, code, msg) { json(res, code, { ok: false, error: msg }); }
function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', c => { s += c; if (s.length > 1e6) reject(new Error('请求体过大')); });
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch { reject(new Error('JSON 格式错误')); } });
    req.on('error', reject);
  });
}

/* ---------------- API 路由 ---------------- */
const routes = [];
function route(method, pattern, handler) { routes.push({ method, pattern, handler }); }

// 元信息：存储模式 / 状态列表 / 任务操作定义（前端据此渲染操作按钮）
route('GET', '/api/meta', (ctx) => {
  ok(ctx.res, { mode: db.mode, TALENT_STATUSES, TASK_STATUSES, ACTIVE_TASK, ACTIONS });
});

// ---------- Dashboard ----------
route('GET', '/api/dashboard', async (ctx) => {
  const talents = await db.list('talents');
  const tasks = await db.list('tasks');
  const today = fmtDate(new Date());
  const weekStart = fmtDate(new Date(Date.now() - 6 * 864e5));
  const trend7d = [];
  for (let i = 6; i >= 0; i--) {
    const d = fmtDate(new Date(Date.now() - i * 864e5));
    trend7d.push({ date: d.slice(5), count: talents.filter(t => String(t.createdAt).slice(0, 10) === d).length });
  }
  const dist = (list, key, orders) => orders.map(s => ({ name: s, value: list.filter(x => x[key] === s).length })).filter(x => x.value > 0);
  const finished = tasks.filter(t => t.status === '已完成').length;
  const valid = tasks.filter(t => t.status !== '已取消').length;
  const month = today.slice(0, 7);
  const monthCommission = tasks.filter(t => ['已发布', '已完成'].includes(t.status) && String(t.publishedAt || t.createdAt).slice(0, 7) === month).reduce((a, b) => a + (+b.commission || 0), 0);
  const settledCommission = tasks.filter(t => t.status === '已完成' && String(t.publishedAt || t.createdAt).slice(0, 7) === month).reduce((a, b) => a + (+b.commission || 0), 0);
  ok(ctx.res, {
    talents: {
      total: talents.length,
      today: talents.filter(t => String(t.createdAt).slice(0, 10) === today).length,
      week: talents.filter(t => String(t.createdAt).slice(0, 10) >= weekStart).length,
      pendingAudit: talents.filter(t => t.status === '待审核').length,
      active: talents.filter(t => t.status === '合作中').length,
    },
    tasks: {
      ongoing: tasks.filter(t => ACTIVE_TASK.includes(t.status)).length,
      pending: tasks.filter(t => PENDING_TASK.includes(t.status)).length,
      completed: finished,
    },
    commission: { monthExpected: monthCommission, monthSettled: settledCommission },
    trend7d,
    talentStatusDist: dist(talents, 'status', TALENT_STATUSES),
    taskStatusDist: dist(tasks, 'status', TASK_STATUSES),
    completionRate: valid ? Math.round(finished / valid * 100) : 0,
  });
});

// ---------- 达人 ----------
route('GET', '/api/talents', async (ctx) => {
  const q = ctx.query.get('q') || '';
  let arr = await db.list('talents');
  if (q) arr = arr.filter(t => [t.name, t.douyin, t.contact].some(v => String(v || '').includes(q)));
  for (const k of ['status', 'level', 'owner', 'channel']) {
    const v = ctx.query.get(k);
    if (v) arr = arr.filter(t => t[k] === v);
  }
  const tag = ctx.query.get('tag');
  if (tag) arr = arr.filter(t => (t.tags || []).includes(tag));
  const cat = ctx.query.get('category');
  if (cat) arr = arr.filter(t => (t.categories || []).includes(cat));
  ok(ctx.res, arr.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))));
});

route('GET', '/api/talents/:id', async (ctx) => {
  const talent = await db.get('talents', ctx.params.id);
  if (!talent) return fail(ctx.res, 404, '达人不存在');
  const tasks = (await db.list('tasks')).filter(t => t.talentId === talent.id).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const followups = (await db.list('followups')).filter(f => f.talentId === talent.id).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const completed = tasks.filter(t => t.status === '已完成');
  const uncompleted = tasks.filter(t => ACTIVE_TASK.includes(t.status));
  const lastCoop = tasks.map(t => t.publishedAt || t.contentAt || t.createdAt).filter(Boolean).sort().pop() || '';
  ok(ctx.res, {
    talent, tasks, followups,
    stats: {
      coopCount: talent.coopCount || 0,
      completed: completed.length,
      uncompleted: uncompleted.length,
      fulfillmentRate: tasks.length ? Math.round(completed.length / (completed.length + uncompleted.length) * 100) : (talent.fulfillmentRate || 0),
      totalCommission: completed.reduce((a, b) => a + (+b.commission || 0), 0),
      lastCoopAt: lastCoop,
    },
  });
});

route('POST', '/api/talents', async (ctx) => {
  if (!ctx.role.mutate) return fail(ctx.res, 403, '当前角色无修改权限');
  const b = ctx.body;
  if (!b.name) return fail(ctx.res, 400, '请填写达人昵称');
  const rec = {
    id: await nextId('talents', 'T', 4),
    name: b.name, douyin: b.douyin || '', contact: b.contact || '', channel: b.channel || '其他',
    level: b.level || 'C', status: '待联系', contentTypes: b.contentTypes || [], categories: b.categories || [],
    fans: +b.fans || 0, coopCount: 0, fulfillmentRate: 0, owner: b.owner || ctx.operator,
    tags: b.tags || [], note: b.note || '', lastFollowAt: nowStr(), createdAt: nowStr(),
    rejectReason: '', auditAt: '', auditBy: '', isActive: true,
  };
  await db.insert('talents', rec);
  await addLog(ctx.operator, '达人：' + rec.name, '新增达人', '', '状态=待联系');
  ok(ctx.res, rec);
});

route('PUT', '/api/talents/:id', async (ctx) => {
  if (!ctx.role.mutate) return fail(ctx.res, 403, '当前角色无修改权限');
  const allow = ['douyin', 'contact', 'level', 'contentTypes', 'categories', 'tags', 'owner', 'note', 'fans', 'channel'];
  const patch = {};
  for (const k of allow) if (ctx.body[k] !== undefined) patch[k] = k === 'fans' ? (+ctx.body[k] || 0) : ctx.body[k];
  const updated = await db.update('talents', ctx.params.id, patch);
  await addLog(ctx.operator, '达人：' + updated.name, '编辑资料', '', JSON.stringify(patch));
  ok(ctx.res, updated);
});

route('PATCH', '/api/talents/:id/status', async (ctx) => {
  if (!ctx.role.mutate) return fail(ctx.res, 403, '当前角色无修改权限');
  const talent = await db.get('talents', ctx.params.id);
  if (!talent) return fail(ctx.res, 404, '达人不存在');
  const { status, reason } = ctx.body;
  if (!TALENT_STATUSES.includes(status)) return fail(ctx.res, 400, '非法状态: ' + status);
  if (['已通过', '已拒绝'].includes(status) && !ctx.role.audit) return fail(ctx.res, 403, '审核操作需要主管或管理员权限');
  const patch = { status };
  let after = status;
  if (status === '已通过') { patch.auditAt = nowStr(); patch.auditBy = ctx.operator; after = `已通过（审核人 ${ctx.operator}）`; }
  if (status === '已拒绝') {
    if (!reason) return fail(ctx.res, 400, '请填写拒绝原因');
    patch.rejectReason = reason;
    after = '已拒绝（原因：' + reason + '）';
  }
  await db.update('talents', talent.id, patch);
  await addLog(ctx.operator, '达人：' + talent.name, '状态变更', talent.status, after);
  ok(ctx.res, { ...talent, ...patch });
});

route('POST', '/api/talents/:id/followups', async (ctx) => {
  if (!ctx.role.mutate) return fail(ctx.res, 403, '当前角色无修改权限');
  const talent = await db.get('talents', ctx.params.id);
  if (!talent) return fail(ctx.res, 404, '达人不存在');
  const { content, method, nextAt } = ctx.body;
  if (!content) return fail(ctx.res, 400, '请填写跟进内容');
  const rec = {
    id: await nextId('followups', 'F', 4), talentId: talent.id, talentName: talent.name,
    content, method: method || '微信', nextAt: nextAt || '', operator: ctx.operator, createdAt: nowStr(),
  };
  await db.insert('followups', rec);
  await db.update('talents', talent.id, { lastFollowAt: rec.createdAt });
  await addLog(ctx.operator, '达人：' + talent.name, '添加跟进', '', content.slice(0, 50));
  ok(ctx.res, rec);
});

route('POST', '/api/talents/:id/deactivate', async (ctx) => {
  if (!ctx.role.mutate) return fail(ctx.res, 403, '当前角色无修改权限');
  const talent = await db.get('talents', ctx.params.id);
  if (!talent) return fail(ctx.res, 404, '达人不存在');
  await db.update('talents', talent.id, { isActive: false, status: '暂停合作' });
  await addLog(ctx.operator, '达人：' + talent.name, '停用（逻辑删除）', talent.status, 'isActive=false / 暂停合作');
  ok(ctx.res, { id: talent.id, isActive: false, status: '暂停合作' });
});

// ---------- 寄拍任务 ----------
route('GET', '/api/tasks', async (ctx) => {
  const q = ctx.query.get('q') || '';
  let arr = await db.list('tasks');
  if (q) arr = arr.filter(t => [t.id, t.product, t.talentName, t.trackingNo].some(v => String(v || '').includes(q)));
  for (const k of ['status', 'owner', 'talentId', 'campaignId']) {
    const v = ctx.query.get(k);
    if (v) arr = arr.filter(t => t[k] === v);
  }
  ok(ctx.res, arr.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))));
});

route('POST', '/api/tasks', async (ctx) => {
  if (!ctx.role.mutate) return fail(ctx.res, 403, '当前角色无修改权限');
  const b = ctx.body;
  const talent = b.talentId ? await db.get('talents', b.talentId) : null;
  if (!talent) return fail(ctx.res, 400, '请选择达人');
  if (!b.product) return fail(ctx.res, 400, '请填写商品名称');
  const rec = {
    id: await nextId('tasks', 'TK', 4), campaignId: b.campaignId || '', talentId: talent.id, talentName: talent.name,
    product: b.product, status: '待确认', trackingNo: '', sentAt: '', signedAt: '', contentAt: '', publishedAt: '',
    contentUrl: '', contentNote: '', auditOpinion: '', commission: +b.commission || 0, owner: b.owner || ctx.operator,
    issue: '', createdAt: nowStr(),
  };
  await db.insert('tasks', rec);
  await addLog(ctx.operator, '任务：' + rec.id + ' ' + rec.product, '创建任务', '', `达人=${talent.name} 佣金=${rec.commission}`);
  ok(ctx.res, rec);
});

route('PATCH', '/api/tasks/:id/status', async (ctx) => {
  if (!ctx.role.mutate) return fail(ctx.res, 403, '当前角色无修改权限');
  const task = await db.get('tasks', ctx.params.id);
  if (!task) return fail(ctx.res, 404, '任务不存在');
  const act = ACTIONS[ctx.body.action];
  if (!act) return fail(ctx.res, 400, '未知操作');
  if (act.audit && !ctx.role.audit) return fail(ctx.res, 403, '「' + act.label + '」需要主管或管理员权限');
  if (!act.from.includes(task.status)) return fail(ctx.res, 400, `当前状态「${task.status}」不允许执行「${act.label}」`);
  const patch = {};
  for (const f of act.fields) {
    const v = ctx.body[f.key] !== undefined ? ctx.body[f.key] : task[f.key];
    if (f.required && !String(v || '').trim()) return fail(ctx.res, 400, '请填写「' + f.label + '」');
    patch[f.key] = v;
  }
  let newStatus;
  if (ctx.body.action === 'markException') {
    newStatus = ctx.body.to;
    if (!act.options.includes(newStatus)) return fail(ctx.res, 400, '请选择异常类型');
  } else {
    newStatus = act.to;
  }
  patch.status = newStatus;
  if (act.stamp) patch[act.stamp] = nowStr();
  if (ctx.body.issue || (ctx.body.action === 'cancel' && patch.issue)) {
    patch.issue = (task.issue ? task.issue + '\n' : '') + `[${nowStr()}] ${patch.issue || ctx.body.issue}`;
  }
  await db.update('tasks', task.id, patch);
  await addLog(ctx.operator, '任务：' + task.id + ' ' + task.product, act.label, task.status, newStatus);
  ok(ctx.res, { ...task, ...patch });
});

// ---------- 操作日志 ----------
route('GET', '/api/logs', async (ctx) => {
  const arr = await db.list('logs');
  ok(ctx.res, arr.sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 200));
});

/* ---------------- 静态文件 ---------------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
function serveStatic(req, res, pathname) {
  // 统一入口（增量合并，两套页面同源共存）：
  //   /admin/...        → v1/public（V1 飞书业务后台）
  //   /api/...          → 上方 API 路由（调用前已拦截）
  //   其他（/、/app.js）→ 项目根目录（原 8 页 MVP 演示系统，文件未移动未修改）
  let file;
  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    const rel = pathname.replace(/^\/admin\/?/, '') || 'index.html';
    file = path.join(PUBLIC_DIR, rel);
    if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
  } else {
    file = path.join(LEGACY_DIR, pathname === '/' ? 'index.html' : pathname);
    if (!file.startsWith(LEGACY_DIR)) { res.writeHead(403); return res.end(); }
  }
  fs.readFile(file, (e, d) => {
    if (e) { res.writeHead(404); return res.end('404'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'text/plain; charset=utf-8' });
    res.end(d);
  });
}

/* ---------------- 服务入口 ---------------- */
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  if (!u.pathname.startsWith('/api/')) return serveStatic(req, res, u.pathname);
  try {
    const match = routes.find(r => {
      if (r.method !== req.method) return false;
      const pp = r.pattern.split('/'), up = u.pathname.split('/');
      if (pp.length !== up.length) return false;
      const params = {};
      for (let i = 0; i < pp.length; i++) {
        if (pp[i].startsWith(':')) params[pp[i].slice(1)] = decodeURIComponent(up[i]);
        else if (pp[i] !== up[i]) return false;
      }
      r._params = params;
      return true;
    });
    if (!match) return fail(res, 404, '接口不存在: ' + req.method + ' ' + u.pathname);
    function safeDecode(v, fallback) { if (!v) return fallback; try { return decodeURIComponent(v) || fallback; } catch { return v; } }
    const operator = safeDecode(req.headers['x-operator'], '未知用户');
    const roleName = safeDecode(req.headers['x-role'], '运营');
    const role = ROLES[roleName] || ROLES['运营'];
    const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : {};
    await match.handler({ req, res, query: u.searchParams, params: match._params, body, operator, role });
  } catch (e) {
    console.error('[API Error]', e);
    fail(res, 500, e.message || '服务器内部错误');
  }
});

if (!USE_FEISHU) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(DATA_FILE)) {
    mockDb = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  } else {
    mockDb = seedDb();
    saveDb();
    console.log('已生成种子数据（含「小王」待审核链路）→', DATA_FILE);
  }
}

server.listen(PORT, () => {
  console.log(`MCN 达人培育后台 V1 已启动: http://localhost:${PORT}`);
  console.log(`存储模式: ${USE_FEISHU ? '飞书多维表格' : 'Mock 本地 JSON（配置 FEISHU_* 环境变量后自动切换为飞书）'}`);
});
