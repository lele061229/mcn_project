/* ============================================================
 * MCN 达人运营中台 · MVP 演示
 * 纯前端：Vue3 + ECharts + SheetJS（CDN），无需构建，双击即可运行
 * ============================================================ */

// ---- 图片生成（演示用 AI 文生图接口）----
const IMG = (p, s = 'square') =>
  `https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=${encodeURIComponent(p)}&image_size=${s}`;

// 内置渠道 + 用户自定义渠道（自定义存 localStorage，持久保留；渠道在后端是自由文本，无白名单）
const CHANNELS_BASE = ['朋友圈', '抖音短视频', 'AI数字人直播', '社群推广', '私聊邀约', '海报图文', '达人转介绍'];
const CHANNELS = CHANNELS_BASE; // 兼容旧引用（仅做展示兜底，下拉一律用下面的 channelsAll）
const OWNERS = ['李婷', '王浩', '张萌'];
const LEAD_STAGES = ['新线索', '已联系', '有意向', '已报名', '已成为达人'];
// 寄拍任务真实状态机（与 v1/server.js 的 TASK_STATUSES / ACTIONS 对齐）
const TASK_STAGES = ['待确认', '待寄出', '已寄出', '已签收', '待拍摄', '待提交', '待审核', '内容修改中', '待发布', '已发布', '已完成'];
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

const { createApp, reactive, ref, computed, watch, nextTick, onMounted } = Vue;

