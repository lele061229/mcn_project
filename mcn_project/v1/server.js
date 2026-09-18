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
const urlLib = require('url'); // Node 8 兼容：URL 类不在全局，需显式 require
const { readXlsxRows } = require('./lib/xlsx-lite'); // 达人线索 Excel 导入 V1（零依赖 xlsx 读取）

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'db.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const LEGACY_DIR = path.join(__dirname, '..'); // 原 MVP 演示系统（根目录 8 页），保持文件原位、原样服务
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads'); // 报名表单上传的截图（对外以 /uploads/ 访问）

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
    // —— 负责人与分配（分配 ≠ 交接）——
    ownerId: '负责人账号ID', ownerPosition: '负责人所属岗位', assignedAt: '分配时间',
    recruitBy: '招募负责人', recruitById: '招募负责人账号ID',
    // —— 转化留痕（线索 → 正式达人，线索负责人发起）——
    convertedBy: '转化人', convertedById: '转化人账号ID', convertedAt: '转化时间',
    // —— 达人运营负责人（与「线索负责人 owner」区分：招募交接给运营时固化，此后不再随再次交接/分配变化）——
    opsBy: '达人运营负责人', opsId: '达人运营负责人账号ID', opsAt: '转运营时间',
    // —— 跟进计划（工作台待办的判断依据）——
    nextFollowAt: '下次跟进时间',
    // —— 业务评估字段 ——
    potentialLevel: '达人潜力', intentLevel: '合作意愿', talentClass: '达人分类', coopPath: '合作路径',
    incubationFee: '孵化服务费', feeStatus: '服务费收款状态',
    // —— 交接（在线索上留最近一次交接的摘要，完整记录在 handovers 集合）——
    handoverStatus: '交接状态', handoverFrom: '原负责人', handoverFromId: '原负责人账号ID',
    handoverFromPosition: '原岗位', handoverTo: '接收负责人', handoverToId: '接收负责人账号ID',
    handoverToPosition: '接收岗位', handoverReason: '交接原因', handoverNote: '交接说明',
    handoverAt: '交接发起时间', handoverReceivedAt: '交接接收时间', handoverBy: '交接发起人账号',
    // —— 账号运营（得物账号指标；当前手动录入，接入得物平台后由 API 自动同步）——
    dewuId: '得物账号ID', dewuFans: '得物粉丝数', dewuActivity: '信誉等级',
    dewuUpdateDays: '更新频率（天/更）', dewuLastPublish: '最近发布日期', dewuSyncedAt: '数据同步时间', dewuSource: '数据来源',
  },
  tasks: {
    id: '任务ID', campaignId: '商单ID', talentId: '达人ID', talentName: '达人昵称', product: '商品名称',
    status: '任务状态', trackingNo: '快递单号', sentAt: '寄出时间', signedAt: '签收时间',
    contentAt: '内容提交时间', publishedAt: '发布时间', contentUrl: '内容链接', contentNote: '内容说明',
    auditOpinion: '审核意见', commission: '佣金', owner: '运营负责人（任务归属）', ownerId: '运营负责人账号ID', issue: '异常情况', createdAt: '创建时间',
  },
  followups: {
    id: '记录ID', talentId: '达人ID', talentName: '达人昵称', content: '跟进内容',
    method: '跟进方式', nextAt: '下次跟进时间', operator: '操作人', createdAt: '创建时间',
    result: '跟进结果', stage: '跟进时阶段', potentialLevel: '达人潜力', intentLevel: '合作意愿',
    talentClass: '达人分类', operatorId: '操作人账号ID',
  },
  logs: {
    id: '日志ID', operator: '操作人', at: '操作时间', target: '操作对象', type: '操作类型', before: '修改前', after: '修改后',
  },
  // 交接单（岗位交接体系）：一条线索生成一张单，接收人确认后才真正变更负责人
  handovers: {
    id: '交接单ID', talentId: '线索ID', talentName: '达人昵称',
    fromUser: '发起人', fromPosition: '发起岗位', fromUserId: '发起人账号ID',
    toUser: '接收人', toPosition: '接收岗位', toUserId: '接收人账号ID',
    reason: '交接说明', note: '达人当前情况 / 下一步建议', status: '状态',
    operator: '操作人', createdAt: '发起时间', confirmedAt: '确认时间',
  },
};
const DATE_FIELDS = {
  talents: new Set(['lastFollowAt', 'createdAt', 'auditAt', 'assignedAt', 'nextFollowAt', 'handoverAt', 'handoverReceivedAt', 'dewuLastPublish', 'dewuSyncedAt', 'opsAt', 'convertedAt']),
  leads: new Set(['lastFollowAt', 'createdAt', 'auditAt', 'assignedAt', 'nextFollowAt', 'handoverAt', 'handoverReceivedAt', 'opsAt']),
  tasks: new Set(['sentAt', 'signedAt', 'contentAt', 'publishedAt', 'createdAt']),
  followups: new Set(['nextAt', 'createdAt']),
  logs: new Set(['at']),
  handovers: new Set(['createdAt', 'confirmedAt']),
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
    T('T0001', '小王', '合作中', '抖音直播', 'B', 12800, ['女装', '鞋靴'], '李婷', ['新达人'], 2, { coopCount: 0, rate: 0, douyin: 'xiaowang_2026', contact: 'wx_xiaowang99' }),
    T('T0002', '王芳Fiona', '合作中', '私聊邀约', 'A', 86000, ['女装', '鞋靴'], '李婷', ['核心达人', '高履约'], 6, { coopCount: 12, rate: 96 }),
    T('T0003', '阿泽', '合作中', '达人推荐', 'B', 45000, ['男装', '鞋靴'], '王浩', ['男装'], 5, { coopCount: 6, rate: 92 }),
    T('T0004', '桃子peach', '合作中', '抖音直播', 'A', 152000, ['美妆', '女装'], '张萌', ['美妆', '高转化'], 4, { coopCount: 9, rate: 98 }),
    T('T0005', '大熊的鞋柜', '合作中', '表单', 'B', 68000, ['鞋靴', '数码'], '王浩', ['鞋靴'], 4, { coopCount: 5, rate: 88 }),
    T('T0006', '蕾蕾Lena', '合作中', '微信', 'B', 32000, ['女装', '包袋'], '李婷', ['女装'], 3, { coopCount: 4, rate: 100 }),
    T('T0007', '周周有好货', '合作中', '抖音直播', 'C', 21000, ['女装'], '李婷', ['新达人'], 3),
    T('T0008', '小鹿乱撞', '合作中', '表单', 'C', 18000, ['包袋', '手表'], '张萌', ['新达人'], 2),
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
    contentNote: '', auditOpinion: '', commission, owner: extra.owner || '李婷', issue: '', createdAt: extra.createdAt || daysAgo(extra.dAgo === undefined || extra.dAgo === null ? 3 : extra.dAgo, 14),
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
  return { talents, leads: [], tasks, followups, logs };
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
  async remove(coll, id) {
    const before = mockDb[coll].length;
    mockDb[coll] = mockDb[coll].filter(r => String(r.id) !== String(id));
    if (mockDb[coll].length === before) throw new Error('记录不存在: ' + id);
    saveDb();
    return true;
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
  async remove(coll, id) {
    const rec = (await this.list(coll)).find(r => String(r.id) === String(id));
    if (!rec) throw new Error('记录不存在: ' + id);
    await feishuApi('DELETE', `/open-apis/bitable/v1/apps/${ENV.FEISHU_BITABLE_APP_TOKEN}/tables/${TABLES[coll]}/records`, { records: [rec._rid] });
    return true;
  },
};

const db = USE_FEISHU ? feishuStore : mockStore;
async function addLog(operator, target, type, before, after) {
  const arr = await db.list('logs');
  const next = arr.reduce((m, r) => Math.max(m, parseInt(String(r.id).replace(/\D/g, '')) || 0), 0) + 1;
  await db.insert('logs', { id: 'LOG' + String(next).padStart(4, '0'), operator, at: nowStr(), target, type, before: String(before === undefined || before === null ? '' : before), after: String(after === undefined || after === null ? '' : after) });
}
async function nextId(coll, prefix, width) {
  // 线索池（leads）与达人库（talents）共享一个 ID 序列：转化时记录原 ID 迁入达人表，
  // 两个集合的 max 必须一起看，否则转化搬走最大号后序列会回退造成撞号
  const pool = (coll === 'leads' || coll === 'talents')
    ? [...(await db.list('leads')), ...(await db.list('talents'))]
    : await db.list(coll);
  const max = pool.reduce((m, r) => Math.max(m, parseInt(String(r.id).replace(/\D/g, '')) || 0), 0);
  return prefix + String(max + 1).padStart(width, '0');
}

/* ---------------- 数据迁移：补齐岗位与交接字段（幂等，每次启动检查） ----------------
 * owner 存的是一线人员的姓名（李婷/王浩/张萌），这里按姓名回填所属岗位。
 * 新账号在「账号管理」里选岗位后，姓名与岗位即与这边对应上。 */
const OWNER_POSITION = { '李婷': 'recruit', '王浩': 'ops', '张萌': 'senior_ops', '陈晨': 'promote' };
// 预置账号的姓名（其余账号默认取账号名，管理员可在「账号管理」里改）
const SEED_DISPLAY_NAME = { admin: '管理员', 'demo-staff': '王浩', 'demo-finance': '周妍', 'demo-recruit': '李婷', 'demo-senior': '张萌', 'demo-promote': '陈晨' };
const SEED_POSITION = { admin: 'admin', 'demo-staff': 'ops', 'demo-finance': 'finance', 'demo-recruit': 'recruit', 'demo-senior': 'senior_ops', 'demo-promote': 'promote' };
// 无效的负责人占位（早期版本拿不到登录身份时写入的脏数据），迁移时归位为「未分配」
const BAD_OWNERS = ['未知用户', 'undefined', 'null', ''];

/* ---- 账号 ↔ 姓名 互查：负责人一律以账号 ID（ownerId）为准，中文姓名仅用于展示 ----
 * 账号系统的主键就是登录账号名（auth.json 的 user），因此 ownerId = 登录账号名。 */
function userRecByName(name) {
  if (!name) return null;
  return (AUTH && Array.isArray(AUTH.users) ? AUTH.users : []).find(x => x.user === name || nameOf(x) === name) || null;
}
function uidByName(name) { const r = userRecByName(name); return r ? r.user : ''; }
function posByName(name) { const r = userRecByName(name); return r ? (r.position || '') : (OWNER_POSITION[name] || ''); }
function seedTalentFields(t, isTalent) {
  // outcome 为 true 表示确实补了字段（用于日志计数）
  let n = 0;
  // —— 达人生命周期 + 运营负责人（talent_status / talent_operator 的库内驼峰字段）——
  // 正式达人库默认陪跑达人；线索池默认线索达人；运营负责人优先取固化的 opsBy
  if (!TALENT_STATUS.includes(t.talentStatus)) { t.talentStatus = isTalent ? 'coaching' : 'lead'; n++; }
  if (t.talentOperator === undefined) { t.talentOperator = t.opsBy || ''; n++; }
  if (BAD_OWNERS.includes(t.owner)) { t.owner = '未分配'; n++; }
  // 注意：用 falsy 判断而不是 undefined —— 历史上若账号晚于线索创建，
  // 首次迁移会写下 ownerId:''，之后必须能被后续启动重新补上（自愈）
  if (!t.ownerId && t.owner && t.owner !== '未分配') {
    const id = uidByName(t.owner);
    if (id) { t.ownerId = id; n++; }
  }
  if (t.ownerPosition === undefined || t.ownerPosition === '') {
    const p = (t.owner && t.owner !== '未分配') ? posByName(t.owner) : '';
    if (p) { t.ownerPosition = p; n++; }
  }
  if (t.assignedAt === undefined) { t.assignedAt = (t.owner && t.owner !== '未分配') ? (t.createdAt || '') : ''; n++; }
  // —— 跟进 SLA 字段（首次联系时限）——
  // 历史线索用 slaExempt 显式豁免（上线时由一次性脚本打标），不参与首次联系考核，
  // 避免「功能一上线，存量线索全部超时」的误伤；重新分配/重新指派会清掉这个标记。
  if (t.slaExempt === undefined) { t.slaExempt = false; n++; }
  if (t.firstContactAt === undefined) { t.firstContactAt = ''; n++; }
  if (t.lastFollowupAt === undefined) { t.lastFollowupAt = t.lastFollowAt || ''; n++; }
  if (t.escalatedAt === undefined) { t.escalatedAt = ''; n++; }
  if (t.escalatedBy === undefined) { t.escalatedBy = ''; n++; }
  if (t.reassignedAt === undefined) { t.reassignedAt = ''; n++; }
  if (t.reassignFrom === undefined) { t.reassignFrom = ''; n++; }
  if (t.reassignReason === undefined) { t.reassignReason = ''; n++; }
  if (t.overdueReason === undefined) { t.overdueReason = ''; n++; }
  if (t.overdueReasonAt === undefined) { t.overdueReasonAt = ''; n++; }
  if (t.urgeCount === undefined) { t.urgeCount = 0; n++; }
  if (t.urgedAt === undefined) { t.urgedAt = ''; n++; }
  if (t.urgeBy === undefined) { t.urgeBy = ''; n++; }
  if (t.urgeNote === undefined) { t.urgeNote = ''; n++; }
  if (t.recruitBy === undefined) { t.recruitBy = ''; n++; }
  if (t.recruitById === undefined) { t.recruitById = ''; n++; }
  if (t.nextFollowAt === undefined) { t.nextFollowAt = ''; n++; }
  if (t.potentialLevel === undefined) { t.potentialLevel = '待判断'; n++; }
  if (t.intentLevel === undefined) { t.intentLevel = '待判断'; n++; }
  if (t.talentClass === undefined) { t.talentClass = '待分类'; n++; }
  if (t.handoverFrom === undefined) { t.handoverFrom = ''; n++; }
  if (t.handoverFromId === undefined) { t.handoverFromId = ''; n++; }
  if (t.handoverFromPosition === undefined) { t.handoverFromPosition = ''; n++; }
  if (t.handoverToId === undefined) { t.handoverToId = ''; n++; }
  if (t.handoverReason === undefined) { t.handoverReason = ''; n++; }
  if (t.handoverNote === undefined) { t.handoverNote = ''; n++; }
  if (t.handoverReceivedAt === undefined) { t.handoverReceivedAt = ''; n++; }
  if (t.handoverStatus === undefined) { Object.assign(t, emptyHandoverState()); n++; }
  // —— 账号运营指标：按已有资料推一版演示值（接入得物平台后由 API 同步覆盖）——
  if (t.dewuId === undefined) { t.dewuId = t.id ? ('DWU' + String(t.id).replace(/\D/g, '').padStart(6, '0')) : ''; n++; }
  if (t.dewuFans === undefined) {
    const h = [...String(t.id)].reduce((s, c) => (s * 31 + c.charCodeAt(0)) % 9973, 7);
    t.dewuFans = Number(t.fans) || (1200 + (h % 48) * 950); n++;
  }
  if (t.dewuActivity === undefined) {
    const h = [...String(t.id)].reduce((s, c) => (s * 17 + c.charCodeAt(0)) % 97, 3);
    t.dewuActivity = h % 3 === 0 ? '高' : (h % 3 === 1 ? '中' : '低'); n++;
  }
  if (t.dewuUpdateDays === undefined) { const h = [...String(t.id)].reduce((s, c) => (s * 13 + c.charCodeAt(0)) % 89, 5); t.dewuUpdateDays = [3, 7, 14][h % 3]; n++; }
  if (t.dewuLastPublish === undefined) {
    const h = [...String(t.id)].reduce((s, c) => (s * 29 + c.charCodeAt(0)) % 101, 11);
    const d = new Date(Date.now() - (h % 21) * 86400000);
    t.dewuLastPublish = t.owner && t.owner !== '未分配' ? fmtDate(d) : ''; n++;
  }
  if (t.dewuSyncedAt === undefined) { t.dewuSyncedAt = ''; n++; }
  if (t.dewuSource === undefined) { t.dewuSource = t.dewuId ? 'manual' : ''; n++; }
  // —— 达人评级（talentLevel）：老数据从既有 level 回填；没有 level 的按「正式达人=B / 线索=待判断」给默认 ——
  // 注意「待判断」是合法值（新报名线索初始态），不能被这里覆写回 C；存量已有评级的数据不受影响
  if (!TALENT_LEVEL_ANY.includes(t.talentLevel)) {
    t.talentLevel = TALENT_LEVEL_ANY.includes(t.level) ? t.level : (isTalent ? 'B' : TALENT_LEVEL_UNSET);
    n++;
  }
  if (!TALENT_LEVEL_ANY.includes(t.level)) { t.level = t.talentLevel; n++; }   // level 镜像，保持 SLA 高潜口径与评级一致
  return n;
}
function migrateDb() {
  if (USE_FEISHU) return;
  let n = 0;
  if (!Array.isArray(mockDb.handovers)) { mockDb.handovers = []; n++; }
  // —— 中台升级新增集合（幂等）：运营成长任务 / 爆款拆解库 ——
  if (!Array.isArray(mockDb.opsTasks)) { mockDb.opsTasks = []; n++; }
  if (!Array.isArray(mockDb.hitCases)) { mockDb.hitCases = []; n++; }
  // —— 拆表迁移（幂等）：leads=线索池，talents=正式达人库 ——
  // 只有 合作中/暂停合作 算正式达人，其余状态全部搬去线索池；记录保留原 ID 迁移，跟进记录/操作日志引用不断链
  const TALENT_ONLY_STATUS = ['合作中', '暂停合作'];
  if (!Array.isArray(mockDb.leads)) { mockDb.leads = []; n++; }
  {
    const stay = [], move = [];
    for (const t of (mockDb.talents || [])) (TALENT_ONLY_STATUS.includes(t.status) ? stay : move).push(t);
    if (move.length) {
      const exist = new Set(mockDb.leads.map(x => x.id));
      for (const t of move) if (!exist.has(t.id)) mockDb.leads.push(t);
      mockDb.talents = stay;
      n += move.length;
      console.log('[迁移] 线索池/达人库拆分：' + move.length + ' 条线索移入 leads，达人库保留 ' + stay.length + ' 条正式达人');
    }
  }
  for (const t of (mockDb.talents || [])) n += seedTalentFields(t, true);
  for (const t of (mockDb.leads || [])) n += seedTalentFields(t, false);
  // 交接单补账号 ID（老单只有中文姓名）
  for (const h of (mockDb.handovers || [])) {
    if (h.fromUserId === undefined) { h.fromUserId = uidByName(h.fromUser); n++; }
    if (h.toUserId === undefined) { h.toUserId = uidByName(h.toUser); n++; }
    if (h.note === undefined) { h.note = ''; n++; }
  }
  // 任务记录补归属人账号 ID（历史执行人字段沿用 owner，不改达人归属）
  for (const k of (mockDb.tasks || [])) {
    if (k.ownerId === undefined) { k.ownerId = k.owner ? uidByName(k.owner) : ''; n++; }
    // 任务类型：历史任务全部是寄拍任务，补默认值保证旧数据可读（不改任何既有字段含义）
    if (!TASK_TYPES.includes(k.taskType)) { k.taskType = 'shoot'; n++; }
  }
  // 「达人运营负责人」自愈：已有数据里负责人岗位已是运营的，回推固化 opsBy/opsId（只补一次）
  for (const t of (mockDb.talents || [])) {
    if (!t.opsId && t.ownerPosition === 'ops' && t.owner && t.owner !== '未分配') {
      t.opsBy = t.owner;
      t.opsId = t.ownerId || uidByName(t.owner);
      if (!t.opsAt) t.opsAt = t.assignedAt || t.handoverReceivedAt || '';
      n++;
    }
  }
  if (n) { saveDb(); console.log('[迁移] 线索负责人ID / 分配 / 跟进计划 / 交接字段补齐 ' + n + ' 处'); }
  // 账号补默认姓名与岗位：姓名决定「我负责的线索」，岗位决定「本岗位池」
  let an = 0;
  for (const u of (AUTH && Array.isArray(AUTH.users) ? AUTH.users : [])) {
    if (u.displayName === undefined) { u.displayName = SEED_DISPLAY_NAME[u.user] || u.user; an++; }
    if (!u.position && SEED_POSITION[u.user]) { u.position = SEED_POSITION[u.user]; an++; }
    else if (u.position === undefined) { u.position = u.role === 'admin' ? 'admin' : (u.role === 'finance' ? 'finance' : ''); an++; }
  }
  if (an) { saveAuth(); console.log('[迁移] 账号姓名 / 岗位补齐 ' + an + ' 处'); }
}

/* ---------------- 权限（V1 简易版） ---------------- */
const ROLES = {
  '运营': { mutate: true, audit: false },
  '主管': { mutate: true, audit: true },
  '财务': { mutate: false, audit: false },
  '管理员': { mutate: true, audit: true },
};
// 会话角色码 → ROLES 键：权限对象一律按 token 里的角色取，不信任前端请求头
const ROLE_KEY = { admin: '管理员', staff: '运营', finance: '财务' };

/* ---------------- HTTP 工具 ---------------- */
function json(res, code, data) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); }
function ok(res, data) { json(res, 200, { ok: true, data }); }
function fail(res, code, msg) { json(res, code, { ok: false, error: msg }); }
function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', c => { s += c; if (s.length > 1e6) reject(new Error('请求体过大')); });
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch (e2) { reject(new Error('JSON 格式错误')); } });
    req.on('error', reject);
  });
}

