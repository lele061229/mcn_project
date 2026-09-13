/* ============================================================
 * MCN 达人运营中台 · MVP 演示
 * 纯前端：Vue3 + ECharts + SheetJS（CDN），无需构建，双击即可运行
 * ============================================================ */

// ---- 图片生成（演示用 AI 文生图接口）----
const IMG = (p, s = 'square') =>
  `https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=${encodeURIComponent(p)}&image_size=${s}`;

const CHANNELS = ['朋友圈', '抖音短视频', 'AI数字人直播', '社群推广', '私聊邀约', '海报图文', '达人转介绍'];
const OWNERS = ['李婷', '王浩', '张萌'];
const LEAD_STAGES = ['新线索', '已联系', '有意向', '已报名', '已成为达人'];
const TASK_STAGES = ['待报名', '已报名', '已通过', '商家发货', '达人收货', '拍摄中', '已发布', '已完成', '已结算'];
const MCN_RATE = 0.2;

// ---- 头像 ----
const AV = [
  IMG('professional headshot portrait of a stylish young asian woman, smiling softly, natural light, plain light gray background, photorealistic'),
  IMG('professional headshot portrait of a fashionable young asian man, short hair, confident smile, plain light gray background, photorealistic'),
  IMG('professional headshot portrait of a cute young asian woman with long hair, sweet smile, plain beige background, photorealistic'),
  IMG('professional headshot portrait of a cool young asian man with glasses, casual style, plain light gray background, photorealistic'),
  IMG('professional headshot portrait of an elegant young asian woman, minimal makeup, neutral background, photorealistic'),
  IMG('professional headshot portrait of a cheerful asian college girl, ponytail, bright smile, plain background, photorealistic'),
];

// ---- 商品图（寄拍任务用）----
const PRODUCTS = {
  P1: { name: '复古慢跑鞋（米白翻毛皮）', img: IMG('e-commerce product photo of vintage retro running sneakers, cream white suede, pure white studio background, soft shadow, ultra detailed') },
  P2: { name: '奶油云感针织卫衣', img: IMG('e-commerce product photo of cream white knit hoodie on hanger, soft beige background, cozy fashion, high detail') },
  P3: { name: '头层牛皮通勤托特包', img: IMG('e-commerce product photo of brown genuine leather tote handbag, elegant, light gray studio background, luxury feel') },
  P4: { name: '316 不锈钢保温杯', img: IMG('e-commerce product photo of matte white stainless steel insulated thermos bottle, minimal, white background') },
  P5: { name: '主动降噪蓝牙耳机', img: IMG('e-commerce product photo of white wireless bluetooth earbuds in open charging case, dark slate background, tech style') },
};

const { createApp, reactive, ref, computed, watch, nextTick } = Vue;