createApp({
  setup() {
    /* ================= 基础状态 ================= */
    const page = ref('dashboard');
    const mnav = ref(false); // 移动端抽屉导航开关
    const mobTabs = computed(() => [
      { key: 'dashboard', label: '看板' },
      { key: 'talent-leads', label: '线索' },
      { key: 'tasks', label: '任务' },
      { key: 'finance', label: '结算' },
      { key: 'channels', label: '获客' },
    ].filter(b => { const r = NAV_ROLES[b.key]; return !r || r.includes(me.value.role); }));
    const toast = ref('');
    const today = '2026-09-07';

    const allNav = [
      { key: 'dashboard', label: '经营看板', desc: '全局经营数据一屏总览' },
      /* 2026-09-15 合并：原「线索管理」页与「达人线索」重复（同一张 /api/mvp/leads 表、两套字段模型）。
         看板视图已并入达人线索页（列表/看板切换），本入口停用。恢复需同时还原 NAV_ROLES、
         顶栏「+ 新增线索」按钮、看板待办「去处理」链接、pendingLeads 徽标的目标页。 */
      // { key: 'leads', label: '线索管理', desc: '谁在跟？跟到哪一步？有没有漏？' },
      // 信息架构 = 业务链路：推广获客 → 一线招募对接 → 达人运营（陪跑/质检）→ 收益结算 → 管理员总览
      { key: 'channels', label: '推广获客', desc: '投放 / 渠道成本 / 线索量 / 转化率 · 推广岗', group: '推广获客' },
      { key: 'talent-leads', label: '达人线索', desc: '跟进 / 潜力意愿 / ABCD 分类 / 合作路径 · 招募岗', group: '一线招募对接' },
      { key: 'talent-pool', label: '达人档案', desc: '正式达人库 · 转化人 / 负责人 / 交接状态', group: '达人运营' },
      { key: 'account-ops', label: '账号运营', desc: '得物账号：信誉等级 / 粉丝数 / 更新频率 · 运营岗', group: '达人运营' },
      { key: 'tasks', label: '达人任务中心', desc: '内容 / 寄拍 / 运营成长三类任务 · 归属运营负责人', group: '达人运营' },
      { key: 'hit-cases', label: '爆款拆解库', desc: '爆款内容拆解 · 运营方法沉淀 · 高级运营维护', group: '达人运营' },
      { key: 'finance', label: '收益结算', desc: '分成 / 应付 / 结算 · 财务岗', group: '收益结算' },
      { key: 'workbench', label: '我的工作台', desc: '按岗位生成的待办：今天该跟谁、推什么、结什么' },
      { key: 'import', label: '数据导入', desc: '抖音 / 飞书 / Excel 数据进入系统', group: '工具' },
      { key: 'ai', label: 'AI 生图', desc: '素材生产成本与可用率验证', group: '工具' },
      { key: 'accounts', label: '账号管理', desc: '账号 / 角色 / 岗位', group: '系统设置', action: 'accounts' },
      /* 2026-09-15：V1 飞书业务后台入口已隐藏（与主系统功能重复，用户确认）。
         如需恢复，从 git 历史或下方注释找回：4 个整页跳转 /admin/ 的增量入口。 */
      // { key: 'v1-group', label: 'V1 飞书业务后台', group: true },
      // { key: 'v1-dashboard', label: 'V1 经营看板', desc: '达人培育后台 V1', href: '/admin/' },
      // { key: 'v1-talents', label: 'V1 达人管理', desc: '达人培育后台 V1', href: '/admin/?page=talents' },
      // { key: 'v1-tasks', label: 'V1 寄拍任务', desc: '达人培育后台 V1', href: '/admin/?page=tasks' },
      // { key: 'v1-logs', label: 'V1 操作日志', desc: '达人培育后台 V1', href: '/admin/?page=logs' },
    ];
    const icons = {
      dashboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-5 h-5"><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg>',
      channels: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-5 h-5"><path d="M3 11l18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 11-5.8-1.6"/></svg>',
      leads: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-5 h-5"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>',
      'talent-leads': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-5 h-5"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>',
      'account-ops': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-5 h-5"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><path d="M2 20h20"/></svg>',
      'talent-pool': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-5 h-5"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>',
      tasks: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-5 h-5"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>',
      'hit-cases': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-5 h-5"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 00-4 12.7V17h8v-2.3A7 7 0 0012 2z"/></svg>',
      finance: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-5 h-5"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>',
      ai: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-5 h-5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
      import: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-5 h-5"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
      workbench: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-5 h-5"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><path d="M9 16l2 2 4-4"/></svg>',
      accounts: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-5 h-5"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33h0a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51h0a1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82v0a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>',
    };
    allNav.forEach(n => { if (icons[n.key]) n.icon = icons[n.key]; }); // 仅给原 8 项补图标；V1 增量项自带图标、分组项无图标

    /* ---- 角色权限（2026-09-15 收紧版，用户确认）----
       admin  管理员：全部 8 页 + 账号管理
       staff  运营：业务五页（经营看板/推广获客/线索管理/达人线索/寄拍任务），
              不可见：收益结算、AI 生图、数据导入、账号管理
       finance 财务：经营看板（看数字对账）+ 收益结算，
              不可见：推广获客、线索管理、达人线索、寄拍任务、AI 生图、数据导入、账号管理 */
    const canFin = computed(() => ['admin', 'finance'].includes(me.value.role));
    const NAV_ROLES = {
      channels: ['admin', 'staff'],
      leads: ['admin', 'staff'],
      'talent-leads': ['admin', 'staff'],
      'talent-pool': ['admin', 'staff'],
      tasks: ['admin', 'staff'],
      'hit-cases': ['admin', 'staff'],
      finance: ['admin', 'finance'],
      ai: ['admin'],
      import: ['admin'],
      workbench: ['admin', 'staff', 'finance'],
      accounts: ['admin'],
    };
    /* 岗位视角的信息架构（在角色基础上再收敛）：
       业务链路 = 推广获客 → 一线招募对接 → 达人运营（普通运营陪跑 → 高级运营质检）→ 收益结算 → 管理员总览
       - 推广岗：推广获客（投放 / 渠道成本 / 线索量 / 转化率）
       - 招募岗：达人线索（跟进 / 潜力意愿 / ABCD 分类 / 合作路径）
       - 普通运营（ops）：达人线索（长期管理）+ 账号运营 + 寄拍任务（登记跟进）
       - 高级运营（senior_ops）：爆款拆解 / 方法沉淀 / 给普通运营分配任务 / 管理运营质量（跨运营看全部达人）
       - 财务岗：收益结算
       不在映射里的页面（经营看板 / 我的工作台）对所有岗位可见；管理员不受限。 */
    const NAV_POSITIONS = {
      channels: ['promote'],
      'talent-leads': ['recruit', 'ops', 'senior_ops'],
      'account-ops': ['ops', 'senior_ops'],
      'talent-pool': ['recruit', 'ops', 'senior_ops'],
      tasks: ['ops', 'senior_ops'],
      'hit-cases': ['ops', 'senior_ops'],
      finance: ['finance'],
    };
    const nav = computed(() => allNav.filter(n => {
      const r = NAV_ROLES[n.key]; if (r && !r.includes(me.value.role)) return false;
      const p = NAV_POSITIONS[n.key];
      // 岗位未设置的账号不收敛（保持角色默认可见），设置后才按岗位出菜单
      if (p && me.value.role !== 'admin' && me.value.position && !p.includes(me.value.position)) return false;
      return true;
    }));
    const currentNav = computed(() => allNav.find(n => n.key === page.value));

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

    /* 推广投放接入真实数据库：启动拉取（失败回退演示模式） */
    fetch('/api/mvp/campaigns').then(r => r.json()).then(j => {
      if (j && j.ok && Array.isArray(j.data)) campaigns.splice(0, campaigns.length, ...j.data);
    }).catch(() => { /* 本地演示模式 */ });

    /* 推广投放：新增/编辑/删除（写入通道） */
    const cmpModal = ref(false);
    const cmpEditing = ref(null);
    const cmpForm = reactive({ name: '', channel: '朋友圈', owner: '', cost: 0, start: new Date().toISOString().slice(0, 10), consult: 0, validLeads: 0, signed: 0, talents: 0, visits: 0, note: '' });
    function cmpBlank() {
      return { name: '', channel: '朋友圈', owner: '', cost: 0, start: new Date().toISOString().slice(0, 10), consult: 0, validLeads: 0, signed: 0, talents: 0, note: '' };
    }
    function openCmpCreate() {
      cmpEditing.value = null;
      Object.assign(cmpForm, cmpBlank());
      cmpModal.value = true;
    }

    /* 自定义渠道：内置 CHANNELS_BASE 之外，用户可点「＋」现场添加，存 localStorage 持久保留。
       channelsAll 是下拉的数据源（内置在前、自定义在后）；投放/新增线索两个下拉共用。 */
    const customChannels = ref((() => { try { return JSON.parse(localStorage.getItem('customChannels') || '[]'); } catch (e) { return []; } })());
    const channelsAll = computed(() => [...CHANNELS_BASE, ...customChannels.value.filter(c => c && !CHANNELS_BASE.includes(c))]);
    const chAddOpen = ref(false);       // 「＋」展开的新渠道输入行（投放/线索弹窗共用，同一时刻只开一个弹窗）
    const chNewName = ref('');
    function addCustomChannel(target) {
      const n = String(chNewName.value || '').trim().slice(0, 20);
      if (!n) { showToast('请输入渠道名称'); return; }
      if (channelsAll.value.includes(n)) { showToast('该渠道已存在'); chAddOpen.value = false; chNewName.value = ''; return; }
      customChannels.value.push(n);
      try { localStorage.setItem('customChannels', JSON.stringify(customChannels.value)); } catch (e) {}
      if (target) target.channel = n;   // 新增后自动选中
      chAddOpen.value = false; chNewName.value = '';
      showToast('已添加渠道：' + n);
    }
    function openCmpEdit(c) {
      cmpEditing.value = c.id;
      Object.assign(cmpForm, { name: c.name, channel: c.channel, owner: c.owner === '—' ? '' : c.owner, cost: c.cost, start: c.start, consult: c.consult, validLeads: c.validLeads, signed: c.signed, talents: c.talents, note: c.note || '' });
      cmpModal.value = true;
    }
    function saveCampaign() {
      if (!cmpForm.name.trim()) { showToast('请填写活动名称'); return; }
      const payload = JSON.parse(JSON.stringify(cmpForm));
      payload.owner = cmpForm.owner.trim() || '—';
      const isEdit = !!cmpEditing.value;
      const url = isEdit ? '/api/mvp/campaigns/' + cmpEditing.value : '/api/mvp/campaigns';
      fetch(url, { method: isEdit ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        .then(r => r.json()).then(j => {
          if (!j || !j.ok) { showToast((j && j.message) || '保存失败'); return; }
          const rec = j.data;
          const idx = campaigns.findIndex(x => x.id === rec.id);
          if (idx >= 0) campaigns.splice(idx, 1, rec); else campaigns.unshift(rec);
          cmpModal.value = false;
          showToast(isEdit ? '投放已更新并写入数据库' : '投放已创建并写入数据库');
        })
        .catch(() => {
          if (isEdit) {
            const idx = campaigns.findIndex(x => x.id === cmpEditing.value);
            if (idx >= 0) campaigns.splice(idx, 1, { ...campaigns[idx], ...payload });
          } else {
            campaigns.unshift({ id: 'CMP' + String(campaigns.length + 1).padStart(3, '0'), ...payload });
          }
          cmpModal.value = false;
          showToast('已保存（本地演示模式，未写入数据库）');
        });
    }
    function deleteCampaign(c) {
      if (!window.confirm('确认删除「' + c.name + '」？删除后不可恢复。')) return;
      fetch('/api/mvp/campaigns/' + c.id, { method: 'DELETE' })
        .then(r => r.json()).then(j => {
          if (j && j.ok) {
            const idx = campaigns.findIndex(x => x.id === c.id);
            if (idx >= 0) campaigns.splice(idx, 1);
            showToast('已删除（数据库同步）');
          } else {
            showToast((j && j.message) || '删除失败');
          }
        })
        .catch(() => showToast('删除失败：无法连接服务器'));
    }

    // 寄拍任务：V0.3 起接真实接口 /api/tasks（服务端按岗位过滤：运营=我名下达人的任务、寄拍=执行人是我的任务）
    const tasks = reactive([]);

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

    /* 接入后端真实数据：启动时拉取线索，成功即整体替换演示数据（含返回空数组的情况）。
       ⚠ 20260921c：原来写成 `&& j.data.length`，只要返回 0 条（新运营还没分到线索 / 权限范围为空）
       就保留内置演示数据 → 页面上会出现库里根本不存在的线索。判据应是「接口是否正常应答」，
       而不是「是否有数据」——空数据集本身就是正确的业务事实。 */
    let leadsFromApi = false;
    fetch('/api/mvp/leads').then(r => r.json()).then(j => {
      if (j && j.ok && Array.isArray(j.data)) {
        leads.splice(0, leads.length, ...j.data);
        leadsFromApi = true;
      }
    }).catch(() => { /* 接口不可用：保持只读演示模式，不写入任何数据 */ });

    /* 新达人录入提醒：每 30 秒检查一次数据库，发现新线索弹提示并自动上屏 */
    setInterval(() => {
      if (!leadsFromApi) return;
      fetch('/api/mvp/leads').then(r => r.json()).then(j => {
        if (!(j && j.ok && Array.isArray(j.data))) return;
        const known = {};
        leads.forEach(l => { known[l.id] = true; });
        const fresh = j.data.filter(x => !known[x.id]);
        if (fresh.length) {
          leads.unshift(...fresh.slice().reverse());
          showToast('🔔 有新达人录入：' + fresh.map(x => x.name).join('、'));
        }
      }).catch(() => {});
    }, 30000);

    /* ================= 工具与计算 ================= */
    const fmt = n => (Math.round(n * 100) / 100).toLocaleString('zh-CN');
    const sum = (arr, k) => arr.reduce((a, b) => a + (b[k] || 0), 0);
    const stageIdx = s => TASK_STAGES.indexOf(s);
    const leadStagesAll = [...LEAD_STAGES, '无效线索'];
    /* V0.2：线索漏斗统计（按当前所处阶段的线索数） */
    const leadFunnel = computed(() => {
      const main = LEAD_STAGES.map(s => ({ stage: s, count: leads.filter(l => l.status === s).length }));
      const base = main[0].count || 1;
      return main.map(x => ({ ...x, rate: Math.round(x.count / base * 100) }));
    });

    const leadStageColor = s => ({
      '新线索': '#64748b', '已联系': '#3b82f6', '有意向': '#f59e0b', '已报名': '#8b5cf6',
      '已成为达人': '#10b981', '无效线索': '#cbd5e1',
    }[s] || '#94a3b8');
    const taskStageColor = s => {
      const i = stageIdx(s);
      const colors = ['#94a3b8', '#94a3b8', '#0ea5e9', '#0ea5e9', '#6366f1', '#6366f1', '#8b5cf6', '#10b981'];
      return colors[i] || '#94a3b8';
    };

    // 任务附带达人名称（达人库已下线，统一显示达人ID）
    tasks.forEach(t => { t._talentName = '达人 ' + t.talentId; });

    // 达人聚合统计（达人库已下线，保留为空计算以备后续复用）
    const talentCards = computed(() => []);

    /* ================= 收益结算（达人分成结算单 · 真实落库） =================
     * 业务模型：得物平台按账号表现结算 → 全额打入 MCN 对公账户
     *           → MCN 按公司统一比例与达人分成 → 把达人那份付给达人
     * 一张结算单有两条腿：应收 = 平台收益；应付 = 达人应得（先代扣个税，再加减差异项）
     * 关键口径：「已结清」由资金流水累加判定，不再由寄拍任务状态推导
     */
    const SETTLE_STATUSES = ['待核对', '已确认', '已结清'];
    const ADJ_TYPES = ['样品扣款', '寄回运费', '加急加单费', '内容不达标扣款', '税费调整', '返点优惠', '其他'];
    const settlements = reactive([]);
    const finSettings = reactive({ mcnRate: 0.3, taxRate: 0.06, receiveDays: 30, payDays: 15 });
    const finMode = ref('demo');
    const settleKeyword = ref('');
    const settleStatusFilter = ref('全部');

    function todayStr() { return new Date().toISOString().slice(0, 10); }
    function addDays(dateStr, n) {
      const d = dateStr ? new Date(dateStr + 'T00:00:00') : new Date();
      return new Date(d.getTime() + Number(n) * 864e5).toISOString().slice(0, 10);
    }
    const PERIODS = (() => {
      const out = [], d = new Date(); d.setDate(1);
      for (let i = 1; i <= 6; i++) { const x = new Date(d.getFullYear(), d.getMonth() - i, 1); out.push(x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0')); }
      return out;
    })();

    fetch('/api/mvp/finance/settings').then(r => r.json())
      .then(j => { if (j && j.ok) Object.assign(finSettings, j.data); }).catch(() => { });
    function loadSettlements() {
      return fetch('/api/mvp/settlements').then(r => r.json()).then(j => {
        if (j && j.ok && Array.isArray(j.data)) { settlements.splice(0, settlements.length, ...j.data); finMode.value = 'api'; }
      }).catch(() => { finMode.value = 'demo'; });
    }
    loadSettlements();

    /* ---- 账号运营（运营岗）：得物账号指标，当前手动录入，待接入得物平台自动同步 ---- */
    /* ================= 达人档案（正式达人库） =================
       数据来自 /api/mvp/talents：线索转化后由服务端迁入达人库，这里只读展示。 */
    const talentRows = reactive([]);
    const talentReady = ref(false);
    function loadTalents() {
      fetch('/api/mvp/talents').then(r => r.json()).then(j => {
        if (j && j.ok && Array.isArray(j.data)) { talentRows.splice(0, talentRows.length, ...j.data); talentReady.value = true; }
      }).catch(() => { });
    }
    const talentStats = computed(() => ({
      total: talentRows.length,
      month: talentRows.filter(r => String(r.convertedAt || '').slice(0, 7) === today.slice(0, 7)).length,
      pending: talentRows.filter(r => r.opsPending).length,   // 待运营接收：已转正式但还没交接给运营（与服务端 opsPending 口径一致）
    }));
    // 确认接收分配（2026-09-18e）：工作台「新分配达人」/ 达人档案「我的运营状态=待接收」一键确认，
    // 服务端校验只有被分配的普通运营本人可确认（pending_assign → assigned）
    async function ackAssign(talentId) {
      if (!talentId) return;
      try {
        const r = await fetch('/api/mvp/leads/' + encodeURIComponent(talentId) + '/assign-ack', { method: 'POST' });
        const j = await r.json();
        if (j && j.ok) {
          const i = talentRows.findIndex(x => x.id === talentId);
          if (i >= 0) talentRows.splice(i, 1, Object.assign({}, talentRows[i], { assignState: 'assigned', assignAckAt: (j.data || {}).assignAckAt || '' }));
          showToast('已确认接收，可以开始陪跑啦');
          loadDashPanels();
        } else showToast((j && j.error) || '确认失败');
      } catch (e) { showToast('网络错误，确认失败'); }
    }
    const dewuRows = reactive([]);
    const dewuReady = ref(false);
    function loadAccounts() {
      return fetch('/api/mvp/accounts').then(r => r.json()).then(j => {
        if (j && j.ok && Array.isArray(j.data.rows)) { dewuRows.splice(0, dewuRows.length, ...j.data.rows); dewuReady.value = true; }
      }).catch(() => { dewuReady.value = false; });
    }
    const dewuStats = computed(() => ({
      total: dewuRows.length,
      stale: dewuRows.filter(r => r.updateStale).length,
      low: dewuRows.filter(r => r.dewuActivity === '低').length,
      fans: dewuRows.reduce((s, r) => s + (r.dewuFans || 0), 0),
    }));
    const fansText = n => n >= 10000 ? (n / 10000).toFixed(1) + 'w' : String(n || 0);
    const dewuDlg = ref(false);
    const dewuForm = reactive({ id: '', name: '', dewuId: '', dewuFans: 0, dewuActivity: '中', dewuUpdateDays: 7, dewuLastPublish: '', opsPlan: '', weekGoal: '', nextAction: '', needShoot: '', opsNote: '' });
    function openDewuEdit(r) {
      Object.assign(dewuForm, { id: r.id, name: r.name, dewuId: r.dewuId, dewuFans: r.dewuFans, dewuActivity: r.dewuActivity || '中', dewuUpdateDays: r.dewuUpdateDays, dewuLastPublish: r.dewuLastPublish,
        opsPlan: r.opsPlan || '', weekGoal: r.weekGoal || '', nextAction: r.nextAction || '', needShoot: r.needShoot || '', opsNote: r.opsNote || '' });
      dewuDlg.value = true;
    }
    function saveDewu() {
      const f = dewuForm;
      fetch('/api/mvp/accounts/' + encodeURIComponent(f.id), {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dewuId: f.dewuId, dewuFans: Number(f.dewuFans) || 0, dewuActivity: f.dewuActivity, dewuUpdateDays: Number(f.dewuUpdateDays) || 7, dewuLastPublish: f.dewuLastPublish,
          opsPlan: f.opsPlan, weekGoal: f.weekGoal, nextAction: f.nextAction, needShoot: f.needShoot, opsNote: f.opsNote }),
      }).then(r => r.json()).then(j => {
        if (j && j.ok) {
          const i = dewuRows.findIndex(x => x.id === f.id);
          if (i >= 0) dewuRows.splice(i, 1, j.data);
          dewuDlg.value = false; showToast('账号数据已更新');
        } else showToast(j && j.error ? j.error : '更新失败');
      }).catch(() => showToast('网络错误，更新失败'));
    }

    /* ---- 当前登录用户 & 账号管理 ---- */
    const me = ref({ user: '', role: '' });
    fetch('/api/me').then(r => r.json()).then(j => {
      if (j && j.ok) {
        me.value = { user: j.data.user, role: j.data.role, displayName: j.data.displayName || j.data.user, position: j.data.position || '' };
        // 落地页按链路岗位分流：员工先看自己的工作台，管理员看全链路总览
        if (me.value.role !== 'admin' && page.value === 'dashboard') goPage('workbench');
      }
    }).catch(() => { });
    // 侧边栏底部岗位显示名（字段名与中文显示名分离；未知岗位兜底「成员」）
    const MY_POSITION_LABEL = { admin: '管理员', promote: '推广', recruit: '招募', ops: '运营', senior_ops: '高级运营', finance: '财务' };
    const myPositionLabel = computed(() => {
      if (!me.value.role) return '';
      const p = me.value.position || (me.value.role === 'admin' ? 'admin' : '');
      return MY_POSITION_LABEL[p] || '成员';
    });
    // 达人档案字段分层（2026-09-18e）：普通运营只看陪跑视角字段，负责人链路仅主管/管理员可见
    const amOps = computed(() => me.value.role !== 'admin' && me.value.position === 'ops');
    /* ---- 站内消息中心（2026-09-19a 建，20260921a 升级轮询）：右上角铃铛 + 轻量轮询 ----
     * 8 秒轮询未读消息（不引 WebSocket）：新消息到达 → 顶部轻提示 + 静默刷新线索列表（syncFromDb 原位更新）。 */
    const notif = reactive({ open: false, unread: 0, items: [] });
    const NOTIF_TYPE_LABEL = { new_lead: '新报名', signup: '新报名', assign: '分配提醒', talent_assigned: '分配提醒',
      new_paid_lead: '付费孵化线索', lead_followup_submitted: '待审核', lead_approved: '审核通过',
      lead_reassigned: '重新分配', lead_supplement: '要求补充', sla: 'SLA 超时', system: '系统' };
    function loadNotifs() {
      return fetch('/api/notifications').then(r => r.json()).then(j => {
        if (j && j.ok) { notif.unread = j.data.unread; notif.items.splice(0, notif.items.length, ...(j.data.items || [])); }
      }).catch(() => { });
    }
    let lastTopNotifId = '';
    function pollNotifs() {
      const before = lastTopNotifId;
      return loadNotifs().then(() => {
        const top = notif.items[0];
        lastTopNotifId = top ? top.id : '';
        if (top && before && top.id !== before) {
          // 轻提示：收到新线索 / 新分配 / 审核流转等站内消息
          if (typeof showToast === 'function') showToast('🔔 ' + (top.title || NOTIF_TYPE_LABEL[top.type] || '新消息'));
          if (tl && tl.syncFromDb) tl.syncFromDb(true);   // 新数据静默刷新线索列表（原位更新，不整页刷新）
        }
      }).catch(() => { });
    }
    function toggleNotif() { notif.open = !notif.open; if (notif.open) loadNotifs(); }
    function readNotif(m) {
      if (!m.readAt) fetch('/api/notifications/read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [m.id] }) }).then(loadNotifs).catch(() => { });
      if (m.link) { notif.open = false; goPage(m.link); }
    }
    function readAllNotifs() {
      fetch('/api/notifications/read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ all: true }) }).then(loadNotifs).catch(() => { });
    }
    setInterval(pollNotifs, 8000);   // 20260921a：60s → 8s 轻量轮询（5~10s 区间）
    loadNotifs().then(() => { const t = notif.items[0]; lastTopNotifId = t ? t.id : ''; });
    // 工作台「新线索提醒（待分配）」行内操作（2026-09-19a）：查看→达人线索页；分配→跳页后打开分配弹窗（复用线索页分配流）
    // 工作台「付费孵化待审核」行内操作（20260921a）：打开审核弹窗（复用线索页审核流）
    function reviewPanelLead(cv) {
      goPage('talent-leads');
      if (tl && tl.openReview) setTimeout(() => tl.openReview({ id: cv.talentId, name: cv.name || '' }, showToast), 400);
    }
    function panelLeadAct(cv, act) {
      if (act === 'view') { goPage('talent-leads'); return; }
      if (act === 'assign') {
        goPage('talent-leads');
        setTimeout(() => {
          if (tl && tl.openAssign) tl.openAssign({ id: cv.talentId, name: cv.name || '', owner: cv.owner || '未分配' }, showToast);
        }, 350);
      }
    }
    /* 经营看板按岗位分流：管理员=经营总览（原有 dashboard），其他岗位=岗位工作台视图（服务端按 position 装配 panels） */
    const dashPanels = reactive({ role: '', blocks: [], today: '' });
    const dashView = computed(() => (me.value.role === 'admin' ? 'admin' : 'position'));
    function loadDashPanels() {
      return fetch('/api/mvp/workbench').then(r => r.json()).then(j => {
        if (j && j.ok) { dashPanels.role = j.data.panels.role; dashPanels.blocks = j.data.panels.blocks || []; dashPanels.today = j.data.today || ''; }
      }).catch(() => { });
    }
    const accModal = ref(false), pwModal = ref(false);
    const accList = reactive([]);
    // 岗位决定账号能看到哪些线索（与 talents.ownerPosition 对应）
    const POSITIONS = [{ key: 'promote', label: '推广' }, { key: 'recruit', label: '招募' }, { key: 'ops', label: '普通运营' }, { key: 'senior_ops', label: '高级运营' }, { key: 'finance', label: '财务' }, { key: '', label: '暂不设置' }];
    const accForm = reactive({ user: '', pass: '', role: 'staff', displayName: '', position: 'recruit' });
    const pwForm = reactive({ old: '', next: '' });
    const resetInfo = ref(null);
    async function openAccounts() {
      resetInfo.value = null;
      try {
        const j = await (await fetch('/api/users')).json();
        if (j.ok) { accList.splice(0, accList.length, ...j.data); accModal.value = true; }
      } catch (e) { showToast && showToast('加载账号失败'); }
    }
    async function createAccount() {
      if (!accForm.user.trim() || accForm.pass.length < 6) { showToast && showToast('账号名必填，密码至少 6 位'); return; }
      const r = await fetch('/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(accForm) });
      const j = await r.json();
      if (j.ok) { showToast && showToast('已创建：' + j.data.user); accForm.user = ''; accForm.pass = ''; accForm.displayName = ''; openAccounts(); }
      else showToast && showToast(j.error || '创建失败');
    }
    async function removeAccount(name) {
      if (!confirm('确定删除账号「' + name + '」？该账号将无法登录。')) return;
      const r = await fetch('/api/users/' + encodeURIComponent(name), { method: 'DELETE' });
      const j = await r.json();
      if (j.ok) { showToast && showToast('已删除：' + name); openAccounts(); }
      else showToast && showToast(j.error || '删除失败');
    }
    async function resetAccount(name) {
      if (!confirm('确定重置「' + name + '」的密码？将生成一个临时密码，旧密码立即失效。')) return;
      const r = await fetch('/api/users/' + encodeURIComponent(name) + '/reset', { method: 'POST' });
      const j = await r.json();
      if (j.ok) { resetInfo.value = { user: j.data.user, pass: j.data.tempPass }; showToast && showToast('已重置，请复制临时密码'); }
      else showToast && showToast(j.error || '重置失败');
    }
    /* 修改账号的姓名 / 岗位 / 角色：改岗位立即生效，无需该账号重新登录 */
    async function updateAccount(row, patch) {
      const r = await fetch('/api/users/' + encodeURIComponent(row.user), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
      const j = await r.json();
      if (j.ok) { showToast && showToast('已更新：' + row.user); openAccounts(); }
      else showToast && showToast(j.error || '更新失败');
    }
    function openPassword() { pwForm.old = ''; pwForm.next = ''; pwModal.value = true; }
    async function changePassword() {
      if (pwForm.next.length < 6) { showToast && showToast('新密码至少 6 位'); return; }
      const r = await fetch('/api/users/me/password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pwForm) });
      const j = await r.json();
      if (j.ok) { pwModal.value = false; showToast && showToast('密码已修改'); }
      else showToast && showToast(j.error || '修改失败');
    }

    /* 退出登录：模板里不能直接用全局 fetch（会被 Vue 作用域遮蔽），必须走方法 */
    async function logout() {
      try { await fetch('/api/logout', { method: 'POST' }); } catch (e) { }
      window.location.href = '/login.html';
    }

    /* 孵化服务收入：付费孵化达人交的服务费，单独记账，与分成结算分开 */
    const paidTalents = computed(() => leads.filter(l => l.coopPath === '付费孵化'));
    const svcTotals = computed(() => {
      let total = 0, received = 0;
      paidTalents.value.forEach(t => {
        const fee = Number(t.incubationFee) || 0;
        total += fee;
        if (t.feeStatus === '已收') received += fee;
      });
      return { total, received, pending: total - received, count: paidTalents.value.length };
    });
    function markFeeReceived(t) {
      t.feeStatus = '已收';
      showToast('已登记服务费收款：' + t.name + ' ¥' + fmt(t.incubationFee));
      if (!leadsFromApi) return;
      fetch('/api/mvp/leads/' + encodeURIComponent(t.id), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ feeStatus: '已收' }) })
        .then(r => r.json()).then(j => { if (!(j && j.ok)) showToast('数据库同步失败，仅本地生效'); }).catch(() => showToast('数据库同步失败，仅本地生效'));
    }

    const settleFiltered = computed(() => settlements.filter(s => {
      if (settleStatusFilter.value === '逾期') { if (!s.overdue) return false; }
      else if (settleStatusFilter.value !== '全部' && s.status !== settleStatusFilter.value) return false;
      const kw = settleKeyword.value.trim();
      return !kw || [s.talentName, s.account, s.id, s.period].some(v => String(v || '').includes(kw));
    }));

    const finTotals = computed(() => {
      const t = { income: 0, mcn: 0, talent: 0, received: 0, paid: 0, outstandingPay: 0, overdueCount: 0, overdueAmount: 0, open: 0 };
      settlements.forEach(s => {
        t.income += s.platformIncome; t.mcn += s.mcnShare; t.talent += s.payableToTalent;
        t.received += s.received; t.paid += s.paid;
        if (s.status !== '已结清') {
          t.open++; t.outstandingPay += s.outstandingPay;
          if (s.overdue) { t.overdueCount++; t.overdueAmount += s.outstandingPay; }
        }
      });
      return t;
    });
    const finPlatform = computed(() => finTotals.value.income);
    const finMcn = computed(() => finTotals.value.mcn);
    const finPayable = computed(() => finTotals.value.talent);
    const finPaid = computed(() => finTotals.value.paid);
    const finUnpaid = computed(() => finTotals.value.outstandingPay);
    const finOverdue = computed(() => finTotals.value.overdueAmount);
    const talentNameOptions = computed(() => Array.from(new Set(leads.map(l => l.name).filter(Boolean))));

    /* ---- 新建结算单 ---- */
    const settleModal = ref(false);
    const settleForm = reactive({ talentName: '', account: '', period: PERIODS[0] || '', platformIncome: 0, mcnPct: 30, taxPct: 6, dueDate: '', remark: '' });
    function openSettleCreate() {
      Object.assign(settleForm, {
        talentName: '', account: '', period: PERIODS[0] || '',
        platformIncome: 0, mcnPct: Math.round(finSettings.mcnRate * 100), taxPct: Math.round(finSettings.taxRate * 100),
        dueDate: addDays(todayStr(), finSettings.receiveDays || 30), remark: '',
      });
      settleModal.value = true;
    }
    const settlePreview = computed(() => {
      const income = Number(settleForm.platformIncome) || 0;
      const mcnShare = Math.round(income * (Number(settleForm.mcnPct) || 0) / 100 * 100) / 100;
      const talentShare = Math.round((income - mcnShare) * 100) / 100;
      const taxAmount = Math.round(talentShare * (Number(settleForm.taxPct) || 0) / 100 * 100) / 100;
      return { mcnShare, talentShare, taxAmount, payable: Math.round((talentShare - taxAmount) * 100) / 100 };
    });
    function saveSettlement() {
      if (!settleForm.talentName.trim()) { showToast('请填写达人名称'); return; }
      if (!settleForm.period) { showToast('请选择结算周期'); return; }
      if (!(Number(settleForm.platformIncome) > 0)) { showToast('请填写大于 0 的平台收益金额'); return; }
      const payload = {
        talentName: settleForm.talentName.trim(), account: settleForm.account.trim(), period: settleForm.period,
        platformIncome: Number(settleForm.platformIncome), mcnRate: (Number(settleForm.mcnPct) || 0) / 100,
        taxRate: (Number(settleForm.taxPct) || 0) / 100, dueDate: settleForm.dueDate, remark: settleForm.remark, status: '待核对',
      };
      fetch('/api/mvp/settlements', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        .then(r => r.json()).then(j => {
          if (!j || !j.ok) { showToast((j && j.error) || '生成失败'); return; }
          settlements.unshift(j.data);
          settleModal.value = false;
          showToast('结算单 ' + j.data.id + ' 已生成，状态：待核对');
        })
        .catch(() => showToast('生成失败：无法连接服务器'));
    }

    /* ---- 结算单详情 · 状态流转 / 差异项 ---- */
    const settleDetailId = ref(null);
    const settleDetail = computed(() => settlements.find(s => s.id === settleDetailId.value) || null);
    function openSettleDetail(s) { settleDetailId.value = s.id; }
    function closeSettleDetail() { settleDetailId.value = null; }
    function patchSettlement(id, patch, tip) {
      fetch('/api/mvp/settlements/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) })
        .then(r => r.json()).then(j => {
          if (!j || !j.ok) { showToast((j && j.error) || '操作失败'); return; }
          const i = settlements.findIndex(x => x.id === j.data.id);
          if (i >= 0) settlements.splice(i, 1, j.data);
          showToast(tip || '已更新');
        })
        .catch(() => showToast('操作失败：无法连接服务器'));
    }
    function confirmSettle(s) { patchSettlement(s.id, { status: '已确认' }, '已对账确认，可开票收款'); }
    function closeSettle(s) { patchSettlement(s.id, { status: '已结清' }, '已手工标记为结清'); }
    function deleteSettlement(s) {
      if (!window.confirm('确认删除结算单「' + s.id + '(' + s.talentName + ' ' + s.period + ')」？\n关联的 ' + s.payments.length + ' 笔资金流水会一并删除，不可恢复。')) return;
      fetch('/api/mvp/settlements/' + s.id, { method: 'DELETE' })
        .then(r => r.json()).then(j => {
          if (!j || !j.ok) { showToast((j && j.error) || '删除失败'); return; }
          const i = settlements.findIndex(x => x.id === s.id);
          if (i >= 0) settlements.splice(i, 1);
          if (settleDetailId.value === s.id) settleDetailId.value = null;
          showToast('结算单已删除');
        })
        .catch(() => showToast('删除失败：无法连接服务器'));
    }
    function addAdjustment(s) {
      const type = window.prompt('差异项类型（' + ADJ_TYPES.join(' / ') + '）', '样品扣款');
      if (type === null) return;
      const amt = window.prompt('金额（正数=加项，负数=减项）', '-100');
      if (amt === null || !Number(amt)) return;
      const reason = window.prompt('原因说明', '') || '';
      patchSettlement(s.id, { adjustments: (s.adjustments || []).concat([{ type: type, amount: Number(amt), reason: reason }]) }, '差异项已添加，应付金额已重算');
    }
    function removeAdjustment(s, idx) {
      const next = (s.adjustments || []).slice();
      next.splice(idx, 1);
      patchSettlement(s.id, { adjustments: next }, '差异项已移除');
    }

    /* ---- 资金流水登记 ---- */
    const payModal = ref(false);
    const payDirection = ref('out');
    const payTarget = ref(null);
    const payForm = reactive({ amount: 0, date: '', method: '对公转账', refNo: '', remark: '' });
    function openPayModal(s, dir) {
      payTarget.value = s; payDirection.value = dir;
      Object.assign(payForm, {
        amount: dir === 'in' ? s.outstandingReceive : s.outstandingPay,
        date: todayStr(), method: dir === 'in' ? '对公转账' : '支付宝', refNo: '', remark: '',
      });
      payModal.value = true;
    }
    function savePayment() {
      if (!(Number(payForm.amount) > 0)) { showToast('请填写大于 0 的金额'); return; }
      const payload = { settlementId: payTarget.value.id, direction: payDirection.value, amount: Number(payForm.amount), date: payForm.date, method: payForm.method, refNo: payForm.refNo, remark: payForm.remark };
      fetch('/api/mvp/payments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        .then(r => r.json()).then(j => {
          if (!j || !j.ok) { showToast((j && j.error) || '登记失败'); return; }
          payModal.value = false;
          loadSettlements().then(() => showToast(payDirection.value === 'in' ? '平台到账已登记' : '达人付款已登记'));
        })
        .catch(() => showToast('登记失败：无法连接服务器'));
    }
    function deletePayment(p) {
      if (!window.confirm('撤销这笔流水？\n' + (p.direction === 'in' ? '平台到账' : '达人付款') + ' ¥' + fmt(p.amount) + '（' + p.date + '）')) return;
      fetch('/api/mvp/payments/' + p.id, { method: 'DELETE' })
        .then(r => r.json()).then(j => {
          if (!j || !j.ok) { showToast((j && j.error) || '撤销失败'); return; }
          loadSettlements().then(() => showToast('流水已撤销，金额已重算'));
        })
        .catch(() => showToast('撤销失败：无法连接服务器'));
    }

    /* ---- 分成规则设置 ---- */
    const setModal = ref(false);
    const setForm = reactive({ mcnPct: 30, taxPct: 6, receiveDays: 30, payDays: 15 });
    function openSettings() {
      Object.assign(setForm, {
        mcnPct: Math.round(finSettings.mcnRate * 100), taxPct: Math.round(finSettings.taxRate * 100),
        receiveDays: finSettings.receiveDays, payDays: finSettings.payDays,
      });
      setModal.value = true;
    }
    function saveSettings() {
      const payload = { mcnRate: (Number(setForm.mcnPct) || 0) / 100, taxRate: (Number(setForm.taxPct) || 0) / 100, receiveDays: Number(setForm.receiveDays) || 0, payDays: Number(setForm.payDays) || 0 };
      fetch('/api/mvp/finance/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        .then(r => r.json()).then(j => {
          if (!j || !j.ok) { showToast((j && j.error) || '保存失败'); return; }
          Object.assign(finSettings, j.data);
          setModal.value = false;
          showToast('分成规则已保存（仅对新建结算单生效，历史单据保留原比例）');
        })
        .catch(() => showToast('保存失败：无法连接服务器'));
    }

    function settleStatusColor(s) {
      return { '待核对': '#f59e0b', '已确认': '#6366f1', '已结清': '#10b981' }[s] || '#94a3b8';
    }

    // 渠道（投放数据只有管理员 / 推广岗能拿；其他岗位看渠道与漏斗的真实聚合）
    const canSeeCost = computed(() => me.value.role === 'admin' || me.value.position === 'promote');
    const canTasks = computed(() => me.value.role === 'admin' || ['ops', 'senior_ops'].includes(me.value.position));
    const totalCost = computed(() => sum(campaigns, 'cost'));
    const totalTalentsAcquired = computed(() => sum(campaigns, 'talents'));
    const monthNewTalents = computed(() => sum(campaigns, 'talents'));
    const costPerTalent = computed(() => fmt(totalCost.value / totalTalentsAcquired.value));
    const cpa = channel => {
      const c = campaigns.filter(x => x.channel === channel);
      const cost = sum(c, 'cost'), t = sum(c, 'talents');
      return t ? fmt(cost / t) : '—';
    };
    // 投放为空（非推广岗）时不崩：给出安全默认值
    const insight = computed(() => {
      const rows = campaigns || [];
      if (!rows.length) return { bestChannel: '—', bestRate: '0', cheapChannel: '—', cheapCost: '0' };
      const ranked = rows.map(c => ({ ...c, rate: c.consult ? (c.talents / c.consult * 100) : 0 }));
      const best = [...ranked].sort((a, b) => b.rate - a.rate)[0] || {};
      const paid = ranked.filter(c => c.cost > 0).map(c => ({ ...c, cpa: c.talents ? c.cost / c.talents : 0 })).sort((a, b) => a.cpa - b.cpa)[0];
      return { bestChannel: best.channel || '—', bestRate: (best.rate || 0).toFixed(1), cheapChannel: (paid && paid.channel) || '—', cheapCost: fmt(paid ? paid.cpa : 0) };
    });
    const boardFunnel = computed(() => {
      const f = board.value.funnel || [];
      const at = n => (f.find(x => x.name === n) || {}).value || 0;
      return {
        total: at('线索进入'), assigned: at('已分配负责人'), followed: at('已跟进'),
        intent: at('有意向/已报名'), cooperated: at('已成为达人'), hot: board.value.hot || 0,
      };
    });
    const boardAttention = computed(() => board.value.attention || {});
    const boardAlerts = computed(() => board.value.alerts || []);   // 风险提醒：哪里需要处理

    // 看板 KPI（page = 点击卡片跳转的目标页）
    const kpis = computed(() => [
      ...(canSeeCost.value ? [
        { label: '本月新增达人', value: monthNewTalents.value, unit: '人', good: true, note: '各渠道新增合计', page: 'channels' },
      ] : [
        { label: '线索总数', value: boardFunnel.value.total, unit: '条', good: true, note: '已分配 ' + boardFunnel.value.assigned + ' · 已跟进 ' + boardFunnel.value.followed, page: 'talent-leads' },
        { label: '待分配线索', value: boardAttention.value.unassigned || 0, unit: '条', good: false, note: '还没指定负责人的公海线索', page: 'talent-leads' },
        { label: '逾期未跟进', value: boardAttention.value.overdueFollow || 0, unit: '条', good: false, note: '超过下次跟进时间', page: 'workbench' },
        { label: '待接收交接', value: boardAttention.value.pendingHandover || 0, unit: '单', good: false, note: '等接收人确认', page: 'workbench' },
        { label: '已合作达人', value: boardFunnel.value.cooperated, unit: '人', good: true, note: '高潜强意愿 ' + boardFunnel.value.hot + ' 人待推进', page: 'talent-leads' },
      ]),
      { label: '本月寄拍任务', value: tasks.length, unit: '个', good: true, note: '待审核 ' + (boardAttention.value.pendingAudit || 0) + ' · 逾期 ' + (boardAttention.value.taskOverdue || 0), page: 'tasks', onlyTasks: true },
      { label: '平台收益合计', value: '¥' + fmt(finPlatform.value), unit: '', good: true, note: '得物结算给公司的总额', page: 'finance', fin: true },
      { label: 'MCN 分成留存', value: '¥' + fmt(finMcn.value), unit: '', good: true, note: '分成 ' + Math.round(finSettings.mcnRate * 100) + '%', page: 'finance', fin: true },
      { label: '已付达人', value: '¥' + fmt(finPaid.value), unit: '', good: false, note: '实际打款给达人', page: 'finance', fin: true },
      { label: '待付达人', value: '¥' + fmt(finUnpaid.value), unit: '', good: false, note: finTotals.value.overdueCount ? '含逾期 ' + finTotals.value.overdueCount + ' 单' : '暂无逾期', page: 'finance', fin: true },
      ...(canSeeCost.value ? [
        { label: '单达人获客成本', value: '¥' + costPerTalent.value, unit: '', good: true, note: '全渠道平均', page: 'channels' },
        { label: '本月有效线索', value: sum(campaigns, 'validLeads'), unit: '条', good: true, note: '报名 ' + sum(campaigns, 'signed') + ' 人', page: 'channels' },
      ] : []),
    ].filter(k => (k.onlyTasks ? canTasks.value : true))
     .filter(k => { const r = NAV_ROLES[k.page]; return !r || r.includes(me.value.role); })
     .filter(k => !(k.page === 'channels' && !canSeeCost.value)));

    // 待办跟进：真实数据，不写死。来源 = 工作台接口的服务端推导（wbApi.todos，登录后自动拉取）
    // + 看板风险提醒（board.alerts）。此前这里是 5 条写死的演示文案，与真实业务无关。
    const todos = computed(() => {
      const out = [];
      const seen = new Set();
      const push = (id, name, action, time, urgent, page) => {
        const r = NAV_ROLES[page];
        if (r && !r.includes(me.value.role)) return;              // 角色无该页面权限 → 不展示
        const k = name + '|' + action;
        if (seen.has(k)) return; seen.add(k);
        out.push({ id, name, action, time, urgent, page });
      };
      // 1) 服务端工作台待办（新分配/今日待跟进/逾期/SLA/交接…按登录人职责推导）
      const wb = (wbReady.value && Array.isArray(wbApi.value.todos)) ? wbApi.value.todos : [];
      wb.slice(0, 6).forEach((t, i) => {
        const page = /结算/.test(t.type || '') ? 'finance' : (/任务|寄拍|拍摄/.test(t.type || '') ? 'tasks' : 'talent-leads');
        push(t.talentId || ('wb-' + i), t.name || '', (t.type || '') + (t.action ? ' · ' + t.action : ''), t.due || '', t.priority === '高', page);
      });
      // 2) 看板风险提醒（未分配/超时/SLA 超时/逾期结算…全局口径）
      const alerts = (board.value && Array.isArray(board.value.alerts)) ? board.value.alerts : [];
      alerts.slice(0, 4).forEach((a, i) => {
        push('alert-' + i, a.type || '风险提醒', a.text || '', (a.count || 0) + ' 条', a.tone === 'rose', a.page || 'talent-leads');
      });
      return out.slice(0, 8);
    });

    const taskStageDist = computed(() => TASK_STAGES.map(s => ({ name: s, count: tasks.filter(t => t.status === s).length })).filter(x => x.count > 0));
    const pendingLeads = computed(() => { try { return tl.list.filter(r => r.stage !== '已交接').length; } catch (e) { return leads.filter(l => l.status !== '已成为达人' && l.status !== '无效线索').length; } });

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
      const payload = { name: leadForm.name, channel: leadForm.channel, contact: leadForm.contact, owner: leadForm.owner, level: leadForm.level, note: leadForm.note };
      leadModal.value = false;
      Object.assign(leadForm, { name: '', channel: '朋友圈', level: 'B', contact: '', owner: OWNERS[0], note: '' });
      const addLocal = () => {
        leads.unshift({
          id: 'L' + String(leads.length + 28).padStart(3, '0'),
          name: payload.name, channel: payload.channel, contact: payload.contact || '未填写',
          owner: payload.owner, level: payload.level, status: '新线索',
          lastFollow: today, nextFollow: '2026-09-08', note: payload.note,
        });
        showToast('线索已保存，状态：新线索');
      };
      fetch('/api/mvp/leads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        .then(r => r.json()).then(j => {
          if (j && j.ok && j.data) { leads.unshift(j.data); showToast('线索已写入数据库，状态：新线索'); }
          else addLocal();
        }).catch(addLocal);
    }
    function onLeadMove(l) {
      showToast(l.name + ' 已移动到「' + l.status + '」');
      if (!leadsFromApi) return;
      fetch('/api/mvp/leads/' + encodeURIComponent(l.id), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: l.status }) })
        .then(r => r.json()).then(j => { if (!(j && j.ok)) showToast('数据库同步失败，仅本地生效'); }).catch(() => showToast('数据库同步失败，仅本地生效'));
    }

    /* ================= 任务页（寄拍任务记录 · 真实接口 V0.3） =================
       链路：运营登记寄拍任务（归属=达人运营负责人）→ 达人本人完成寄拍 → 运营跟进审核/发布 → 结果回流运营。
       寄拍由达人完成，系统不再维护独立执行岗位；owner 字段沿用为「运营负责人（任务归属）」。 */
    const taskFilter = ref('全部');
    // 任务中心三分栏：shoot 寄拍 / content 内容在 tasks 表按 taskType 区分；growth 走独立的 opsTasks 表
    const taskTypeTab = ref('shoot');
    const TASK_TYPE_TABS = [
      { key: 'shoot', label: '寄拍任务', desc: '达人本人完成寄拍，系统只记录任务与内容产出' },
      { key: 'content', label: '内容任务', desc: '运营给达人安排的内容产出任务' },
      { key: 'growth', label: '运营成长任务', desc: '高级运营派给普通运营的方向验证 / 方法沉淀任务' },
    ];
    const taskTypeOf = k => (['shoot', 'content', 'growth'].includes(k && k.taskType) ? k.taskType : 'shoot');
    const tasksFiltered = computed(() => {
      if (taskTypeTab.value === 'growth') return [];
      const base = tasks.filter(t => taskTypeOf(t) === taskTypeTab.value);
      return taskFilter.value === '全部' ? base : base.filter(t => t.status === taskFilter.value);
    });
    const taskActionsMap = ref({});          // action key → {label, fields, audit, options}
    const tasksLoaded = ref(false);
    const canLaunchShoot = computed(() => me.value.role === 'admin' || me.value.position === 'ops');
    const shootDlg = reactive({ open: false, saving: false, form: { talentId: '', product: '', commission: 0, dueAt: '', note: '', taskType: 'shoot' } });
    const taskDlg = reactive({ open: false, saving: false, task: null, action: null, form: {}, to: '' });
    const taskStatusTone = s => ({
      '待确认': 'bg-amber-50 text-amber-600', '待寄出': 'bg-amber-50 text-amber-600', '已寄出': 'bg-sky-50 text-sky-600',
      '已签收': 'bg-sky-50 text-sky-600', '待拍摄': 'bg-indigo-50 text-indigo-600', '待提交': 'bg-indigo-50 text-indigo-600',
      '待审核': 'bg-violet-50 text-violet-600', '内容修改中': 'bg-rose-50 text-rose-600', '待发布': 'bg-cyan-50 text-cyan-700',
      '已发布': 'bg-emerald-50 text-emerald-600', '已完成': 'bg-slate-100 text-slate-500',
      '超时': 'bg-rose-50 text-rose-600', '商品异常': 'bg-rose-50 text-rose-600', '内容不合格': 'bg-rose-50 text-rose-600',
      '达人拒绝': 'bg-rose-50 text-rose-600', '已取消': 'bg-slate-100 text-slate-400',
    }[s] || 'bg-slate-100 text-slate-500');

    function loadTaskActions() {
      if (Object.keys(taskActionsMap.value).length) return Promise.resolve();
      return fetch('/api/task-actions').then(r => r.json()).then(j => {
        if (j && j.ok && Array.isArray(j.data)) { const m = {}; j.data.forEach(a => { m[a.key] = a; }); taskActionsMap.value = m; }
      }).catch(() => {});
    }
    /* ================= 达人任务中心：运营成长任务（主管派发 → 普通运营执行） =================
       与寄拍任务分表的原因：寄拍任务是「一物一达人」的执行单，运营成长任务是
       「一条方向 + 多达人」的运营动作，字段结构差异大，混在一张表会互相污染。
       谁能看 / 谁能派，全部由服务端裁决，前端只渲染。 */
    const opsTasks = reactive([]);
    const opsTasksLoaded = ref(false);
    const canAssignOpsTask = computed(() => me.value.role === 'admin' || me.value.position === 'senior_ops');
    const opsTargetOptions = ref([]);
    function loadOpsTargets() {
      if (opsTargetOptions.value.length) return Promise.resolve();
      return fetch('/api/mvp/handover-targets?positions=ops').then(r => r.json())
        .then(j => { opsTargetOptions.value = (j && j.ok && Array.isArray(j.data)) ? j.data : []; })
        .catch(() => { opsTargetOptions.value = []; });
    }
    function loadOpsTasks() {
      return fetch('/api/ops-tasks').then(r => r.json()).then(j => {
        opsTasks.splice(0, opsTasks.length);
        if (j && j.ok && Array.isArray(j.data)) j.data.forEach(k => opsTasks.push(k));
        opsTasksLoaded.value = true;
      }).catch(() => { opsTasksLoaded.value = true; });
    }
    const opsTaskDlg = reactive({ open: false, saving: false, form: { title: '', contentDirection: '', productType: '', reason: '', owner: '', dueAt: '', note: '' } });
    function openOpsTask() {
      Object.assign(opsTaskDlg.form, { title: '', contentDirection: '', productType: '', reason: '', owner: '', dueAt: '', note: '' });
      opsTaskDlg.open = true;
      loadOpsTargets();
    }
    function saveOpsTask() {
      const f = opsTaskDlg.form;
      if (!String(f.title || '').trim()) { showToast('请填写任务标题'); return; }
      if (!f.owner) { showToast('请选择负责人'); return; }
      opsTaskDlg.saving = true;
      fetch('/api/ops-tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({}, f)) })
        .then(r => r.json()).then(j => {
          opsTaskDlg.saving = false;
          if (j && j.ok) { opsTaskDlg.open = false; showToast('运营任务已派发'); loadOpsTasks(); loadWorkbench(); }
          else showToast('派发失败：' + ((j && j.error) || ''));
        }).catch(() => { opsTaskDlg.saving = false; showToast('网络异常，派发失败'); });
    }
    const opsTaskProgDlg = reactive({ open: false, saving: false, task: null, status: '', progress: '' });
    function openOpsTaskProgress(k) {
      opsTaskProgDlg.task = k; opsTaskProgDlg.status = k.status || '待开始'; opsTaskProgDlg.progress = k.progress || '';
      opsTaskProgDlg.open = true;
    }
    function saveOpsTaskProgress() {
      const k = opsTaskProgDlg.task; if (!k) return;
      opsTaskProgDlg.saving = true;
      fetch('/api/ops-tasks/' + encodeURIComponent(k.id), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: opsTaskProgDlg.status, progress: opsTaskProgDlg.progress }) })
        .then(r => r.json()).then(j => {
          opsTaskProgDlg.saving = false;
          if (j && j.ok) { opsTaskProgDlg.open = false; showToast('已更新：' + k.title); loadOpsTasks(); loadWorkbench(); }
          else showToast('更新失败：' + ((j && j.error) || ''));
        }).catch(() => { opsTaskProgDlg.saving = false; showToast('网络异常'); });
    }
    function deleteOpsTask(k) {
      if (!confirm('确认删除运营任务「' + k.title + '」？')) return;
      fetch('/api/ops-tasks/' + encodeURIComponent(k.id), { method: 'DELETE' }).then(r => r.json())
        .then(j => { if (j && j.ok) { showToast('已删除'); loadOpsTasks(); loadWorkbench(); } else showToast('删除失败：' + ((j && j.error) || '')); })
        .catch(() => showToast('网络异常'));
    }

    /* ================= 爆款拆解库（高级运营方法沉淀，全岗位可读） ================= */
    const hitCases = reactive([]);
    const hitCasesLoaded = ref(false);
    const hitCaseQ = ref('');
    const canEditHitCase = computed(() => me.value.role === 'admin' || me.value.position === 'senior_ops');
    const hitCasesFiltered = computed(() => {
      const q = String(hitCaseQ.value || '').trim();
      if (!q) return hitCases;
      return hitCases.filter(c => (String(c.title || '') + String(c.contentDirection || '') + String(c.productType || '') + String(c.reason || '')).includes(q));
    });
    function loadHitCases() {
      return fetch('/api/hit-cases').then(r => r.json()).then(j => {
        hitCases.splice(0, hitCases.length);
        if (j && j.ok && Array.isArray(j.data)) j.data.forEach(c => hitCases.push(c));
        hitCasesLoaded.value = true;
      }).catch(() => { hitCasesLoaded.value = true; });
    }
    const hitCaseDlg = reactive({ open: false, saving: false, id: '', form: { title: '', contentDirection: '', productType: '', reason: '', fitTalents: '', refUrl: '' } });
    function openHitCase(c) {
      hitCaseDlg.id = c ? c.id : '';
      Object.assign(hitCaseDlg.form, c
        ? { title: c.title, contentDirection: c.contentDirection, productType: c.productType, reason: c.reason, fitTalents: c.fitTalents, refUrl: c.refUrl }
        : { title: '', contentDirection: '', productType: '', reason: '', fitTalents: '', refUrl: '' });
      hitCaseDlg.open = true;
    }
    function saveHitCase() {
      const f = hitCaseDlg.form;
      if (!String(f.title || '').trim()) { showToast('请填写标题'); return; }
      if (!String(f.reason || '').trim()) { showToast('请填写爆款原因'); return; }
      hitCaseDlg.saving = true;
      const url = hitCaseDlg.id ? '/api/hit-cases/' + encodeURIComponent(hitCaseDlg.id) : '/api/hit-cases';
      fetch(url, { method: hitCaseDlg.id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({}, f)) })
        .then(r => r.json()).then(j => {
          hitCaseDlg.saving = false;
          if (j && j.ok) { hitCaseDlg.open = false; showToast(hitCaseDlg.id ? '已保存' : '已沉淀到爆款拆解库'); loadHitCases(); loadWorkbench(); }
          else showToast('保存失败：' + ((j && j.error) || ''));
        }).catch(() => { hitCaseDlg.saving = false; showToast('网络异常'); });
    }
    function deleteHitCase(c) {
      if (!confirm('确认删除「' + c.title + '」？')) return;
      fetch('/api/hit-cases/' + encodeURIComponent(c.id), { method: 'DELETE' }).then(r => r.json())
        .then(j => { if (j && j.ok) { showToast('已删除'); loadHitCases(); loadWorkbench(); } else showToast('删除失败：' + ((j && j.error) || '')); })
        .catch(() => showToast('网络异常'));
    }

    function loadTasks() {
      // 达人档案一并拉取：发起寄拍时的「选达人」下拉来自正式达人库（拆表后线索池里没有达人）
      fetch('/api/mvp/talents').then(r => r.json()).then(j => {
        if (j && j.ok && Array.isArray(j.data)) { talentRows.splice(0, talentRows.length, ...j.data); talentReady.value = true; }
      }).catch(() => { });
      return loadTaskActions().then(() => fetch('/api/tasks').then(r => r.json())).then(j => {
        tasks.splice(0, tasks.length);
        if (j && j.ok && Array.isArray(j.data)) j.data.forEach(k => tasks.push(k));
        tasksLoaded.value = true;
      }).catch(() => { tasksLoaded.value = true; });
    }
    // 可发起的达人：线索列表（服务端已按岗位过滤，运营只会看到自己名下的）
    const shootTalentOptions = computed(() => {
      try {
        const rows = Array.isArray(talentRows) ? talentRows : [];
        return rows.slice().map(r => ({ id: r.id, name: r.name, stage: r.status, owner: r.owner }));
      } catch (e) { return []; }
    });
    function openLaunchShoot() {
      Object.assign(shootDlg.form, { talentId: '', product: '', commission: 0, dueAt: '', note: '', taskType: taskTypeTab.value === 'content' ? 'content' : 'shoot' });
      shootDlg.open = true;
    }
    function saveLaunchShoot() {
      const f = shootDlg.form;
      if (!f.talentId) { showToast('请选择达人'); return; }
      if (!String(f.product || '').trim()) { showToast('请填写商品名称'); return; }
      shootDlg.saving = true;
      fetch('/api/tasks', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ talentId: f.talentId, product: String(f.product).trim(), commission: Number(f.commission) || 0, dueAt: f.dueAt || '', note: f.note || '', taskType: f.taskType || 'shoot' }),
      }).then(r => r.json()).then(j => {
        shootDlg.saving = false;
        if (j && j.ok) { shootDlg.open = false; showToast((f.taskType === 'content' ? '内容任务' : '寄拍任务') + '已登记，请跟进达人进度'); loadTasks(); }
        else showToast((j && j.error) || '发起失败');
      }).catch(() => { shootDlg.saving = false; showToast('网络异常，发起失败'); });
    }
    // 可执行动作由服务端下发（含当前状态与我的权限判断），前端只负责渲染
    const taskActionsOf = t => (Array.isArray(t.actions) ? t.actions : []).map(k => taskActionsMap.value[k]).filter(Boolean);
    function openTaskAction(t, key) {
      const a = taskActionsMap.value[key]; if (!a) return;
      taskDlg.task = t; taskDlg.action = a; taskDlg.to = ''; taskDlg.form = {};
      (a.fields || []).forEach(f => { taskDlg.form[f.key] = t[f.key] || ''; });
      taskDlg.open = true;
    }
    function saveTaskAction() {
      const t = taskDlg.task, a = taskDlg.action;
      if (!t || !a) return;
      const body = { action: a.key };
      (a.fields || []).forEach(f => { body[f.key] = taskDlg.form[f.key]; });
      if (a.options && a.options.length) { if (!taskDlg.to) { showToast('请选择异常类型'); return; } body.to = taskDlg.to; }
      taskDlg.saving = true;
      fetch('/api/tasks/' + encodeURIComponent(t.id) + '/status', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }).then(r => r.json()).then(j => {
        taskDlg.saving = false;
        if (j && j.ok) { taskDlg.open = false; showToast('已更新：' + a.label); loadTasks(); }
        else showToast((j && j.error) || '操作失败');
      }).catch(() => { taskDlg.saving = false; showToast('网络异常，操作失败'); });
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
    // 把当前登录身份（角色 + 姓名 + 岗位）交给达人线索模块，用于数据可见范围与「我负责的」判定
    const tl = reactive(window.TalentLeadsModule.useTalentLeads({ me }));

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
    const funnelChart = ref(null), channelChart = ref(null), trendChart = ref(null), trend30Chart = ref(null);
    let charts = {};
    /* 经营看板真实数据：漏斗（由达人状态实时推导）/ 渠道效果 / 负责人负载，来自 /api/mvp/dashboard */
    const board = ref({ funnel: [], workload: [], byChannel: [], attention: {} });
    function loadBoard() {
      return fetch('/api/mvp/dashboard').then(r => r.json()).then(j => {
        if (j && j.ok && j.data) board.value = j.data;
        renderCharts();
      }).catch(() => {});
    }
    const boardReady = computed(() => (board.value.funnel || []).some(x => x.value > 0));
    const maxLoad = computed(() => Math.max(1, ...((board.value.workload || []).map(w => w.load))));
    const loadPct = w => Math.max(6, Math.round(w.load / maxLoad.value * 100));
    function renderCharts() {
      nextTick(() => {
        if (funnelChart.value) {
          charts.f = charts.f || echarts.init(funnelChart.value);
          // 真实漏斗：线索进入 → 已分配负责人 → 已跟进 → 高潜强意愿 → 已合作（由达人表实时推导）
          const fn = (board.value.funnel || []).length ? board.value.funnel : [
            { name: '线索进入', value: 0 }, { name: '已分配负责人', value: 0 }, { name: '已跟进', value: 0 },
            { name: '高潜强意愿', value: 0 }, { name: '已合作', value: 0 },
          ];
          charts.f.setOption({
            tooltip: { trigger: 'item', formatter: '{b}: {c}' },
            series: [{
              type: 'funnel', left: '5%', width: '90%', top: 10, bottom: 10, minSize: '22%',
              label: { formatter: '{b} {c}', fontSize: 11 },
              color: ['#818cf8', '#6366f1', '#4f46e5', '#4338ca', '#312e81'],
              data: fn.map(x => ({ value: x.value, name: x.name })),
            }],
          });
        }
        if (channelChart.value) {
          charts.c = charts.c || echarts.init(channelChart.value);
          // 渠道效果：按达人来源渠道实时聚合（不再依赖投放表的手工汇总数字）
          const chs = board.value.byChannel || [];
          const names = chs.length ? chs.map(c => c.channel) : ['暂无数据'];
          const showCost = chs.some(c => c.cost !== null && c.cost !== undefined);
          charts.c.setOption({
            tooltip: { trigger: 'axis' },
            legend: { data: showCost ? ['单达人成本(元)', '线索→达人转化率%'] : ['线索数', '成为达人', '线索→达人转化率%'], bottom: 0, textStyle: { fontSize: 10 } },
            // 渠道名是手填自由文本：x 轴标签截断到 8 字 + 斜排，防止长名字互相重叠盖住图例
            grid: { left: 40, right: 40, top: 20, bottom: 75 },
            xAxis: { type: 'category', data: names, axisLabel: { fontSize: 10, interval: 0, rotate: 30, formatter: v => (v.length > 8 ? v.slice(0, 8) + '…' : v) } },
            yAxis: [{ type: 'value' }, { type: 'value', max: 100, axisLabel: { formatter: '{value}%' } }],
            series: showCost ? [
              { name: '单达人成本(元)', type: 'bar', data: chs.map(c => c.costPerTalent || 0), itemStyle: { color: '#c7d2fe', borderRadius: [4, 4, 0, 0] }, barWidth: 18 },
              { name: '线索→达人转化率%', type: 'line', yAxisIndex: 1, data: chs.map(c => c.talentRate || 0), itemStyle: { color: '#4f46e5' }, lineStyle: { width: 3 } },
            ] : [
              { name: '线索数', type: 'bar', data: chs.map(c => c.leads), itemStyle: { color: '#c7d2fe', borderRadius: [4, 4, 0, 0] }, barWidth: 14 },
              { name: '成为达人', type: 'bar', data: chs.map(c => c.talents), itemStyle: { color: '#818cf8', borderRadius: [4, 4, 0, 0] }, barWidth: 14 },
              { name: '线索→达人转化率%', type: 'line', yAxisIndex: 1, data: chs.map(c => c.talentRate || 0), itemStyle: { color: '#4f46e5' }, lineStyle: { width: 3 } },
            ],
          });
        }
        if (trendChart.value) {
          charts.t = charts.t || echarts.init(trendChart.value);
          const byPeriod = {};
          settlements.forEach(s => { byPeriod[s.period] = (byPeriod[s.period] || 0) + s.platformIncome; });
          const periods = Object.keys(byPeriod).sort();
          charts.t.setOption({
            tooltip: { trigger: 'axis' },
            legend: { data: ['平台收益(元)', '结算单数'], bottom: 0, textStyle: { fontSize: 10 } },
            grid: { left: 62, right: 42, top: 20, bottom: 40 },
            xAxis: { type: 'category', data: periods.length ? periods : ['暂无结算单'] },
            yAxis: [{ type: 'value' }, { type: 'value' }],
            series: [
              { name: '平台收益(元)', type: 'line', smooth: true, data: periods.map(p => Math.round(byPeriod[p])), areaStyle: { color: 'rgba(99,102,241,.12)' }, itemStyle: { color: '#6366f1' }, lineStyle: { width: 3 } },
              { name: '结算单数', type: 'bar', yAxisIndex: 1, data: periods.map(p => settlements.filter(s => s.period === p).length), itemStyle: { color: '#c7d2fe', borderRadius: [4, 4, 0, 0] }, barWidth: 22 },
            ],
          });
        }
        if (trend30Chart.value) {
          charts.d = charts.d || echarts.init(trend30Chart.value);
          // 近 30 天每日新增线索：优先用服务端看板接口聚合好的 trend30（按 createdAt，口径唯一）；
          // 接口未返回时回退到本地按线索模块列表聚合（老数据兼容）。
          let days30 = [], vals30 = [], empty30 = true;
          const t30 = (board.value && Array.isArray(board.value.trend30)) ? board.value.trend30 : null;
          if (t30 && t30.length) {
            days30 = t30.map(d => d.date); vals30 = t30.map(d => d.count);
            empty30 = vals30.every(v => !v);
          } else {
            const now = new Date();
            for (let i = 29; i >= 0; i--) { const d = new Date(now.getTime() - i * 86400000); days30.push(d.toISOString().slice(5)); }
            const rows30 = (tl && Array.isArray(tl.list)) ? tl.list : [];
            const byDay = {}; rows30.forEach(r => { const k = String(r.createdAt || '').slice(0, 10); byDay[k] = (byDay[k] || 0) + 1; });
            vals30 = days30.map(d => byDay[d] || 0);
            empty30 = rows30.length === 0;
          }
          charts.d.setOption({
            title: empty30 ? { text: me.value.role === 'admin' ? '暂无线索数据' : '当前角色无线索数据权限', left: 'center', top: 'middle', textStyle: { color: '#94a3b8', fontSize: 12, fontWeight: 'normal' } } : undefined,
            tooltip: { trigger: 'axis' },
            grid: { left: 34, right: 16, top: 16, bottom: 26 },
            xAxis: { type: 'category', data: days30, axisLabel: { fontSize: 9, interval: 6 } },
            yAxis: { type: 'value', minInterval: 1 },
            series: [{
              name: '新增线索', type: 'bar', barWidth: '55%',
              data: vals30,
              itemStyle: { color: '#818cf8', borderRadius: [3, 3, 0, 0] },
            }],
          });
        }
        setTimeout(() => Object.values(charts).forEach(c => c && c.resize()), 50);
      });
    }
    watch(page, p => { if (p === 'dashboard') renderCharts(); window.scrollTo(0, 0); });
    // 图表响应式重绘：数据（看板/结算单/任务/线索列表）晚于页面到达时自动补画。
    // 此前只在挂载后 300ms/1500ms 两个固定时间点绘制，线上冷启动数据晚到就会一直空白。
    watch(
      [board, () => settlements.length, () => tasks.length, () => (tl && Array.isArray(tl.list) ? tl.list.length : 0)],
      () => { if (page.value === 'dashboard') nextTick(renderCharts); },
    );
    // 首次进看板也要渲染图表（此前只有切页才触发，导致登录后图表空白）
    onMounted(() => {
      loadBoard();
      if (canTasks.value) loadTasks();   // 寄拍任务只有运营/寄拍/管理员能拉，其他人拉到 403 留空
      setTimeout(renderCharts, 300); setTimeout(renderCharts, 1500);
    });
    // /api/me 是异步返回的：挂载瞬间 canTasks 还是 false，导致看板「任务阶段分布」永远空。
    // 等 me 到位、权限变 true 时补加载一次（tasksLoaded 防重复）。
    watch(canTasks, v => { if (v && !tasksLoaded.value) loadTasks(); });

    /* ================= 我的工作台 =================
       待办由服务端按规则推导（GET /api/mvp/workbench）：
       新分配给我 / 今日待跟进 / 逾期未跟进 / 待我接收交接 / 高潜强意愿未推进
       接口不可用时，用同一套规则在本地兜底计算（保持演示可用） */
    const day = s => String(s || '').slice(0, 10);
    const wbApi = ref({ cards: null, todos: [] });
    const wbReady = ref(false);
    function loadWorkbench() {
      return fetch('/api/mvp/workbench').then(r => r.json())
        .then(j => { if (j && j.ok && j.data) { wbApi.value = j.data; wbReady.value = true; } })
        .catch(() => { wbReady.value = false; });
    }
    loadWorkbench();
    // —— 本地兜底口径（与后端规则一致）——
    const wbToday = computed(() => tl.list.filter(r => r.nextFollow && day(r.nextFollow) === today && r.stage !== '已交接'));
    const wbOverdue = computed(() => tl.list.filter(r => r.nextFollow && day(r.nextFollow) < today && r.stage !== '已交接'));
    const wbHandover = computed(() => tl.list.filter(r => r.handoverStatus === 'pending'));
    const wbInbox = computed(() => tl.inbox || []);
    const wbHot = computed(() => tl.list.filter(r => r.potential === '高' && r.willing === '强' && !['已交接'].includes(r.stage)));
    const wbAssigned = computed(() => tl.list.filter(r => r.assignedAt && day(r.assignedAt) >= today));
    const WB_LOCAL_DONE = ['已交接'];
    const wbLocal = computed(() => {
      const seen = new Set(); const rows = [];
      const push = (r, type, priority, action, due, source) => {
        const k = r.id + '|' + type; if (seen.has(k)) return; seen.add(k);
        rows.push({ id: r.id, talentId: r.id, name: r.name, stage: r.stage, type, priority, action,
          due: due || '未安排', source: source || '', handoverId: '', owner: r.owner });
      };
      for (const r of wbOverdue.value) push(r, '逾期未跟进', '高', '立即联系，重新约定跟进时间', day(r.nextFollow), '我负责');
      for (const r of wbToday.value) push(r, '今日待跟进', '高', r.stage === '新线索' ? '首次触达，发送介绍资料' : '按计划跟进', day(r.nextFollow), '我负责');
      for (const r of wbHandover.value) push(r, '待交接', '中', '等待 ' + (r.handoverTo || '对方') + ' 确认接收', day(r.handoverAt), '我发起');
      for (const r of wbAssigned.value) push(r, '新分配', '中', '首次触达，确认达人意向', day(r.assignedAt), '管理员分配');
      for (const r of wbHot.value) push(r, '高潜强意愿', '中', '推进分类与合作路径', '未安排', '我负责');
      return {
        rows: rows.sort((a, b) => (a.priority === '高' ? 0 : 1) - (b.priority === '高' ? 0 : 1)),
        cards: {
          assigned: wbAssigned.value.length, today: wbToday.value.length, overdue: wbOverdue.value.length,
          pending: wbInbox.value.length, hot: wbHot.value.length, handover: wbHandover.value.length,
          unassigned: 0, total: rows.length,
        },
      };
    });
    const wbCards = computed(() => (wbReady.value && wbApi.value.cards) ? wbApi.value.cards : wbLocal.value.cards);
    const wbTodos = computed(() => (wbReady.value && Array.isArray(wbApi.value.todos)) ? wbApi.value.todos : wbLocal.value.rows);
    // 岗位专属卡片（推广 / 财务）：服务端按岗位生成；为空则沿用 7 张达人卡
    const wbExtraCards = computed(() => (wbReady.value && Array.isArray(wbApi.value.extraCards)) ? wbApi.value.extraCards : []);
    // 岗位面板（运营中台）：服务端按岗位装配的模块块，前端只负责渲染，不做权限判断
    const wbPanels = computed(() => (wbReady.value && wbApi.value.panels) ? wbApi.value.panels : { role: '', blocks: [] });
    // 漏斗条宽：以第一层为基准（分母兜底 1，避免全 0 时除零）
    function funnelWidth(b, v) {
      const max = (b.items && b.items.length && b.items[0].value) || 1;
      return Math.max(6, Math.round(Number(v || 0) / max * 100)) + '%';
    }
    // 漏斗逐级转化率：本层 / 上一层
    function funnelRate(b, i) {
      const prev = b.items[i - 1] && b.items[i - 1].value;
      const cur = b.items[i] && b.items[i].value;
      if (!prev) return '—';
      return Math.round(Number(cur || 0) / prev * 100) + '%';
    }
    // 达人档案「跟进时间轴」：复用线索的跟进接口（达人库 ID 同样支持，转化后不断链）
    const talentTimelineDlg = reactive({ open: false, row: null, rows: [], loading: false });
    function openTalentTimeline(r) {
      talentTimelineDlg.row = r; talentTimelineDlg.rows = []; talentTimelineDlg.loading = true; talentTimelineDlg.open = true;
      fetch('/api/mvp/leads/' + encodeURIComponent(r.id) + '/follow-ups').then(x => x.json())
        .then(j => { talentTimelineDlg.rows = (j && j.ok && Array.isArray(j.data)) ? j.data : []; talentTimelineDlg.loading = false; })
        .catch(() => { talentTimelineDlg.loading = false; });
    }
    // 工作台直接进入业务处理：待接收/待交接 → 查看详情；招募完成 → 直接发起交接；
    // 任务执行 → 寄拍任务页；其余 → 去跟进
    function wbOpen(t) {
      if (t.kind === 'task') { goPage('tasks'); return; }
      if (t.kind === 'account') { goPage('account-ops'); return; }
      const row = tl.list.find(x => x.id === (t.talentId || t.id));
      goPage('talent-leads');
      setTimeout(() => {
        if (!row) { showToast('本地列表暂无该线索，请刷新'); return; }
        if (t.type === '待接收' || t.type === '待交接') tl.openDetail(row);
        else if (t.type === '招募完成') { if (tl.openHandover) tl.openHandover(row); else tl.openDetail(row); }
        else tl.openFollow(row);
      }, 400);
    }
    // 「招募完成」待办：一键把达人交接给运营（长期管理）
    function wbStartHandover(t) {
      const row = tl.list.find(x => x.id === (t.talentId || t.id));
      if (!row) { goPage('talent-leads'); showToast('本地列表暂无该线索，请刷新'); return; }
      goPage('talent-leads');
      setTimeout(() => { tl.openHandover(row); }, 400);
    }
    function wbConfirm(t) {
      const ho = (tl.inbox || []).find(h => h.id === t.handoverId);
      if (!ho) { goPage('talent-leads'); showToast('请到「达人线索」顶部待确认区处理该交接'); return; }
      tl.confirmHandover(ho, showToast);
      setTimeout(loadWorkbench, 600);
    }
    function wbReject(t) {
      const ho = (tl.inbox || []).find(h => h.id === t.handoverId);
      if (!ho) { goPage('talent-leads'); return; }
      tl.rejectHandover(ho, showToast);
      setTimeout(loadWorkbench, 600);
    }

    function goPage(k) {
      if (k === 'accounts') { openAccounts(); return; } // 系统设置组的账号管理：打开弹窗而非切页
      const r = NAV_ROLES[k];
      if (r && !r.includes(me.value.role)) { toast.value = '没有权限访问该页面'; setTimeout(() => (toast.value = ''), 2600); return; }
      // 岗位职责边界：岗位设置了却不属于该页面的，拦截（管理员不受限）
      const p = NAV_POSITIONS[k];
      if (p && me.value.role !== 'admin' && me.value.position && !p.includes(me.value.position)) { toast.value = '该页面不在你的岗位职责内（' + (POSITIONS.find(x => x.key === me.value.position) || {}).label + '岗）'; setTimeout(() => (toast.value = ''), 2600); return; }
      page.value = k;
      if (k === 'dashboard') { if (dashView.value === 'admin') { loadBoard(); setTimeout(renderCharts, 60); } else loadDashPanels(); }
      if (k === 'workbench') loadWorkbench();   // 待办按服务端规则实时重算
      if (k === 'account-ops') loadAccounts();  // 账号指标每次进入都刷新
      if (k === 'talent-pool') loadTalents(); // 达人档案：转化入库后实时刷新
      if (k === 'tasks') { loadTasks(); loadOpsTasks(); }   // 达人任务中心：寄拍/内容 + 运营成长任务
      if (k === 'hit-cases') loadHitCases();                // 爆款拆解库
    }
    function showToast(msg) { toast.value = msg; setTimeout(() => (toast.value = ''), 2600); }

    return {
      page, nav, currentNav, today, toast, trendUp, trendFlat, tl, mnav, mobTabs, showToast,
      wbToday, wbOverdue, wbHandover, wbHot, wbInbox, wbTodos, wbOpen, wbCards, wbExtraCards, wbPanels, wbConfirm, wbReject, wbStartHandover, loadWorkbench,
      funnelWidth, funnelRate, talentTimelineDlg, openTalentTimeline, dashView, dashPanels, loadDashPanels,
      dewuRows, dewuStats, dewuReady, fansText, dewuDlg, dewuForm, openDewuEdit, saveDewu, loadAccounts,
      talentRows, talentStats, talentReady, loadTalents,
      me, canFin, accModal, pwModal, accList, accForm, pwForm, resetInfo, openAccounts, createAccount, removeAccount, resetAccount, updateAccount, POSITIONS, openPassword, changePassword, logout,
      CHANNELS, channelsAll, chAddOpen, chNewName, addCustomChannel, OWNERS, TASK_STAGES, leadStagesAll, leadFunnel,
      campaigns, leads, tasks,
      cmpModal, cmpEditing, cmpForm, openCmpCreate, openCmpEdit, saveCampaign, deleteCampaign,
      kpis, todos, taskStageDist, pendingLeads,
      fmt, cpa, sum, stageIdx, leadStageColor, taskStageColor,
      totalCost,
      finMode, finSettings, settlements, settleFiltered, settleKeyword, settleStatusFilter, SETTLE_STATUSES, ADJ_TYPES,
      paidTalents, svcTotals, markFeeReceived,
      finPlatform, finMcn, finPayable, finPaid, finUnpaid, finOverdue, finTotals,
      settleModal, settleForm, openSettleCreate, saveSettlement, settlePreview, PERIODS,
      settleDetailId, settleDetail, openSettleDetail, closeSettleDetail,
      confirmSettle, closeSettle, deleteSettlement, addAdjustment, removeAdjustment, settleStatusColor,
      payModal, payDirection, payTarget, payForm, openPayModal, savePayment, deletePayment,
      setModal, setForm, openSettings, saveSettings, talentNameOptions, todayStr,
      monthNewTalents, costPerTalent, insight,
      talentCards,
      leadView, leadKeyword, leadModal, leadForm, filteredLeads, leadsFiltered, isOverdue,
      openLeadModal, saveLead, onLeadMove,
      taskFilter, tasksFiltered, tasksLoaded, canLaunchShoot, shootDlg, openLaunchShoot, saveLaunchShoot, shootTalentOptions, taskDlg, openTaskAction, saveTaskAction, taskActionsOf, taskStatusTone,
      taskTypeTab, TASK_TYPE_TABS, taskTypeOf, opsTasks, opsTasksLoaded, canAssignOpsTask, opsTargetOptions, opsTaskDlg, openOpsTask, saveOpsTask, myPositionLabel, amOps, ackAssign,
      notif, NOTIF_TYPE_LABEL, toggleNotif, readNotif, readAllNotifs, panelLeadAct, reviewPanelLead,
      opsTaskProgDlg, openOpsTaskProgress, saveOpsTaskProgress, deleteOpsTask,
      hitCases, hitCasesLoaded, hitCaseQ, hitCasesFiltered, canEditHitCase, loadHitCases, hitCaseDlg, openHitCase, saveHitCase, deleteHitCase,
      board, loadBoard, boardReady, maxLoad, loadPct, boardFunnel, boardAttention, boardAlerts, canSeeCost, canTasks,
      ai, aiTemplates, aiPrompt, aiUsableRate, generateImages,
      tplList, imp, downloadTemplate, handleFile, confirmImport,
      funnelChart, channelChart, trendChart, trend30Chart,
      goPage,
    };
  },
}).mount('#app');