/* ---------------- multipart/form-data 读取（文件上传用，零依赖） ---------------- */
function readMultipart(req, maxBytes = 10 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0, done = false;
    req.on('data', c => {
      size += c.length;
      if (size > maxBytes) { done = true; reject(new Error('上传文件过大（上限 10MB）')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (done) return;
      try {
        const buf = Buffer.concat(chunks);
        const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(req.headers['content-type'] || '');
        if (!m) throw new Error('请求不是 multipart/form-data（缺少 boundary）');
        const boundary = Buffer.from('--' + (m[1] || m[2]).trim());

        // 按 boundary 切分：第 0 段是前缀，最后一段以 "--" 结束
        const segs = [];
        let start = 0, idx;
        while ((idx = buf.indexOf(boundary, start)) !== -1) { segs.push(buf.slice(start, idx)); start = idx + boundary.length; }
        segs.push(buf.slice(start));

        const fields = {}, files = [];
        for (let i = 1; i < segs.length; i++) {
          let p = segs[i];
          if (p.length >= 2 && p[0] === 0x2d && p[1] === 0x2d) break; // 结束标记
          if (p.length >= 2 && p[0] === 0x0d && p[1] === 0x0a) p = p.slice(2); // 段首 CRLF
          const headEnd = p.indexOf('\r\n\r\n');
          if (headEnd < 0) continue;
          const head = p.slice(0, headEnd).toString('utf8');
          let body = p.slice(headEnd + 4);
          if (body.length >= 2 && body[body.length - 2] === 0x0d && body[body.length - 1] === 0x0a) body = body.slice(0, -2);
          const nameM = /name="([^"]*)"/i.exec(head);
          // 兼容 filename="x.xlsx" 与 filename*=UTF-8''x.xlsx 两种写法
          const fileStar = /filename\*=(?:[^']*'')?([^;\r\n]+)/i.exec(head);
          const filePlain = /filename="([^"]*)"/i.exec(head);
          if (fileStar || filePlain) {
            const filename = fileStar ? decodeURIComponent(fileStar[1].trim()) : filePlain[1];
            files.push({ field: nameM ? nameM[1] : 'file', filename, contentType: (/Content-Type:\s*([^\r\n]+)/i.exec(head) || [])[1] || '', data: body });
          } else if (nameM) {
            fields[nameM[1]] = body.toString('utf8');
          }
        }
        resolve({ fields, files });
      } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

/* ---------------- API 路由 ---------------- */
const routes = [];
function route(method, pattern, handler) { const r = { method, pattern, handler, multipart: false }; routes.push(r); return r; }

// 元信息：存储模式 / 状态列表 / 任务操作定义（前端据此渲染操作按钮）
route('GET', '/api/meta', (ctx) => {
  ok(ctx.res, { mode: db.mode, TALENT_STATUSES, TASK_STATUSES, ACTIVE_TASK, ACTIONS });
});

// ---------- Dashboard ----------
route('GET', '/api/dashboard', async (ctx) => {
  const talents = await listLeadsAndTalents();
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
  // 行级权限：管理员看全部，其余岗位最多看「本岗位池 + 我负责的 + 待我接收的」（与线索页同一裁决口径）
  if (ctx.roleCode !== 'admin') arr = arr.filter(t => leadVisibleTo(t, ctx, 'position'));
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

// ---------- MVP 演示页·线索看板（复用达人库真实数据，两套页面同一个库） ----------
const MVP_STAGE_MAP = {
  '待联系': '新线索', '已联系': '已联系', '有意向': '有意向',
  '待审核': '已报名', '已通过': '已报名',
  '合作中': '已成为达人', '暂停合作': '已成为达人', '已流失': '无效线索',
};
const MVP_STAGE_REVERSE = {
  '新线索': '待联系', '已联系': '已联系', '有意向': '有意向',
  '已报名': '待审核', '已成为达人': '合作中', '无效线索': '已流失',
};
/* ============================================================
 * 岗位与数据可见范围（权限体系）
 * 角色 role      → 能进哪些页面 / 能调哪些接口（原有机制）
 * 岗位 position  → 能看哪些数据行（本次新增）
 * 可见范围一律在服务端裁决，前端只负责展示，越权请求自动降级
 * ============================================================ */
const POSITIONS = ['promote', 'recruit', 'ops', 'senior_ops', 'finance'];
const POSITION_LABEL = { recruit: '招募', ops: '普通运营', senior_ops: '高级运营', promote: '推广', finance: '财务', admin: '管理员', '': '未设置' };
// 达人（线索）只能由这两个岗位持有：招募（一线对接）→ 运营（长期管理）。
// 高级运营管质量/分配任务、财务岗只管结算，都不做达人负责人（分配/交接时服务端强校验）。
const OWNER_POSITIONS = ['recruit', 'ops'];
// —— 达人生命周期（2026-09-17 业务模型调整）——
// talent_status 五阶段：线索达人 → 陪跑达人 → 重点培养达人 → 公司签约达人 → 公司直属达人
// 库内沿用全项目驼峰命名约定：talent_status → talentStatus（对应 API / 展示字段）
const TALENT_STATUS = ['lead', 'coaching', 'potential', 'contracted', 'company_owned'];
const TALENT_STATUS_LABEL = { lead: '线索达人', coaching: '陪跑达人', potential: '重点培养达人', contracted: '公司签约达人', company_owned: '公司直属达人' };
// —— 达人评级（2026-09-17 中台升级新增）——
// A 高价值 / B 培养中 / C 普通 / D 沉默；纯展示与排序维度，不参与权限判断。
// 与既有 level 字段关系：talentLevel 是展示主字段，写入时同步镜像到 level（SLA 高潜判定沿用 level，保持口径一致）。
const TALENT_LEVELS = ['A', 'B', 'C', 'D'];
const TALENT_LEVEL_LABEL = { A: 'A 高价值', B: 'B 培养中', C: 'C 普通', D: 'D 沉默' };
// 「待判断」= 尚无运营判断（新报名/新线索初始态，2026-09-18 字段分层）；合法展示值，不参与 SLA 高潜口径（level==='A' 判定不受影响）
const TALENT_LEVEL_UNSET = '待判断';
const TALENT_LEVEL_ANY = TALENT_LEVELS.concat([TALENT_LEVEL_UNSET]);
TALENT_LEVEL_LABEL[TALENT_LEVEL_UNSET] = '待判断';
// —— 任务中心任务类型（2026-09-17）——
// shoot 寄拍任务（达人本人完成，走寄拍状态机）/ content 内容任务（运营指导达人产出内容）/ growth 运营成长任务（高级运营分配，见 opsTasks 集合）
const TASK_TYPES = ['shoot', 'content', 'growth'];
const TASK_TYPE_LABEL = { shoot: '寄拍任务', content: '内容任务', growth: '运营成长任务' };
// 运营成长任务（高级运营 → 普通运营 的「运营方法沉淀/方向验证」类任务，独立集合 opsTasks）
// 结构：title/contentDirection/productType/reason/talentIds[]/owner/ownerId/dueAt/status
const OPS_TASK_STATUSES = ['待开始', '进行中', '已完成', '已取消'];
// 主管视角：管理员（老板）或高级运营 —— 高级运营可跨运营负责人查看/管理达人，可催办/重新分配/分配任务
const isSupervisor = ctx => ctx.roleCode === 'admin' || ctx.position === 'senior_ops';
const posLabel = p => POSITION_LABEL[p] || '未设置';
// 判断字段（评级/潜力/意愿/分类/路径）修改权限：普通运营 / 高级运营 / 管理员 —— 招募只收集报名信息，不做业务判断
const canJudgeLead = ctx => isSupervisor(ctx) || ctx.position === 'ops';
// 账号显示名：auth.json 的 displayName（与 talents.owner 存的人名对应），缺省退回账号名
const nameOf = rec => (rec && (rec.displayName || rec.user)) || '';
// 是否「我负责的」：优先按账号 ID 比对（ownerId ⇄ 登录账号），老数据回退到中文姓名比对
function isMine(t, ctx) {
  if (ctx.authUser && t.ownerId) return t.ownerId === ctx.authUser;
  return !!ctx.displayName && t.owner === ctx.displayName;
}
// 是否「待我接收」的交接
function isPendingForMe(t, ctx) {
  if (t.handoverStatus !== 'pending') return false;
  if (ctx.authUser && t.handoverToId) return t.handoverToId === ctx.authUser;
  return !!ctx.displayName && t.handoverTo === ctx.displayName;
}
// 请求的 scope 由角色裁决：管理员可看全部，其余人最多到「本岗位池」
function resolveScope(ctx, want) {
  if (isSupervisor(ctx)) return ['all', 'position', 'mine'].includes(want) ? want : 'all';  // 主管默认看全部
  return want === 'position' ? 'position' : 'mine';
}
// 单条线索是否对 ctx 可见（服务端唯一裁决点，前端不参与权限判断）
function leadVisibleTo(t, ctx, scope) {
  if (isSupervisor(ctx)) return true;                          // 老板/高级运营：跨运营负责人看全部
  if (isPendingForMe(t, ctx)) return true;                     // 待我确认的交接
  const mine = isMine(t, ctx);                                 // 我负责的
  if (scope === 'position') return mine || (!!ctx.position && t.ownerPosition === ctx.position);
  return mine;
}
// 是否有权改动这条线索（负责人本人或主管：管理员/高级运营）
function canTouchLead(t, ctx) {
  if (isSupervisor(ctx)) return true;
  return isMine(t, ctx);
}
function emptyHandoverState() {
  return {
    handoverStatus: 'none', handoverFrom: '', handoverFromId: '', handoverFromPosition: '',
    handoverTo: '', handoverToId: '', handoverToPosition: '',
    handoverReason: '', handoverNote: '', handoverAt: '', handoverReceivedAt: '', handoverBy: '',
  };
}
/* ============================================================
 * 线索跟进 SLA（首次联系时限）——「提醒 → 上报 → 主管确认重新分配」
 *   计时起点：assignedAt（管理员分配 / 新建挂自己名下 / 交接接收 三处都会刷新）
 *   普通线索：30 分钟未首次联系 → 提醒负责人；60 分钟 → 超时并自动上报主管
 *   高潜强意愿（等级 A / 潜力高 / 意愿强）：更严格  10 / 30 分钟
 *   ⚠ 设计红线：系统**不自动换负责人**。超时只做「标记 + 上报」，
 *     换人必须由主管（管理员）确认后走 reassign 接口，人工闭环可追溯。
 *   字段口径（项目统一 camelCase，对应需求里的 snake_case）：
 *     firstContactAt  = first_contact_at   首次联系时间（首次跟进时落库，SLA 完成标志）
 *     lastFollowupAt  = last_followup_at   最近一次跟进时间（每次跟进刷新）
 *     escalatedAt     = escalated_at       超时自动上报主管的时间
 *     reassignedAt    = reassigned_at      主管重新分配的时间
 *     slaStatus       = sla_status         读时派生：none/done/normal/remind/overdue
 * ============================================================ */
const SLA_NORMAL = { remindMin: 30, overdueMin: 60 };
const SLA_STRICT = { remindMin: 10, overdueMin: 30 };
// 历史线索豁免：SLA 上线前的存量线索带 slaExempt=true（一次性数据标记，不做日期判断——
// 日期判断会把"今天上线前新建的线索"也误伤）。规则见 migrateDb 与重新分配（换人即恢复考核）。
// 已成交 / 已流失的线索不再考核「首次联系」
const SLA_DONE_STATUS = ['合作中', '暂停合作'];
// 高潜强意愿线索用严格 SLA
function isHotLead(t) {
  return t.level === 'A' || t.potentialLevel === '高' || t.intentLevel === '强';
}
function slaRuleOf(t) { return isHotLead(t) ? SLA_STRICT : SLA_NORMAL; }
function msOf(s) { const n = new Date(String(s || '').replace(' ', 'T')).getTime(); return isNaN(n) ? 0 : n; }
function minSince(s) { const n = msOf(s); return n ? Math.floor((Date.now() - n) / 60000) : -1; }
// SLA 状态派生（不落库，和 opsPending/overdue 同一套路：数据一变口径自动对）
function slaOf(t) {
  const hot = isHotLead(t);
  const rule = slaRuleOf(t);
  const base = {
    slaLevel: hot ? 'strict' : 'normal',
    slaRemindMin: rule.remindMin, slaOverdueMin: rule.overdueMin,
    slaRuleLabel: hot ? '高潜强意愿 · ' + rule.remindMin + '/' + rule.overdueMin + ' 分钟' : '普通 · ' + rule.remindMin + '/' + rule.overdueMin + ' 分钟',
    firstContactAt: String(t.firstContactAt || ''), lastFollowupAt: String(t.lastFollowupAt || ''),
    escalatedAt: String(t.escalatedAt || ''), escalatedBy: t.escalatedBy || '',
    reassignedAt: String(t.reassignedAt || ''), reassignReason: t.reassignReason || '',
    overdueReason: t.overdueReason || '', overdueReasonAt: String(t.overdueReasonAt || ''),
    urgeCount: Number(t.urgeCount) || 0, urgedAt: String(t.urgedAt || ''), urgeBy: t.urgeBy || '', urgeNote: t.urgeNote || '',
    slaDeadline: '', slaUsedMin: -1, slaRemainMin: -1, slaOverdueMinute: 0,
  };
  // 不适用：公海未分配 / 没有分配时间 / 已成交或已流失 / SLA 上线前的历史线索
  if (!t.owner || t.owner === '未分配' || !t.assignedAt || SLA_DONE_STATUS.includes(t.status)) {
    return Object.assign(base, { slaStatus: 'none' });
  }
  if (t.slaExempt) return Object.assign(base, { slaStatus: 'exempt' });
  const deadline = fmtDateTime(new Date(msOf(t.assignedAt) + rule.overdueMin * 60000));
  // 已完成：有首次联系时间（记录用了多久）
  if (t.firstContactAt) {
    return Object.assign(base, {
      slaStatus: 'done', slaDeadline: deadline,
      slaUsedMin: Math.max(0, Math.floor((msOf(t.firstContactAt) - msOf(t.assignedAt)) / 60000)),
      slaRemainMin: 0,
    });
  }
  const used = Math.max(0, minSince(t.assignedAt));
  const status = used >= rule.overdueMin ? 'overdue' : (used >= rule.remindMin ? 'remind' : 'normal');
  return Object.assign(base, {
    slaStatus: status, slaDeadline: deadline, slaUsedMin: used,
    slaRemainMin: Math.max(0, rule.overdueMin - used),
    slaOverdueMinute: status === 'overdue' ? used - rule.overdueMin : 0,
  });
}
/* 惰性 SLA 扫描：没有定时任务（零依赖单进程），改为在「读列表 / 工作台 / 看板」时顺手检查。
   只对「已超时且还没上报」的线索写一次 escalatedAt（幂等：已有值就跳过），
   同时把负责人写进 escalatedBy 之外的 escalatedTo（主管=管理员）并推通知。 */
async function slaSweep(rows) {
  const nowT = nowStr();
  let n = 0;
  for (const t of rows) {
    if (!t || t.isActive === false) continue;
    if (!t.owner || t.owner === '未分配' || !t.assignedAt) continue;
    if (t.firstContactAt || t.escalatedAt) continue;          // 已联系 / 已上报 → 幂等跳过
    if (t.slaExempt) continue;                                // 历史线索不考核
    if (SLA_DONE_STATUS.includes(t.status)) continue;
    const rule = slaRuleOf(t);
    if (minSince(t.assignedAt) < rule.overdueMin) continue;    // 还没到超时线
    const { coll } = await findLeadOrTalent(t.id);
    if (!coll) continue;
    await db.update(coll, t.id, {
      escalatedAt: nowT, escalatedBy: '系统', slaStatus: 'overdue',
      slaRule: rule.overdueMin,
    });
    await addLog('系统', '达人：' + t.name, 'SLA 超时上报',
      '负责人=' + t.owner + '(' + posLabel(t.ownerPosition) + ')',
      '分配后 ' + rule.overdueMin + ' 分钟内未首次联系（' + (isHotLead(t) ? '高潜强意愿严格 SLA' : '普通 SLA') + '），已上报主管待处理；系统不自动换负责人');
    notify('SLA 超时：' + t.name + ' 分配后 ' + rule.overdueMin + ' 分钟仍未首次联系（负责人 ' + t.owner + '），请主管催办或重新分配');
    t.escalatedAt = nowT; t.escalatedBy = '系统'; t.slaStatus = 'overdue';
    n++;
  }
  return n;
}
function toMvpLead(t) {
  return {
    id: t.id, name: t.name, channel: t.channel || '其他',
    contact: t.contact || t.douyin || '未填写',
    owner: t.owner || '未分配', ownerId: t.ownerId || '',
    ownerPosition: t.ownerPosition || '',
    ownerPositionLabel: posLabel(t.ownerPosition),
    recruitBy: t.recruitBy || '', recruitById: t.recruitById || '',
    // 转化留痕：线索负责人把线索转为正式达人时固化（谁转的、什么时候转的）
    convertedBy: t.convertedBy || '', convertedById: t.convertedById || '', convertedAt: String(t.convertedAt || ''),
    // 达人运营负责人：与「当前负责人 owner」区分（owner 会随再次交接变化，opsBy 是转入运营时固化的归属）
    opsBy: t.opsBy || '', opsId: t.opsId || '', opsAt: String(t.opsAt || ''),
    // 达人生命周期（talent_status）+ 运营负责人（talent_operator）：2026-09-17 业务模型调整
    talentStatus: TALENT_STATUS.includes(t.talentStatus)
      ? t.talentStatus
      : (['合作中', '暂停合作'].includes(t.status) ? 'coaching' : 'lead'),
    talentOperator: t.talentOperator || t.opsBy || '',
    // 待运营接收：已转正式（合作中）但负责人还是招募岗、且没固化运营负责人 → 等待招募发起交接给运营
    opsPending: ['合作中', '暂停合作'].includes(t.status) && t.ownerPosition !== 'ops' && !t.opsId,
    assignedAt: String(t.assignedAt || ''),
    // 跟进 SLA：首次联系时限相关的派生字段（详见文件上方 slaOf 注释）
    ...slaOf(t),
    level: t.level || 'C',
    // 达人评级（A 高价值 / B 培养中 / C 普通 / D 沉默）：展示主字段，与 level 保持镜像
    talentLevel: TALENT_LEVEL_ANY.includes(t.talentLevel) ? t.talentLevel : (TALENT_LEVEL_ANY.includes(t.level) ? t.level : 'C'),
    talentLevelLabel: TALENT_LEVEL_LABEL[t.talentLevel] || TALENT_LEVEL_LABEL[t.level] || 'C 普通',
    status: MVP_STAGE_MAP[t.status] || '新线索',
    lastFollow: String(t.lastFollowAt || '').slice(0, 16),
    nextFollow: String(t.nextFollowAt || '').slice(0, 16),
    note: t.note || '',
    tags: t.tags || [], createdAt: String(t.createdAt || ''), recruit: t.recruit || null,
    potentialLevel: t.potentialLevel || '待判断', intentLevel: t.intentLevel || '待判断',
    talentClass: t.talentClass || '待分类',
    coopPath: t.coopPath || '待判断',
    incubationFee: Number(t.incubationFee) || 0, feeStatus: t.feeStatus || '未收',
    handoverStatus: t.handoverStatus || 'none',
    handoverFrom: t.handoverFrom || '', handoverFromPosition: t.handoverFromPosition || '',
    handoverFromPositionLabel: posLabel(t.handoverFromPosition),
    handoverTo: t.handoverTo || '', handoverToId: t.handoverToId || '',
    handoverToPosition: t.handoverToPosition || '',
    handoverToPositionLabel: posLabel(t.handoverToPosition),
    handoverReason: t.handoverReason || '', handoverNote: t.handoverNote || '',
    handoverRisk: t.handoverRisk || '',
    handoverAt: t.handoverAt || '', handoverReceivedAt: t.handoverReceivedAt || '',
    handoverBy: t.handoverBy || '',
  };
}
route('GET', '/api/mvp/leads', async (ctx) => {
  const arr = await db.list('leads');
  // 可见范围由服务端裁决：管理员可要 all/position/mine，其他人最多到「本岗位池」
  const scope = resolveScope(ctx, ctx.query.get('scope'));
  let rows = arr.filter(t => t.isActive !== false).filter(t => leadVisibleTo(t, ctx, scope));
  // 附加筛选（只在「已授权的可见集合」上再收窄，不会扩大权限）
  const q = ctx.query;
  const fOwner = q.get('owner') || '';
  if (fOwner) rows = rows.filter(t => t.owner === fOwner || t.ownerId === fOwner);
  const fPos = q.get('position') || '';
  if (fPos) rows = rows.filter(t => (t.ownerPosition || '') === fPos);
  if (q.get('unassigned') === '1') rows = rows.filter(t => !t.owner || t.owner === '未分配');
  if (q.get('handover') === '1') rows = rows.filter(t => t.handoverStatus === 'pending');
  if (q.get('overdue') === '1') {
    const today = fmtDate(new Date());
    rows = rows.filter(t => t.nextFollowAt && String(t.nextFollowAt).slice(0, 10) < today && t.status !== '已成为达人');
  }
  // SLA 筛选（读时派生，先扫描上报再筛）
  await slaSweep(rows);
  if (q.get('slaOverdue') === '1') rows = rows.filter(t => slaOf(t).slaStatus === 'overdue');
  if (q.get('slaRemind') === '1') rows = rows.filter(t => slaOf(t).slaStatus === 'remind');
  if (q.get('slaEscalated') === '1') rows = rows.filter(t => slaOf(t).slaStatus === 'overdue' && t.escalatedAt);
  ok(ctx.res, rows.map(toMvpLead));
});
// 单条线索（越权直接 403，不依赖前端隐藏）
route('GET', '/api/mvp/leads/:id', async (ctx) => {
  const t = await db.get('leads', ctx.params.id);
  if (!t) return fail(ctx.res, 404, '线索不存在');
  if (!leadVisibleTo(t, ctx, 'position')) return fail(ctx.res, 403, '无权查看该线索');
  ok(ctx.res, toMvpLead(t));
});
route('POST', '/api/mvp/leads', async (ctx) => {
  if (!ctx.role.mutate) return fail(ctx.res, 403, '当前角色无修改权限');
  const b = ctx.body;
  if (!b.name) return fail(ctx.res, 400, '请填写昵称/姓名');
  // 负责人：管理员可指定，其他人新建的线索只能挂在自己名下（同时写入所属岗位）
  const selfName = ctx.displayName || ctx.operator;
  const owner = (ctx.roleCode === 'admin' && b.owner) ? b.owner : (selfName || '未分配');
  const ownerPosition = (ctx.roleCode === 'admin' && b.ownerPosition) ? b.ownerPosition : (ctx.position || '');
  const rec = {
    id: await nextId('leads', 'T', 4),
    name: b.name, douyin: '', contact: b.contact || '', channel: b.channel || '其他',
    // 评级=判断字段（2026-09-18 分层）：创建者可判（运营/高级运营/管理员）时接受显式指定，否则一律「待判断」
    level: (canJudgeLead(ctx) && TALENT_LEVEL_ANY.includes(b.level)) ? b.level : TALENT_LEVEL_UNSET, status: '待联系', contentTypes: [], categories: [],
    fans: 0, coopCount: 0, fulfillmentRate: 0, owner, ownerId: uidByName(owner), ownerPosition,
    assignedAt: (owner && owner !== '未分配') ? nowStr() : '',
    tags: [], note: b.note || '', lastFollowAt: nowStr(), createdAt: nowStr(),
    potentialLevel: '待判断', intentLevel: '待判断', talentClass: '待分类',
    coopPath: '待判断', incubationFee: 0, feeStatus: '未收', nextFollowAt: '',
    talentStatus: 'lead', talentLevel: (canJudgeLead(ctx) && TALENT_LEVEL_ANY.includes(b.level)) ? b.level : TALENT_LEVEL_UNSET,
    talentOperator: (ownerPosition === 'ops' && owner && owner !== '未分配') ? owner : '',
    rejectReason: '', auditAt: '', auditBy: '', isActive: true,
    ...emptyHandoverState(),
  };
  await db.insert('leads', rec);
  await addLog(ctx.operator, '达人：' + rec.name, '新增线索', '', '状态=待联系；负责人=' + owner + '（' + posLabel(ownerPosition) + '）');
  ok(ctx.res, toMvpLead(rec));
});

/* ============================================================
 * 线索分配（分配 ≠ 交接）
 *   分配：线索还没被处理过（新线索阶段），管理员直接指派负责人 → 立即生效
 *   交接：线索已在处理中，需要转岗位 → 接收人确认后才生效（见下方 handovers）
 * 两者都写操作日志，但语义与流程不同，所以是两个接口。
 * ============================================================ */
// 把一批线索的负责人改成指定人；返回 { changed: [...], skipped: [...] }
// remark：分配备注（写入独立分配记录 talentAssignments，交接历史可回溯）
async function doAssign(ids, ownerName, ownerPosition, ctx, mode, remark) {
  const target = userRecByName(ownerName);
  if (!target) return { error: '负责人不存在：' + ownerName };
  const toPosition = POSITIONS.includes(ownerPosition) ? ownerPosition : (target.position || '');
  // 岗位职责边界：达人只能由招募 / 运营岗持有；高级运营管质量、财务管结算
  if (!OWNER_POSITIONS.includes(toPosition)) {
    return { error: '「' + posLabel(toPosition) + '」岗不做达人负责人（高级运营管质量、财务岗只管结算），请选招募或运营岗' };
  }
  const changed = [], skipped = [];
  for (const id of ids) {
    const { rec: t, coll } = await findLeadOrTalent(id);
    if (!t || t.isActive === false) { skipped.push({ id, reason: '线索不存在' }); continue; }
    if (t.handoverStatus === 'pending') { skipped.push({ id, name: t.name, reason: '有未处理的交接单' }); continue; }
    if (t.owner === nameOf(target) && (t.ownerPosition || '') === toPosition) { skipped.push({ id, name: t.name, reason: '负责人未变化' }); continue; }
    const before = (t.owner || '未分配') + '（' + posLabel(t.ownerPosition) + '）';
    const extra = {};
    // 管理员/高级运营把达人分配给运营 → 「达人运营负责人」始终跟随最新分配人（2026-09-18）：
    // 高级运营不是达人长期 owner，只做分配/重新分配；重新分给另一位普通运营时 talentOperator 同步换人
    if (toPosition === 'ops') { extra.opsBy = nameOf(target); extra.opsId = target.user; extra.opsAt = nowStr(); extra.talentOperator = nameOf(target); }
    const upd = await db.update(coll, id, Object.assign({
      owner: nameOf(target), ownerId: target.user, ownerPosition: toPosition, assignedAt: nowStr(),
      // 换人 = SLA 重新计时：清掉历史豁免 / 上报标记 / 催办计数（新负责人从零开始考核）
      slaExempt: false, escalatedAt: '', overdueReason: '', overdueReasonAt: '', urgeCount: 0,
    }, extra));
    await addLog(ctx.operator, '达人：' + upd.name, mode, '负责人=' + before,
      '负责人=' + nameOf(target) + '（' + posLabel(toPosition) + '）');
    // 独立分配记录：谁把哪位达人分给了谁、备注是什么 —— 交接历史可回溯（跟进时间轴也会并入展示）
    await db.insert('talentAssignments', {
      id: await nextId('talentAssignments', 'TA', 5),
      talentId: t.id, talentName: t.name,
      fromOwner: t.owner || '', fromOwnerId: t.ownerId || '', fromPosition: t.ownerPosition || '',
      toOwner: nameOf(target), toOwnerId: target.user, toPosition,
      type: mode, remark: String(remark || '').slice(0, 200),
      assignedBy: ctx.displayName || ctx.operator, assignedById: ctx.authUser || ctx.operator,
      assignedAt: nowStr(), isActive: true,
    });
    changed.push(toMvpLead(upd));
  }
  return { changed, skipped };
}
// 单条分配（主管：管理员/高级运营 在达人总表「分配负责人」）
route('POST', '/api/mvp/leads/:id/assign', async (ctx) => {
  if (!isSupervisor(ctx)) return fail(ctx.res, 403, '只有主管（管理员/高级运营）可以分配负责人');
  const b = ctx.body || {};
  if (!b.owner) return fail(ctx.res, 400, '请选择负责人');
  const r = await doAssign([ctx.params.id], b.owner, b.ownerPosition, ctx, '线索分配', b.remark);
  if (r.error) return fail(ctx.res, 400, r.error);
  if (!r.changed.length) return fail(ctx.res, 409, (r.skipped[0] && r.skipped[0].reason) || '分配未生效');
  notify('线索已分配给 ' + b.owner + '：' + r.changed[0].name);
  ok(ctx.res, { assigned: r.changed.length, leads: r.changed, skipped: r.skipped });
});
// 批量分配（主管达人总表勾选多条 → 一次指派）
route('POST', '/api/mvp/leads/batch-assign', async (ctx) => {
  if (!isSupervisor(ctx)) return fail(ctx.res, 403, '只有主管（管理员/高级运营）可以分配负责人');
  const b = ctx.body || {};
  const ids = Array.isArray(b.ids) ? b.ids.filter(Boolean) : [];
  if (!ids.length) return fail(ctx.res, 400, '请先勾选线索');
  if (ids.length > 500) return fail(ctx.res, 400, '单次最多分配 500 条');
  if (!b.owner) return fail(ctx.res, 400, '请选择负责人');
  const r = await doAssign(ids, b.owner, b.ownerPosition, ctx, '线索批量分配', b.remark);
  if (r.error) return fail(ctx.res, 400, r.error);
  await addLog(ctx.operator, '线索批量分配', '线索批量分配', ids.length + ' 条', '负责人=' + b.owner + '；成功 ' + r.changed.length + ' / 跳过 ' + r.skipped.length);
  if (r.changed.length) notify('批量分配 ' + r.changed.length + ' 条线索给 ' + b.owner);
  ok(ctx.res, { assigned: r.changed.length, leads: r.changed, skipped: r.skipped });
});
route('PUT', '/api/mvp/leads/:id', async (ctx) => {
  if (!ctx.role.mutate) return fail(ctx.res, 403, '当前角色无修改权限');
  const t = await db.get('leads', ctx.params.id);
  if (!t) return fail(ctx.res, 404, '线索不存在');
  if (!canTouchLead(t, ctx)) return fail(ctx.res, 403, '只能修改自己负责的线索');
  // 判断字段分层（2026-09-18）：评级/潜力/意愿/分类/路径只能由运营/高级运营/管理员修改，招募只收集报名信息
  const JUDGE_BODY_KEYS = ['talentLevel', 'potentialLevel', 'potential', 'intentLevel', 'willing', 'talentClass', 'category', 'coopPath'];
  if (!canJudgeLead(ctx) && JUDGE_BODY_KEYS.some(k => (ctx.body || {})[k] !== undefined)) {
    return fail(ctx.res, 403, '达人评级/潜力/合作意愿/分类/合作路径只能由运营或高级运营修改（招募岗只收集报名信息）');
  }
  const patch = {};
  const b = ctx.body || {};
  if (b.status && MVP_STAGE_REVERSE[b.status]) patch.status = MVP_STAGE_REVERSE[b.status];
  // 负责人变更：管理员可直接改（按「分配」记流水），其他人必须走交接流程
  if (b.owner && b.owner !== t.owner) {
    if (ctx.roleCode !== 'admin') return fail(ctx.res, 403, '负责人变更请使用「交接」，接收人确认后自动生效');
    const target = userRecByName(b.owner);
    if (!target) return fail(ctx.res, 400, '负责人不存在：' + b.owner);
    patch.owner = nameOf(target);
    patch.ownerId = target.user;
    patch.ownerPosition = POSITIONS.includes(b.ownerPosition) ? b.ownerPosition : (target.position || '');
    patch.assignedAt = nowStr();
  } else if (b.ownerPosition !== undefined && ctx.roleCode === 'admin') {
    patch.ownerPosition = POSITIONS.includes(b.ownerPosition) ? b.ownerPosition : '';
  }
  if (b.note !== undefined) patch.note = b.note;
  // 达人生命周期（talent_status）：主管（管理员/高级运营）与负责人可调整
  if (b.talentStatus !== undefined) {
    if (!TALENT_STATUS.includes(b.talentStatus)) return fail(ctx.res, 400, '非法生命周期: ' + b.talentStatus);
    patch.talentStatus = b.talentStatus;
  }
  // 达人评级（talentLevel）：A 高价值 / B 培养中 / C 普通 / D 沉默；写入时镜像到 level（保持 SLA 口径）
  if (b.talentLevel !== undefined) {
    if (!TALENT_LEVEL_ANY.includes(b.talentLevel)) return fail(ctx.res, 400, '非法达人评级: ' + b.talentLevel);
    patch.talentLevel = b.talentLevel;
    patch.level = b.talentLevel;
  }
  // 业务评估字段（跟进 / 分类弹窗都会写）
  if (b.potentialLevel !== undefined) patch.potentialLevel = b.potentialLevel;
  else if (b.potential !== undefined) patch.potentialLevel = b.potential;
  if (b.intentLevel !== undefined) patch.intentLevel = b.intentLevel;
  else if (b.willing !== undefined) patch.intentLevel = b.willing;
  if (b.talentClass !== undefined) patch.talentClass = b.talentClass;
  else if (b.category !== undefined) patch.talentClass = b.category;
  if (b.nextFollowAt !== undefined) patch.nextFollowAt = b.nextFollowAt;
  // 孵化类型与服务费：免费签约（优质孵化）/ 付费孵化；付费达人的服务费单独记账
  if (b.coopPath !== undefined) patch.coopPath = b.coopPath;
  if (b.incubationFee !== undefined) patch.incubationFee = Number(b.incubationFee) || 0;
  if (b.feeStatus !== undefined) patch.feeStatus = b.feeStatus;
  if (!Object.keys(patch).length) return fail(ctx.res, 400, '没有需要更新的字段');
  // 状态被推到「合作中」= 转化为正式达人：走服务端不变式迁移（推荐用显式接口 POST /convert）
  if (patch.status === '合作中') {
    const rec = await promoteToTalent(Object.assign({}, t, patch), ctx.displayName || ctx.operator, ctx.authUser || ctx.operator, t.status);
    ok(ctx.res, toMvpLead(rec));
    return;
  }
  const updated = await db.update('leads', ctx.params.id, patch);
  const ownerChanged = !!patch.owner && patch.owner !== t.owner;
  // 留痕：负责人变化 / 阶段变化 / 潜力意愿变化 分开记，便于回溯「谁改了什么」
  const evalChanged = (b.potentialLevel !== undefined || b.potential !== undefined || b.intentLevel !== undefined || b.willing !== undefined);
  const type = ownerChanged ? '线索分配'
    : (patch.status && patch.status !== t.status) ? '线索阶段变更'
      : evalChanged ? '线索潜力意愿' : '线索跟进';
  const beforeTxt = ownerChanged ? ('负责人=' + (t.owner || '未分配') + '（' + posLabel(t.ownerPosition) + '）')
    : ('阶段=' + t.status + '；潜力=' + (t.potentialLevel || '待判断') + '；意愿=' + (t.intentLevel || '待判断'));
  const afterTxt = ownerChanged ? ('负责人=' + updated.owner + '（' + posLabel(updated.ownerPosition) + '）')
    : ('阶段=' + updated.status + '；潜力=' + (updated.potentialLevel || '待判断') + '；意愿=' + (updated.intentLevel || '待判断'));
  await addLog(ctx.operator, '达人：' + updated.name, type, beforeTxt, afterTxt);
  ok(ctx.res, toMvpLead(updated));
});

/* ============================================================
 * 跟进记录：负责人「去跟进」提交 → 更新最近/下次跟进时间 + 评估字段，并落一条 followups
 * 工作台待办完全由这些字段推导（见 /api/mvp/workbench）
 * ============================================================ */
const FOLLOW_METHODS_SRV = ['微信', '电话', '面谈', '私信', '其他'];
// 运营任务 / 爆款拆解库的序列化（纯展示加工，权限判断一律在路由里做）
async function namesOfTalents(ids) {
  if (!Array.isArray(ids) || !ids.length) return [];
  const all = await listLeadsAndTalents();
  const map = {}; for (const t of all) map[t.id] = t.name;
  return ids.map(id => ({ id, name: map[id] || id }));
}
function toOpsTask(k) {
  return {
    id: k.id, title: k.title || '', contentDirection: k.contentDirection || '',
    productType: k.productType || '', reason: k.reason || '',
    talentIds: k.talentIds || [], talentNames: k.talentNames || [], talentCount: (k.talentIds || []).length,
    owner: k.owner || '', ownerId: k.ownerId || '',
    status: k.status || '待开始', dueAt: k.dueAt || '', progress: k.progress || '', note: k.note || '',
    createdBy: k.createdBy || '', createdAt: k.createdAt || '',
    type: 'growth', typeLabel: TASK_TYPE_LABEL.growth,
    overdue: !!(k.dueAt && k.dueAt < fmtDate(new Date()) && !['已完成', '已取消'].includes(k.status || '')),
  };
}
function toHitCase(c) {
  return {
    id: c.id, title: c.title || '', contentDirection: c.contentDirection || '',
    productType: c.productType || '', reason: c.reason || '', fitTalents: c.fitTalents || '',
    talentIds: c.talentIds || [], refUrl: c.refUrl || '',
    createdBy: c.createdBy || '', createdAt: c.createdAt || '',
  };
}
function toFollowup(f) {
  return {
    id: f.id, talentId: f.talentId, talentName: f.talentName,
    method: f.method || '', result: f.result || '', content: f.content || '',
    stage: f.stage || '', potentialLevel: f.potentialLevel || '', intentLevel: f.intentLevel || '',
    talentClass: f.talentClass || '', nextAt: f.nextAt || '',
    // 跟进时间轴「下一步动作」：与 nextAt（下次跟进时间）配套，解决微信聊天记录无法沉淀的问题
    nextAction: f.nextAction || '',
    type: f.type || f.method || '跟进',
    operator: f.operator || '', operatorId: f.operatorId || '', createdAt: f.createdAt || '',
  };
}
/* ---------------- 运营团队效率聚合（工作台面板与 /api/mvp/team 共用同一口径） ----------------
 * 逐个运营岗同事算：负责达人 / 生命周期分布 / 异常数 / 任务完成率。
 * 与 /api/mvp/team 共用，避免「工作台看到的数字」和「团队页看到的数字」两套口径。 */
async function buildTeamMembers() {
  const users = (AUTH && Array.isArray(AUTH.users) ? AUTH.users : []);
  const talents = (await db.list('talents')).filter(t => t.isActive !== false);
  const tasks = (await db.list('tasks')).filter(k => k.isActive !== false);
  const today = fmtDate(new Date());
  const members = [];
  for (const u of users) {
    const pos = u.position || (u.role === 'admin' ? 'admin' : '');
    if (!['ops', 'senior_ops'].includes(pos)) continue;                  // 只统计运营岗（普通 + 高级）
    const myTalents = talents.filter(t => t.ownerId === u.user || (!t.ownerId && t.owner === nameOf(u)));
    const myIds = new Set(myTalents.map(t => t.id));
    const myTasks = tasks.filter(k => myIds.has(k.talentId));
    const done = myTasks.filter(k => k.status === '已完成').length;
    const abnormal = myTalents.filter(t => accRowOf(t).updateStale).length
      + myTasks.filter(k => ['超时', '商品异常', '内容不合格', '达人拒绝'].includes(k.status)).length
      + myTalents.filter(t => String(t.nextFollowAt || '').slice(0, 10) && String(t.nextFollowAt).slice(0, 10) < today).length;
    const lifecycle = {};
    for (const k of TALENT_STATUS) lifecycle[k] = myTalents.filter(t => (t.talentStatus || 'coaching') === k).length;
    members.push({
      user: u.user, name: nameOf(u), position: pos, positionLabel: posLabel(pos),
      talents: myTalents.length, abnormal,
      taskTotal: myTasks.length, taskDone: done,
      taskRate: myTasks.length ? Math.round(done / myTasks.length * 100) : 0,
      lifecycle,
    });
  }
  members.sort((a, b) => b.talents - a.talents);
  return members;
}

/* ---------------- 工作台岗位面板（运营中台核心：每个岗位看到的「今天该干什么」不同） ----------------
 * 只做数据装配；所有权限判断复用既有裁决点（isSupervisor / isMine / leadVisibleTo），不新造判断。 */
async function buildWorkbenchPanels(ctx, all) {
  const isAdmin = ctx.roleCode === 'admin';
  const myPos = ctx.position || '';
  const today = fmtDate(new Date());
  const daysAgo = s => { const n = new Date(String(s || '').replace(' ', 'T')).getTime(); return isNaN(n) ? 9999 : Math.floor((Date.now() - n) / 86400000); };
  const blocks = [];
  const statusOf = t => String(t.talentStatus || (['合作中', '暂停合作'].includes(t.status) ? 'coaching' : 'lead'));
  // 成长漏斗用「达到该阶段及以上」的累计口径，保证逐层单调递减、可直接读转化率；
  // raw 保留各状态当前人数，方便一眼看出人卡在哪一级。
  const LEVEL_RANK = { lead: 0, coaching: 1, potential: 2, contracted: 3, company_owned: 4 };
  const rankOf = t => { const r = LEVEL_RANK[statusOf(t)]; return r === undefined ? 0 : r; };
  const funnelBlock = () => ({
    key: 'growth-funnel', title: '达人成长漏斗', type: 'funnel', link: 'talent-pool',
    hint: '每层是「达到该阶段及以上」的累计人数，右侧为逐级转化率',
    items: [
      { key: 'lead', label: TALENT_STATUS_LABEL.lead, value: all.filter(t => rankOf(t) >= 0).length, raw: all.filter(t => statusOf(t) === 'lead').length },
      { key: 'coaching', label: TALENT_STATUS_LABEL.coaching, value: all.filter(t => rankOf(t) >= 1).length, raw: all.filter(t => statusOf(t) === 'coaching').length },
      { key: 'potential', label: TALENT_STATUS_LABEL.potential, value: all.filter(t => rankOf(t) >= 2).length, raw: all.filter(t => statusOf(t) === 'potential').length },
      { key: 'contracted', label: TALENT_STATUS_LABEL.contracted, value: all.filter(t => rankOf(t) >= 3).length, raw: all.filter(t => statusOf(t) === 'contracted').length },
      { key: 'company_owned', label: TALENT_STATUS_LABEL.company_owned, value: all.filter(t => rankOf(t) >= 4).length, raw: all.filter(t => statusOf(t) === 'company_owned').length },
    ],
  });

  if (isAdmin) {
    const talentRows = (await db.list('talents')).filter(t => t.isActive !== false);
    const tasksAll = (await db.list('tasks')).filter(k => k.isActive !== false);
    const camps = await db.list('campaigns');
    const users = (AUTH && Array.isArray(AUTH.users) ? AUTH.users : []);
    // 1) 达人成长漏斗
    blocks.push(funnelBlock());
    // 2) 运营团队效率
    blocks.push({
      key: 'team-efficiency', title: '运营团队效率', type: 'stats', link: 'talent-pool',
      items: [
        { label: '高级运营', value: users.filter(u => u.position === 'senior_ops').length, sub: '主管：质检 / 方法沉淀 / 分配任务' },
        { label: '普通运营', value: users.filter(u => u.position === 'ops').length, sub: '一线达人陪跑' },
        { label: '管理达人', value: all.filter(t => t.ownerId || (t.owner && t.owner !== '未分配')).length, sub: '已落到具体负责人名下' },
        { label: '异常达人', value: talentRows.filter(t => accRowOf(t).updateStale).length
            + all.filter(t => String(t.nextFollowAt || '').slice(0, 10) && String(t.nextFollowAt).slice(0, 10) < today).length,
          sub: '账号久未更新 / 跟进逾期', tone: 'text-rose-600' },
      ],
    });
    // 3) 渠道 ROI（投入只存在于投放表，管理员可见）
    const chAgg = {};
    for (const t of all) {
      const c = t.channel || '其他';
      const m = chAgg[c] = chAgg[c] || { channel: c, cost: 0, leads: 0, talents: 0 };
      m.leads++;
      if (['合作中', '暂停合作'].includes(t.status)) m.talents++;
    }
    for (const c of camps) {
      const key = c.channel || '其他';
      const m = chAgg[key] = chAgg[key] || { channel: key, cost: 0, leads: 0, talents: 0 };
      m.cost += Number(c.cost) || 0;
    }
    const roiRows = Object.values(chAgg).map(m => Object.assign(m, {
      rate: m.leads ? +(m.talents / m.leads * 100).toFixed(1) : 0,
      cpt: m.talents ? Math.round(m.cost / m.talents) : null,
    })).sort((a, b) => b.leads - a.leads);
    blocks.push({
      key: 'channel-roi', title: '渠道 ROI', type: 'table', link: 'channels',
      columns: ['渠道', '投入', '线索', '新增达人', '转化率', '单人成本'],
      rows: roiRows.map(m => [m.channel, '¥' + m.cost, m.leads, m.talents, m.rate + '%', m.cpt == null ? '—' : '¥' + m.cpt]),
    });
    // 4) 异常提醒（超时未跟进 / 长时间未更新 / 未完成任务 / SLA 超时）
    const alertsItems = [];
    const staleFollow = all.filter(t => t.owner && t.owner !== '未分配' && !WB_DONE_STATUS.includes(t.status)
      && t.lastFollowAt && daysAgo(t.lastFollowAt) > 2).length;
    if (staleFollow) alertsItems.push({ text: '超时未跟进线索', sub: staleFollow + ' 条超过 2 天未跟进', page: 'talent-leads', tone: 'rose' });
    const staleAcc = talentRows.filter(t => accRowOf(t).updateStale).length;
    if (staleAcc) alertsItems.push({ text: '长时间未更新达人', sub: staleAcc + ' 个账号超过更新周期未发内容', page: 'account-ops', tone: 'amber' });
    const undone = tasksAll.filter(k => k.status === '超时' || (ACTIVE_TASK.includes(k.status) && k.dueAt && k.dueAt < today)).length;
    if (undone) alertsItems.push({ text: '未完成任务', sub: undone + ' 个任务逾期 / 超时未完成', page: 'tasks', tone: 'rose' });
    const slaUp = all.filter(t => slaOf(t).slaStatus === 'overdue').length;
    if (slaUp) alertsItems.push({ text: 'SLA 超时未联系', sub: slaUp + ' 条线索超过首次联系时限', page: 'talent-leads', tone: 'rose' });
    blocks.push({ key: 'alerts', title: '异常提醒', type: 'alerts', items: alertsItems });
  } else if (myPos === 'senior_ops') {
    const members = await buildTeamMembers();
    const opsTasksAll = (await db.list('opsTasks')).filter(k => k.isActive !== false);
    const hitCases = (await db.list('hitCases')).filter(c => c.isActive !== false);
    blocks.push({
      key: 'ops-team', title: '运营团队', type: 'table', link: 'talent-pool',
      hint: '谁手上多少达人、多少异常、任务完成率 —— 决定要不要重新分配',
      columns: ['运营', '岗位', '负责达人', '异常', '任务完成率'],
      rows: members.filter(m => m.position === 'ops').map(m => [m.name, m.positionLabel, m.talents, m.abnormal, m.taskRate + '%']),
    });
    blocks.push(funnelBlock());
    blocks.push({
      key: 'ops-tasks', title: '运营任务管理', type: 'stats', link: 'tasks',
      items: [
        { label: '我派发的运营任务', value: opsTasksAll.filter(k => k.createdById === ctx.authUser).length, sub: '方向验证 / 方法沉淀类任务' },
        { label: '进行中', value: opsTasksAll.filter(k => k.status === '进行中').length, sub: '普通运营正在推进' },
        { label: '逾期未完成', value: opsTasksAll.filter(k => k.dueAt && k.dueAt < today && !['已完成', '已取消'].includes(k.status)).length, sub: '已过截止时间', tone: 'text-rose-600' },
      ],
    });
    blocks.push({
      key: 'hit-cases', title: '爆款拆解库', type: 'list', link: 'hit-cases',
      hint: '把跑通的内容方向沉淀下来，一线直接复用',
      items: hitCases.slice(0, 5).map(c => ({ text: c.title, sub: (c.contentDirection || '') + (c.productType ? ' · ' + c.productType : '') })),
    });
    // 未分配达人池 + 异常提醒（管理台补全）：分配入口在达人档案页「分配给运营」
    const unassignedAll = all.filter(t => !(t.ownerId || (t.owner && t.owner !== '未分配')));
    blocks.push({
      key: 'unassigned-pool', title: '未分配达人池', type: 'stats', link: 'talent-pool',
      hint: '在达人档案页点「分配给运营」把达人落给具体负责人',
      items: [
        { label: '未分配线索', value: unassignedAll.filter(t => statusOf(t) === 'lead').length, sub: '需要指派招募 / 运营跟进' },
        { label: '未分配达人', value: unassignedAll.filter(t => statusOf(t) !== 'lead').length, sub: '正式达人还没落到负责人名下' },
        { label: '待处理交接单', value: (await db.list('handovers')).filter(h => h.status === 'pending').length, sub: '等待双方确认', tone: 'text-amber-500' },
      ],
    });
    const abnAcc = (await db.list('talents')).filter(t => t.isActive !== false && accRowOf(t).updateStale).length;
    const abnFollow = all.filter(t => t.owner && t.owner !== '未分配' && !WB_DONE_STATUS.includes(t.status) && t.lastFollowAt && daysAgo(t.lastFollowAt) > 2).length;
    const abnSla = all.filter(t => slaOf(t).slaStatus === 'overdue').length;
    blocks.push({
      key: 'senior-alerts', title: '异常达人提醒', type: 'alerts', items: [
        abnFollow ? { text: '超时未跟进', sub: abnFollow + ' 条线索超过 2 天未跟进', page: 'talent-leads', tone: 'rose' } : null,
        abnAcc ? { text: '账号久未更新', sub: abnAcc + ' 个达人账号超过更新周期未发内容', page: 'account-ops', tone: 'amber' } : null,
        abnSla ? { text: 'SLA 超时未联系', sub: abnSla + ' 条线索超过首次联系时限', page: 'talent-leads', tone: 'rose' } : null,
      ].filter(Boolean),
    });
  } else if (myPos === 'ops') {
    const mine = all.filter(t => isMine(t, ctx));
    const cnt = k => mine.filter(t => statusOf(t) === k).length;
    const myOpsTasks = (await db.list('opsTasks')).filter(k => k.isActive !== false
      && (k.ownerId === ctx.authUser || k.owner === (ctx.displayName || ctx.operator)));
    // 新分配达人（2026-09-18）：近 7 天主管（管理员/高级运营）分配给我的达人，来自独立分配记录
    const myAssigns = (await db.list('talentAssignments')).filter(a => a.isActive !== false
      && (a.toOwnerId === ctx.authUser || (!a.toOwnerId && a.toOwner === (ctx.displayName || ctx.operator)))
      && daysAgo(a.assignedAt) <= 7)
      .sort((a, b) => String(b.assignedAt || '').localeCompare(String(a.assignedAt || '')));
    blocks.push({
      key: 'new-assigned', title: '新分配达人', type: 'table', link: 'talent-pool',
      hint: '近 7 天高级运营分配给我的达人，尽快首次触达建立联系',
      columns: ['达人', '分配人', '分配时间', '备注'],
      rows: myAssigns.slice(0, 8).map(a => {
        const t = mine.find(x => x.id === a.talentId);
        return [t ? t.name : (a.talentName || a.talentId), a.assignedBy || '—', String(a.assignedAt || '').slice(0, 16) || '—', a.remark || '—'];
      }),
    });
    blocks.push({
      key: 'my-talents', title: '我的达人', type: 'stats', link: 'talent-pool',
      items: [
        { label: '陪跑达人', value: cnt('coaching'), sub: '正在陪着成长' },
        { label: '重点培养', value: cnt('potential'), sub: '潜力已被验证', tone: 'text-violet-600' },
        { label: '签约 / 直属', value: cnt('contracted') + cnt('company_owned'), sub: '公司签约 + 公司直属', tone: 'text-emerald-600' },
        { label: '公司账号', value: mine.filter(t => t.dewuId).length, sub: '有得物账号在运营' },
      ],
    });
    blocks.push({
      key: 'today', title: '今日待办', type: 'stats',
      items: [
        { label: '7 天未更新达人', value: mine.filter(t => accRowOf(t).daysSincePublish >= 7).length, sub: '该安排新内容了', tone: 'text-amber-500' },
        { label: '待调整内容方向', value: mine.filter(t => !(t.contentTypes || []).length || t.coopPath === '待判断').length, sub: '还没定方向 / 合作路径' },
        { label: '待完成运营任务', value: myOpsTasks.filter(k => !['已完成', '已取消'].includes(k.status)).length, sub: '主管派发的方向验证任务' },
      ],
    });
    // 待跟进提醒（2026-09-18）：逾期未跟进 / 今日待跟进 / 新分配未触达，只统计我名下达人
    const followDue = t => String(t.nextFollowAt || '').slice(0, 10);
    const overdueFollow = mine.filter(t => followDue(t) && followDue(t) < today);
    const dueToday = mine.filter(t => followDue(t) === today);
    const assignedUntouched = myAssigns.filter(a => { const t = mine.find(x => x.id === a.talentId); return t && !t.lastFollowAt; });
    blocks.push({
      key: 'follow-remind', title: '待跟进提醒', type: 'alerts',
      items: [
        overdueFollow.length ? { text: '逾期未跟进', sub: overdueFollow.length + ' 位达人已过计划跟进时间（' + overdueFollow.slice(0, 3).map(t => t.name).join('、') + (overdueFollow.length > 3 ? ' 等' : '') + '）', page: 'talent-pool', tone: 'rose' } : null,
        dueToday.length ? { text: '今日待跟进', sub: dueToday.length + ' 位达人计划今天跟进', page: 'talent-pool', tone: 'amber' } : null,
        assignedUntouched.length ? { text: '新分配未触达', sub: assignedUntouched.length + ' 位新分配达人还没首次联系', page: 'talent-pool', tone: 'amber' } : null,
      ].filter(Boolean),
    });
    // 任务概览：寄拍执行单 + 成长任务分开看（内容 / 成长任务是运营成长任务体系）
    const myTasks = (await db.list('tasks')).filter(k => k.isActive !== false
      && (k.ownerId === ctx.authUser || k.owner === (ctx.displayName || ctx.operator)));
    blocks.push({
      key: 'task-overview', title: '任务概览（寄拍 / 成长）', type: 'stats', link: 'tasks',
      items: [
        { label: '进行中寄拍任务', value: myTasks.filter(k => ACTIVE_TASK.includes(k.status)).length, sub: '我名下达人的执行单' },
        { label: '逾期寄拍', value: myTasks.filter(k => k.status === '超时' || (k.dueAt && k.dueAt < today && ACTIVE_TASK.includes(k.status))).length, sub: '该催达人交付了', tone: 'text-rose-600' },
        { label: '进行中成长任务', value: myOpsTasks.filter(k => k.status === '进行中').length, sub: '主管派发的内容 / 成长任务' },
        { label: '内容方向待定', value: mine.filter(t => !(t.contentTypes || []).length || t.coopPath === '待判断').length, sub: '先定方向再安排任务' },
      ],
    });
    blocks.push({
      key: 'my-talent-list', title: '我的达人 · 成长与下一步动作', type: 'table', link: 'talent-pool',
      columns: ['达人', '生命周期', '评级', '最近更新', '成长趋势', '下一步动作'],
      rows: mine.slice(0, 12).map(t => {
        const a = accRowOf(t);
        const d = a.daysSincePublish;
        return [
          t.name, TALENT_STATUS_LABEL[statusOf(t)],
          (TALENT_LEVEL_LABEL[t.talentLevel] || 'C 普通').slice(0, 1),
          a.dewuLastPublish || '未更新',
          d < 0 ? '未开始' : (d <= 7 ? '上升' : (d <= 14 ? '平稳' : '停滞')),
          t.nextAction || '—',
        ];
      }),
    });
  } else if (myPos === 'recruit') {
    const mine = (await db.list('leads')).filter(t => t.isActive !== false && isMine(t, ctx));
    const st = s => mine.filter(t => t.status === s).length;
    blocks.push({
      key: 'my-leads', title: '我的线索', type: 'stats', link: 'talent-leads',
      items: [
        { label: '待联系', value: st('待联系'), sub: '还没首次触达' },
        { label: '跟进中', value: st('已联系') + st('有意向'), sub: '已联系 / 已有意向' },
        { label: '高意愿', value: mine.filter(t => t.intentLevel === '强').length, sub: '意愿=强，优先推进', tone: 'text-emerald-600' },
        { label: '待转运营', value: mine.filter(t => ['合作中', '暂停合作'].includes(t.status)).length, sub: '已合作，尽快交接运营' },
      ],
    });
    const over = mine.filter(t => slaOf(t).slaStatus === 'overdue');
    const remind = mine.filter(t => slaOf(t).slaStatus === 'remind');
    blocks.push({
      key: 'sla', title: 'SLA 首次联系时限', type: 'list', link: 'talent-leads',
      hint: '分配即开始计时，超时会自动上报主管',
      items: over.map(t => ({ text: t.name, sub: '已超时 · ' + (slaOf(t).slaRuleLabel || ''), tone: 'rose' }))
        .concat(remind.map(t => ({ text: t.name, sub: '剩余 ' + slaOf(t).slaRemainMin + ' 分钟', tone: 'amber' }))),
    });
    blocks.push({
      key: 'today-judge', title: '今日与待判断', type: 'stats', link: 'talent-leads',
      items: [
        { label: '今日新增线索', value: mine.filter(t => String(t.createdAt || '').slice(0, 10) === today).length, sub: '按线索创建时间' },
        { label: '待判断达人', value: mine.filter(t => t.coopPath === '待判断' || !(t.contentTypes || []).length).length, sub: '合作路径 / 内容方向未定' },
        { label: 'SLA 即将超时', value: remind.length, sub: '已进提醒档，抓紧联系', tone: 'text-amber-500' },
      ],
    });
  } else if (myPos === 'promote') {
    // 推广工作台：我的活动 → 我负责渠道的线索转化 → 渠道效果
    const camps = (await db.list('campaigns')).filter(c => c.isActive !== false);
    const mineCamps = camps.filter(c => c.owner === (ctx.displayName || ctx.operator));
    const myChannels = [...new Set(mineCamps.map(c => c.channel).filter(Boolean))];
    const chLeads = myChannels.length ? all.filter(t => myChannels.includes(t.channel || '')) : [];
    const stgOf = t => MVP_STAGE_MAP[t.status] || '新线索';
    blocks.push({
      key: 'my-campaigns', title: '我的推广活动', type: 'stats', link: 'channels',
      hint: '只统计我名下的投放活动与其覆盖的渠道',
      items: [
        { label: '活动数', value: mineCamps.length, sub: '我名下的投放活动' },
        { label: '总投入', value: '¥' + mineCamps.reduce((s, c) => s + (Number(c.cost) || 0), 0), sub: '活动成本合计' },
        { label: '覆盖渠道', value: myChannels.length, sub: myChannels.join(' / ') || '暂无渠道，去推广获客创建' },
        { label: '带来线索', value: chLeads.length, sub: '我负责渠道的线索总量' },
      ],
    });
    blocks.push({
      key: 'lead-convert', title: '线索转化', type: 'stats', link: 'talent-leads',
      hint: '我负责渠道线索的实时转化进度',
      items: [
        { label: '新增线索（30 天）', value: chLeads.filter(t => daysAgo(t.createdAt) <= 30).length, sub: '按线索创建时间' },
        { label: '有效线索', value: chLeads.filter(t => t.lastFollowAt).length, sub: '已建立联系' },
        { label: '报名 / 成达人', value: chLeads.filter(t => ['已报名', '已成为达人'].includes(stgOf(t))).length, sub: '进入报名及之后阶段', tone: 'text-emerald-600' },
        { label: '线索→达人转化率', value: chLeads.length ? Math.round(chLeads.filter(t => stgOf(t) === '已成为达人').length / chLeads.length * 100) + '%' : '—', sub: '我负责渠道的整体转化' },
      ],
    });
    blocks.push({
      key: 'channel-effect', title: '渠道效果', type: 'table', link: 'channels',
      hint: '按我负责的渠道逐个聚合，看哪个渠道值得续投',
      columns: ['渠道', '线索', '有效', '报名', '达人', '转化率'],
      rows: myChannels.map(ch => {
        const rows = chLeads.filter(t => (t.channel || '') === ch);
        const valid = rows.filter(t => t.lastFollowAt).length;
        const signed = rows.filter(t => ['已报名', '已成为达人'].includes(stgOf(t))).length;
        const tal = rows.filter(t => stgOf(t) === '已成为达人').length;
        return [ch, rows.length, valid, signed, tal, rows.length ? Math.round(tal / rows.length * 100) + '%' : '—'];
      }),
    });
  } else if (myPos === 'finance' || ctx.roleCode === 'finance') {
    // 财务工作台：结算进度 + 收益概览（明细与操作在「收益结算」页）
    const sts = (await db.list('settlements')).filter(s2 => s2.isActive !== false);
    const pending = sts.filter(s2 => s2.status !== '已结清');
    const done = sts.filter(s2 => s2.status === '已结清');
    const overdue = pending.filter(s2 => s2.dueDate && s2.dueDate < today);
    const sumBy = (arr, f) => arr.reduce((acc, x) => acc + (Number(x[f]) || 0), 0);
    const received = (await db.list('payments')).filter(p => p.isActive !== false && p.direction === 'in').reduce((acc, p) => acc + (Number(p.amount) || 0), 0);
    blocks.push({
      key: 'settle-overview', title: '结算概览', type: 'stats', link: 'finance',
      hint: '金额按平台收益口径；待结算=未结清的结算单',
      items: [
        { label: '待结算笔数', value: pending.length, sub: '未结清的结算单' },
        { label: '待结算金额', value: '¥' + sumBy(pending, 'platformIncome'), sub: '平台收益合计（未结清）', tone: 'text-amber-500' },
        { label: '已结算笔数', value: done.length, sub: '已结清' },
        { label: '已结算金额', value: '¥' + sumBy(done, 'platformIncome'), sub: '平台收益合计（已结清）', tone: 'text-emerald-600' },
      ],
    });
    blocks.push({
      key: 'income-stats', title: '收益统计', type: 'stats', link: 'finance',
      items: [
        { label: '平台收益总额', value: '¥' + sumBy(sts, 'platformIncome'), sub: '全部结算单的平台收益' },
        { label: '已到账', value: '¥' + received, sub: '平台到账流水合计', tone: 'text-emerald-600' },
        { label: '待到账', value: '¥' + Math.max(0, sumBy(sts, 'platformIncome') - received), sub: '平台收益 - 已到账' },
        { label: '逾期未结清', value: overdue.length, sub: '超过应结日期还未结清', tone: overdue.length ? 'text-rose-600' : 'text-slate-800' },
      ],
    });
    blocks.push({
      key: 'settle-todo', title: '待办提醒', type: 'alerts',
      items: overdue.slice(0, 5).map(s2 => ({ text: (s2.talentName || '达人') + ' ' + (s2.period || ''), sub: '¥' + s2.platformIncome + ' · 应结 ' + s2.dueDate, page: 'finance', tone: 'rose' })),
    });
  }
  return { role: isAdmin ? 'admin' : (myPos || 'other'), blocks, today };
}

/* ---------------- 达人评级 / 生命周期（线索与达人通用，兼容两表） ----------------
 * 前端在「达人线索」与「达人档案」两处都能改；因 ID 不变只是搬表，这里统一回退查询。
 * 权限：主管（管理员/高级运营）或该记录的负责人（服务端裁决）。 */
route('PUT', '/api/mvp/talent-meta/:id', async (ctx) => {
  if (!ctx.role.mutate) return fail(ctx.res, 403, '当前角色无修改权限');
  let t = await db.get('leads', ctx.params.id); let coll = 'leads';
  if (!t) { t = await db.get('talents', ctx.params.id); coll = 'talents'; }
  if (!t) return fail(ctx.res, 404, '线索 / 达人不存在');
  if (!canTouchLead(t, ctx)) return fail(ctx.res, 403, '只能修改自己负责的达人');
  const b = ctx.body || {};
  // 达人评级=判断字段（2026-09-18 分层）：招募岗不可修改（生命周期仍归负责人/主管）
  if (b.talentLevel !== undefined && !canJudgeLead(ctx)) return fail(ctx.res, 403, '达人评级只能由运营或高级运营修改（招募岗只收集报名信息）');
  const patch = {};
  if (b.talentLevel !== undefined) {
    if (!TALENT_LEVEL_ANY.includes(b.talentLevel)) return fail(ctx.res, 400, '非法达人评级: ' + b.talentLevel);
    patch.talentLevel = b.talentLevel; patch.level = b.talentLevel;     // level 镜像，SLA 高潜口径同步
  }
  if (b.talentStatus !== undefined) {
    if (!TALENT_STATUS.includes(b.talentStatus)) return fail(ctx.res, 400, '非法生命周期: ' + b.talentStatus);
    patch.talentStatus = b.talentStatus;
  }
  if (b.nextAction !== undefined) patch.nextAction = String(b.nextAction || '').slice(0, 200);
  if (!Object.keys(patch).length) return fail(ctx.res, 400, '没有需要更新的字段');
  const updated = await db.update(coll, t.id, patch);
  await addLog(ctx.operator, '达人：' + t.name, '达人评级 / 生命周期',
    '评级=' + (t.talentLevel || 'C') + '；生命周期=' + (TALENT_STATUS_LABEL[t.talentStatus] || '未设置'),
    '评级=' + (updated.talentLevel || 'C') + '；生命周期=' + (TALENT_STATUS_LABEL[updated.talentStatus] || '未设置'));
  ok(ctx.res, toMvpLead(updated));
});

/* ---------------- 运营团队效率（高级运营 / 管理员）----------------
 * 按「运营岗同事」逐个聚合：负责达人 / 异常数 / 任务完成率 / 待办积压。
 * 主管用它回答「谁忙谁闲、谁的质量需要盯」。 */
route('GET', '/api/mvp/team', async (ctx) => {
  if (!isSupervisor(ctx)) return fail(ctx.res, 403, '只有主管（管理员/高级运营）可以查看运营团队');
  ok(ctx.res, { members: await buildTeamMembers(), today: fmtDate(new Date()) });
});

/* ---------------- 运营成长任务（高级运营 → 普通运营）----------------
 * 与寄拍任务（tasks）分表：寄拍任务是「一次一物一人」的执行单，运营成长任务是
 * 「一条方法/方向 + 多达人」的运营动作，结构差异大，塞同一张表会互相污染字段。
 * 权限：主管创建/派发/删除；被指派人可改状态与进展。 */
route('GET', '/api/ops-tasks', async (ctx) => {
  if (ctx.roleCode === 'finance' || ctx.position === 'finance') return fail(ctx.res, 403, '财务岗不参与运营任务');
  let arr = (await db.list('opsTasks')).filter(k => k.isActive !== false);
  if (!isSupervisor(ctx)) {
    // 普通运营 / 招募只看指派给自己的
    arr = arr.filter(k => (ctx.authUser && k.ownerId === ctx.authUser) || k.owner === (ctx.displayName || ''));
  }
  arr.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  ok(ctx.res, arr.map(toOpsTask));
});
route('POST', '/api/ops-tasks', async (ctx) => {
  if (!isSupervisor(ctx)) return fail(ctx.res, 403, '只有主管（管理员/高级运营）可以创建运营任务');
  const b = ctx.body || {};
  const title = String(b.title || '').trim();
  if (!title) return fail(ctx.res, 400, '请填写任务标题');
  const target = b.owner ? userRecByName(b.owner) : null;
  if (!target) return fail(ctx.res, 400, '请选择负责人（运营岗同事）');
  const tp = target.position || '';
  if (!['ops', 'senior_ops'].includes(tp)) return fail(ctx.res, 400, '运营任务只能分配给运营岗（当前：' + posLabel(tp) + '）');
  const rec = {
    id: await nextId('opsTasks', 'OT', 4),
    title, contentDirection: String(b.contentDirection || '').slice(0, 200),
    productType: String(b.productType || '').slice(0, 60),
    reason: String(b.reason || '').slice(0, 500),
    talentIds: Array.isArray(b.talentIds) ? b.talentIds.filter(Boolean).slice(0, 200) : [],
    owner: nameOf(target), ownerId: target.user,
    status: OPS_TASK_STATUSES.includes(b.status) ? b.status : '待开始',
    dueAt: b.dueAt ? String(b.dueAt).slice(0, 10) : '',
    note: String(b.note || '').slice(0, 300),
    createdBy: ctx.displayName || ctx.operator, createdById: ctx.authUser || '',
    createdAt: nowStr(), isActive: true,
  };
  rec.talentNames = await namesOfTalents(rec.talentIds);
  await db.insert('opsTasks', rec);
  await addLog(ctx.operator, '运营任务：' + rec.id + ' ' + title, '创建运营任务', '',
    '负责人=' + rec.owner + ' 关联达人=' + rec.talentIds.length + ' 人' + (rec.dueAt ? ' 截止=' + rec.dueAt : ''));
  notify('新运营任务：' + title + '\n负责人：' + rec.owner + '\n关联达人：' + rec.talentIds.length + ' 人');
  ok(ctx.res, rec);
});
route('PUT', '/api/ops-tasks/:id', async (ctx) => {
  if (!ctx.role.mutate) return fail(ctx.res, 403, '当前角色无修改权限');
  const k = await db.get('opsTasks', ctx.params.id);
  if (!k) return fail(ctx.res, 404, '运营任务不存在');
  const mineTask = (ctx.authUser && k.ownerId === ctx.authUser) || k.owner === (ctx.displayName || ctx.operator);
  if (!isSupervisor(ctx) && !mineTask) return fail(ctx.res, 403, '只能更新指派给自己的运营任务');
  const b = ctx.body || {};
  const patch = {};
  if (b.status !== undefined) {
    if (!OPS_TASK_STATUSES.includes(b.status)) return fail(ctx.res, 400, '非法任务状态: ' + b.status);
    patch.status = b.status;
  }
  if (b.progress !== undefined) patch.progress = String(b.progress || '').slice(0, 500);
  if (b.note !== undefined) patch.note = String(b.note || '').slice(0, 300);
  if (b.dueAt !== undefined) patch.dueAt = b.dueAt ? String(b.dueAt).slice(0, 10) : '';
  if (b.title !== undefined && isSupervisor(ctx)) patch.title = String(b.title).trim().slice(0, 120);
  if (!Object.keys(patch).length) return fail(ctx.res, 400, '没有需要更新的字段');
  const updated = await db.update('opsTasks', k.id, patch);
  if (patch.status) await addLog(ctx.operator, '运营任务：' + k.id + ' ' + k.title, '运营任务' + patch.status, k.status, patch.status);
  ok(ctx.res, toOpsTask(updated));
});
route('DELETE', '/api/ops-tasks/:id', async (ctx) => {
  if (!isSupervisor(ctx)) return fail(ctx.res, 403, '只有主管可以删除运营任务');
  await db.update('opsTasks', ctx.params.id, { isActive: false });
  await addLog(ctx.operator, '运营任务：' + ctx.params.id, '删除运营任务', '', '');
  ok(ctx.res, { deleted: true });
});

/* ---------------- 爆款拆解库（高级运营方法沉淀）----------------
 * 字段：标题 / 内容方向 / 商品类型 / 爆款原因 / 适用达人。
 * 全岗位可读（招募/运营/主管/管理员），仅主管可写 —— 方法沉淀是给一线用的资产。 */
route('GET', '/api/hit-cases', async (ctx) => {
  if (!['admin', 'recruit', 'ops', 'senior_ops'].includes(ctx.roleCode === 'admin' ? 'admin' : (ctx.position || ''))) {
    return fail(ctx.res, 403, '当前岗位不参与内容运营');
  }
  const q = String(ctx.query.get('q') || '').trim();
  let arr = (await db.list('hitCases')).filter(c => c.isActive !== false);
  if (q) arr = arr.filter(c => (c.title + c.contentDirection + c.productType + c.reason).includes(q));
  arr.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  ok(ctx.res, arr.map(toHitCase));
});
route('POST', '/api/hit-cases', async (ctx) => {
  if (!isSupervisor(ctx)) return fail(ctx.res, 403, '只有主管（管理员/高级运营）可以沉淀爆款拆解');
  const b = ctx.body || {};
  const title = String(b.title || '').trim();
  if (!title) return fail(ctx.res, 400, '请填写标题');
  if (!String(b.reason || '').trim()) return fail(ctx.res, 400, '请填写爆款原因');
  const rec = {
    id: await nextId('hitCases', 'HC', 4),
    title: title.slice(0, 120),
    contentDirection: String(b.contentDirection || '').slice(0, 200),
    productType: String(b.productType || '').slice(0, 60),
    reason: String(b.reason || '').slice(0, 800),
    fitTalents: String(b.fitTalents || '').slice(0, 300),
    talentIds: Array.isArray(b.talentIds) ? b.talentIds.filter(Boolean).slice(0, 100) : [],
    refUrl: String(b.refUrl || '').slice(0, 300),
    createdBy: ctx.displayName || ctx.operator, createdById: ctx.authUser || '',
    createdAt: nowStr(), isActive: true,
  };
  await db.insert('hitCases', rec);
  await addLog(ctx.operator, '爆款拆解：' + rec.id + ' ' + rec.title, '新增爆款拆解', '', rec.contentDirection || rec.productType);
  ok(ctx.res, rec);
});
route('PUT', '/api/hit-cases/:id', async (ctx) => {
  if (!isSupervisor(ctx)) return fail(ctx.res, 403, '只有主管（管理员/高级运营）可以修改爆款拆解');
  const c = await db.get('hitCases', ctx.params.id);
  if (!c) return fail(ctx.res, 404, '记录不存在');
  const b = ctx.body || {};
  const patch = {};
  for (const k of ['title', 'contentDirection', 'productType', 'reason', 'fitTalents', 'refUrl']) {
    if (b[k] !== undefined) patch[k] = String(b[k] || '').slice(0, 800);
  }
  if (!Object.keys(patch).length) return fail(ctx.res, 400, '没有需要更新的字段');
  ok(ctx.res, await db.update('hitCases', c.id, patch));
});
route('DELETE', '/api/hit-cases/:id', async (ctx) => {
  if (!isSupervisor(ctx)) return fail(ctx.res, 403, '只有主管（管理员/高级运营）可以删除爆款拆解');
  await db.update('hitCases', ctx.params.id, { isActive: false });
  ok(ctx.res, { deleted: true });
});

route('GET', '/api/mvp/leads/:id/follow-ups', async (ctx) => {
  // 线索转为正式达人后会搬到达人库（保留原 ID），这里回退查询，保证转化后仍能看到招募期的跟进历史
  let t = await db.get('leads', ctx.params.id);
  let fromTalent = false;
  if (!t) { t = await db.get('talents', ctx.params.id); fromTalent = true; }
  if (!t) return fail(ctx.res, 404, '线索不存在');
  // 可见性统一走服务端裁决：线索池按行级可见性，达人库按「主管或我的」
  const visible = fromTalent ? (isSupervisor(ctx) || isMine(t, ctx)) : leadVisibleTo(t, ctx, 'position');
  if (!visible) return fail(ctx.res, 403, '无权查看该线索的跟进记录');
  const arr = await db.list('followups');
  const rows = arr.filter(f => f.talentId === t.id).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  // 分配/交接历史并入时间轴（2026-09-18）：「谁把达人分给了谁 + 备注」与跟进记录同一条时间线可见
  const assigns = (await db.list('talentAssignments')).filter(a => a.talentId === t.id && a.isActive !== false);
  const assignRows = assigns.map(a => ({
    id: a.id, talentId: a.talentId, talentName: a.talentName,
    content: '【' + (a.type || '达人分配') + '】' + (a.fromOwner ? a.fromOwner + ' → ' : '') + a.toOwner
      + (a.remark ? '；备注：' + a.remark : ''),
    method: '分配记录', nextAt: '', nextAction: '', type: '分配',
    operator: a.assignedBy || '', operatorId: a.assignedById || '', createdAt: a.assignedAt || '',
  }));
  const merged = assignRows.concat(rows.map(toFollowup))
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  ok(ctx.res, merged.slice(0, 200));
});
// 分配记录独立查询：某位达人的分配/重新分配历史（主管或现负责人可见）
route('GET', '/api/mvp/leads/:id/assignments', async (ctx) => {
  let t = await db.get('leads', ctx.params.id);
  let fromTalent = false;
  if (!t) { t = await db.get('talents', ctx.params.id); fromTalent = true; }
  if (!t) return fail(ctx.res, 404, '线索不存在');
  const visible = fromTalent ? (isSupervisor(ctx) || isMine(t, ctx)) : leadVisibleTo(t, ctx, 'position');
  if (!visible) return fail(ctx.res, 403, '无权查看该达人的分配记录');
  const rows = (await db.list('talentAssignments'))
    .filter(a => a.talentId === t.id && a.isActive !== false)
    .sort((a, b) => String(b.assignedAt || '').localeCompare(String(a.assignedAt || '')));
  ok(ctx.res, rows.slice(0, 100));
});
route('POST', '/api/mvp/leads/:id/follow-ups', async (ctx) => {
  if (!ctx.role.mutate) return fail(ctx.res, 403, '当前角色无修改权限');
  // 线索转化为正式达人后 ID 不变但记录搬到达人库 → 这里回退查询，保证转化后仍能继续登记跟进（时间轴不断链）
  let t = await db.get('leads', ctx.params.id);
  let fromTalent = false;
  if (!t) { t = await db.get('talents', ctx.params.id); fromTalent = true; }
  if (!t) return fail(ctx.res, 404, '线索不存在');
  if (!canTouchLead(t, ctx)) return fail(ctx.res, 403, '只能跟进自己负责的线索');
  const b = ctx.body || {};
  // 判断字段分层（2026-09-18）：招募跟进不写判断字段（潜力/意愿/分类只能由运营/高级运营修改），静默忽略，跟进本身照常落库
  if (!canJudgeLead(ctx)) { b.potentialLevel = undefined; b.intentLevel = undefined; b.talentClass = undefined; }
  if (!b.content && !b.result) return fail(ctx.res, 400, '请填写跟进内容或结果');
  const nowT = nowStr();
  const patch = { lastFollowAt: nowT, lastFollowupAt: nowT };
  // 跟进时间轴的「下一步动作」：写进达人档案的 nextAction（账号运营页同字段），形成「记录 + 待办」闭环
  if (b.nextAction !== undefined) patch.nextAction = String(b.nextAction || '').slice(0, 200);
  // 首次联系：第一次跟进即视为完成首次触达，SLA 计时结束（已有值则保留，便于回看首次联系用了多久）
  if (!t.firstContactAt) patch.firstContactAt = nowT;
  if (b.nextFollowAt) patch.nextFollowAt = b.nextFollowAt;
  if (b.status && MVP_STAGE_REVERSE[b.status]) patch.status = MVP_STAGE_REVERSE[b.status];
  else if (b.stage && MVP_STAGE_REVERSE[b.stage]) patch.status = MVP_STAGE_REVERSE[b.stage];
  if (b.potentialLevel) patch.potentialLevel = b.potentialLevel;
  if (b.intentLevel) patch.intentLevel = b.intentLevel;
  if (b.talentClass) patch.talentClass = b.talentClass;
  if (b.note !== undefined) patch.note = b.note;
  // 跟进把阶段推到「合作中」= 转化为正式达人：先迁移再落跟进记录（ID 不变，记录跟到达人库）
  let updated;
  if (!fromTalent && patch.status === '合作中') {
    updated = await promoteToTalent(Object.assign({}, t, patch), ctx.displayName || ctx.operator, ctx.authUser || ctx.operator, t.status, '跟进中转化');
  } else {
    updated = await db.update(fromTalent ? 'talents' : 'leads', t.id, patch);
  }
  const rec = {
    id: await nextId('followups', 'F', 4),
    talentId: t.id, talentName: t.name,
    method: FOLLOW_METHODS_SRV.includes(b.method) ? b.method : (b.method || '其他'),
    result: String(b.result || '').slice(0, 60), content: String(b.content || '').slice(0, 500),
    stage: updated.status || '', potentialLevel: updated.potentialLevel || '', intentLevel: updated.intentLevel || '',
    talentClass: updated.talentClass || '', nextAt: patch.nextFollowAt || '',
    nextAction: patch.nextAction || updated.nextAction || '',
    operator: ctx.displayName || ctx.operator, operatorId: ctx.authUser || '', createdAt: nowT,
  };
  await db.insert('followups', rec);
  await addLog(ctx.operator, '达人：' + t.name, '线索跟进记录',
    '上次跟进=' + String(t.lastFollowAt || '—'),
    (rec.method ? '方式=' + rec.method + '；' : '') + '结果=' + (rec.result || '—')
    + '；阶段=' + (t.status || '') + '→' + (updated.status || '')
    + '；下次跟进=' + (patch.nextFollowAt || '未安排'));
  ok(ctx.res, { followup: toFollowup(rec), lead: toMvpLead(updated) });
});

// 删除线索（达人线索页「删除」按钮）：从达人库物理删除，写操作日志
route('DELETE', '/api/mvp/leads/:id', async (ctx) => {
  if (!ctx.role.mutate) return fail(ctx.res, 403, '当前角色无修改权限');
  const t = await db.get('leads', ctx.params.id);
  if (!t) return fail(ctx.res, 404, '线索不存在');
  // 行级校验：只有管理员或该线索的负责人本人可删（与 PUT 同口径，避免一线互相删对方线索）
  if (!canTouchLead(t, ctx)) return fail(ctx.res, 403, '只能删除自己负责的线索');
  await db.remove('leads', ctx.params.id);
  // 级联清理：跟进记录跟着线索一起删。否则孤儿 followups 会挂在一个将来被新线索复用的 ID 上
  //（nextId 取现存最大值 +1，删掉的 ID 会被复用），污染下一条同 ID 线索的「跟进记录读回」。
  const fus = await db.list('followups');
  for (const f of fus) { if (f.talentId === ctx.params.id) await db.remove('followups', f.id); }
  // 级联清理：分配记录同理跟着删，避免孤儿 talentAssignments 挂到将来被复用的 ID 上
  const tas = await db.list('talentAssignments');
  for (const a of tas) { if (a.talentId === ctx.params.id) await db.remove('talentAssignments', a.id); }
  await addLog(ctx.operator, '达人：' + t.name, '删除线索', '状态=' + t.status, '已删除');
  ok(ctx.res, { id: ctx.params.id, deleted: true });
});

/* ============================================================
 * 转为正式达人：线索负责人发起（管理员可代操作）——记录从线索池迁入达人库（保留原 ID），
 * 固化「转化人 / 转化时间」。「转化」与「交接」是两件事：
 *   转化 = 线索招募完成，进入正式达人库（负责人仍是招募，直到发起交接）
 *   交接 = 把正式达人移交给运营长期管理（见下方 handovers）
 * ============================================================ */
// 转化不变式：把一条线索记录迁入达人库（保留原 ID，固化「转化人 / 转化时间」）。
// 任何把线索推到「合作中」的路径（显式转化接口 / 改状态 / 跟进推送）都必须走这里，
// 否则会出现「线索池里躺着合作中记录、达人库查无此人」的两库不一致。
async function promoteToTalent(merged, operatorName, operatorId, fromStatus, extraLog) {
  const nowT = nowStr();
  const rec = Object.assign({}, merged, {
    status: '合作中',
    convertedBy: merged.convertedBy || operatorName || '',
    convertedById: merged.convertedById || operatorId || '',
    convertedAt: merged.convertedAt || nowT,
    nextFollowAt: '',   // 转化后进入达人管理节奏，不再挂在「今日待跟进」里
  });
  // 负责人本身是运营岗（管理员直建/直派的运营线索）→ 顺手固化运营负责人，口径与分配一致
  if (rec.ownerPosition === 'ops' && !rec.opsId && rec.ownerId) {
    rec.opsBy = rec.owner; rec.opsId = rec.ownerId;
    if (!rec.opsAt) rec.opsAt = nowT;
  }
  // 转正式 = 生命周期进入「陪跑达人」，运营负责人同步固化
  rec.talentStatus = 'coaching';
  rec.talentOperator = rec.opsBy || rec.talentOperator || '';
  await db.remove('leads', rec.id);
  await db.insert('talents', rec);
  await addLog(operatorName || '系统', '达人：' + rec.name, '转为正式达人',
    '线索阶段=' + (fromStatus || '') + '；负责人=' + (rec.owner || '未分配'),
    '正式进入达人库；转化人=' + rec.convertedBy + '；转化时间=' + nowT + (extraLog ? '；' + extraLog : ''));
  return rec;
}
route('POST', '/api/mvp/leads/:id/convert', async (ctx) => {
  if (!ctx.role.mutate) return fail(ctx.res, 403, '当前角色无修改权限');
  const lead = await db.get('leads', ctx.params.id);
  if (!lead) return fail(ctx.res, 404, '线索不存在或已是正式达人');
  if (ctx.roleCode !== 'admin' && !isMine(lead, ctx)) return fail(ctx.res, 403, '只有线索负责人或管理员可以转为正式达人');
  if (lead.handoverStatus === 'pending') return fail(ctx.res, 400, '该线索有未处理的交接单，请先处理交接');
  const rec = await promoteToTalent(Object.assign({}, lead), ctx.displayName || ctx.operator, ctx.authUser || ctx.operator, lead.status);
  const toOps = rec.ownerPosition !== 'ops' && !rec.opsId;   // 负责人还是招募岗 → 待运营接收
  notify('「' + rec.name + '」已转为正式达人（转化人：' + rec.convertedBy + '）'
    + (toOps ? '；当前待运营接收，请发起交接给达人运营' : ''));
  ok(ctx.res, toMvpLead(rec));
});

/* ============================================================
 * SLA 主管动作（主管 = 管理员）
 *   流程：系统提醒 → 超时自动上报 → 主管「催办 / 重新分配」人工闭环
 *   红线：任何一步都不会自动换负责人，reassign 必须由主管显式提交
 * ============================================================ */
// 催办：主管推负责人一把（可附留言），通知 + 日志留痕；不改负责人、不改分配时间
route('POST', '/api/mvp/leads/:id/urge', async (ctx) => {
  if (!isSupervisor(ctx)) return fail(ctx.res, 403, '只有主管（管理员/高级运营）可以催办');
  const { rec: t, coll } = await findLeadOrTalent(ctx.params.id);
  if (!t) return fail(ctx.res, 404, '线索不存在');
  const sla = slaOf(t);
  if (sla.slaStatus === 'none') return fail(ctx.res, 400, '公海 / 已成交线索不适用 SLA 催办');
  if (sla.slaStatus === 'done') return fail(ctx.res, 409, '该线索已完成首次联系，无需催办');
  if (sla.slaStatus === 'normal') return fail(ctx.res, 409, '该线索还在时限内（剩余 ' + sla.slaRemainMin + ' 分钟），无需催办');
  const nowT = nowStr();
  const note = String((ctx.body && ctx.body.note) || '').slice(0, 200);
  const patch = {
    urgedAt: nowT, urgeBy: ctx.displayName || ctx.operator,
    urgeCount: (Number(t.urgeCount) || 0) + 1,
  };
  if (note) patch.urgeNote = note;
  const upd = await db.update(coll, t.id, patch);
  await addLog(ctx.operator, '达人：' + t.name, 'SLA 催办',
    '负责人=' + t.owner + '；SLA=' + sla.slaStatus + '（已用 ' + sla.slaUsedMin + ' 分钟 / 时限 ' + sla.slaOverdueMin + ' 分钟）',
    '第 ' + patch.urgeCount + ' 次催办' + (note ? '；留言=' + note : ''));
  notify('催办：请尽快首次联系「' + t.name + '」（负责人 ' + t.owner + '，' + sla.slaRuleLabel + '）');
  ok(ctx.res, toMvpLead(upd));
});
// 重新分配：主管确认后换人 —— 复用 doAssign（含岗位边界校验/日志），再补 SLA 重计时字段
route('POST', '/api/mvp/leads/:id/reassign', async (ctx) => {
  if (!isSupervisor(ctx)) return fail(ctx.res, 403, '只有主管（管理员/高级运营）可以重新分配');
  const b = ctx.body || {};
  if (!b.owner) return fail(ctx.res, 400, '请选择新的负责人');
  const { rec: t, coll } = await findLeadOrTalent(ctx.params.id);
  if (!t) return fail(ctx.res, 404, '线索不存在');
  if (t.owner === b.owner) return fail(ctx.res, 400, '新负责人与当前负责人相同，请选择其他人');
  const sla = slaOf(t);
  const r = await doAssign([t.id], b.owner, b.ownerPosition, ctx, 'SLA 重新分配', b.reason || b.remark);
  if (r.error) return fail(ctx.res, 400, r.error);
  if (!r.changed.length) return fail(ctx.res, 409, (r.skipped[0] && r.skipped[0].reason) || '重新分配未生效');
  const nowT = nowStr();
  // 换人 = SLA 重新计时：清空「已上报 / 超时原因 / 催办次数」，assign 已把 assignedAt 刷成现在
  const upd = await db.update(coll, t.id, {
    reassignedAt: nowT, reassignFrom: t.owner || '', reassignFromId: t.ownerId || '',
    reassignReason: String(b.reason || '').slice(0, 200),
    escalatedAt: '', overdueReason: '', overdueReasonAt: '', urgeCount: 0,
  });
  await addLog(ctx.operator, '达人：' + t.name, 'SLA 重新分配',
    '原负责人=' + (t.owner || '未分配') + '（SLA=' + sla.slaStatus + '）',
    '新负责人=' + b.owner + '；原因=' + (b.reason || '—') + '；分配时间已重置，SLA 重新计时');
  notify('SLA 重新分配：' + t.name + ' 已由 ' + (t.owner || '未分配') + ' 转给 ' + b.owner + '，请尽快首次联系');
  ok(ctx.res, toMvpLead(upd));
});
// 填写超时原因：负责人（或主管）说明为什么没在时限内首次联系；只留痕，不改 SLA 结论
route('POST', '/api/mvp/leads/:id/overdue-reason', async (ctx) => {
  if (!ctx.role.mutate) return fail(ctx.res, 403, '当前角色无修改权限');
  const { rec: t, coll } = await findLeadOrTalent(ctx.params.id);
  if (!t) return fail(ctx.res, 404, '线索不存在');
  if (!canTouchLead(t, ctx)) return fail(ctx.res, 403, '只有线索负责人或主管可以填写超时原因');
  const reason = String((ctx.body && ctx.body.reason) || '').trim();
  if (!reason) return fail(ctx.res, 400, '请填写超时原因');
  const sla = slaOf(t);
  const nowT = nowStr();
  const upd = await db.update(coll, t.id, {
    overdueReason: reason.slice(0, 300), overdueReasonAt: nowT,
    overdueReasonBy: ctx.displayName || ctx.operator,
  });
  await addLog(ctx.operator, '达人：' + t.name, 'SLA 超时原因',
    'SLA=' + sla.slaStatus + '；已用 ' + sla.slaUsedMin + ' 分钟',
    '原因=' + reason.slice(0, 120));
  notify('超时原因已记录：' + t.name + '（' + (ctx.displayName || ctx.operator) + '）');
  ok(ctx.res, toMvpLead(upd));
});

// 删除正式达人（管理员专用：清理与纠错；物理删除并写日志）
route('DELETE', '/api/talents/:id', async (ctx) => {
  if (ctx.roleCode !== 'admin') return fail(ctx.res, 403, '只有管理员可以删除达人档案');
  const t = await db.get('talents', ctx.params.id);
  if (!t) return fail(ctx.res, 404, '达人不存在');
  await db.remove('talents', ctx.params.id);
  // 级联清理：分配记录跟着达人一起删（与删线索级联同口径，避免孤儿记录挂到将来复用的 ID 上）
  const tas = await db.list('talentAssignments');
  for (const a of tas) { if (a.talentId === ctx.params.id) await db.remove('talentAssignments', a.id); }
  await addLog(ctx.operator, '达人：' + t.name, '删除达人档案', '状态=' + t.status, '已删除');
  ok(ctx.res, { id: ctx.params.id, deleted: true });
});
// 达人档案：正式达人库列表（转化后的达人）。管理员全量；招募/运营只看自己名下；其他岗位不开放
route('GET', '/api/mvp/talents', async (ctx) => {
  const myPos = ctx.position || '';
  if (ctx.roleCode !== 'admin' && !['recruit', 'ops', 'senior_ops'].includes(myPos)) {
    return fail(ctx.res, 403, '达人档案仅对招募 / 运营 / 高级运营 / 管理员开放');
  }
  const q = ctx.query.get('q') || '';
  let arr = (await db.list('talents')).filter(t => t.isActive !== false);
  // 高级运营：跨运营负责人查看全部达人（管理质量）；普通运营只看自己名下
  if (ctx.roleCode !== 'admin' && myPos !== 'senior_ops') arr = arr.filter(t => isMine(t, ctx) || isPendingForMe(t, ctx));
  if (q) arr = arr.filter(t => [t.name, t.contact].some(v => String(v || '').includes(q)));
  // 寄拍结果回流汇总：累计任务数 / 进行中 / 累计佣金收益 / 最近发布时间（真实来自 tasks 集合）
  const tasks = await db.list('tasks');
  const agg = {};
  for (const k of tasks) {
    if (k.isActive === false || !k.talentId) continue;
    const a = (agg[k.talentId] = agg[k.talentId] || { taskTotal: 0, taskActive: 0, totalCommission: 0, lastPublish: '' });
    a.taskTotal++;
    if (ACTIVE_TASK.includes(k.status)) a.taskActive++;
    a.totalCommission += Number(k.commission) || 0;
    const p = String(k.publishedAt || '').slice(0, 10);
    if (p && p > a.lastPublish) a.lastPublish = p;
  }
  ok(ctx.res, arr
    .map(t => Object.assign(toMvpLead(t), {
      taskTotal: (agg[t.id] && agg[t.id].taskTotal) || 0,
      taskActive: (agg[t.id] && agg[t.id].taskActive) || 0,
      totalCommission: round2((agg[t.id] && agg[t.id].totalCommission) || 0),
      lastPublish: (agg[t.id] && agg[t.id].lastPublish) || String(t.dewuLastPublish || '').slice(0, 10),
    }))
    .sort((a, b) => String(b.convertedAt || b.createdAt || '').localeCompare(String(a.convertedAt || a.createdAt || ''))));
});
/* ============================================================
 * 线索交接：发起（选接收人 + 接收岗位）→ 接收人确认 → 负责人自动变更
 * 独立存 handovers 集合，每一步都写入 logs 留痕
 * ============================================================ */
// 按 ID 定位记录：优先线索池，其次达人库（线索转化前在 leads，转化后在 talents，ID 不变）
// 返回 { rec, coll }，找不到时 rec 为 null
async function findLeadOrTalent(id) {
  const lead = await db.get('leads', id);
  if (lead) return { rec: lead, coll: 'leads' };
  const talent = await db.get('talents', id);
  if (talent) return { rec: talent, coll: 'talents' };
  return { rec: null, coll: '' };
}
function toHandover(h) {
  return {
    id: h.id, talentId: h.talentId, talentName: h.talentName,
    fromUser: h.fromUser || '', fromUserId: h.fromUserId || '', fromPosition: h.fromPosition || '',
    fromPositionLabel: posLabel(h.fromPosition),
    toUser: h.toUser || '', toUserId: h.toUserId || '', toPosition: h.toPosition || '',
    toPositionLabel: posLabel(h.toPosition),
    reason: h.reason || '', note: h.note || '', status: h.status || 'pending', operator: h.operator || '',
    situation: h.situation || '', accountState: h.accountState || '', coopWay: h.coopWay || '',
    contentDirection: h.contentDirection || '', risk: h.risk || '', nextSuggest: h.nextSuggest || '',
    createdAt: h.createdAt || '', confirmedAt: h.confirmedAt || '',
    statusLabel: { pending: '待确认', confirmed: '已接收', rejected: '已驳回', cancelled: '已撤回' }[h.status || 'pending'] || h.status,
  };
}
function findUserByName(name) {
  return (AUTH && Array.isArray(AUTH.users) ? AUTH.users : []).find(x => x.user === name || nameOf(x) === name);
}
// 可交接的人选（前端下拉用）：排除指定的当前负责人
route('GET', '/api/mvp/handover-targets', async (ctx) => {
  const exclude = ctx.query.get('exclude') || '';
  // 可选按岗位过滤：分配 / 交接达人 → recruit,ops；指派寄拍执行人 → ops,sample
  const ps = (ctx.query.get('positions') || '').split(',').map(s => s.trim()).filter(Boolean);
  ok(ctx.res, (AUTH && Array.isArray(AUTH.users) ? AUTH.users : [])
    .filter(x => nameOf(x) !== exclude)
    .filter(x => !ps.length || ps.includes(x.position || ''))
    .map(x => ({ user: x.user, name: nameOf(x), position: x.position || '', positionLabel: posLabel(x.position), role: x.role })));
});
// 交接单列表：box=inbox 待我确认 / outbox 我发起的 / all 全部（仅管理员）
route('GET', '/api/mvp/handovers', async (ctx) => {
  const arr = await db.list('handovers');
  const box = ctx.query.get('box') || 'inbox';
  const meName = ctx.displayName || '';
  let rows = arr.slice();
  if (ctx.roleCode === 'admin' && box === 'all') { /* 全部 */ }
  else if (box === 'outbox') rows = rows.filter(h => h.fromUser === meName);
  else rows = rows.filter(h => h.toUser === meName && h.status === 'pending');
  rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  ok(ctx.res, rows.slice(0, 300).map(toHandover));
});
// 发起交接（新路径 /api/mvp/leads/:id/handover 与旧路径 /api/mvp/handovers 都走这里）
async function createHandover(ctx) {
  if (!ctx.role.mutate) return fail(ctx.res, 403, '当前角色无修改权限');
  const b = ctx.body || {};
  const talentId = ctx.params.id || b.talentId;
  const { rec: t, coll } = await findLeadOrTalent(talentId);
  if (!t) return fail(ctx.res, 404, '线索不存在');
  if (!canTouchLead(t, ctx)) return fail(ctx.res, 403, '只有当前负责人可以发起交接');
  if (t.handoverStatus === 'pending') return fail(ctx.res, 409, '该线索已有一条待确认的交接，请先等接收人处理');
  const toUser = String(b.toUser || '').trim();
  if (!toUser) return fail(ctx.res, 400, '请选择接收人');
  if (toUser === t.owner) return fail(ctx.res, 400, '接收人与当前负责人相同');
  const target = findUserByName(toUser);
  if (!target) return fail(ctx.res, 400, '接收人不存在：' + toUser);
  // 接收岗位默认取接收人账号上的岗位，管理员可在发起时覆盖
  const toPosition = POSITIONS.includes(b.toPosition) ? b.toPosition : (target.position || '');
  // 岗位职责边界：达人交接只能交给招募 / 运营岗（招募完成后 → 运营长期管理）
  if (!OWNER_POSITIONS.includes(toPosition)) {
    return fail(ctx.res, 400, '「' + posLabel(toPosition) + '」岗不做达人负责人（高级运营管质量、财务岗只管结算），请交接给招募或运营岗');
  }
  const rec = {
    id: await nextId('handovers', 'HO', 4),
    talentId: t.id, talentName: t.name,
    fromUser: t.owner || ctx.displayName || ctx.operator,
    fromUserId: t.ownerId || uidByName(t.owner || ''),
    fromPosition: t.ownerPosition || '',
    toUser: nameOf(target), toUserId: target.user, toPosition,
    reason: String(b.reason || '').slice(0, 200),
    note: String(b.note || '').slice(0, 500),
    // 交接单结构化信息（招募 → 运营的知识传递，确认后完整保留在交接单里可回看）
    situation: String(b.situation || '').slice(0, 500),          // 达人当前情况
    accountState: String(b.accountState || '').slice(0, 300),    // 账号情况
    coopWay: String(b.coopWay || '').slice(0, 200),              // 合作方式
    contentDirection: String(b.contentDirection || '').slice(0, 300), // 已知内容方向
    risk: String(b.risk || '').slice(0, 300),                    // 风险 / 注意事项
    nextSuggest: String(b.nextSuggest || '').slice(0, 300),      // 下一步建议
    status: 'pending', operator: ctx.operator, createdAt: nowStr(), confirmedAt: '',
  };
  await db.insert('handovers', rec);
  // 交接期间原负责人不变（current_owner 仍是他），只挂上「待确认」标记
  await db.update(coll, t.id, {
    handoverStatus: 'pending',
    handoverFrom: rec.fromUser, handoverFromId: rec.fromUserId, handoverFromPosition: rec.fromPosition,
    handoverTo: rec.toUser, handoverToId: rec.toUserId, handoverToPosition: toPosition,
    handoverReason: rec.reason, handoverNote: rec.note, handoverRisk: rec.risk,
    handoverAt: rec.createdAt, handoverReceivedAt: '', handoverBy: ctx.authUser || ctx.operator,
  });
  await addLog(ctx.operator, '达人：' + t.name, '线索交接-发起',
    '负责人=' + rec.fromUser + '（' + posLabel(rec.fromPosition) + '）',
    '待 ' + rec.toUser + '（' + posLabel(toPosition) + '）确认'
    + (rec.reason ? '；原因=' + rec.reason : '')
    + (rec.note ? '；说明=' + rec.note : ''));
  notify('待确认交接：' + t.name + ' → ' + rec.toUser + '（' + posLabel(toPosition) + '）');
  ok(ctx.res, toHandover(rec));
}
route('POST', '/api/mvp/handovers', createHandover);
// 语义更清晰的等价路径：对某条线索发起交接
route('POST', '/api/mvp/leads/:id/handover', createHandover);
// 接收人处理交接：confirm/accept 确认接收 / reject 驳回；发起人 cancel 撤回；管理员 force 强制指派
route('POST', '/api/mvp/handovers/:id/:action', async (ctx) => {
  let action = ctx.params.action;
  if (action === 'accept') action = 'confirm'; // 语义别名
  if (!['confirm', 'reject', 'cancel', 'force'].includes(action)) return fail(ctx.res, 404, '未知的交接操作');
  const h = await db.get('handovers', ctx.params.id);
  if (!h) return fail(ctx.res, 404, '交接单不存在');
  if (h.status !== 'pending') return fail(ctx.res, 409, '该交接单已处理（' + h.status + '）');
  const { rec: t, coll } = await findLeadOrTalent(h.talentId);
  const meName = ctx.displayName || '';
  const isAdmin = ctx.roleCode === 'admin';
  if (action === 'confirm' || action === 'reject') {
    if (!isAdmin && meName !== h.toUser) return fail(ctx.res, 403, '只有接收人本人可以处理该交接');
  } else if (action === 'cancel') {
    if (!isAdmin && meName !== h.fromUser) return fail(ctx.res, 403, '只有发起人可以撤回该交接');
  } else if (action === 'force' && !isAdmin) {
    return fail(ctx.res, 403, '强制指派需要管理员权限');
  }
  const newStatus = (action === 'reject') ? 'rejected' : (action === 'cancel') ? 'cancelled' : 'confirmed';
  const ownerChanged = newStatus === 'confirmed';
  const nowT = nowStr();
  await db.update('handovers', h.id, { status: newStatus, confirmedAt: nowT, operator: ctx.operator });
  if (t) {
    // 交接摘要保留在线索上（便于在总表看「上次交接从谁到谁」），只有负责人字段在有确认时变更
    const patchT = {
      handoverStatus: newStatus,
      handoverFrom: h.fromUser || '', handoverFromId: h.fromUserId || '',
      handoverFromPosition: h.fromPosition || '',
      handoverTo: h.toUser || '', handoverToId: h.toUserId || '', handoverToPosition: h.toPosition || '',
      handoverReason: h.reason || '', handoverNote: h.note || '',
      handoverRisk: h.risk || '',
      handoverAt: h.createdAt || '', handoverBy: h.operator || '',
    };
    if (ownerChanged) {
      patchT.owner = h.toUser;
      patchT.ownerId = h.toUserId || uidByName(h.toUser);
      if (h.toPosition) patchT.ownerPosition = h.toPosition;
      patchT.assignedAt = nowT;          // 交接接收 = 一次负责人变更，刷新分配时间
      patchT.handoverReceivedAt = nowT;
      // 招募完成 → 交接给运营：固化「招募负责人」留痕（只记第一次，后续运营之间交接不覆盖）
      if (h.fromPosition === 'recruit' && !t.recruitById) {
        patchT.recruitBy = h.fromUser || '';
        patchT.recruitById = h.fromUserId || uidByName(h.fromUser || '');
      }
      // 交接给运营（含管理员直接指派运营）：固化「达人运营负责人」——与「线索负责人 owner」区分，
      // owner 会随后续再交接变化，opsBy 是这位达人真正归属的运营，只记第一次转入运营。
      if (h.toPosition === 'ops' && !t.opsId) {
        patchT.opsBy = h.toUser || '';
        patchT.opsId = h.toUserId || uidByName(h.toUser || '');
        patchT.opsAt = nowT;
      }
    } else {
      patchT.handoverReceivedAt = '';
    }
    await db.update(coll, t.id, patchT);
  }
  const logType = { confirm: '线索交接-确认', reject: '线索交接-驳回', cancel: '线索交接-撤回', force: '线索交接-强制指派' }[action];
  const beforeTxt = '负责人=' + h.fromUser + '（' + posLabel(h.fromPosition) + '）';
  const afterTxt = ownerChanged
    ? ('负责人=' + h.toUser + '（' + posLabel(h.toPosition) + '）；' + ctx.operator + ' 确认')
    : ('负责人保持 ' + h.fromUser + '；' + (action === 'reject' ? '接收人驳回' : '发起人撤回'));
  await addLog(ctx.operator, '达人：' + (h.talentName || h.talentId), logType, beforeTxt, afterTxt);
  ok(ctx.res, toHandover(Object.assign({}, h, { status: newStatus, confirmedAt: nowT })));
});
// 单条线索的流转历史（交接 / 状态 / 负责人变化）
route('GET', '/api/mvp/leads/:id/history', async (ctx) => {
  // 线索转化后会搬到达人库（保留原 ID），这里回退查询，转化后仍能回看招募期的流转历史
  let t = await db.get('leads', ctx.params.id);
  let fromTalent = false;
  if (!t) { t = await db.get('talents', ctx.params.id); fromTalent = true; }
  if (!t) return fail(ctx.res, 404, '线索不存在');
  const visible = fromTalent ? (ctx.roleCode === 'admin' || isMine(t, ctx)) : leadVisibleTo(t, ctx, 'position');
  if (!visible) return fail(ctx.res, 403, '无权查看该线索的历史');
  const arr = await db.list('logs');
  const key = '达人：' + t.name;
  const rows = arr.filter(l => l.target === key)
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .map(l => ({ id: l.id, at: l.at, operator: l.operator, type: l.type, before: l.before || '', after: l.after || '' }));
  ok(ctx.res, {
    talentId: t.id, name: t.name, owner: t.owner || '未分配',
    ownerPosition: t.ownerPosition || '', ownerPositionLabel: posLabel(t.ownerPosition),
    handoverStatus: t.handoverStatus || 'none', handoverTo: t.handoverTo || '',
    rows,
  });
});

/* ============================================================
 * 我的工作台待办：服务端按规则推导（第一版不上 AI，纯规则 + 真实字段）
 *   规则1 新分配给我       当前负责人=我 且 分配时间在 7 天内 且 分配后我还没跟进过
 *   规则2 今日待跟进       下次跟进时间 = 今天
 *   规则3 逾期未跟进       下次跟进时间 < 今天
 *   规则4 高潜强意愿未推进 潜力=高 且 意愿=强 且 还没进入合作
 *   规则5 待我接收交接     交接状态=待确认 且 接收人=我
 * 管理员额外看到「待分配（公海线索）」与全部待确认交接 —— 对应「管理员可以查看所有待办」
 * ============================================================ */
const WB_DONE_STATUS = ['已成为达人', '已流失', '无效线索'];
// 合并读取：线索池 + 达人库（工作台待办 / 看板漏斗 / 负责人负载要跨两库推导）
async function listLeadsAndTalents() {
  return [...(await db.list('leads')), ...(await db.list('talents'))].filter(t => t.isActive !== false);
}
route('GET', '/api/mvp/workbench', async (ctx) => {
  const all = await listLeadsAndTalents();
  await slaSweep(all);                                   // 惰性 SLA 扫描：超时未联系的在此自动上报
  const hPending = (await db.list('handovers')).filter(h => h.status === 'pending');
  const isAdmin = ctx.roleCode === 'admin';
  const myId = ctx.authUser || '';
  const meName = ctx.displayName || '';
  const myPos = ctx.position || '';
  const today = fmtDate(new Date());
  const sc = s => String(s || '').slice(0, 10);
  const ts = s => { const n = new Date(String(s || '').replace(' ', 'T')).getTime(); return isNaN(n) ? 0 : n; };
  const NOW = Date.now();
  const hoOf = id => hPending.find(h => h.talentId === id) || null;
  const rows = []; const seen = new Set();
  const add = (t, type, priority, action, due, source, hoId) => {
    const k = t.id + '|' + type; if (seen.has(k)) return; seen.add(k);
    rows.push({
      kind: 'talent', id: t.id, talentId: t.id, name: t.name, stage: MVP_STAGE_MAP[t.status] || '新线索',
      type, priority, action, due: due || '未安排', source: source || '',
      handoverId: hoId || '', owner: t.owner || '未分配',
      ownerPosition: t.ownerPosition || '', ownerPositionLabel: posLabel(t.ownerPosition),
    });
  };
  // —— 达人维度待办：招募（一线对接）/ 运营（长期管理）/ 主管=管理员+高级运营（总览）——
  {
    // 数据口径：非管理员只在自己的可见范围内推导；管理员看全部
    const universe = isAdmin ? all : all.filter(t => leadVisibleTo(t, ctx, 'position'));
    for (const t of universe) {
      const st = MVP_STAGE_MAP[t.status] || '新线索';
      const mine = isMine(t, ctx);
      const pend = hoOf(t.id);
      const iAmReceiver = t.handoverStatus === 'pending' && pend
        && ((myId && t.handoverToId === myId) || (!myId && !!meName && t.handoverTo === meName));
      if (iAmReceiver) { add(t, '待接收', '高', '查看达人情况后确认接收 / 驳回', sc(t.handoverAt), (t.handoverFrom || '原负责人') + ' 发起', pend.id); continue; }
      if (t.handoverStatus === 'pending' && pend && mine) { add(t, '待交接', '中', '等待 ' + t.handoverTo + ' 确认接收', sc(t.handoverAt), '我发起', pend.id); continue; }
      if (mine && t.nextFollowAt && sc(t.nextFollowAt) < today) { add(t, '逾期未跟进', '高', '立即联系，重新约定跟进时间', sc(t.nextFollowAt), '我负责'); continue; }
      // SLA：分配后的首次联系时限（高潜强意愿用严格档）。已超时排在「今日待跟进」之前——它是硬时限
      const sla = slaOf(t);
      if (mine && sla.slaStatus === 'overdue') {
        add(t, 'SLA 已超时', '高',
          '立即首次联系；无法联系请填写超时原因（' + sla.slaRuleLabel + '）',
          String(sla.slaDeadline).slice(11) || sc(t.assignedAt), 'SLA 超时' + (t.escalatedAt ? ' · 已上报主管' : ''));
        continue;
      }
      if (mine && sla.slaStatus === 'remind') {
        add(t, 'SLA 即将超时', '高',
          '尽快完成首次联系（剩余 ' + sla.slaRemainMin + ' 分钟）',
          String(sla.slaDeadline).slice(11), 'SLA 提醒');
        continue;
      }
      if (mine && t.nextFollowAt && sc(t.nextFollowAt) === today) { add(t, '今日待跟进', '高', st === '新线索' ? '首次触达，发送介绍资料' : '按计划跟进', sc(t.nextFollowAt), '我负责'); continue; }
      // 招募岗位职责的终点：达人确认合作后，交接给运营做长期管理（先于「新分配」判断：
      // 已合作的达人不应再算「首次触达」）
      if (mine && myPos === 'recruit' && !pend && (t.status === '合作中' || t.status === '暂停合作')) {
        add(t, '招募完成', '中', '交接给达人运营，达人转长期管理', '未安排', '我负责'); continue;
      }
      const aTs = ts(t.assignedAt);
      if (mine && aTs > 0 && (NOW - aTs) <= 7 * 86400000 && ts(t.lastFollowAt) <= aTs) { add(t, '新分配', '中', '首次触达，确认达人意向', sc(t.assignedAt), '管理员分配'); continue; }
      if (mine && t.potentialLevel === '高' && t.intentLevel === '强' && !WB_DONE_STATUS.includes(t.status)) { add(t, '高潜强意愿', '中', '推进分类与合作路径', '未安排', '我负责'); continue; }
      if (isAdmin && (!t.owner || t.owner === '未分配')) { add(t, '待分配', '中', '指派负责人后进入对应同事的工作台', '未安排', '公海线索'); }
    }
    if (isAdmin) {
      for (const h of hPending) {
        const t = all.find(x => x.id === h.talentId); if (!t) continue;
        add(t, '待接收', '高', '跟进 ' + h.toUser + ' 的处理进度（可强制指派）', sc(h.createdAt), h.fromUser + ' → ' + h.toUser, h.id);
      }
    }
  }
  // —— 任务维度待办（寄拍任务记录）：普通运营=我名下达人的任务；高级运营=全部任务（质检） ——
  const isOps = ['ops', 'senior_ops'].includes(myPos) && !isAdmin;
  const myTalentIds = (myPos === 'ops' && !isAdmin) ? new Set(all.filter(t => isMine(t, ctx)).map(t => t.id)) : null;
  if (isOps) {
    const tasks = await db.list('tasks');
    const taskOf = k => {
      const name = (k.talentName || '') + ' · ' + (k.product || '');
      const kk = k.id + '|task'; if (seen.has(kk)) return; seen.add(kk);
      // 按「现在该谁动」细分待办类型（质检视角沿用任务推进口径）
      let type = '寄拍任务', priority = '中', action = '推进「' + (k.status || '任务') + '」到下一状态';
      if (k.status === '超时') { type = '任务逾期'; priority = '高'; action = '任务已超时，联系寄拍同事处理'; }
      else if (k.status === '商品异常' || k.status === '内容不合格' || k.status === '达人拒绝') { type = '任务异常'; priority = '高'; action = '异常：' + String(k.issue || '').split('\n').pop(); }
      else if (isOps && k.status === '待审核') { type = '寄拍待审核'; priority = '高'; action = '审核寄拍内容' + (k.contentUrl ? '（' + k.contentUrl + '）' : ''); }
      else if (isOps && k.status === '待发布') { type = '内容待发布'; priority = '高'; action = '内容已过审，发布后标记已发布'; }
      else if (isOps && (k.status === '内容修改中')) { type = '退回修改中'; priority = '中'; action = '修改意见已回流：' + String(k.auditOpinion || '').slice(0, 40); }
      rows.push({
        kind: 'task', id: k.id, talentId: k.talentId || '', name,
        stage: k.status || '', type, priority, action,
        due: String(k.publishedAt || k.contentAt || k.createdAt || '').slice(0, 10) || '未安排',
        source: myPos === 'senior_ops' ? '全部任务（质检视角）' : '我名下达人的任务',
      });
    };
    for (const k of tasks) {
      if (k.isActive === false) continue;
      if (!ACTIVE_TASK.includes(k.status) && k.status !== '超时') continue;
      if (myTalentIds && !myTalentIds.has(k.talentId)) continue;   // 普通运营只看自己名下达人的任务；高级运营/管理员看全部
      taskOf(k);
    }
  }
  // —— 账号维度待办（账号运营链路）：运营岗名下达人的账号健康 ——
  if (isOps) {
    const accUniverse = isSupervisor(ctx) ? all : all.filter(t => isMine(t, ctx));
    for (const t of accUniverse) {
      const a = accRowOf(t);
      if (a.updateStale) {
        rows.push({ kind: 'account', id: 'acc-' + t.id, talentId: t.id, name: t.name, stage: a.status,
          type: '账号待更新', priority: '高', action: '已 ' + a.daysSincePublish + ' 天未更新（频率 ' + a.dewuUpdateDays + ' 天/更），安排新内容',
          due: a.dewuLastPublish, source: '我运营的账号' });
      } else if (a.dewuActivity === '低') {
        rows.push({ kind: 'account', id: 'acc-' + t.id, talentId: t.id, name: t.name, stage: a.status,
          type: '账号低信誉', priority: '中', action: '提升更新频率与互动，维护账号信誉等级',
          due: a.dewuLastPublish || '未安排', source: '我运营的账号' });
      }
    }
  }
  const order = { '高': 0, '中': 1, '低': 2 };
  rows.sort((a, b) => (order[a.priority] - order[b.priority]) || String(a.due).localeCompare(String(b.due)));
  const byType = tp => rows.filter(r => r.type === tp).length;
  // —— 岗位专属卡片：推广 / 寄拍 / 财务 的链路口径（招募 / 运营 / 管理员沿用 5 张达人卡）——
  let extraCards = [];
  if (isAdmin) {
    // 管理员工作台：哪里需要处理（未分配 / 超时线索 / 待运营接收 / 异常任务 / 逾期结算 / 待确认交接）
    const todayStr = fmtDate(new Date());
    const staleLeads = all.filter(t => t.owner && t.owner !== '未分配'
      && !WB_DONE_STATUS.includes(t.status) && t.lastFollowAt
      && (Date.now() - ts(t.lastFollowAt)) > 2 * 86400000).length;
    const opsPending = all.filter(t => ['合作中', '暂停合作'].includes(t.status)
      && t.ownerPosition !== 'ops' && !t.opsId).length;
    let settleOverdue = 0;
    try { settleOverdue = (await db.list('settlements')).filter(s => s.status !== '已结清' && s.dueDate && s.dueDate < todayStr).length; } catch (e) { }
    const abTasks = (await db.list('tasks')).filter(k => k.isActive !== false
      && ((k.status === '超时') || (ACTIVE_TASK.includes(k.status) && k.dueAt && k.dueAt < todayStr))).length;
    // 待升级线索：分配后超首次联系时限、还没联系的（主管要催办或重新分配）
    const slaUp = all.filter(t => slaOf(t).slaStatus === 'overdue').length;
    extraCards = [
      { label: '未分配线索', value: all.filter(t => !t.owner || t.owner === '未分配').length, sub: '公海线索，尽快指派负责人', tone: 'text-rose-600' },
      { label: '待升级线索', value: slaUp, sub: '超首次联系时限未联系，需催办或重新分配', tone: 'text-rose-600' },
      { label: '超时线索', value: staleLeads, sub: '负责入超过 2 天没跟进', tone: 'text-amber-500' },
      { label: '待运营接收', value: opsPending, sub: '已转正式、还没交接给运营', tone: 'text-teal-600' },
      { label: '待确认交接', value: hPending.length, sub: '跟进接收人的处理进度', tone: 'text-orange-600' },
      { label: '异常任务', value: abTasks, sub: '逾期 / 超时的寄拍任务', tone: 'text-rose-600' },
      { label: '逾期结算', value: settleOverdue, sub: '到期未结清的结算单', tone: 'text-rose-600' },
    ];
  } else if (myPos === 'promote' && !isAdmin) {
    const cs = (await db.list('campaigns')).filter(c => c.owner === meName);
    const consult = cs.reduce((s, c) => s + (Number(c.consult) || 0), 0);
    const leads = cs.reduce((s, c) => s + (Number(c.validLeads) || 0), 0);
    const signed = cs.reduce((s, c) => s + (Number(c.signed) || 0), 0);
    extraCards = [
      { label: '我的投放', value: cs.length, sub: '负责的推广活动 / 渠道', tone: 'text-cyan-600' },
      { label: '有效线索', value: leads, sub: '咨询 ' + consult + ' → 有效 ' + leads, tone: 'text-indigo-600' },
      { label: '线索转化率', value: (consult ? Math.round(signed / consult * 100) : 0) + '%', sub: '签约 / 咨询', tone: 'text-emerald-600' },
    ];
  } else if (myPos === 'finance' && !isAdmin) {
    const ss = await db.list('settlements');
    extraCards = [
      { label: '待核对结算单', value: ss.filter(s => s.status === '待核对').length, sub: '核对无误后确认', tone: 'text-amber-500' },
      { label: '待付款', value: ss.filter(s => s.status === '已确认').length, sub: '已确认、尚未结清', tone: 'text-indigo-600' },
      { label: '已结清', value: ss.filter(s => s.status === '已结清').length, sub: '历史累计', tone: 'text-emerald-600' },
    ];
  } else if (isOps) {
    // 运营工作台卡片：我的达人 / 待制定内容方向 / 待发布 / 数据异常 / 待发起寄拍
    //（账号指标见「账号运营」页；这里聚焦运营岗每天要推进的事）
    const mineTalents = all.filter(t => isMine(t, ctx));
    const myIds = new Set(mineTalents.map(t => t.id));
    const myTasks = (await db.list('tasks')).filter(k => k.isActive !== false && myIds.has(k.talentId));
    const noDirection = mineTalents.filter(t => !(t.contentTypes || []).length || t.coopPath === '待判断').length;
    const toPublish = myTasks.filter(k => k.status === '待发布' || k.status === '待审核').length;
    const abnormal = myTasks.filter(k => ['超时', '商品异常', '内容不合格', '达人拒绝'].includes(k.status)).length
      + mineTalents.map(accRowOf).filter(a => a.updateStale).length;
    const needShoot = mineTalents.filter(t => (MVP_STAGE_MAP[t.status] || '') === '合作中'
      && !myTasks.some(k => ACTIVE_TASK.includes(k.status))).length;
    // 新接收达人：7 天内通过交接确认接收的（运营接手初期要重点看交接单里的风险与建议）
    const rTs = s => { const n = new Date(String(s || '').replace(' ', 'T')).getTime(); return isNaN(n) ? 0 : n; };
    const newReceived = mineTalents.filter(t => t.handoverStatus === 'confirmed' && t.handoverReceivedAt
      && (Date.now() - rTs(t.handoverReceivedAt)) <= 7 * 86400000).length;
    extraCards = [
      { label: '我的达人', value: mineTalents.length, sub: '我名下长期管理的达人（已从招募交接给我）', tone: 'text-cyan-600' },
      { label: '新接收达人', value: newReceived, sub: '7 天内交接给我的，先看交接单风险与建议', tone: 'text-teal-600' },
      { label: '待制定内容方向', value: noDirection, sub: '还没定内容方向 / 合作路径的达人', tone: 'text-indigo-600' },
      { label: '待发布', value: toPublish, sub: '含待我审核的寄拍内容', tone: 'text-amber-500' },
      { label: '数据异常', value: abnormal, sub: '任务超时 / 商品异常 / 账号久未更新', tone: 'text-rose-600' },
      { label: '待发起寄拍', value: needShoot, sub: '合作中但当前没有进行中寄拍任务', tone: 'text-emerald-600' },
    ];
  }
  // 岗位面板（中台化）：管理员=经营视角，高级运营=管理视角，普通运营=陪跑视角，招募=线索视角
  const panels = await buildWorkbenchPanels(ctx, all);
  ok(ctx.res, {
    panels,
    cards: {
      assigned: byType('新分配'), today: byType('今日待跟进'), overdue: byType('逾期未跟进'),
      slaOverdue: byType('SLA 已超时'), slaRemind: byType('SLA 即将超时'),
      pending: byType('待接收'), hot: byType('高潜强意愿'), handover: byType('待交接'),
      recruitDone: byType('招募完成'), taskActive: byType('寄拍任务'), taskOverdue: byType('任务逾期'),
      taskAudit: byType('寄拍待审核'), taskPublish: byType('内容待发布'), taskIssue: byType('任务异常'),
      accStale: byType('账号待更新'), accLow: byType('账号低信誉'),
      unassigned: byType('待分配'), total: rows.length,
    },
    extraCards,
    todos: rows.slice(0, 200),
    scope: resolveScope(ctx, ctx.query.get('scope')),
    today,
  });
});
// 「我负责的线索」：等价于 /api/mvp/leads?scope=mine，单独开一个语义清晰的别名
route('GET', '/api/mvp/my/leads', async (ctx) => {
  const arr = await db.list('leads');
  const rows = arr.filter(t => t.isActive !== false).filter(t => isMine(t, ctx));
  ok(ctx.res, rows.map(toMvpLead));
});

/* ---------------- 经营看板：真实漏斗 + 负责人负载 ----------------
 * 漏斗口径改为**由达人表实时推导**（不再依赖投放表手工汇总的咨询/报名数）：
 *   线索进入 → 已分配负责人 → 已跟进 → 高潜强意愿 → 已合作
 * 负责人负载：按当前负责人聚合手上的线索/达人/待跟进/逾期/进行中任务/待接收交接，
 * 用于判断谁忙谁闲、该不该再分配。管理员看全量，其他岗位只看自己。 */
route('GET', '/api/mvp/dashboard', async (ctx) => {
  // 经营看板 = 管理视图（漏斗大盘 / 负责人负载 / 全局渠道效果）：仅主管（管理员/高级运营）可访问
  if (!isSupervisor(ctx)) return fail(ctx.res, 403, '经营看板仅主管（管理员/高级运营）可查看，普通岗位请使用岗位工作台');
  const isAdmin = ctx.roleCode === 'admin';
  const all = await listLeadsAndTalents();
  const leadRows = (await db.list('leads')).filter(t => t.isActive !== false);   // 新增线索趋势专用（只算线索池，不含正式达人）
  const tasks = (await db.list('tasks')).filter(k => k.isActive !== false);
  const handovers = (await db.list('handovers')).filter(h => h.status === 'pending');
  await slaSweep(all);                                   // 看板也要触发 SLA 上报（无定时任务）
  const scopeRows = isAdmin ? all : all.filter(t => isMine(t, ctx));
  const today = fmtDate(new Date());
  const stageOf = t => MVP_STAGE_MAP[t.status] || '新线索';
  const owned = t => !!(t.ownerId || (t.owner && t.owner !== '未分配'));

  const stageIdxOf = t => ({ '新线索': 0, '已联系': 1, '有意向': 2, '已报名': 3, '已成为达人': 4, '无效线索': -1 }[stageOf(t)] ?? 0);
  // 严格逐级收敛的漏斗：每一层都在上一层集合内再收窄（保证下层 ≤ 上层，可直接看流失）
  const f1 = scopeRows;
  const f2 = f1.filter(owned);
  const f3 = f2.filter(t => t.lastFollowAt);
  const f4 = f3.filter(t => stageIdxOf(t) >= 2);         // 有意向 / 已报名 / 已成为达人
  const f5 = f4.filter(t => stageIdxOf(t) >= 4);         // 已成为达人
  const funnel = [
    { name: '线索进入', value: f1.length },
    { name: '已分配负责人', value: f2.length },
    { name: '已跟进', value: f3.length },
    { name: '有意向/已报名', value: f4.length },
    { name: '已成为达人', value: f5.length },
  ];
  // 高潜强意愿单独作为关注指标（它是属性组合，不属于漏斗层级）
  const hot = scopeRows.filter(t => t.potentialLevel === '高' && t.intentLevel === '强').length;

  // 负责人负载：按 owner 聚合（未分配的单独一行，提醒管理员尽快分配）
  const byOwner = {};
  const bucket = name => (byOwner[name] = byOwner[name] || {
    owner: name, position: '', leads: 0, talents: 0, todayFollow: 0, overdueFollow: 0, tasks: 0, pending: 0,
  });
  for (const t of scopeRows) {
    const key = owned(t) ? t.owner : '未分配';
    const b = bucket(key);
    b.leads++;
    if (key !== '未分配' && t.ownerPosition) b.position = posLabel(t.ownerPosition);
    if (stageOf(t) === '已成为达人') b.talents++;
    const nf = String(t.nextFollowAt || '').slice(0, 10);
    if (nf && nf < today) b.overdueFollow++;
    else if (nf && nf === today) b.todayFollow++;
  }
  if (isAdmin) {
    for (const h of handovers) {
      const b = bucket(h.toUser || '未指定');
      b.pending++;
      if (h.toPosition) b.position = posLabel(h.toPosition);
    }
  }
  const idToOwner = {};
  for (const t of scopeRows) if (t.ownerId) idToOwner[t.id] = t.owner;
  for (const k of tasks) {
    if (!ACTIVE_TASK.includes(k.status)) continue;
    const key = idToOwner[k.talentId] || (isAdmin ? '未分配' : null);
    if (!key) continue;
    bucket(key).tasks++;
  }
  const workload = Object.values(byOwner)
    .map(b => Object.assign(b, { load: b.leads + b.tasks * 2 + b.overdueFollow * 2 + b.pending * 2 }))
    .sort((a, b) => b.load - a.load);

  // 渠道效果：按达人的来源渠道实时聚合（真实漏斗，不依赖投放表的手工汇总数字）
  // 投入金额只存在于投放表：有推广数据权限的（管理员/推广岗）才带上，其他人拿到 null 不展示成本列
  const canSeeCost = ctx.roleCode === 'admin' || ctx.position === 'promote';
  const campaigns = canSeeCost ? await db.list('campaigns') : [];
  const chMap = {};
  for (const t of scopeRows) {
    const c = t.channel || '其他';
    const m = (chMap[c] = chMap[c] || { channel: c, leads: 0, valid: 0, signed: 0, talents: 0, cost: 0 });
    m.leads++;
    if (['已联系', '有意向'].includes(t.status) || stageOf(t) !== '新线索') m.valid++;
    if (['待审核', '已通过'].includes(t.status) || stageOf(t) === '已成为达人') m.signed++;
    if (stageOf(t) === '已成为达人') m.talents++;
  }
  for (const c of campaigns) {
    const m = chMap[c.channel || '其他'] || (chMap[c.channel || '其他'] = { channel: c.channel || '其他', leads: 0, valid: 0, signed: 0, talents: 0, cost: 0 });
    m.cost += Number(c.cost) || 0;
  }
  const byChannel = Object.values(chMap)
    .map(m => Object.assign(m, {
      cost: canSeeCost ? m.cost : null,
      // 单达人获客成本：只有拿得到投入的人才算得出来
      costPerTalent: (canSeeCost && m.talents) ? Math.round(m.cost / m.talents) : null,
      talentRate: m.leads ? +(m.talents / m.leads * 100).toFixed(1) : 0,
    }))
    .sort((a, b) => b.leads - a.leads);

  // 风险提醒（哪里需要处理）：由真实字段实时推导，前端按类型展示并可点击跳转
  const alerts = [];
  {
    const unassigned = scopeRows.filter(t => !owned(t)).length;
    if (unassigned) alerts.push({ type: '未分配线索', count: unassigned, text: unassigned + ' 条线索未分配负责人，进入公海闲置', page: 'talent-leads', tone: 'rose' });
    // SLA 超时（首次联系时限）：管理员看全量、其他岗位看自己可见范围
    const slaOver = scopeRows.filter(t => slaOf(t).slaStatus === 'overdue').length;
    if (slaOver) alerts.push({ type: 'SLA 超时未联系', count: slaOver, text: slaOver + ' 条线索超过首次联系时限仍未联系，需催办或重新分配', page: 'talent-leads', tone: 'rose' });
    const staleHot = scopeRows.filter(t => t.potentialLevel === '高' && !WB_DONE_STATUS.includes(t.status)
      && t.lastFollowAt && (Date.now() - new Date(String(t.lastFollowAt).replace(' ', 'T')).getTime()) > 2 * 86400000).length;
    if (staleHot) alerts.push({ type: '高潜超时', count: staleHot, text: staleHot + ' 条高潜线索超过 2 天未跟进', page: 'talent-leads', tone: 'amber' });
    const staleAcc = (isAdmin ? all : all.filter(t => isMine(t, ctx))).filter(t => accRowOf(t).updateStale).length;
    if (staleAcc) alerts.push({ type: '账号待更新', count: staleAcc, text: staleAcc + ' 个达人账号超过更新周期未发新内容', page: 'account-ops', tone: 'amber' });
    const taskOverdueAll = tasks.filter(k => (ACTIVE_TASK.includes(k.status) && k.dueAt && k.dueAt < today) || k.status === '超时').length;
    if (taskOverdueAll) alerts.push({ type: '任务逾期', count: taskOverdueAll, text: taskOverdueAll + ' 个寄拍任务已逾期 / 超时', page: 'tasks', tone: 'rose' });
    if (isAdmin) {
      try {
        const so = (await db.list('settlements')).filter(s => s.status !== '已结清' && s.dueDate && s.dueDate < today).length;
        if (so) alerts.push({ type: '结算逾期', count: so, text: so + ' 笔结算已到期未结清', page: 'finance', tone: 'rose' });
      } catch (e) { }
      const op = all.filter(t => ['合作中', '暂停合作'].includes(t.status) && t.ownerPosition !== 'ops' && !t.opsId).length;
      if (op) alerts.push({ type: '待运营接收', count: op, text: op + ' 位正式达人还没交接给运营负责人', page: 'talent-pool', tone: 'teal' });
    }
  }

  ok(ctx.res, {
    funnel,
    hot,
    workload,
    byChannel,
    alerts,
    // 近 30 天每日新增线索（按 createdAt 创建时间，服务端统一聚合，口径唯一）。
    // 日期用服务器本地时间生成（createdAt 存的就是本地格式），不用 toISOString 的 UTC 日期。
    trend30: (() => {
      const p2 = v => String(v).padStart(2, '0');
      const out = [];
      for (let i = 29; i >= 0; i--) {
        const d = new Date(Date.now() - i * 86400000);
        const key = d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
        out.push({ date: key.slice(5), count: leadRows.filter(t => String(t.createdAt || '').slice(0, 10) === key).length });
      }
      return out;
    })(),
    // 关注项：管理员/运营一眼看到卡在哪一步
    attention: {
      unassigned: scopeRows.filter(t => !owned(t)).length,
      slaOverdue: scopeRows.filter(t => slaOf(t).slaStatus === 'overdue').length,
      slaRemind: scopeRows.filter(t => slaOf(t).slaStatus === 'remind').length,
      overdueFollow: scopeRows.filter(t => { const nf = String(t.nextFollowAt || '').slice(0, 10); return nf && nf < today; }).length,
      pendingHandover: isAdmin ? handovers.length : scopeRows.filter(t => isPendingForMe(t, ctx)).length,
      taskOverdue: tasks.filter(k => k.status === '超时').length,
      pendingAudit: tasks.filter(k => k.status === '待审核').length,
    },
    scope: isAdmin ? 'all' : 'mine',
    today,
  });
});

/* ---------------- 账号运营（运营岗）----------------
 * 得物账号指标：信誉等级 / 粉丝数 / 更新频率 / 最近发布。
 * V1 数据为手动录入（dewuSource=manual）；接入得物平台后由平台 API 定时同步（dewuSource=dewu），
 * 字段与接口已按此预留，切换数据源不改表结构。 */
function accRowOf(t) {
  const upDays = Math.max(1, Number(t.dewuUpdateDays) || 7);
  const lp = t.dewuLastPublish ? String(t.dewuLastPublish).slice(0, 10) : '';
  const days = lp ? Math.floor((Date.now() - new Date(lp + 'T00:00:00').getTime()) / 86400000) : -1;
  // 更新健康：超过「更新频率」一个周期没发新内容 → 待更新（得物接入后可直接用平台最新发布时间）
  const stale = !!lp && days > upDays;
  return {
    id: t.id, name: t.name, status: MVP_STAGE_MAP[t.status] || '新线索',
    owner: t.owner || '未分配', ownerPosition: t.ownerPosition || '',
    dewuId: t.dewuId || '', dewuFans: Number(t.dewuFans) || 0, dewuActivity: t.dewuActivity || '',
    dewuUpdateDays: upDays, dewuLastPublish: lp, dewuSyncedAt: t.dewuSyncedAt || '',
    dewuSource: t.dewuSource || '', daysSincePublish: days, updateStale: stale,
    // 运营计划（运营岗每天/每周要推进的事，与账号指标分开维护）
    contentDirection: Array.isArray(t.contentTypes) && t.contentTypes.length ? t.contentTypes.join(' / ') : (t.coopPath === '待判断' ? '' : String(t.coopPath || '')),
    opsPlan: t.opsPlan || '', weekGoal: t.weekGoal || '', nextAction: t.nextAction || '',
    needShoot: t.needShoot || '', opsNote: t.opsNote || '',
  };
}
route('GET', '/api/mvp/accounts', async (ctx) => {
  const all = (await db.list('talents')).filter(t => t.isActive !== false);
  // 行级权限：管理员/高级运营看全部（质检视角）；其他岗位只看自己负责的达人账号
  const rows = (isSupervisor(ctx) ? all : all.filter(t => isMine(t, ctx)))
    .map(accRowOf)
    .sort((a, b) => (b.updateStale - a.updateStale) || b.dewuFans - a.dewuFans);
  ok(ctx.res, { rows, today: fmtDate(new Date()) });
});
route('PUT', '/api/mvp/accounts/:id', async (ctx) => {
  const t = await db.get('talents', ctx.params.id);
  if (!t || t.isActive === false) return fail(ctx.res, 404, '账号对应的达人不存在');
  if (!isSupervisor(ctx) && !isMine(t, ctx)) return fail(ctx.res, 403, '只能更新自己负责达人的账号数据');
  const b = ctx.body || {};
  const before = { fans: t.dewuFans, activity: t.dewuActivity, updateDays: t.dewuUpdateDays, lastPublish: t.dewuLastPublish };
  const patch = { dewuSource: 'manual', dewuSyncedAt: nowStr() };   // manual=手动录入；接入得物平台后改为 dewu
  if (b.dewuId !== undefined) patch.dewuId = String(b.dewuId).trim();
  if (b.dewuFans !== undefined) patch.dewuFans = Math.max(0, Number(b.dewuFans) || 0);
  if (b.dewuActivity !== undefined && ['高', '中', '低'].includes(b.dewuActivity)) patch.dewuActivity = b.dewuActivity;
  if (b.dewuUpdateDays !== undefined) patch.dewuUpdateDays = Math.max(1, Number(b.dewuUpdateDays) || 7);
  if (b.dewuLastPublish !== undefined && b.dewuLastPublish !== null && String(b.dewuLastPublish).trim() !== '') patch.dewuLastPublish = String(b.dewuLastPublish).trim().slice(0, 10);
  // 运营计划字段（可选更新，留空不覆盖已有内容）
  if (b.opsPlan !== undefined) patch.opsPlan = String(b.opsPlan).slice(0, 300);
  if (b.weekGoal !== undefined) patch.weekGoal = String(b.weekGoal).slice(0, 200);
  if (b.nextAction !== undefined) patch.nextAction = String(b.nextAction).slice(0, 200);
  if (b.needShoot !== undefined && ['', '是', '否'].includes(b.needShoot)) patch.needShoot = b.needShoot;
  if (b.opsNote !== undefined) patch.opsNote = String(b.opsNote).slice(0, 300);
  await db.update('talents', t.id, patch);
  Object.assign(t, patch);
  await addLog(ctx.operator, '达人：' + t.name, '账号运营数据更新', JSON.stringify(before),
    JSON.stringify({ fans: t.dewuFans, activity: t.dewuActivity, updateDays: t.dewuUpdateDays, lastPublish: t.dewuLastPublish }));
  ok(ctx.res, accRowOf(t));
});


// ---------- MVP 演示页·推广获客（投放活动真实落库：新增/编辑/删除） ----------
// 说明：达人/线索等集合已有飞书映射，campaigns 仅在本地 JSON 模式开放（当前部署即此模式）
function toMvpCampaign(c) {
  const consult = Number(c.consult) || 0, validLeads = Number(c.validLeads) || 0, signed = Number(c.signed) || 0;
  return {
    id: c.id, name: c.name, channel: c.channel || '其他', owner: c.owner || '—',
    cost: Number(c.cost) || 0, start: String(c.start || '').slice(0, 10),
    consult, validLeads, signed, talents: Number(c.talents) || 0, note: c.note || '',
    // 质量指标：不只看获客便宜，还要看线索质量（有效线索率 / 报名转化率 / 最终转化率）
    validRate: consult ? +(validLeads / consult * 100).toFixed(1) : 0,   // 有效线索率 = 有效线索 / 咨询
    signRate: validLeads ? +(signed / validLeads * 100).toFixed(1) : 0,  // 报名转化率 = 报名 / 有效线索
    finalRate: consult ? +(signed / consult * 100).toFixed(1) : 0,       // 最终转化率 = 报名 / 咨询
    costPerLead: validLeads ? Math.round((Number(c.cost) || 0) / validLeads) : null,   // 单线索成本
    costPerTalent: (Number(c.talents) || 0) ? Math.round((Number(c.cost) || 0) / Number(c.talents)) : null, // 单达人成本
  };
}
if (!USE_FEISHU) {
  /* 推广投放数据行级权限（服务端裁决，前端菜单隐藏只是展示层）：
     管理员看全部；推广岗只看自己负责的投放；其余岗位（招募/运营/寄拍/财务）不涉及推广数据，直接 403。 */
  const canSeeCampaigns = ctx => ctx.roleCode === 'admin' || ctx.position === 'promote';
  route('GET', '/api/mvp/campaigns', async (ctx) => {
    if (!canSeeCampaigns(ctx)) return fail(ctx.res, 403, '仅推广岗与管理员可查看投放数据');
    let arr = await db.list('campaigns');
    if (ctx.roleCode !== 'admin') arr = arr.filter(c => c.owner === (ctx.displayName || ctx.operator));
    ok(ctx.res, arr.map(toMvpCampaign));
  });
  route('POST', '/api/mvp/campaigns', async (ctx) => {
    if (!canSeeCampaigns(ctx)) return fail(ctx.res, 403, '仅推广岗与管理员可新增投放');
    const b = ctx.body;
    if (!b.name) return fail(ctx.res, 400, '请填写活动名称');
    const rec = {
      id: await nextId('campaigns', 'CMP', 3),
      // 推广岗新增的投放默认归属自己（避免把别人的数据挂到自己名下）
      name: b.name, channel: b.channel || '其他', owner: ctx.roleCode === 'admin' ? (b.owner || '—') : (ctx.displayName || ctx.operator),
      cost: Number(b.cost) || 0, start: b.start || String(nowStr()).slice(0, 10),
      consult: Number(b.consult) || 0, validLeads: Number(b.validLeads) || 0,
      signed: Number(b.signed) || 0, talents: Number(b.talents) || 0,
      note: b.note || '', createdAt: nowStr(),
    };
    await db.insert('campaigns', rec);
    await addLog(ctx.operator, '推广活动：' + rec.name, '新增投放', '', '投入=¥' + rec.cost + ' 渠道=' + rec.channel);
    ok(ctx.res, toMvpCampaign(rec));
  });
  route('PUT', '/api/mvp/campaigns/:id', async (ctx) => {
    if (!canSeeCampaigns(ctx)) return fail(ctx.res, 403, '仅推广岗与管理员可修改投放');
    const c = await db.get('campaigns', ctx.params.id);
    if (!c) return fail(ctx.res, 404, '推广活动不存在');
    if (ctx.roleCode !== 'admin' && c.owner !== (ctx.displayName || ctx.operator)) return fail(ctx.res, 403, '只能修改自己负责的投放');
    const b = ctx.body;
    const patch = {};
    ['name', 'channel', 'owner', 'start', 'note'].forEach(k => { if (b[k] !== undefined) patch[k] = b[k]; });
    ['cost', 'consult', 'validLeads', 'signed', 'talents'].forEach(k => { if (b[k] !== undefined) patch[k] = Number(b[k]) || 0; });
    if (ctx.roleCode !== 'admin') delete patch.owner;   // 非管理员不能把投放改挂到别人名下
    if (!Object.keys(patch).length) return fail(ctx.res, 400, '没有需要更新的字段');
    const updated = await db.update('campaigns', ctx.params.id, patch);
    await addLog(ctx.operator, '推广活动：' + updated.name, '修改投放',
      '投入=¥' + c.cost + ' 有效线索=' + c.validLeads + ' 达人=' + c.talents,
      '投入=¥' + updated.cost + ' 有效线索=' + updated.validLeads + ' 达人=' + updated.talents);
    ok(ctx.res, toMvpCampaign(updated));
  });
  route('DELETE', '/api/mvp/campaigns/:id', async (ctx) => {
    if (!canSeeCampaigns(ctx)) return fail(ctx.res, 403, '仅推广岗与管理员可删除投放');
    const c = await db.get('campaigns', ctx.params.id);
    if (!c) return fail(ctx.res, 404, '推广活动不存在');
    if (ctx.roleCode !== 'admin' && c.owner !== (ctx.displayName || ctx.operator)) return fail(ctx.res, 403, '只能删除自己负责的投放');
    await db.remove('campaigns', ctx.params.id);
    await addLog(ctx.operator, '推广活动：' + c.name, '删除投放', '投入=¥' + c.cost, '已删除');
    ok(ctx.res, { id: ctx.params.id, deleted: true });
  });
}

/* ---------- MVP 演示页·收益结算（达人分成结算单 + 资金流水，真实落库） ----------
 * 业务模型（与实际业务确认后修正）：
 *   1) 得物平台按账号表现结算收益 → 全额打入 MCN 对公账户（MCN 先全额收）
 *   2) MCN 再按「公司统一分成比例」与达人分成，把达人那份付给达人
 * 因此一张结算单同时有两条腿：
 *   应收 = 平台收益（向平台收）   应付 = 达人应得 − 代扣个税 + 差异项（向达人付）
 * MCN 留存 = 平台收益 × MCN 分成比例
 * 关键口径：状态不再由「任务」推导，而是由「资金流水累加」决定是否结清。
 */
const FIN_SETTINGS_ID = 'finance';
const FIN_DEFAULT = { mcnRate: 0.3, taxRate: 0.06, receiveDays: 30, payDays: 15 };
const SETTLE_STATUSES = ['待核对', '已确认', '已结清'];
const PAY_METHODS = ['对公转账', '支付宝', '微信', '银行卡', '其他'];

function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

async function getFinSettings() {
  let s = null;
  try { s = await db.get('settings', FIN_SETTINGS_ID); } catch (e) { s = null; }
  if (!s) { s = Object.assign({ id: FIN_SETTINGS_ID }, FIN_DEFAULT); await db.insert('settings', s); }
  return Object.assign({ id: FIN_SETTINGS_ID }, FIN_DEFAULT, s);
}

// 结算单派生计算：金额、税费、差异、已收已付、逾期
function calcSettlement(rec, pays) {
  const platformIncome = round2(rec.platformIncome);
  const mcnRate = (rec.mcnRate === undefined || rec.mcnRate === null || rec.mcnRate === '') ? FIN_DEFAULT.mcnRate : Number(rec.mcnRate);
  const taxRate = (rec.taxRate === undefined || rec.taxRate === null || rec.taxRate === '') ? 0 : Number(rec.taxRate);
  const mcnShare = round2(platformIncome * mcnRate);
  const talentShare = round2(platformIncome - mcnShare);
  const adjustments = Array.isArray(rec.adjustments) ? rec.adjustments : [];
  const adjTotal = round2(adjustments.reduce((s, a) => s + (Number(a.amount) || 0), 0));
  const taxAmount = round2(talentShare * taxRate);
  const payableToTalent = round2(talentShare - taxAmount + adjTotal);
  const mine = (pays || []).filter(p => String(p.settlementId) === String(rec.id));
  const received = round2(mine.filter(p => p.direction === 'in').reduce((s, p) => s + (Number(p.amount) || 0), 0));
  const paid = round2(mine.filter(p => p.direction === 'out').reduce((s, p) => s + (Number(p.amount) || 0), 0));
  const today = fmtDate(new Date());
  const due = String(rec.dueDate || '').slice(0, 10);
  const status = SETTLE_STATUSES.indexOf(rec.status) >= 0 ? rec.status : '待核对';
  return {
    id: rec.id, talentId: rec.talentId || '', talentName: rec.talentName || '未命名达人',
    account: rec.account || '', period: rec.period || '',
    platformIncome, mcnRate, taxRate, mcnShare, talentShare,
    adjustments, adjTotal, taxAmount, payableToTalent,
    received, paid,
    outstandingReceive: round2(Math.max(0, platformIncome - received)),
    outstandingPay: round2(Math.max(0, payableToTalent - paid)),
    dueDate: due, status, remark: rec.remark || '',
    createdAt: rec.createdAt || '', updatedAt: rec.updatedAt || '',
    overdue: status !== '已结清' && !!due && due < today,
    payments: mine.slice().sort((a, b) => String(a.date).localeCompare(String(b.date))),
  };
}

if (!USE_FEISHU) {
  // ---- 结算规则设置（公司统一分成比例 / 代扣税率 / 账期） ----
  route('GET', '/api/mvp/finance/settings', async (ctx) => { ok(ctx.res, await getFinSettings()); });

  route('PUT', '/api/mvp/finance/settings', async (ctx) => {
    if (!ctx.role.mutate) return fail(ctx.res, 403, '当前角色无修改权限');
    const b = ctx.body, before = await getFinSettings(), patch = {};
    if (b.mcnRate !== undefined) patch.mcnRate = Math.min(1, Math.max(0, Number(b.mcnRate) || 0));
    if (b.taxRate !== undefined) patch.taxRate = Math.min(1, Math.max(0, Number(b.taxRate) || 0));
    if (b.receiveDays !== undefined) patch.receiveDays = Math.max(0, parseInt(b.receiveDays, 10) || 0);
    if (b.payDays !== undefined) patch.payDays = Math.max(0, parseInt(b.payDays, 10) || 0);
    if (!Object.keys(patch).length) return fail(ctx.res, 400, '没有需要更新的字段');
    const updated = await db.update('settings', FIN_SETTINGS_ID, patch);
    await addLog(ctx.operator, '财务设置', '修改分成规则',
      'MCN分成=' + Math.round(before.mcnRate * 100) + '% 代扣税=' + Math.round(before.taxRate * 100) + '%',
      'MCN分成=' + Math.round(updated.mcnRate * 100) + '% 代扣税=' + Math.round(updated.taxRate * 100) + '%');
    ok(ctx.res, Object.assign(before, patch));
  });

  // ---- 结算单 ----
  route('GET', '/api/mvp/settlements', async (ctx) => {
    const list = await db.list('settlements');
    const pays = await db.list('payments');
    ok(ctx.res, list.map(r => calcSettlement(r, pays))
      .sort((a, b) => String(b.period + b.id).localeCompare(String(a.period + a.id))));
  });

  route('POST', '/api/mvp/settlements', async (ctx) => {
    if (!ctx.role.mutate) return fail(ctx.res, 403, '当前角色无修改权限');
    const b = ctx.body, s = await getFinSettings();
    if (!b.talentName) return fail(ctx.res, 400, '请填写达人名称');
    if (!b.period) return fail(ctx.res, 400, '请选择结算周期');
    const income = Number(b.platformIncome);
    if (!(income > 0)) return fail(ctx.res, 400, '请填写大于 0 的平台收益金额');
    if (b.status !== undefined && SETTLE_STATUSES.indexOf(b.status) < 0) return fail(ctx.res, 400, '结算单状态不合法');
    const dup = (await db.list('settlements')).find(r =>
      String(r.talentName) === String(b.talentName) && String(r.period) === String(b.period));
    if (dup) return fail(ctx.res, 400, '「' + b.talentName + '」' + b.period + ' 已有结算单（' + dup.id + '），请勿重复生成');
    const rec = {
      id: await nextId('settlements', 'ST', 5),
      talentId: b.talentId || '', talentName: b.talentName, account: b.account || '',
      period: b.period, platformIncome: income,
      mcnRate: b.mcnRate === undefined || b.mcnRate === '' ? s.mcnRate : Number(b.mcnRate),
      taxRate: b.taxRate === undefined || b.taxRate === '' ? s.taxRate : Number(b.taxRate),
      adjustments: Array.isArray(b.adjustments) ? b.adjustments : [],
      dueDate: String(b.dueDate || '').slice(0, 10), status: '待核对',
      remark: b.remark || '', createdAt: nowStr(), updatedAt: nowStr(),
    };
    await db.insert('settlements', rec);
    await addLog(ctx.operator, '结算单：' + rec.id, '生成结算单', '',
      rec.talentName + ' ' + rec.period + ' 平台收益=¥' + income);
    ok(ctx.res, calcSettlement(rec, await db.list('payments')));
  });

  route('PUT', '/api/mvp/settlements/:id', async (ctx) => {
    if (!ctx.role.mutate) return fail(ctx.res, 403, '当前角色无修改权限');
    const cur = await db.get('settlements', ctx.params.id);
    if (!cur) return fail(ctx.res, 404, '结算单不存在');
    const b = ctx.body, patch = {};
    ['talentId', 'talentName', 'account', 'period', 'dueDate', 'remark'].forEach(k => {
      if (b[k] !== undefined) patch[k] = k === 'dueDate' ? String(b[k]).slice(0, 10) : b[k];
    });
    if (b.status !== undefined) {
      if (SETTLE_STATUSES.indexOf(b.status) < 0) return fail(ctx.res, 400, '结算单状态不合法');
      patch.status = b.status;
    }
    ['platformIncome', 'mcnRate', 'taxRate'].forEach(k => { if (b[k] !== undefined) patch[k] = Number(b[k]) || 0; });
    if (b.adjustments !== undefined) patch.adjustments = Array.isArray(b.adjustments) ? b.adjustments : [];
    if (!Object.keys(patch).length) return fail(ctx.res, 400, '没有需要更新的字段');
    patch.updatedAt = nowStr();
    const updated = await db.update('settlements', ctx.params.id, patch);
    await addLog(ctx.operator, '结算单：' + cur.id,
      patch.status && patch.status !== cur.status ? '结算单状态流转' : '修改结算单',
      '状态=' + cur.status + ' 平台收益=¥' + cur.platformIncome,
      '状态=' + updated.status + ' 平台收益=¥' + updated.platformIncome);
    ok(ctx.res, calcSettlement(updated, await db.list('payments')));
  });

  route('DELETE', '/api/mvp/settlements/:id', async (ctx) => {
    if (!ctx.role.mutate) return fail(ctx.res, 403, '当前角色无修改权限');
    const rec = await db.get('settlements', ctx.params.id);
    if (!rec) return fail(ctx.res, 404, '结算单不存在');
    const pays = await db.list('payments');
    let removed = 0;
    for (const p of pays) {
      if (String(p.settlementId) === String(ctx.params.id)) { await db.remove('payments', p.id); removed++; }
    }
    await db.remove('settlements', ctx.params.id);
    await addLog(ctx.operator, '结算单：' + rec.id, '删除结算单',
      rec.talentName + ' ' + rec.period + ' 平台收益=¥' + rec.platformIncome + '（含流水 ' + removed + ' 笔）', '已删除');
    ok(ctx.res, { id: ctx.params.id, deleted: true, paymentsRemoved: removed });
  });

  // ---- 资金流水（一张结算单可拆多笔，支持部分收付） ----
  route('GET', '/api/mvp/payments', async (ctx) => {
    const list = await db.list('payments');
    ok(ctx.res, list.sort((a, b) => String(b.date).localeCompare(String(a.date))));
  });

  route('POST', '/api/mvp/payments', async (ctx) => {
    if (!ctx.role.mutate) return fail(ctx.res, 403, '当前角色无修改权限');
    const b = ctx.body;
    const st = await db.get('settlements', b.settlementId);
    if (!st) return fail(ctx.res, 404, '结算单不存在');
    if (b.direction !== 'in' && b.direction !== 'out') return fail(ctx.res, 400, '收付方向不合法');
    const amount = Number(b.amount);
    if (!(amount > 0)) return fail(ctx.res, 400, '请填写大于 0 的金额');
    const rec = {
      id: await nextId('payments', 'PY', 5), settlementId: st.id,
      direction: b.direction, amount: round2(amount),
      date: String(b.date || nowStr()).slice(0, 10),
      method: PAY_METHODS.indexOf(b.method) >= 0 ? b.method : '对公转账',
      refNo: b.refNo || '', remark: b.remark || '', operator: ctx.operator, createdAt: nowStr(),
    };
    await db.insert('payments', rec);
    // 两条腿都收/付齐 → 自动结清（这就是「已结算」的真实口径）
    const pays = await db.list('payments');
    const c = calcSettlement(st, pays);
    if (c.status !== '已结清' && c.outstandingReceive <= 0 && c.outstandingPay <= 0) {
      await db.update('settlements', st.id, { status: '已结清', updatedAt: nowStr() });
    }
    await addLog(ctx.operator, '结算单：' + st.id,
      b.direction === 'in' ? '登记平台到账' : '登记达人付款', '',
      '¥' + rec.amount + ' · ' + rec.method + (rec.refNo ? ' · ' + rec.refNo : ''));
    ok(ctx.res, rec);
  });

  route('DELETE', '/api/mvp/payments/:id', async (ctx) => {
    if (!ctx.role.mutate) return fail(ctx.res, 403, '当前角色无修改权限');
    const p = await db.get('payments', ctx.params.id);
    if (!p) return fail(ctx.res, 404, '流水不存在');
    await db.remove('payments', ctx.params.id);
    await addLog(ctx.operator, '结算单：' + p.settlementId, '撤销资金流水',
      (p.direction === 'in' ? '平台到账' : '达人付款') + ' ¥' + p.amount, '已撤销');
    ok(ctx.res, { id: ctx.params.id, deleted: true });
  });
}

// ---------- 招募报名表单（recruit.html 公开提交，无需登录） ----------
// 报名截图上传：multipart 单文件，≤20MB，仅图片，存 /uploads/ 并返回访问 URL
const recruitUploadRoute = route('POST', '/api/upload', async (ctx) => {
  const f = ctx.body.files && ctx.body.files[0];
  if (!f || !f.data || !f.data.length) return json(ctx.res, 400, { code: 1, message: '没有收到文件' });
  if (f.data.length > 20 * 1024 * 1024) return json(ctx.res, 400, { code: 1, message: '文件超过 20MB 上限' });
  const ext = path.extname(f.filename || '').toLowerCase();
  if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'].indexOf(ext) === -1) return json(ctx.res, 400, { code: 1, message: '仅支持图片文件' });
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const name = Date.now() + '_' + Math.random().toString(36).slice(2, 8) + ext;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), f.data);
  json(ctx.res, 200, { code: 0, message: 'success', data: { url: '/uploads/' + name } });
});
recruitUploadRoute.multipart = true;

// 报名提交：写入达人库（状态=待联系，出现在 MVP 看板「新线索」），回答拼进备注
route('POST', '/api/leads', async (ctx) => {
  const b = ctx.body;
  if (!b.nickname || !String(b.nickname).trim()) return json(ctx.res, 400, { code: 1, message: '请填写昵称/称呼' });
  const contactParts = [b.phone, b.wechat_id].filter(Boolean);
  const noteParts = [];
  if (b.self_media_status) noteParts.push('自媒体：' + b.self_media_status);
  if (b.platforms) noteParts.push('平台：' + b.platforms);
  if (b.followers) noteParts.push('粉丝量：' + b.followers);
  if (b.appearance_style) noteParts.push('出镜方式：' + b.appearance_style);
  if (b.business_experience) noteParts.push('合作经历：' + b.business_experience);
  if (b.cooperation_categories) noteParts.push('合作过的品类：' + b.cooperation_categories);
  if (b.preferred_categories) noteParts.push('想接的品类：' + b.preferred_categories);
  if (b.questions) noteParts.push('疑问：' + b.questions);
  const rec = {
    id: await nextId('leads', 'T', 4),
    name: String(b.nickname).trim(), douyin: '', contact: contactParts.join(' / '),
    channel: b.source_channel || '表单', level: 'C', status: '待联系',
    contentTypes: [], categories: [], fans: 0, coopCount: 0, fulfillmentRate: 0,
    owner: '未分配', tags: ['报名表单'], note: noteParts.join('；'),
    // 字段分层（2026-09-18）：报名表只提供映射字段；判断字段一律「待判断」，由运营/高级运营跟进后判定
    talentStatus: 'lead', talentLevel: TALENT_LEVEL_UNSET,
    potentialLevel: '待判断', intentLevel: '待判断', talentClass: '待分类', coopPath: '待判断',
    profileScreenshot: b.profile_screenshot || '', works: b.works || '',
    recruit: {
      selfMedia: b.self_media_status || '', platforms: b.platforms || '', fansText: b.followers || '',
      appearWay: b.appearance_style || '', hasExp: b.business_experience || '',
      coopCategories: b.cooperation_categories || '', preferredCategories: b.preferred_categories || '',
      questions: b.questions || '', profileScreenshot: b.profile_screenshot || '', works: b.works || '',
    },
    lastFollowAt: nowStr(), createdAt: nowStr(),
    rejectReason: '', auditAt: '', auditBy: '', isActive: true,
  };
  await db.insert('leads', rec);
  await addLog('报名表单', '达人：' + rec.name, '问卷报名', '', '来源=' + rec.channel);
  notify('新达人报名：' + rec.name + '（渠道：' + rec.channel + '）\n联系方式：' + rec.contact + '\n请在后台「达人线索」及时跟进');
  json(ctx.res, 200, { code: 0, message: '提交成功', data: { id: rec.id } });
});



// ---------- 寄拍任务 ----------
// 任务归属人是否是我（任务记录行级权限）
function isMineTask(k, ctx) {
  if (ctx.authUser && k.ownerId) return k.ownerId === ctx.authUser;
  return !!ctx.displayName && k.owner === ctx.displayName;
}
// 单条任务是否对 ctx 可见：主管（管理员/高级运营）全部 / 普通运营=我名下达人的 / 其余岗位不涉及
function taskVisibleTo(k, ctx, myTalentIds) {
  if (isSupervisor(ctx)) return true;
  if (ctx.position === 'ops') return !!(myTalentIds && myTalentIds.has(k.talentId));
  return false;
}
// 任务可执行动作：按当前状态下发可用动作，并按下述规则收敛按钮
//（audit 类需主管/管理员；运营可审核自己名下任务的内容）
function taskActionsFor(k, ctx, mineTask, mineTalent) {
  const mine = isSupervisor(ctx) || mineTask || mineTalent;
  if (!mine) return [];
  return Object.keys(ACTIONS).filter(key => {
    const a = ACTIONS[key];
    if (!a.from.includes(k.status)) return false;
    if (a.audit && !(ctx.role.audit || isSupervisor(ctx) || (ctx.position === 'ops' && mineTalent))) return false;  // 运营审自己名下任务
    return true;
  });
}
// 给任务补上前端需要的派生字段（不改动存储结构，兼容 V1 后台）
function annotateTask(k, ctx, myTalentIds) {
  const mineTask = isMineTask(k, ctx);
  const mineTalent = !!(myTalentIds && myTalentIds.has(k.talentId));
  const today = fmtDate(new Date());
  const active = ACTIVE_TASK.includes(k.status);
  return Object.assign({}, k, {
    actions: taskActionsFor(k, ctx, mineTask, mineTalent),
    mineTask, mineTalent,
    active,
    // 任务类型（任务中心三分栏）：历史任务迁移时已补 'shoot'，缺省按寄拍处理，保证旧数据可读
    taskType: TASK_TYPES.includes(k.taskType) ? k.taskType : 'shoot',
    taskTypeLabel: TASK_TYPE_LABEL[TASK_TYPES.includes(k.taskType) ? k.taskType : 'shoot'],
    overdue: active && !!k.dueAt && k.dueAt < today,                                   // 已逾期（截止时间已过且未完成）
    dueSoon: active && !!k.dueAt && k.dueAt >= today && k.dueAt <= fmtDate(new Date(Date.now() + 2 * 86400000)), // 2 天内到期
  });
}
route('GET', '/api/tasks', async (ctx) => {
  const q = ctx.query.get('q') || '';
  const isAdmin = ctx.roleCode === 'admin';
  const myPos = ctx.position || '';
  let arr = await db.list('tasks');
  // 行级权限（服务端裁决）：主管（管理员/高级运营）看全部；普通运营看「我名下达人」；
  // 招募 / 推广 / 财务不参与寄拍执行，直接 403（前端菜单隐藏只是展示层）。
  let myTalentIds = null;
  if (!isSupervisor(ctx)) {
    if (myPos !== 'ops') return fail(ctx.res, 403, '当前岗位不参与寄拍任务，无权查看');
    myTalentIds = new Set((await db.list('talents')).filter(t => isMine(t, ctx)).map(t => t.id));
    arr = arr.filter(k => taskVisibleTo(k, ctx, myTalentIds));
  }
  if (q) arr = arr.filter(t => [t.id, t.product, t.talentName, t.trackingNo].some(v => String(v || '').includes(q)));
  for (const k of ['status', 'owner', 'talentId', 'campaignId', 'taskType']) {
    const v = ctx.query.get(k);
    if (v) arr = arr.filter(t => t[k] === v);
  }
  ok(ctx.res, arr.map(k => annotateTask(k, ctx, myTalentIds)).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))));
});