createApp({
  setup() {
    /* ================= 基础状态 ================= */
    const page = ref('dashboard');
    const toast = ref('');
    const today = '2026-09-07';

    const nav = [
      { key: 'dashboard', label: '经营看板', desc: '获客—转化—任务—收益 一屏总览' },
      { key: 'channels', label: '推广获客', desc: '哪个渠道真正有效' },
      { key: 'leads', label: '线索管理', desc: '谁在跟？跟到哪一步？有没有漏？' },
      { key: 'talent-leads', label: '达人线索', desc: '达人招募 CRM（新增）' },
      { key: 'tasks', label: '寄拍任务', desc: '任务卡在哪一步，一目了然' },
      { key: 'finance', label: '收益结算', desc: '佣金 / MCN 分成 / 待结算' },
      { key: 'ai', label: 'AI 生图', desc: '素材生产成本与可用率验证' },
      { key: 'import', label: '数据导入', desc: '抖音 / 飞书 / Excel 数据进入系统' },
      // ===== 以下为 V1 飞书业务后台【增量入口】：整页跳转 /admin/，与上方 8 个演示板块并存，互不影响 =====
      { key: 'v1-group', label: 'V1 飞书业务后台', group: true },
      { key: 'v1-dashboard', label: 'V1 经营看板', desc: '达人培育后台 V1', href: '/admin/', group: false,
        icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-5 h-5"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>' },
      { key: 'v1-talents', label: 'V1 达人管理', desc: '达人培育后台 V1', href: '/admin/?page=talents', group: false,
        icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-5 h-5"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 00-3-3.87"/></svg>' },
      { key: 'v1-tasks', label: 'V1 寄拍任务', desc: '达人培育后台 V1', href: '/admin/?page=tasks', group: false,
        icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-5 h-5"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>' },
      { key: 'v1-logs', label: 'V1 操作日志', desc: '达人培育后台 V1', href: '/admin/?page=logs', group: false,
        icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-5 h-5"><path d="M12 8v4l3 3"/><circle cx="12" cy="12" r="10"/></svg>' },
    ];
    const icons = {
      dashboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-5 h-5"><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg>',
      channels: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-5 h-5"><path d="M3 11l18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 11-5.8-1.6"/></svg>',
      leads: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-5 h-5"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>',
      'talent-leads': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-5 h-5"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>',
      tasks: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-5 h-5"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>',
      finance: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-5 h-5"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>',
      ai: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-5 h-5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
      import: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-5 h-5"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
    };
    nav.forEach(n => { if (icons[n.key]) n.icon = icons[n.key]; }); // 仅给原 8 项补图标；V1 增量项自带图标、分组项无图标
    const currentNav = computed(() => nav.find(n => n.key === page.value));

    const trendUp = '<svg viewBox="0 0 24 24" fill="currentColor" class="w-3.5 h-3.5"><path d="M7 14l5-5 5 5H7z"/></svg>';
    const trendFlat = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-3.5 h-3.5"><circle cx="12" cy="12" r="9"/></svg>';

    /* ================= 模拟数据 ================= */
    const campaigns = reactive([
      { id: 'CMP001', name: '朋友圈春季招募', channel: '朋友圈', owner: '李婷', cost: 100, start: '2026-08-28', consult: 30, validLeads: 20, signed: 5, talents: 3 },
      { id: 'CMP002', name: '抖音短视频·达人招募第3期', channel: '抖音短视频', owner: '王浩', cost: 500, start: '2026-08-25', consult: 126, validLeads: 45, signed: 12, talents: 7 },
      { id: 'CMP003', name: '达人社群日常推广', channel: '社群推广', owner: '张萌', cost: 0, start: '2026-09-01', consult: 25, validLeads: 12, signed: 4, talents: 2 },
      { id: 'CMP004', name: 'AI 数字人直播招募', channel: 'AI数字人直播', owner: '李婷', cost: 300, start: '2026-09-02', consult: 82, validLeads: 28, signed: 8, talents: 4 },
      { id: 'CMP005', name: '老达人转介绍激励', channel: '达人转介绍', owner: '—', cost: 0, start: '2026-09-01', consult: 10, validLeads: 8, signed: 5, talents: 4 },
      { id: 'CMP006', name: '招募海报·朋友圈投放', channel: '海报图文', owner: '王浩', cost: 150, start: '2026-09-03', consult: 18, validLeads: 9, signed: 2, talents: 1 },
    ]);

    const tasks = reactive([
      { id: 'TK20260901', talentId: 'T001', product: '复古慢跑鞋（米白翻毛皮）', img: PRODUCTS.P1.img, commission: 600, rate: MCN_RATE, status: '已结算', deadline: '2026-09-02' },
      { id: 'TK20260902', talentId: 'T001', product: '奶油云感针织卫衣', img: PRODUCTS.P2.img, commission: 500, rate: MCN_RATE, status: '已结算', deadline: '2026-09-03' },
      { id: 'TK20260903', talentId: 'T001', product: '头层牛皮通勤托特包', img: PRODUCTS.P3.img, commission: 500, rate: MCN_RATE, status: '已完成', deadline: '2026-09-06' },
      { id: 'TK20260904', talentId: 'T001', product: '316 不锈钢保温杯', img: PRODUCTS.P4.img, commission: 400, rate: MCN_RATE, status: '已发布', deadline: '2026-09-07' },
      { id: 'TK20260905', talentId: 'T002', product: '复古慢跑鞋（米白翻毛皮）', img: PRODUCTS.P1.img, commission: 550, rate: MCN_RATE, status: '已结算', deadline: '2026-09-02' },
      { id: 'TK20260906', talentId: 'T002', product: '主动降噪蓝牙耳机', img: PRODUCTS.P5.img, commission: 450, rate: MCN_RATE, status: '已结算', deadline: '2026-09-05' },
      { id: 'TK20260907', talentId: 'T002', product: '奶油云感针织卫衣', img: PRODUCTS.P2.img, commission: 480, rate: MCN_RATE, status: '拍摄中', deadline: '2026-09-09' },
      { id: 'TK20260908', talentId: 'T010', product: '复古慢跑鞋（米白翻毛皮）', img: PRODUCTS.P1.img, commission: 520, rate: MCN_RATE, status: '已完成', deadline: '2026-09-06' },
      { id: 'TK20260909', talentId: 'T010', product: '316 不锈钢保温杯', img: PRODUCTS.P4.img, commission: 300, rate: MCN_RATE, status: '已完成', deadline: '2026-09-08' },
      { id: 'TK20260910', talentId: 'T003', product: '头层牛皮通勤托特包', img: PRODUCTS.P3.img, commission: 460, rate: MCN_RATE, status: '已发布', deadline: '2026-09-08' },
      { id: 'TK20260911', talentId: 'T003', product: '主动降噪蓝牙耳机', img: PRODUCTS.P5.img, commission: 350, rate: MCN_RATE, status: '拍摄中', deadline: '2026-09-10' },
      { id: 'TK20260912', talentId: 'T004', product: '奶油云感针织卫衣', img: PRODUCTS.P2.img, commission: 420, rate: MCN_RATE, status: '达人收货', deadline: '2026-09-10' },
      { id: 'TK20260913', talentId: 'T004', product: '316 不锈钢保温杯', img: PRODUCTS.P4.img, commission: 280, rate: MCN_RATE, status: '商家发货', deadline: '2026-09-11' },
      { id: 'TK20260914', talentId: 'T005', product: '头层牛皮通勤托特包', img: PRODUCTS.P3.img, commission: 500, rate: MCN_RATE, status: '拍摄中', deadline: '2026-09-09' },
      { id: 'TK20260915', talentId: 'T005', product: '主动降噪蓝牙耳机', img: PRODUCTS.P5.img, commission: 380, rate: MCN_RATE, status: '已通过', deadline: '2026-09-12' },
      { id: 'TK20260916', talentId: 'T009', product: '复古慢跑鞋（米白翻毛皮）', img: PRODUCTS.P1.img, commission: 460, rate: MCN_RATE, status: '已报名', deadline: '2026-09-13' },
      { id: 'TK20260917', talentId: 'T009', product: '奶油云感针织卫衣', img: PRODUCTS.P2.img, commission: 390, rate: MCN_RATE, status: '已报名', deadline: '2026-09-13' },
      { id: 'TK20260918', talentId: 'T012', product: '316 不锈钢保温杯', img: PRODUCTS.P4.img, commission: 260, rate: MCN_RATE, status: '已通过', deadline: '2026-09-12' },
      { id: 'TK20260919', talentId: 'T006', product: '头层牛皮通勤托特包', img: PRODUCTS.P3.img, commission: 430, rate: MCN_RATE, status: '待报名', deadline: '2026-09-14' },
      { id: 'TK20260920', talentId: 'T007', product: '主动降噪蓝牙耳机', img: PRODUCTS.P5.img, commission: 320, rate: MCN_RATE, status: '待报名', deadline: '2026-09-14' },
      { id: 'TK20260921', talentId: 'T008', product: '奶油云感针织卫衣', img: PRODUCTS.P2.img, commission: 0, rate: MCN_RATE, status: '商家发货', deadline: '2026-09-12' },
      { id: 'TK20260922', talentId: 'T011', product: '复古慢跑鞋（米白翻毛皮）', img: PRODUCTS.P1.img, commission: 0, rate: MCN_RATE, status: '待报名', deadline: '2026-09-15' },
    ]);

    const leads = reactive([
      { id: 'L027', name: '风一样的女子', channel: '抖音短视频', contact: 'wx_feng_2026', owner: '王浩', level: 'C', status: '新线索', lastFollow: '2026-09-07', nextFollow: '2026-09-08' },
      { id: 'L026', name: '阿泽_Aze', channel: '抖音短视频', contact: '138****6621', owner: '王浩', level: 'B', status: '新线索', lastFollow: '2026-09-07', nextFollow: '2026-09-08' },
      { id: 'L025', name: '甜甜圈本圈', channel: 'AI数字人直播', contact: 'ttq_life', owner: '李婷', level: 'B', status: '新线索', lastFollow: '2026-09-07', nextFollow: '2026-09-08' },
      { id: 'L024', name: '大山', channel: '私聊邀约', contact: 'dashan88', owner: '张萌', level: 'C', status: '新线索', lastFollow: '2026-09-06', nextFollow: '2026-09-07' },
      { id: 'L023', name: 'Lisa妈妈', channel: '朋友圈', contact: 'lisa_mom', owner: '李婷', level: 'B', status: '新线索', lastFollow: '2026-09-06', nextFollow: '2026-09-07' },
      { id: 'L022', name: '果果', channel: '社群推广', contact: 'guoguo_99', owner: '张萌', level: 'B', status: '已联系', lastFollow: '2026-09-06', nextFollow: '2026-09-07' },
      { id: 'L021', name: '阿凯同学', channel: '抖音短视频', contact: 'akai_kk', owner: '王浩', level: 'A', status: '已联系', lastFollow: '2026-09-06', nextFollow: '2026-09-08' },
      { id: 'L020', name: '椰子冻', channel: 'AI数字人直播', contact: 'yezi_dong', owner: '李婷', level: 'B', status: '已联系', lastFollow: '2026-09-05', nextFollow: '2026-09-07' },
      { id: 'L019', name: '慢慢', channel: '朋友圈', contact: 'manman_01', owner: '李婷', level: 'C', status: '已联系', lastFollow: '2026-09-05', nextFollow: '2026-09-09' },
      { id: 'L018', name: 'KK不想上班', channel: '海报图文', contact: 'kk_quitjob', owner: '王浩', level: 'B', status: '已联系', lastFollow: '2026-09-04', nextFollow: '2026-09-06' },
      { id: 'L017', name: '七喜', channel: '达人转介绍', contact: 'qixi_baby', owner: '张萌', level: 'A', status: '有意向', lastFollow: '2026-09-06', nextFollow: '2026-09-07' },
      { id: 'L016', name: '糖糖不甜', channel: '社群推广', contact: 'tangtang_t', owner: '张萌', level: 'B', status: '有意向', lastFollow: '2026-09-05', nextFollow: '2026-09-08' },
      { id: 'L015', name: '阿杰不会穿', channel: '抖音短视频', contact: 'ajie_style', owner: '王浩', level: 'A', status: '有意向', lastFollow: '2026-09-05', nextFollow: '2026-09-07' },
      { id: 'L014', name: '五月', channel: '朋友圈', contact: 'wuyue_may', owner: '李婷', level: 'B', status: '有意向', lastFollow: '2026-09-04', nextFollow: '2026-09-09' },
      { id: 'L013', name: '波比', channel: 'AI数字人直播', contact: 'bobi_bb', owner: '李婷', level: 'C', status: '有意向', lastFollow: '2026-09-04', nextFollow: '2026-09-08' },
      { id: 'L012', name: '柠檬不酸', channel: '朋友圈', contact: 'lemon_ns', owner: '李婷', level: 'A', status: '已报名', lastFollow: '2026-09-06', nextFollow: '2026-09-09' },
      { id: 'L011', name: '糯米团子', channel: '社群推广', contact: 'nuomi_tz', owner: '张萌', level: 'B', status: '已报名', lastFollow: '2026-09-05', nextFollow: '2026-09-09' },
      { id: 'L010', name: '大壮本壮', channel: '抖音短视频', contact: 'dazhuang_z', owner: '王浩', level: 'B', status: '已报名', lastFollow: '2026-09-05', nextFollow: '2026-09-10' },
      { id: 'L009', name: '樱桃小完子', channel: 'AI数字人直播', contact: 'yingtao_w', owner: '李婷', level: 'A', status: '已报名', lastFollow: '2026-09-04', nextFollow: '2026-09-10' },
      { id: 'L008', name: '小王超会穿', channel: '朋友圈', contact: 'xiaowang_style', owner: '李婷', level: 'A', status: '已成为达人', lastFollow: '2026-08-30', nextFollow: '' },
      { id: 'L007', name: '阿May穿搭日记', channel: '抖音短视频', contact: 'amay_diary', owner: '王浩', level: 'A', status: '已成为达人', lastFollow: '2026-08-29', nextFollow: '' },
      { id: 'L006', name: '大琪爱吃穿', channel: '社群推广', contact: 'daqi_eat', owner: '张萌', level: 'B', status: '已成为达人', lastFollow: '2026-09-01', nextFollow: '' },
      { id: 'L005', name: '小林的日常', channel: 'AI数字人直播', contact: 'xiaolin_daily', owner: '李婷', level: 'B', status: '已成为达人', lastFollow: '2026-09-02', nextFollow: '' },
      { id: 'L004', name: '蕾蕾Lena', channel: '达人转介绍', contact: 'leilei_lena', owner: '王浩', level: 'A', status: '已成为达人', lastFollow: '2026-09-01', nextFollow: '' },
      { id: 'L003', name: 'xx数据服务', channel: '抖音短视频', contact: 'vx_data88', owner: '王浩', level: 'C', status: '无效线索', lastFollow: '2026-08-28', nextFollow: '', invalidReason: '同行/广告号' },
      { id: 'L002', name: '131****0000', channel: '海报图文', contact: '131****0000', owner: '王浩', level: 'C', status: '无效线索', lastFollow: '2026-08-27', nextFollow: '', invalidReason: '空号/联系不上' },
      { id: 'L001', name: '阿强', channel: '私聊邀约', contact: 'aqiang_7', owner: '张萌', level: 'C', status: '无效线索', lastFollow: '2026-08-26', nextFollow: '', invalidReason: '时间不匹配，无意向' },
    ]);

    /* ================= 工具与计算 ================= */
    const fmt = n => (Math.round(n * 100) / 100).toLocaleString('zh-CN');
    const sum = (arr, k) => arr.reduce((a, b) => a + (b[k] || 0), 0);
    const stageIdx = s => TASK_STAGES.indexOf(s);
    const leadStagesAll = [...LEAD_STAGES, '无效线索'];

    const leadStageColor = s => ({
      '新线索': '#64748b', '已联系': '#3b82f6', '有意向': '#f59e0b', '已报名': '#8b5cf6',
      '已成为达人': '#10b981', '无效线索': '#cbd5e1',
    }[s] || '#94a3b8');
    const taskStageColor = s => {
      const i = stageIdx(s);
      const colors = ['#94a3b8', '#94a3b8', '#0ea5e9', '#0ea5e9', '#6366f1', '#6366f1', '#8b5cf6', '#f59e0b', '#10b981'];
      return colors[i] || '#94a3b8';
    };

    // 任务附带达人名称（达人库已下线，统一显示达人ID）
    tasks.forEach(t => { t._talentName = '达人 ' + t.talentId; });

    // 达人聚合统计（达人库已下线，保留为空计算以备后续复用）
    const talentCards = computed(() => []);

    // 收益
    const revenueTasks = computed(() => tasks.filter(t => stageIdx(t.status) >= 6));
    const totalCommission = computed(() => sum(revenueTasks.value, 'commission'));
    const mcnIncome = computed(() => totalCommission.value * MCN_RATE);
    const settledAmount = computed(() => sum(tasks.filter(t => t.status === '已结算'), 'commission'));
    const pendingAmount = computed(() => totalCommission.value - settledAmount.value);

    // 渠道
    const totalCost = computed(() => sum(campaigns, 'cost'));
    const totalTalentsAcquired = computed(() => sum(campaigns, 'talents'));
    const monthNewTalents = computed(() => sum(campaigns, 'talents'));
    const costPerTalent = computed(() => fmt(totalCost.value / totalTalentsAcquired.value));
    const cpa = channel => {
      const c = campaigns.filter(x => x.channel === channel);
      const cost = sum(c, 'cost'), t = sum(c, 'talents');
      return t ? fmt(cost / t) : '—';
    };
    const insight = computed(() => {
      const ranked = campaigns.map(c => ({ ...c, rate: c.consult ? (c.talents / c.consult * 100) : 0 }));
      const best = [...ranked].sort((a, b) => b.rate - a.rate)[0];
      const paid = ranked.filter(c => c.cost > 0).map(c => ({ ...c, cpa: c.cost / c.talents })).sort((a, b) => a.cpa - b.cpa)[0];
      return { bestChannel: best.channel, bestRate: best.rate.toFixed(1), cheapChannel: paid.channel, cheapCost: fmt(paid.cpa) };
    });

    // 看板 KPI
    const kpis = computed(() => [
      { label: '本月新增达人', value: monthNewTalents.value, unit: '人', good: true, note: '各渠道新增合计' },
      { label: '本月寄拍任务', value: tasks.length, unit: '个', good: true, note: '进行中 ' + tasks.filter(t => stageIdx(t.status) >= 1 && stageIdx(t.status) <= 5).length + ' 个' },
      { label: '本月总佣金', value: '¥' + fmt(totalCommission.value), unit: '', good: true, note: '已发布及以后任务' },
      { label: 'MCN 预计收益', value: '¥' + fmt(mcnIncome.value), unit: '', good: true, note: '分成 20%' },
      { label: '已结算金额', value: '¥' + fmt(settledAmount.value), unit: '', good: false, note: '实际到账' },
      { label: '待结算金额', value: '¥' + fmt(pendingAmount.value), unit: '', good: false, note: '需本周跟进' },
      { label: '单达人获客成本', value: '¥' + costPerTalent.value, unit: '', good: true, note: '全渠道平均' },
      { label: '本月有效线索', value: sum(campaigns, 'validLeads'), unit: '条', good: true, note: '报名 ' + sum(campaigns, 'signed') + ' 人' },
    ]);

    const todos = [
      { id: 1, name: '七喜', action: 'A 级意向，今天需发报名流程', time: '今天', urgent: true },
      { id: 2, name: '阿杰不会穿', action: 'A 级意向，未回复 2 天，电话跟进', time: '今天', urgent: true },
      { id: 3, name: 'TK20260903 托特包', action: '小王任务已完成，待结算 ¥500', time: '今天', urgent: false },
      { id: 4, name: 'TK20260908 慢跑鞋', action: '大熊任务已完成，待结算 ¥520', time: '明天', urgent: false },
      { id: 5, name: 'KK不想上班', action: '跟进时间已逾期 1 天', time: '已逾期', urgent: true },
    ];

    const taskStageDist = computed(() => TASK_STAGES.map(s => ({ name: s, count: tasks.filter(t => t.status === s).length })).filter(x => x.count > 0));
    const pendingLeads = computed(() => leads.filter(l => l.status !== '已成为达人' && l.status !== '无效线索').length);

    /* ================= 线索页 ================= */
    const leadView = ref('board');
    const leadKeyword = ref('');
    const leadModal = ref(false);
    const leadForm = reactive({ name: '', channel: '朋友圈', level: 'B', contact: '', owner: OWNERS[0], note: '' });

    const leadStagesAllRef = leadStagesAll;
    const matchesKw = l => !leadKeyword.value || [l.name, l.owner, l.channel, l.contact].some(v => (v || '').includes(leadKeyword.value));
    const filteredLeads = st => leads.filter(l => l.status === st && matchesKw(l));
    const leadsFiltered = computed(() => leads.filter(matchesKw));
    const isOverdue = d => !!d && d < today;

    function openLeadModal() { leadModal.value = true; }
    function saveLead() {
      if (!leadForm.name.trim()) { showToast('请填写昵称/姓名'); return; }
      leads.unshift({
        id: 'L' + String(leads.length + 28).padStart(3, '0'),
        name: leadForm.name, channel: leadForm.channel, contact: leadForm.contact || '未填写',
        owner: leadForm.owner, level: leadForm.level, status: '新线索',
        lastFollow: today, nextFollow: '2026-09-08', note: leadForm.note,
      });
      leadModal.value = false;
      Object.assign(leadForm, { name: '', channel: '朋友圈', level: 'B', contact: '', owner: OWNERS[0], note: '' });
      showToast('线索已保存，状态：新线索');
    }
    function onLeadMove(l) { showToast(l.name + ' 已移动到「' + l.status + '」'); }

    /* ================= 任务页 ================= */
    const taskFilter = ref('全部');
    const tasksFiltered = computed(() => taskFilter.value === '全部' ? tasks : tasks.filter(t => t.status === taskFilter.value));
    function advanceTask(t) {
      const i = stageIdx(t.status);
      if (i < TASK_STAGES.length - 1) {
        t.status = TASK_STAGES[i + 1];
        showToast(t.product.slice(0, 8) + ' → ' + t.status);
      }
    }

    /* ================= AI 生图 ================= */
    const aiTemplates = [
      { key: 'wear', name: '真人穿搭图', tpl: '真实摄影风格，{model}，穿着{product}，在{scene}，自然光线，全身穿搭照，小红书达人种草风格，高清真实，无AI感，商品颜色和版型准确' },
      { key: 'scene', name: '商品场景图', tpl: '商业静物摄影，{product}，摆放在{scene}，柔和光影，质感高级，电商商品场景图，高清细节，Logo清晰' },
      { key: 'seed', name: '达人种草图', tpl: '生活方式摄影，{model}，使用{product}，{scene}，氛围轻松自然，像手机随手拍的真实种草照片，高清，细节准确' },
      { key: 'poster', name: '招募海报素材', tpl: '电商招募宣传海报背景图，{scene}，明亮活力风格，留出文字排版空间，高清，适合朋友圈招募配图' },
    ];
    const ai = reactive({ tpl: 'wear', product: '复古慢跑鞋，米白色，翻毛皮材质', model: '25岁亚洲女性，甜美休闲风格', scene: '上海街头咖啡店外，秋日午后阳光', generating: false, images: [] });
    const aiPrompt = computed(() => {
      const t = aiTemplates.find(x => x.key === ai.tpl).tpl;
      return t.replace('{model}', ai.model || '年轻模特').replace('{product}', ai.product || '商品').replace('{scene}', ai.scene || '简洁室内场景');
    });
    const aiUsableRate = computed(() => {
      const rated = ai.images.filter(g => g.rating);
      if (!rated.length) return 0;
      const ok = rated.filter(g => g.rating !== '不可用').length;
      return Math.round(ok / rated.length * 100);
    });
    function generateImages() {
      if (!ai.product.trim()) { showToast('请先填写商品描述'); return; }
      ai.generating = true;
      const variants = ['，正面全身视角，站姿自然', '，生活化场景，动态抓拍感', '，中景半身，突出商品细节'];
      const size = ai.tpl === 'scene' ? 'square_hd' : 'portrait_4_3';
      variants.forEach((v, i) => {
        ai.images.unshift({ url: IMG(aiPrompt.value + v, size), loading: true, error: false, rating: '' });
      });
      setTimeout(() => { ai.generating = false; showToast('3 张素材已生成，请审核评级'); }, 1500);
    }

    /* ================= 数据导入 ================= */
    const tplList = [
      { key: 'leads', name: '线索数据', cols: '昵称/姓名 · 来源渠道 · 联系方式 · 负责人 · 意向等级 · 当前状态 · 最近跟进时间 · 下次跟进时间 · 备注' },
      { key: 'talents', name: '达人数据', cols: '昵称 · 来源渠道 · 联系方式 · 负责人 · 加入时间 · 状态 · 累计任务数 · 累计佣金' },
      { key: 'tasks', name: '寄拍任务', cols: '任务编号 · 商品名称 · 达人昵称 · 任务佣金 · MCN分成比例 · 当前状态 · 截止时间' },
    ];
    const FIELD_MAPS = {
      leads: { '昵称': 'name', '姓名': 'name', '昵称/姓名': 'name', '来源渠道': 'channel', '渠道': 'channel', '联系方式': 'contact', '微信': 'contact', '负责人': 'owner', '意向等级': 'level', '等级': 'level', '当前状态': 'status', '状态': 'status', '最近跟进时间': 'lastFollow', '下次跟进时间': 'nextFollow', '备注': 'note' },
      talents: { '昵称': 'name', '达人昵称': 'name', '姓名': 'name', '来源渠道': 'channel', '渠道': 'channel', '联系方式': 'contact', '负责人': 'owner', '加入时间': 'join', '状态': 'status', '累计任务数': 'tasks', '累计佣金': 'commission' },
      tasks: { '任务编号': 'id', '编号': 'id', '商品名称': 'product', '商品': 'product', '达人昵称': 'talentName', '达人': 'talentName', '任务佣金': 'commission', '佣金': 'commission', 'MCN分成比例': 'rate', '分成比例': 'rate', '当前状态': 'status', '状态': 'status', '截止时间': 'deadline' },
    };
    const FIELD_LABEL = { name: '昵称', channel: '来源渠道', contact: '联系方式', owner: '负责人', level: '意向等级', status: '状态', lastFollow: '最近跟进', nextFollow: '下次跟进', note: '备注', join: '加入时间', tasks: '累计任务', commission: '佣金', id: '编号', product: '商品', talentName: '达人', rate: '分成比例', deadline: '截止时间' };

    const imp = reactive({ target: 'leads', fileName: '', headers: [], rows: [], preview: [], fieldMap: {}, matchedCount: 0, done: false, doneCount: 0 });

    function downloadTemplate(key) {
      const samples = {
        leads: [
          ['昵称/姓名', '来源渠道', '联系方式', '负责人', '意向等级', '当前状态', '最近跟进时间', '下次跟进时间', '备注'],
          ['小红书来的Amy', '抖音短视频', 'amy_xx99', '王浩', 'B', '新线索', '2026-09-07', '2026-09-08', '问寄拍佣金怎么算'],
          ['朋友圈的阿成', '朋友圈', 'acheng_6', '李婷', 'A', '已联系', '2026-09-06', '2026-09-07', '有穿搭拍摄经验'],
        ],
        talents: [
          ['昵称', '来源渠道', '联系方式', '负责人', '加入时间', '状态', '累计任务数', '累计佣金'],
          ['小王超会穿', '朋友圈', 'xiaowang_style', '李婷', '2026-08-30', '活跃', 4, 2000],
          ['阿May穿搭日记', '抖音短视频', 'amay_diary', '王浩', '2026-08-29', '活跃', 3, 1000],
        ],
        tasks: [
          ['任务编号', '商品名称', '达人昵称', '任务佣金', 'MCN分成比例', '当前状态', '截止时间'],
          ['TK20260923', '复古慢跑鞋（米白翻毛皮）', '小王超会穿', 500, '20%', '待报名', '2026-09-15'],
          ['TK20260924', '主动降噪蓝牙耳机', '蕾蕾Lena', 380, '20%', '已报名', '2026-09-14'],
        ],
      };
      const csv = '﻿' + samples[key].map(r => r.map(c => `"${c}"`).join(',')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'MCN导入模板_' + { leads: '线索', talents: '达人', tasks: '寄拍任务' }[key] + '.csv';
      a.click();
      showToast('模板已下载，可按格式填写后上传');
    }

    /* 达人线索管理模块（独立文件 talent-leads.js）。提前定义，供数据导入复用。 */
    const tl = reactive(window.TalentLeadsModule.useTalentLeads());

    async function handleFile(e) {
      const file = e.target.files[0];
      if (!file) return;
      if (typeof XLSX === 'undefined') { showToast('Excel 解析库未加载，请检查网络后刷新'); return; }
      imp.done = false;
      imp.fileName = file.name;
      try {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
        if (!json.length) { showToast('文件内容为空'); return; }
        imp.headers = String(json[0].join('')).includes(',') ? String(json[0][0]).split(',') : json[0].map(String);
        const dataRows = json.slice(1).filter(r => r.some(c => String(c).trim() !== ''));
        // CSV 被当成一列的情况
        if (imp.headers.length === 1 && imp.headers[0].includes(',')) {
          const split = r => String(r[0] || '').split(',').map(c => c.replace(/^"|"$/g, '').trim());
          imp.headers = split(json[0]);
          imp.rows = dataRows.map(split);
        } else {
          imp.rows = dataRows.map(r => imp.headers.map((_, i) => String(r[i] ?? '').trim()));
        }
        const map = FIELD_MAPS[imp.target];
        imp.fieldMap = imp.headers.map(h => map[h.trim()] || '');
        imp.matchedCount = imp.fieldMap.filter(Boolean).length;
        imp.preview = imp.rows.slice(0, 5);
        showToast('识别完成：' + imp.rows.length + ' 行，' + imp.matchedCount + ' 个字段匹配');
      } catch (err) {
        showToast('文件解析失败：' + err.message);
      }
      e.target.value = '';
    }

    function confirmImport() {
      const map = imp.fieldMap;
      let count = 0;
      imp.rows.forEach(r => {
        const obj = {};
        r.forEach((v, i) => { if (map[i]) obj[map[i]] = v; });
        if (!obj.name && !obj.product) return;
        if (imp.target === 'leads') {
          leads.unshift({
            id: 'L' + Date.now() + count, name: obj.name, channel: obj.channel || '未填写', contact: obj.contact || '未填写',
            owner: obj.owner || '未分配', level: obj.level || 'B', status: LEAD_STAGES.includes(obj.status) ? obj.status : '新线索',
            lastFollow: obj.lastFollow || today, nextFollow: obj.nextFollow || '2026-09-09', note: obj.note || '',
          });
          count++;
        } else if (imp.target === 'talents') {
          // 达人库已下线，导入的达人数据写入「达人线索」列表
          tl.list.unshift({
            id: 'CL' + String(tl.list.length + 1).padStart(3, '0'), name: obj.name, contact: obj.contact || '未填写',
            source: obj.channel || '其他', hasMedia: false, platforms: ['无'], fans: Number(obj.fans) || 0,
            hasExp: false, coopCategories: '无', wantCategories: '待沟通', appearWay: '待定',
            stage: '已联系', potential: '待判断', willing: '待判断', category: '待分类', coopPath: '待判断',
            owner: obj.owner || '未分配', lastFollow: today, nextFollow: obj.nextFollow || '', note: obj.note || '',
          });
          count++;
        } else {
          const tRef = tl.list.find(x => x.name === obj.talentName);
          tasks.unshift({
            id: obj.id || 'TK' + Date.now(), talentId: tRef ? tRef.id : 'T001',
            _talentName: obj.talentName || '（未知达人）',
            product: obj.product || '未命名商品', img: PRODUCTS[Object.keys(PRODUCTS)[count % 5]].img,
            commission: Number(obj.commission) || 0,
            rate: obj.rate ? Number(String(obj.rate).replace('%', '')) / 100 || MCN_RATE : MCN_RATE,
            status: TASK_STAGES.includes(obj.status) ? obj.status : '待报名', deadline: obj.deadline || '2026-09-15',
          });
          count++;
        }
      });
      imp.done = true;
      imp.doneCount = count;
      showToast('成功导入 ' + count + ' 条数据');
    }

    /* ================= 图表 ================= */
    const funnelChart = ref(null), channelChart = ref(null), trendChart = ref(null);
    let charts = {};
    function renderCharts() {
      nextTick(() => {
        if (funnelChart.value) {
          charts.f = charts.f || echarts.init(funnelChart.value);
          charts.f.setOption({
            tooltip: { trigger: 'item', formatter: '{b}: {c}' },
            series: [{
              type: 'funnel', left: '5%', width: '90%', top: 10, bottom: 10, minSize: '20%',
              label: { formatter: '{b} {c}', fontSize: 11 },
              color: ['#818cf8', '#6366f1', '#4f46e5', '#4338ca'],
              data: [
                { value: sum(campaigns, 'consult'), name: '咨询' },
                { value: sum(campaigns, 'validLeads'), name: '有效线索' },
                { value: sum(campaigns, 'signed'), name: '报名' },
                { value: sum(campaigns, 'talents'), name: '成为达人' },
              ],
            }],
          });
        }
        if (channelChart.value) {
          charts.c = charts.c || echarts.init(channelChart.value);
          const ch = ['朋友圈', '抖音短视频', '社群推广', 'AI数字人直播', '达人转介绍', '海报图文'];
          const agg = k => ch.map(c => sum(campaigns.filter(x => x.channel === c), k));
          charts.c.setOption({
            tooltip: { trigger: 'axis' },
            legend: { data: ['单达人成本(元)', '达人转化率%'], bottom: 0, textStyle: { fontSize: 10 } },
            grid: { left: 40, right: 40, top: 20, bottom: 40 },
            xAxis: { type: 'category', data: ch, axisLabel: { fontSize: 10, interval: 0 } },
            yAxis: [{ type: 'value' }, { type: 'value', max: 45, axisLabel: { formatter: '{value}%' } }],
            series: [
              { name: '单达人成本(元)', type: 'bar', data: ch.map((c, i) => { const t = agg('talents')[i]; return t ? Math.round(sum(campaigns.filter(x => x.channel === c), 'cost') / t) : 0; }), itemStyle: { color: '#c7d2fe', borderRadius: [4, 4, 0, 0] }, barWidth: 18 },
              { name: '达人转化率%', type: 'line', yAxisIndex: 1, data: ch.map((c, i) => { const con = agg('consult')[i]; return con ? +(agg('talents')[i] / con * 100).toFixed(1) : 0; }), itemStyle: { color: '#4f46e5' }, lineStyle: { width: 3 } },
            ],
          });
        }
        if (trendChart.value) {
          charts.t = charts.t || echarts.init(trendChart.value);
          charts.t.setOption({
            tooltip: { trigger: 'axis' },
            legend: { data: ['佣金(元)', '任务数'], bottom: 0, textStyle: { fontSize: 10 } },
            grid: { left: 50, right: 30, top: 20, bottom: 40 },
            xAxis: { type: 'category', data: ['8/18-8/24', '8/25-8/31', '9/1-9/7'] },
            yAxis: [{ type: 'value' }, { type: 'value' }],
            series: [
              { name: '佣金(元)', type: 'line', smooth: true, data: [860, 1520, Math.round(totalCommission.value)], areaStyle: { color: 'rgba(99,102,241,.12)' }, itemStyle: { color: '#6366f1' }, lineStyle: { width: 3 } },
              { name: '任务数', type: 'bar', yAxisIndex: 1, data: [6, 9, tasks.length], itemStyle: { color: '#c7d2fe', borderRadius: [4, 4, 0, 0] }, barWidth: 22 },
            ],
          });
        }
        setTimeout(() => Object.values(charts).forEach(c => c && c.resize()), 50);
      });
    }
    watch(page, p => { if (p === 'dashboard') renderCharts(); window.scrollTo(0, 0); });

    function goPage(k) { page.value = k; if (k === 'dashboard') setTimeout(renderCharts, 60); }
    function showToast(msg) { toast.value = msg; setTimeout(() => (toast.value = ''), 2600); }

    return {
      page, nav, currentNav, today, toast, trendUp, trendFlat, tl,
      CHANNELS, OWNERS, TASK_STAGES, leadStagesAll,
      campaigns, leads, tasks,
      kpis, todos, taskStageDist, pendingLeads,
      fmt, cpa, sum, stageIdx, leadStageColor, taskStageColor,
      totalCost, totalCommission, mcnIncome, settledAmount, pendingAmount,
      monthNewTalents, costPerTalent, insight,
      talentCards, revenueTasks,
      leadView, leadKeyword, leadModal, leadForm, filteredLeads, leadsFiltered, isOverdue,
      openLeadModal, saveLead, onLeadMove,
      taskFilter, tasksFiltered, advanceTask,
      ai, aiTemplates, aiPrompt, aiUsableRate, generateImages,
      tplList, imp, downloadTemplate, handleFile, confirmImport,
      funnelChart, channelChart, trendChart,
      goPage,
    };
  },
}).mount('#app');