// 任务动作表（前端据此渲染「推进」按钮与需要填写的字段，避免前端复制一份状态机）
route('GET', '/api/task-actions', (ctx) => {
  ok(ctx.res, Object.keys(ACTIONS).map(key => ({
    key, label: ACTIONS[key].label, from: ACTIONS[key].from, to: ACTIONS[key].to,
    audit: !!ACTIONS[key].audit, options: ACTIONS[key].options || [],
    fields: ACTIONS[key].fields.map(f => ({ key: f.key, label: f.label, required: !!f.required })),
  })));
});

route('POST', '/api/tasks', async (ctx) => {
  // 业务边界：寄拍任务由**达人运营**为自己名下的达人发起/登记（主管可代登记）
  // 寄拍由达人本人完成，系统里只保留任务记录：归属 = 达人的运营负责人（不再是独立执行岗位）
  if (!isSupervisor(ctx) && ctx.position !== 'ops') return fail(ctx.res, 403, '寄拍任务由达人运营发起登记');
  const b = ctx.body;
  const talent = b.talentId ? await db.get('talents', b.talentId) : null;
  if (!talent) return fail(ctx.res, 400, '请选择达人');
  if (!isSupervisor(ctx) && !isMine(talent, ctx)) return fail(ctx.res, 403, '只能为自己名下的达人发起寄拍');
  if (!b.product) return fail(ctx.res, 400, '请填写商品名称');
  // 任务归属：默认挂到达人的运营负责人（opsBy，回退当前负责人/发起人）；显式指定时必须是招募/运营岗
  let owner = talent.opsBy || talent.owner || (ctx.displayName || ctx.operator), ownerId = talent.opsId || talent.ownerId || ctx.authUser || '';
  if (b.owner) {
    const rec = userRecByName(b.owner);
    if (!rec) return fail(ctx.res, 400, '负责人不存在：' + b.owner);
    if (rec.position && !['recruit', 'ops', 'senior_ops', 'admin'].includes(rec.position)) return fail(ctx.res, 400, '任务归属人必须是招募/运营岗（当前：' + posLabel(rec.position) + '）');
    owner = nameOf(rec); ownerId = rec.user;
  }
  const rec = {
    id: await nextId('tasks', 'TK', 4), campaignId: b.campaignId || '', talentId: talent.id, talentName: talent.name,
    // 任务类型（任务中心三分栏）：shoot 寄拍 / content 内容；growth 走独立集合 opsTasks。
    // 不传则按寄拍处理，与历史数据口径一致。
    taskType: TASK_TYPES.includes(b.taskType) && b.taskType !== 'growth' ? b.taskType : 'shoot',
    product: b.product, status: '待确认', trackingNo: '', sentAt: '', signedAt: '', contentAt: '', publishedAt: '',
    contentUrl: '', contentNote: '', auditOpinion: '', commission: +b.commission || 0, owner,
    ownerId, issue: '', createdAt: nowStr(),
    // 发起运营人员（任务由谁发起，与达人运营负责人/任务执行人三方区分）
    createdBy: ctx.displayName || ctx.operator, createdById: ctx.authUser || '',
    dueAt: b.dueAt ? String(b.dueAt).slice(0, 10) : '',            // 截止时间（逾期判断依据）
    note: String(b.note || '').slice(0, 300),                       // 任务备注
  };
  await db.insert('tasks', rec);
  await addLog(ctx.operator, '任务：' + rec.id + ' ' + rec.product, '创建任务', '',
    `达人=${talent.name} 佣金=${rec.commission} 运营负责人=${owner} 发起=${rec.createdBy}` + (rec.dueAt ? ' 截止=' + rec.dueAt : ''));
  // 任务记录不改变达人归属（owner 是运营负责人，不动 talents.owner）
  notify('寄拍任务已登记：' + rec.product + '\n达人：' + talent.name + '\n运营负责人：' + owner + '（' + rec.id + '）');
  ok(ctx.res, rec);
});

route('PATCH', '/api/tasks/:id/status', async (ctx) => {
  if (!ctx.role.mutate) return fail(ctx.res, 403, '当前角色无修改权限');
  const task = await db.get('tasks', ctx.params.id);
  if (!task) return fail(ctx.res, 404, '任务不存在');
  const act = ACTIONS[ctx.body.action];
  if (!act) return fail(ctx.res, 400, '未知操作');
  // 行级权限：主管（管理员/高级运营）/ 任务归属运营负责人 / 该达人的负责人 可推进
  const mineTask = isMineTask(task, ctx);
  const talentOfTask = task.talentId ? await db.get('talents', task.talentId) : null;
  const mineTalent = !!(talentOfTask && isMine(talentOfTask, ctx));
  if (!isSupervisor(ctx) && !mineTask && !mineTalent) {
    return fail(ctx.res, 403, '只能推进自己名下达人的任务');
  }
  if (act.audit && !(ctx.role.audit || isSupervisor(ctx) || (ctx.position === 'ops' && mineTalent))) {
    return fail(ctx.res, 403, '「' + act.label + '」需要主管（管理员/高级运营）权限');
  }
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
  // 结果回流达人档案：内容发布后把发布时间回写到达人的账号数据（最近发布），运营视角/档案即可看到
  if (['publish', 'complete'].includes(ctx.body.action)) {
    const pubAt = patch.publishedAt || task.publishedAt || '';
    if (talentOfTask && pubAt) {
      const pubDay = String(pubAt).slice(0, 10);
      if (!talentOfTask.dewuLastPublish || String(talentOfTask.dewuLastPublish).slice(0, 10) < pubDay) {
        await db.update('talents', talentOfTask.id, { dewuLastPublish: pubDay, dewuSyncedAt: nowStr(), dewuSource: talentOfTask.dewuSource || 'manual' });
      }
    }
  }
  // 结果回流：寄拍执行的结果回推给该达人的运营负责人（内容链接 / 审核意见随通知一起给出）
  const backTypes = { submitContent: '已提交内容待审核', resubmit: '已重新提交待审核', auditPass: '内容审核通过、待发布', auditReject: '内容未通过审核、需修改', publish: '内容已发布', complete: '寄拍任务已完成', markException: '任务出现异常' };
  if (backTypes[ctx.body.action] && talentOfTask) {
    const to = talentOfTask.opsBy || talentOfTask.owner || '';
    if (to && to !== ctx.operator) {
      const extra = [];
      if (patch.contentUrl || task.contentUrl) extra.push('内容链接：' + (patch.contentUrl || task.contentUrl));
      if (patch.auditOpinion) extra.push('审核意见：' + patch.auditOpinion);
      if (patch.issue) extra.push('异常说明：' + String(patch.issue).split('\n').pop().replace(/^\[[^\]]*\]\s*/, ''));
      notify('寄拍结果回流 · ' + backTypes[ctx.body.action] + '\n达人：' + task.talentName + ' · ' + task.product
        + (extra.length ? '\n' + extra.join('\n') : '') + '\n（负责人：' + to + '）');
    }
  }
  ok(ctx.res, annotateTask(Object.assign({}, task, patch), ctx, null));
});

// 删除任务（仅管理员）：用于清理误建记录，写入操作日志留痕
route('DELETE', '/api/tasks/:id', async (ctx) => {
  if (ctx.roleCode !== 'admin') return fail(ctx.res, 403, '只有管理员可以删除任务');
  const task = await db.get('tasks', ctx.params.id);
  if (!task) return fail(ctx.res, 404, '任务不存在');
  await db.remove('tasks', ctx.params.id);
  await addLog(ctx.operator, '任务：' + task.id + ' ' + task.product, '删除任务', task.status, '已删除');
  ok(ctx.res, { id: ctx.params.id, deleted: true });
});

// ---------- 操作日志 ----------
// 行级权限：管理员看全部操作留痕；其他岗位只能看与自己相关的（我操作的 / 对象是我的）
route('GET', '/api/logs', async (ctx) => {
  let arr = await db.list('logs');
  if (ctx.roleCode !== 'admin') {
    const me = ctx.displayName || ctx.operator;
    arr = arr.filter(l => l.operator === me || (me && String(l.target || '').includes(me)));
  }
  ok(ctx.res, arr.sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 200));
});

// ---------- 达人线索 Excel 导入 V1（仅解析 / 校验 / 预览，不写入存储、不触达飞书） ----------

// V1 固定模板：key=系统内部字段，header=Excel 表头原文（第一版只认精确列名）
const LEAD_IMPORT_COLUMNS = [
  { key: 'name', header: '达人昵称', required: true },
  { key: 'wechat', header: '微信号' },
  { key: 'phone', header: '手机号' },
  { key: 'source', header: '来源渠道', required: true },
  { key: 'platform', header: '自媒体平台' },
  { key: 'fans', header: '粉丝量' },
  { key: 'coopExp', header: '合作经历' },
  { key: 'note', header: '备注' },
];

// 联系方式归一化：仅去空白 / 连字符 / 括号等排版字符（保留下划线等微信号有效字符），用于重复比对
function normContact(v) {
  return String(v || '').trim().toLowerCase().replace(/[\s\-—–().（）]/g, '');
}

// ---------- 金数据问卷导出格式自动适配 ----------
// 表头带题号（如「题 1. 怎么称呼您？」）时，自动映射成 V1 标准列；用户从金数据导出后可直接上传，无需手改表头
// 题号提取：兼容「题 1.」「题1、」「题目2.」「问题3.」「第4题」「Q5.」「6、」「7.」等写法
function qNumber(h) {
  const s = String(h || '').trim();
  let m = s.match(/^(?:题\s*目?|问题|第|Q|q)\s*(\d+)\s*题?\s*[\.、．:：]?/);
  if (!m) m = s.match(/^(\d+)\s*[\.、．]/);
  return m ? Number(m[1]) : 0;
}
// 问卷题号 → V1 系统字段（多题可落同一字段，导入时用「；」拼接；6/11 为文件题、提交时间为时间戳，均忽略）
const Q_COL_MAP = {
  1: ['name'], 2: ['source'], 3: ['note'], 4: ['platform'], 5: ['fans'],
  7: ['coopExp'], 8: ['coopExp'], 9: ['note'], 10: ['note'], 12: ['note'], 13: ['contact'],
};
// 落入「备注」的题目拼接时加前缀，避免多题混在一起分不清
const Q_NOTE_PREFIX = { 3: '自媒体', 9: '想接', 10: '出镜', 12: '想了解' };
const Q_KEY2COL = { name: '达人昵称', source: '来源渠道', note: '备注', platform: '自媒体平台', fans: '粉丝量', coopExp: '合作经历' };

// 粉丝量区间文案 → 数字（取区间中位数，与前端旧导入 parseFans 口径一致；「5万以上」取 5 万）
function qFans(v) {
  const s = String(v || '').trim().replace(/,/g, '').replace(/[～～]/g, '~').replace(/\s+/g, '');
  if (/^\d+$/.test(s)) return s;
  const toNum = s.replace(/(\d+(?:\.\d+)?)万/g, (_, n) => String(Math.round(parseFloat(n) * 10000))); // 「1万~5万」→「10000~50000」
  const m = toNum.match(/(\d+)~(\d+)/);
  if (m) return String(Math.round((Number(m[1]) + Number(m[2])) / 2));
  const single = toNum.match(/^(\d+)(?:万)?以上?$/) || toNum.match(/(\d{3,})/);
  return single ? String(Number(single[1])) : '';
}

// 联系方式拆分：11 位手机号提取到「手机号」，剩余文本（微信号/描述）归「微信号」
function qSplitContact(v) {
  const s = String(v || '').trim();
  const phones = s.match(/1\d{10}/g) || [];
  let rest = s;
  phones.forEach(p => { rest = rest.split(p).join(' '); });
  rest = rest.replace(/[微信号电话手机：:、，,；;\/\s]+/g, ' ').trim();
  return { phone: phones[0] || '', wechat: rest };
}

// 返回值：null = 是问卷格式但缺必填题（上层报错）；数组 = 已转换成标准列的行；原样返回 = 不是问卷格式
function adaptQuestionnaireRows(rows) {
  const headers = (rows[0] || []).map(h => String(h || '').trim());
  const hits = headers.filter(h => qNumber(h)).length;
  if (hits < 3) return rows; // 带题号的列不足 3 个，视为标准模板
  const plans = headers.map(h => {
    const n = qNumber(h);
    return n ? (Q_COL_MAP[n] || []) : [];
  });
  const has = key => plans.some(ks => ks.includes(key));
  if (!has('name') || !has('source')) return null; // 缺「怎么称呼您」或「渠道」题，无法定位昵称/渠道
  const STD = ['达人昵称', '微信号', '手机号', '来源渠道', '自媒体平台', '粉丝量', '合作经历', '备注'];
  const out = [STD.slice()];
  for (const r of rows.slice(1)) {
    if (!r || !r.length) continue;
    const row = new Array(STD.length).fill('');
    const putCol = (col, val, prefix) => {
      const v = String(val === undefined || val === null ? '' : val).trim();
      if (!v) return;
      const i = STD.indexOf(col);
      if (i < 0) return;
      const t = prefix ? prefix + '：' + v : v;
      row[i] = row[i] ? row[i] + '；' + t : t;
    };
    const put = (key, val, prefix) => putCol(Q_KEY2COL[key], val, prefix);
    headers.forEach((h, ci) => {
      const keys = plans[ci];
      if (!keys || !keys.length) return;
      const raw = r[ci];
      const no = qNumber(h);
      keys.forEach(key => {
        if (key === 'fans') return putCol('粉丝量', qFans(raw));
        if (key === 'contact') {
          const c = qSplitContact(raw);
          if (c.phone) putCol('手机号', c.phone);
          if (c.wechat) putCol('微信号', c.wechat);
          return;
        }
        put(key, raw, Q_NOTE_PREFIX[no]);
      });
    });
    if (row.some(v => v !== '')) out.push(row);
  }
  return out;
}

// 系统侧联系方式索引：复用存储适配层 —— Mock 模式查本地数据，飞书模式查真实多维表格（不写死假逻辑）。
// V1 达人线索尚未独立建表，先用达人表「手机号/微信」去重；V2 线索表落地后只需把集合换成 leads。
async function loadSystemContactKeys() {
  const keys = new Set();
  const talents = await listLeadsAndTalents();
  for (const t of talents) {
    const c = String(t.contact || '');
    if (!c.trim()) continue;
    keys.add(normContact(c));
    (c.match(/1\d{10}/g) || []).forEach(p => keys.add(normContact(p))); // 兼容「微信+手机」混写
  }
  return keys;
}

// 共用解析：读上传文件 → 问卷适配 → 列匹配 → 校验/去重（只读不写，preview 与 confirm 共用）
async function parseLeadImport(up) {
  if (!up || !up.filename) return { err: '未收到上传文件' };
  if (!/\.xlsx$/i.test(up.filename)) return { err: 'V1 仅支持 .xlsx 格式文件' };
  if (!up.data || !up.data.length) return { err: '上传文件为空' };

  let rows;
  try {
    rows = readXlsxRows(up.data);
  } catch (e) {
    return { err: 'Excel 解析失败：' + e.message };
  }
  if (!rows.length) return { err: 'Excel 中没有数据' };

  // 1.5) 金数据问卷导出格式自动适配：「题 N. xxx」表头 → V1 标准列（免手改表头直接上传）
  const adapted = adaptQuestionnaireRows(rows);
  if (adapted === null) return { err: '识别为问卷格式，但缺少必填的「题 1. 怎么称呼您」或「题 2. 渠道」列' };
  rows = adapted;

  // 1) 读表头，检查必填列「达人昵称」「来源渠道」
  const headers = rows[0].map(h => String(h || '').trim());
  const colIdx = {};
  for (const c of LEAD_IMPORT_COLUMNS) {
    const i = headers.indexOf(c.header);
    if (i >= 0) colIdx[c.key] = i;
  }
  const missing = LEAD_IMPORT_COLUMNS.filter(c => c.required && colIdx[c.key] === undefined).map(c => c.header);
  if (missing.length) {
    const seen = headers.filter(Boolean).slice(0, 8).map(h => '『' + String(h).slice(0, 16) + '』').join('') || '（空）';
    return { err: '缺少必填列「' + missing.join('、') + '」，请使用 V1 固定模板；系统读到的表头前几列：' + seen };
  }

  const cell = (r, key) => (colIdx[key] !== undefined ? String(r[colIdx[key]] === undefined || r[colIdx[key]] === null ? '' : r[colIdx[key]]).trim() : '');
  const isBlankRow = r => LEAD_IMPORT_COLUMNS.every(c => cell(r, c.key) === '');

  // 2) 系统侧重复数据索引（真实存储；飞书模式即多维表格现有达人）
  const systemKeys = await loadSystemContactKeys();

  // 3) 逐行读取 + 空值校验 + 基础重复检查（微信号 / 手机号）
  const seenKeys = new Map(); // 归一化联系方式 → 首次出现的 Excel 行号
  const resultRows = [];
  let valid = 0, invalid = 0, duplicate = 0;

  rows.slice(1).forEach((r, i) => {
    if (!r.length || isBlankRow(r)) return; // 跳过整行空白（含表格尾部空行）
    const rowNo = i + 2; // Excel 实际行号（第 1 行是表头）
    const rec = {
      row: rowNo,
      name: cell(r, 'name'), wechat: cell(r, 'wechat'), phone: cell(r, 'phone'),
      source: cell(r, 'source'), platform: cell(r, 'platform'), fans: cell(r, 'fans'),
      coopExp: cell(r, 'coopExp'), note: cell(r, 'note'),
      status: 'valid', error: '',
    };

    const errs = [];
    if (!rec.name) errs.push('达人昵称为空');
    if (!rec.source) errs.push('来源渠道为空');
    if (rec.fans && !/^\d+$/.test(rec.fans.replace(/,/g, ''))) errs.push('粉丝量需为数字');

    if (errs.length) {
      rec.status = 'invalid';
      rec.error = errs.join('；');
      invalid++;
    } else {
      const keys = [];
      if (rec.wechat) keys.push({ label: '微信号', value: normContact(rec.wechat), raw: rec.wechat });
      if (rec.phone) keys.push({ label: '手机号', value: normContact(rec.phone), raw: rec.phone });
      let reason = '';
      for (const k of keys) {
        if (seenKeys.has(k.value)) { reason = `与文件第 ${seenKeys.get(k.value)} 行重复（${k.label}：${k.raw}）`; break; }
        if (systemKeys.has(k.value)) { reason = `系统已存在相同${k.label}（${k.raw}）`; break; }
      }
      if (reason) {
        rec.status = 'duplicate';
        rec.error = reason;
        duplicate++;
      } else {
        keys.forEach(k => seenKeys.set(k.value, rowNo)); // 仅登记有效行，避免错误行互相污染
        valid++;
      }
    }
    resultRows.push(rec);
  });

  return { total: resultRows.length, valid, invalid, duplicate, resultRows };
}

const importPreviewRoute = route('POST', '/api/leads/import/preview', async (ctx) => {
  const up = ctx.body.files && (ctx.body.files.find(f => f.field === 'file') || ctx.body.files[0]);
  const r = await parseLeadImport(up);
  if (r.err) return fail(ctx.res, 400, r.err);
  // 统一 JSON：兼容现有 {ok,data} 约定，同时按 V1 规格带 code/message
  json(ctx.res, 200, {
    ok: true, code: 0, message: 'success',
    data: { total: r.total, valid: r.valid, invalid: r.invalid, duplicate: r.duplicate, preview_rows: r.resultRows.slice(0, 15) },
  });
});
importPreviewRoute.multipart = true;

// 确认导入：重新解析同一文件，把「有效」行写入达人表（Mock=本地 JSON / 飞书=多维表格），并同步返回 MVP 线索页可用的记录
const importConfirmRoute = route('POST', '/api/leads/import/confirm', async (ctx) => {
  if (!ctx.role.mutate) return fail(ctx.res, 403, '当前角色无修改权限');
  const up = ctx.body.files && (ctx.body.files.find(f => f.field === 'file') || ctx.body.files[0]);
  const r = await parseLeadImport(up);
  if (r.err) return fail(ctx.res, 400, r.err);
  if (!r.valid) return fail(ctx.res, 400, '没有可导入的有效数据');

  const inserted = [], leads = [];
  for (const rec of r.resultRows) {
    if (rec.status !== 'valid') continue;
    const contact = [rec.phone, rec.wechat].filter(Boolean).join(' / ');
    const noteParts = [rec.platform ? '平台：' + rec.platform : '', rec.coopExp ? '合作经历：' + rec.coopExp : '', rec.note].filter(Boolean);
    const talent = {
      id: await nextId('leads', 'T', 4),
      name: rec.name, douyin: '', contact, channel: rec.source || '其他',
      level: 'C', status: '待联系', contentTypes: [], categories: [],
      fans: +rec.fans || 0, coopCount: 0, fulfillmentRate: 0, owner: ctx.operator,
      tags: [], note: noteParts.join('；'),
      lastFollowAt: nowStr(), createdAt: nowStr(), rejectReason: '', auditAt: '', auditBy: '', isActive: true,
    };
    await db.insert('leads', talent);
    await addLog(ctx.operator, '达人：' + talent.name, 'Excel 导入新增', '', '来源渠道=' + talent.channel + '；联系方式=' + (contact || '—'));
    inserted.push({ id: talent.id, name: talent.name });
    // 同步给 MVP 达人线索页（前端把这条 push 进列表，立即可见）
    const hasExp = /接过/.test(rec.coopExp || '') && !/没接过|未接过/.test(rec.coopExp || '');
    leads.push({
      name: rec.name, contact: contact || '未填写', source: rec.source || '其他',
      hasMedia: /正在做|做过/.test(rec.note || ''), platforms: rec.platform ? rec.platform.split(/[,，、/]/).map(s => s.trim()).filter(Boolean) : [],
      fans: +rec.fans || 0, hasExp,
      coopCategories: '无', wantCategories: '待沟通', appearWay: '待定',
      note: rec.note || '',
    });
  }
  json(ctx.res, 200, {
    ok: true, code: 0, message: 'success',
    data: { inserted: inserted.length, inserted_list: inserted, leads, skipped_invalid: r.invalid, skipped_duplicate: r.duplicate },
  });
});
importConfirmRoute.multipart = true;

/* ---------------- 静态文件 ---------------- */
const zlib = require('zlib');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const GZIP_EXTS = ['.html', '.htm', '.js', '.css', '.json', '.svg', '.txt'];
// gzip 结果内存缓存：按文件路径 + mtime 失效，避免每个请求重复压缩耗 CPU
const gzipCache = new Map();

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
    const ext = path.extname(file);
    const headers = { 'Content-Type': MIME[ext] || 'text/plain; charset=utf-8' };
    // 缓存策略：vendor 库基本不变 → 30 天；html → 每次协商（保证发版即生效）；
    // 根目录 js/css 由 ?v=版本号 控制失效 → 缓存 1 天；图片 → 7 天
    if (pathname.startsWith('/vendor/')) headers['Cache-Control'] = 'public, max-age=2592000';
    else if (ext === '.html' || ext === '.htm') headers['Cache-Control'] = 'no-cache';
    else if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico'].includes(ext)) headers['Cache-Control'] = 'public, max-age=604800';
    else if (ext === '.js' || ext === '.css') headers['Cache-Control'] = 'public, max-age=86400';
    // 文本资源 gzip 压缩（约省 70% 流量），仅浏览器声明支持时启用
    if (GZIP_EXTS.includes(ext) && d.length > 1024 && /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''))) {
      let entry = gzipCache.get(file);
      let mtime = 0;
      try { mtime = fs.statSync(file).mtimeMs; } catch (e2) { /* 读不到就用旧缓存 */ }
      if (!entry || entry.mtime !== mtime) { entry = { mtime, gz: zlib.gzipSync(d) }; gzipCache.set(file, entry); }
      headers['Content-Encoding'] = 'gzip';
      headers['Vary'] = 'Accept-Encoding';
      headers['Content-Length'] = entry.gz.length;
      res.writeHead(200, headers);
      return res.end(entry.gz);
    }
    headers['Content-Length'] = d.length;
    res.writeHead(200, headers);
    res.end(d);
  });
}

/* ---------------- 服务入口 ---------------- */
/* ---------------- 登录鉴权（哇塞传媒） ---------------- */
const crypto = require('crypto');
const AUTH_FILE = path.join(__dirname, 'auth.json');
let AUTH = null;
try {
  AUTH = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf-8'));
  // 兼容旧版单账号格式：自动包装为 users 数组
  if (AUTH && !Array.isArray(AUTH.users) && AUTH.user) {
    AUTH.users = [{ user: AUTH.user, role: 'admin', salt: AUTH.salt, hash: AUTH.hash, createdAt: AUTH.createdAt || '' }];
  }
} catch (e) { console.error('[Auth] 缺少 v1/auth.json，接口鉴权未启用（API 全部公开）'); }
function saveAuth() { fs.writeFileSync(AUTH_FILE, JSON.stringify(AUTH, null, 2)); }
function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
function authHmac(s) { return crypto.createHmac('sha256', AUTH.secret).update(s).digest('hex'); }
function makeToken(user, role) {
  const rec = (AUTH.users || []).find(x => x.user === user);
  const exp = Date.now() + 7 * 24 * 3600 * 1000; // 登录有效期 7 天
  return exp + '.' + encodeURIComponent(user) + '.' + role + '.' + authHmac('ws.' + exp + '.' + user + '.' + role + '.' + rec.hash);
}
function parseToken(tok) {
  // 返回 { user, role, position, displayName } 或 null；签名绑定该用户当前密码哈希 → 改密/重置后旧会话立即失效
  if (!AUTH || !Array.isArray(AUTH.users) || !tok) return null;
  const parts = tok.split('.');
  if (parts.length !== 4) return null;
  const exp = Number(parts[0]), encUser = parts[1], role = parts[2], sig = parts[3];
  if (!exp || exp < Date.now()) return null;
  let user; try { user = decodeURIComponent(encUser); } catch (e) { return null; }
  const rec = AUTH.users.find(x => x.user === user);
  if (!rec) return null;
  const expect = authHmac('ws.' + exp + '.' + user + '.' + role + '.' + rec.hash);
  if (sig.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
  if (rec.role !== role) return null;
  // 岗位与姓名实时取自账号库：管理员改了岗位立即生效，无需重新登录
  return { user, role, position: rec.position || '', displayName: rec.displayName || rec.user };
}
function checkToken(tok) { return !!parseToken(tok); }
function getCookie(req, name) {
  const c = req.headers.cookie || '';
  for (const p of c.split(';')) {
    const kv = p.trim().split('=');
    if (kv[0] === name) return kv.slice(1).join('=');
  }
  return null;
}
// 公开接口：登录/登出、报名表单提交、报名图片上传（后两者有限频防刷）
const PUBLIC_APIS = [
  { method: 'POST', path: '/api/login' },
  { method: 'POST', path: '/api/logout' },
  { method: 'POST', path: '/api/leads' },
  { method: 'POST', path: '/api/upload' },
];
// IP 限频：同一 IP 10 分钟内最多提交 5 次
const rateMap = new Map();
function rateLimited(ip) {
  const now = Date.now(), win = 10 * 60 * 1000, max = 5;
  const arr = (rateMap.get(ip) || []).filter(t => now - t < win);
  if (arr.length >= max) { rateMap.set(ip, arr); return true; }
  arr.push(now); rateMap.set(ip, arr);
  if (rateMap.size > 5000) rateMap.clear();
  return false;
}

/* ---------------- 微信通知钩子（配置 v1/notify.json 后生效） ---------------- */
const httpsLib = require('https');
const NOTIFY_FILE = path.join(__dirname, 'notify.json');
let NOTIFY_CFG = null;
try { NOTIFY_CFG = JSON.parse(fs.readFileSync(NOTIFY_FILE, 'utf-8')); } catch (e) {}
function notify(text) {
  if (!NOTIFY_CFG || !NOTIFY_CFG.enabled) return;
  try {
    let url, body = null, headers = {};
    if (NOTIFY_CFG.type === 'serverchan' && NOTIFY_CFG.key) {
      url = 'https://sctapi.ftqq.com/' + NOTIFY_CFG.key + '.send?title=' + encodeURIComponent('哇塞传媒提醒') + '&desp=' + encodeURIComponent(text);
    } else if (NOTIFY_CFG.type === 'wecom' && NOTIFY_CFG.url) {
      url = NOTIFY_CFG.url;
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify({ msgtype: 'text', text: { content: '哇塞传媒提醒\n' + text } });
    } else return;
    const r = httpsLib.request(url, { method: body ? 'POST' : 'GET', headers }, resp => { resp.resume(); });
    r.on('error', () => {});
    r.end(body);
  } catch (e) { console.error('[Notify]', e.message); }
}
// 每小时检查一次：结算单逾期则推送（每天最多提醒一次）
let lastOverdueNotifyDate = '';
setInterval(() => {
  try {
    if (!USE_FEISHU && Array.isArray(mockDb.settlements)) {
      const today = new Date().toISOString().slice(0, 10);
      const overdue = mockDb.settlements.filter(s => s.status !== '已结清' && s.dueDate && s.dueDate < today);
      if (overdue.length && lastOverdueNotifyDate !== today) {
        lastOverdueNotifyDate = today;
        notify('有 ' + overdue.length + ' 张结算单已逾期：\n' + overdue.map(s => s.id + ' ' + s.talentName + '（' + s.period + '）到期 ' + s.dueDate).join('\n'));
      }
    }
  } catch (e) {}
}, 60 * 60 * 1000);

const server = http.createServer(async (req, res) => {
  const u = urlLib.parse(req.url); // Node 8 兼容：url.parse + 手工补 searchParams.get
  u.searchParams = { get: k => { const q = require('querystring').parse(u.query || ''); const v = q[k]; return v === undefined ? null : String(Array.isArray(v) ? v[0] : v); } };
  if (!u.pathname.startsWith('/api/')) return serveStatic(req, res, u.pathname);
  // —— 鉴权：除公开接口外，全部 API 需要登录（cookie 会话 7 天）——
  if (u.pathname === '/api/login' && req.method === 'POST') {
    try {
      const b = await readBody(req);
      if (!AUTH || !Array.isArray(AUTH.users)) return fail(res, 500, '服务器未配置 auth.json');
      const u8 = AUTH.users.find(x => b && x.user === b.user && typeof b.pass === 'string' && sha256(x.salt + ':' + b.pass) === x.hash);
      if (u8) {
        res.setHeader('Set-Cookie', [
          'ws_auth=' + makeToken(u8.user, u8.role) + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800',
          'ws_user=' + encodeURIComponent(u8.user) + '; Path=/; SameSite=Lax; Max-Age=604800',
        ]);
        return ok(res, { user: u8.user, role: u8.role, position: u8.position || '', displayName: u8.displayName || u8.user });
      }
      return fail(res, 401, '账号或密码错误');
    } catch (e) { return fail(res, 500, e.message); }
  }
  if (u.pathname === '/api/me' && req.method === 'GET') {
    const t = parseToken(getCookie(req, 'ws_auth'));
    if (!t) return fail(res, 401, '未登录');
    return ok(res, { role: t.role, user: t.user, position: t.position, displayName: t.displayName });
  }
  // —— 修改自己的密码（任何已登录用户）——
  if (req.method === 'POST' && u.pathname === '/api/users/me/password') {
    const t = parseToken(getCookie(req, 'ws_auth'));
    if (!t) return fail(res, 401, '未登录');
    const b = await readBody(req);
    const name = t.user;
    const me = (AUTH && Array.isArray(AUTH.users) ? AUTH.users : []).find(x => x.user === name);
    if (!me || !b || typeof b.old !== 'string' || typeof b.next !== 'string') return fail(res, 400, '参数不完整');
    if (sha256(me.salt + ':' + b.old) !== me.hash) return fail(res, 401, '原密码错误');
    if (b.next.length < 6) return fail(res, 400, '新密码至少 6 位');
    me.salt = crypto.randomBytes(8).toString('hex');
    me.hash = sha256(me.salt + ':' + b.next);
    saveAuth();
    return ok(res, { changed: true });
  }
  // —— 账号管理（仅管理员）——
  if ((u.pathname === '/api/users' || u.pathname.startsWith('/api/users/'))) {
    const t = parseToken(getCookie(req, 'ws_auth'));
    if (!t || t.role !== 'admin') return fail(res, 403, '需要管理员权限');
    // 列出账号
    if (req.method === 'GET' && u.pathname === '/api/users') {
      return ok(res, AUTH.users.map(x => ({ user: x.user, role: x.role, position: x.position || '', displayName: x.displayName || x.user, createdAt: x.createdAt || '' })));
    }
    // 新建账号
    if (req.method === 'POST' && u.pathname === '/api/users') {
      const b = await readBody(req);
      if (!b || !b.user || typeof b.pass !== 'string' || b.pass.length < 6) return fail(res, 400, '账号名必填，密码至少 6 位');
      if (AUTH.users.some(x => x.user === b.user)) return fail(res, 400, '该账号名已存在');
      const salt = crypto.randomBytes(8).toString('hex');
      const role = ['admin', 'finance', 'staff'].includes(b.role) ? b.role : 'staff';
      const position = POSITIONS.includes(b.position) ? b.position : (role === 'finance' ? 'finance' : '');
      const displayName = String(b.displayName || '').trim().slice(0, 20);
      AUTH.users.push({ user: String(b.user).slice(0, 30), role, position, displayName, salt, hash: sha256(salt + ':' + b.pass), createdAt: new Date().toISOString().slice(0, 10) });
      saveAuth();
      await addLog('系统', '账号：' + b.user, '新建账号', '角色=' + ROLE_KEY[role], '姓名=' + (displayName || '未填') + '；岗位=' + posLabel(position));
      return ok(res, { user: b.user, role, position, displayName });
    }
    // 管理员重置某账号密码 → 生成临时密码（仅此一次明文展示）
    if (req.method === 'POST' && u.pathname.startsWith('/api/users/') && u.pathname.endsWith('/reset')) {
      const target = decodeURIComponent(u.pathname.slice('/api/users/'.length, -'/reset'.length));
      const t2 = AUTH.users.find(x => x.user === target);
      if (!t2) return fail(res, 404, '账号不存在');
      const temp = 'ws' + crypto.randomBytes(4).toString('hex');
      t2.salt = crypto.randomBytes(8).toString('hex');
      t2.hash = sha256(t2.salt + ':' + temp);
      saveAuth();
      await addLog('系统', '账号：' + target, '重置密码', '', '管理员操作');
      return ok(res, { user: target, tempPass: temp });
    }
    // 修改账号的姓名 / 岗位 / 角色（管理员）——改岗位立即生效，改角色会使旧会话失效
    if (req.method === 'PATCH' && u.pathname.startsWith('/api/users/')) {
      const target = decodeURIComponent(u.pathname.slice('/api/users/'.length));
      const rec = AUTH.users.find(x => x.user === target);
      if (!rec) return fail(res, 404, '账号不存在');
      const b = await readBody(req);
      const before = '姓名=' + (rec.displayName || rec.user) + '；岗位=' + posLabel(rec.position) + '；角色=' + ROLE_KEY[rec.role];
      if (b && b.displayName !== undefined) rec.displayName = String(b.displayName).trim().slice(0, 20);
      if (b && b.position !== undefined && (POSITIONS.includes(b.position) || b.position === '' || b.position === 'admin')) rec.position = b.position;
      if (b && b.role !== undefined && ['admin', 'finance', 'staff'].includes(b.role)) rec.role = b.role;
      saveAuth();
      await addLog('系统', '账号：' + target, '修改账号', before, '姓名=' + (rec.displayName || rec.user) + '；岗位=' + posLabel(rec.position) + '；角色=' + ROLE_KEY[rec.role]);
      return ok(res, { user: rec.user, role: rec.role, position: rec.position || '', displayName: rec.displayName || rec.user });
    }
    // 删除账号
    if (req.method === 'DELETE' && u.pathname.startsWith('/api/users/')) {
      const target = decodeURIComponent(u.pathname.slice('/api/users/'.length));
      if (target === 'admin') return fail(res, 400, '不能删除主管理员账号');
      const idx = AUTH.users.findIndex(x => x.user === target);
      if (idx < 0) return fail(res, 404, '账号不存在');
      AUTH.users.splice(idx, 1); saveAuth();
      await addLog('系统', '账号：' + target, '删除账号', '', '操作者后台');
      return ok(res, { deleted: target });
    }
  }
  if (u.pathname === '/api/logout') {
    res.setHeader('Set-Cookie', [
      'ws_auth=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0',
      'ws_user=; Path=/; SameSite=Lax; Max-Age=0',
    ]);
    return ok(res, { bye: true });
  }
  const isPublic = PUBLIC_APIS.some(p => p.method === req.method && p.path === u.pathname);
  if (AUTH && !isPublic && !checkToken(getCookie(req, 'ws_auth'))) {
    return fail(res, 401, '未登录或登录已过期');
  }
  // —— 角色数据锁：结算/流水/财务设置仅管理员与财务可访问（运营 403）——
  if (u.pathname.startsWith('/api/mvp/settlements') || u.pathname.startsWith('/api/mvp/payments') || u.pathname.startsWith('/api/mvp/finance')) {
    const t = parseToken(getCookie(req, 'ws_auth'));
    if (!t || (t.role !== 'admin' && t.role !== 'finance')) return fail(res, 403, '需要管理员或财务权限');
  }
  if (u.pathname === '/api/leads' || u.pathname === '/api/upload') {
    const ip = String((req.headers['x-forwarded-for'] || req.socket.remoteAddress || '')).split(',')[0].trim();
    if (rateLimited(ip)) return fail(res, 429, '提交太频繁，请 10 分钟后再试');
  }
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
    function safeDecode(v, fallback) { if (!v) return fallback; try { return decodeURIComponent(v) || fallback; } catch (e3) { return v; } }
    // —— 权限上下文一律以会话 token 为准：前端从未发送 x-role，若信任请求头等于对所有登录用户放行 ——
    const tok = parseToken(getCookie(req, 'ws_auth'));
    const roleCode = tok ? tok.role : safeDecode(req.headers['x-role'], 'staff');
    const role = ROLES[ROLE_KEY[roleCode]] || ROLES['运营'];
    const displayName = tok ? tok.displayName : '';
    const operator = displayName || safeDecode(req.headers['x-operator'], '未知用户');
    const body = ['POST', 'PUT', 'PATCH'].includes(req.method)
      ? await (match.multipart ? readMultipart(req) : readBody(req))
      : {};
    await match.handler({
      req, res, query: u.searchParams, params: match._params, body, operator, role,
      roleCode, displayName, position: tok ? tok.position : '', authUser: tok ? tok.user : '',
    });
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
  if (!Array.isArray(mockDb.campaigns)) {
    mockDb.campaigns = [
      { id: 'CMP001', name: '朋友圈春季招募', channel: '朋友圈', owner: '李婷', cost: 100, start: '2026-08-28', consult: 30, validLeads: 20, signed: 5, talents: 3, note: '示例数据，可编辑或删除', createdAt: nowStr() },
      { id: 'CMP002', name: '抖音短视频·达人招募第3期', channel: '抖音短视频', owner: '王浩', cost: 500, start: '2026-08-25', consult: 126, validLeads: 45, signed: 12, talents: 7, note: '示例数据，可编辑或删除', createdAt: nowStr() },
      { id: 'CMP003', name: '达人社群日常推广', channel: '社群推广', owner: '张萌', cost: 0, start: '2026-09-01', consult: 25, validLeads: 12, signed: 4, talents: 2, note: '示例数据，可编辑或删除', createdAt: nowStr() },
      { id: 'CMP004', name: 'AI 数字人直播招募', channel: 'AI数字人直播', owner: '李婷', cost: 300, start: '2026-09-02', consult: 82, validLeads: 28, signed: 8, talents: 4, note: '示例数据，可编辑或删除', createdAt: nowStr() },
      { id: 'CMP005', name: '老达人转介绍激励', channel: '达人转介绍', owner: '—', cost: 0, start: '2026-09-01', consult: 10, validLeads: 8, signed: 5, talents: 4, note: '示例数据，可编辑或删除', createdAt: nowStr() },
      { id: 'CMP006', name: '招募海报·朋友圈投放', channel: '海报图文', owner: '王浩', cost: 150, start: '2026-09-03', consult: 18, validLeads: 9, signed: 2, talents: 1, note: '示例数据，可编辑或删除', createdAt: nowStr() },
    ];
    saveDb();
    console.log('已初始化推广活动示例数据（6 条，可编辑/删除）');
  }
  // 岗位 / 交接状态字段迁移（老数据补默认值，新库补空集合）
  migrateDb();
  // 达人分配记录（2026-09-18）：高级运营分配/重新分配达人给普通运营的历史，独立集合可回溯
  if (!Array.isArray(mockDb.talentAssignments)) { mockDb.talentAssignments = []; saveDb(); }
  // 收益结算：设置 / 结算单 / 资金流水
  if (!Array.isArray(mockDb.settings)) {
    mockDb.settings = [{ id: FIN_SETTINGS_ID, mcnRate: 0.3, taxRate: 0.06, receiveDays: 30, payDays: 15 }];
    saveDb();
    console.log('已初始化结算规则（MCN 分成 30% / 代扣税 6%）');
  }
  if (!Array.isArray(mockDb.payments)) { mockDb.payments = []; saveDb(); }
  if (!Array.isArray(mockDb.settlements)) {
    mockDb.settlements = [
      { id: 'ST00001', talentId: 'T0002', talentName: '王芳Fiona', account: 'fiona_dewu', period: '2026-08',
        platformIncome: 8600, mcnRate: 0.3, taxRate: 0.06, adjustments: [], dueDate: '2026-09-30',
        status: '已确认', remark: '示例数据，可编辑或删除', createdAt: nowStr(), updatedAt: nowStr() },
      { id: 'ST00002', talentId: 'T0003', talentName: '阿泽', account: 'aze_style', period: '2026-08',
        platformIncome: 5200, mcnRate: 0.3, taxRate: 0.06,
        adjustments: [{ type: '样品扣款', amount: -160, reason: '退回样品有磨损，按折价扣回' }],
        dueDate: '2026-09-30', status: '已结清', remark: '示例数据，可编辑或删除', createdAt: nowStr(), updatedAt: nowStr() },
      { id: 'ST00003', talentId: 'T0004', talentName: '桃子peach', account: 'peach_home', period: '2026-08',
        platformIncome: 3100, mcnRate: 0.3, taxRate: 0.06, adjustments: [], dueDate: '2026-09-10',
        status: '待核对', remark: '示例数据，可编辑或删除', createdAt: nowStr(), updatedAt: nowStr() },
    ];
    mockDb.payments = [
      { id: 'PY00001', settlementId: 'ST00001', direction: 'in', amount: 8600, date: '2026-09-05',
        method: '对公转账', refNo: 'DEWU20260905001', remark: '得物平台 8 月收益结算全额到账', operator: '系统', createdAt: nowStr() },
      { id: 'PY00002', settlementId: 'ST00002', direction: 'in', amount: 5200, date: '2026-09-05',
        method: '对公转账', refNo: 'DEWU20260905002', remark: '得物平台 8 月收益结算全额到账', operator: '系统', createdAt: nowStr() },
      { id: 'PY00003', settlementId: 'ST00002', direction: 'out', amount: 3261.6, date: '2026-09-08',
        method: '支付宝', refNo: 'ALI20260908007', remark: '达人分成已付讫', operator: '财务', createdAt: nowStr() },
    ];
    saveDb();
    console.log('已初始化结算单示例数据（3 张 + 3 笔流水，可编辑/删除）');
  }
}

server.listen(PORT, () => {
  console.log(`MCN 达人培育后台 V1 已启动: http://localhost:${PORT}`);
  console.log(`存储模式: ${USE_FEISHU ? '飞书多维表格' : 'Mock 本地 JSON（配置 FEISHU_* 环境变量后自动切换为飞书）'}`);
});
