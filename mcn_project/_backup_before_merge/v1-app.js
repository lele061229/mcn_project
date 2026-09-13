/* ============================================================
 * MCN 达人培育后台 V1 · 前端逻辑
 * 所有数据通过自建后端 API 读写（前端不接触飞书凭证）
 * ============================================================ */
const { createApp, reactive, ref, computed, watch, nextTick } = Vue;

const USERS = [
  { name: '张三', role: '运营' },
  { name: '李四', role: '主管' },
  { name: '王五', role: '财务' },
  { name: '老板', role: '管理员' },
];
const STATUS_COLORS = {
  待联系: '#94a3b8', 已联系: '#64748b', 有意向: '#f59e0b', 已报名: '#8b5cf6', 待审核: '#f97316',
  已通过: '#10b981', 已拒绝: '#ef4444', 合作中: '#10b981', 暂停合作: '#94a3b8', 已流失: '#cbd5e1',
  待确认: '#94a3b8', 待寄出: '#94a3b8', 已寄出: '#0ea5e9', 已签收: '#0ea5e9', 待拍摄: '#6366f1',
  待提交: '#6366f1', 待审核: '#f97316', 内容修改中: '#ef4444', 待发布: '#8b5cf6', 已发布: '#8b5cf6',
  已完成: '#10b981', 达人拒绝: '#ef4444', 超时: '#ef4444', 商品异常: '#ef4444', 内容不合格: '#ef4444', 已取消: '#cbd5e1',
};

createApp({
  setup() {
    /* ---------- 基础状态 ---------- */
    const page = ref('dashboard');
    const toast = ref('');
    const users = USERS;
    const userIdx = ref(parseInt(localStorage.getItem('v1_user') || '1'));
    const user = computed(() => users[userIdx.value] || users[1]);
    const canAudit = computed(() => ['主管', '管理员'].includes(user.value.role));
    const canMutate = computed(() => user.value.role !== '财务');
    const meta = reactive({ mode: 'mock', TALENT_STATUSES: [], TASK_STATUSES: [], ACTIONS: {} });

    const navMenus = [
      { key: 'dashboard', label: '首页 Dashboard', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-4 h-4"><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg>' },
      { key: 'talents', label: '达人管理', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-4 h-4"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>' },
      { key: 'tasks', label: '寄拍任务', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-4 h-4"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>' },
      { key: 'logs', label: '操作日志', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-4 h-4"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/></svg>' },
    ];
    const titles = { dashboard: '经营总览', talents: '达人管理', talent: '达人详情', tasks: '寄拍任务管理', logs: '系统操作日志' };
    const pageTitle = computed(() => titles[page.value] || '');

    /* ---------- API ---------- */
    async function api(method, url, body) {
      const r = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', 'X-Operator': encodeURIComponent(user.value.name), 'X-Role': encodeURIComponent(user.value.role) },
        body: body ? JSON.stringify(body) : undefined,
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || ('HTTP ' + r.status));
      return j.data;
    }
    function showToast(msg) { toast.value = msg; setTimeout(() => (toast.value = ''), 2800); }

    /* ---------- 数据 ---------- */
    const talents = ref([]);
    const tasks = ref([]);
    const logs = ref([]);
    const dash = ref({});
    const detail = ref(null);
    const tf = reactive({ q: '', status: '', level: '', owner: '', channel: '', tag: '' });
    const taskFilter = reactive({ q: '', status: '', owner: '' });

    const ownerOptions = computed(() => [...new Set(talents.value.map(t => t.owner).filter(Boolean))]);
    const channelOptions = computed(() => [...new Set([...talents.value.map(t => t.channel), '抖音直播', '数字人直播', '私信', '微信', '表单', '达人推荐', '人工拓展', '私聊邀约', '其他'].filter(Boolean))]);
    const tagOptions = computed(() => [...new Set(talents.value.flatMap(t => t.tags || []))]);

    const kpiTalents = computed(() => {
      const d = dash.value.talents || {};
      return [
        { label: '达人总数', value: d.total ?? '-' },
        { label: '今日新增达人', value: d.today ?? '-' },
        { label: '本周新增达人', value: d.week ?? '-' },
        { label: '待审核达人', value: d.pendingAudit ?? '-', hot: true, click: () => { tf.status = '待审核'; goPage('talents'); } },
        { label: '活跃达人（合作中）', value: d.active ?? '-' },
      ];
    });
    const kpiTasks = computed(() => {
      const d = dash.value.tasks || {};
      return [
        { label: '进行中任务', value: d.ongoing ?? '-', hot: true, click: () => { taskFilter.status = '__active'; goPage('tasks'); } },
        { label: '待处理任务', value: d.pending ?? '-' },
        { label: '已完成任务', value: d.completed ?? '-' },
      ];
    });

    async function loadDashboard() {
      dash.value = await api('GET', '/api/dashboard');
      nextTick(renderCharts);
    }
    async function loadTalents() {
      const p = new URLSearchParams();
      Object.entries(tf).forEach(([k, v]) => { if (v) p.set(k, v); });
      talents.value = await api('GET', '/api/talents?' + p.toString());
    }
    async function loadTasks() { tasks.value = await api('GET', '/api/tasks'); }
    async function loadLogs() { logs.value = await api('GET', '/api/logs'); }
    function resetTf() { Object.assign(tf, { q: '', status: '', level: '', owner: '', channel: '', tag: '' }); loadTalents(); }

    const tasksFiltered = computed(() => tasks.value.filter(t => {
      if (taskFilter.status === '__active') {
        const a = (meta.ACTIVE_TASK || []);
        if (!a.includes(t.status)) return false;
      } else if (taskFilter.status === '__abnormal') {
        if (!['达人拒绝', '超时', '商品异常', '内容不合格', '已取消'].includes(t.status)) return false;
      } else if (taskFilter.status && t.status !== taskFilter.status) return false;
      if (taskFilter.owner && t.owner !== taskFilter.owner) return false;
      if (taskFilter.q) {
        const q = taskFilter.q;
        if (![t.id, t.product, t.talentName, t.trackingNo].some(v => String(v || '').includes(q))) return false;
      }
      return true;
    }));

    /* ---------- 图表 ---------- */
    const cTrend = ref(null), cTalent = ref(null), cTask = ref(null), cRate = ref(null);
    const charts = {};
    function renderCharts() {
      const d = dash.value;
      if (!d || !d.trend7d) return;
      if (cTrend.value) {
        charts.trend = charts.trend || echarts.init(cTrend.value);
        charts.trend.setOption({
          grid: { left: 30, right: 10, top: 15, bottom: 25 },
          xAxis: { type: 'category', data: d.trend7d.map(x => x.date), axisLabel: { fontSize: 10 } },
          yAxis: { type: 'value', minInterval: 1 },
          series: [{ type: 'bar', data: d.trend7d.map(x => x.count), itemStyle: { color: '#818cf8', borderRadius: [4, 4, 0, 0] }, barWidth: 18 }],
        });
      }
      if (cTalent.value) {
        charts.talent = charts.talent || echarts.init(cTalent.value);
        charts.talent.setOption({
          tooltip: { trigger: 'item' },
          series: [{ type: 'pie', radius: ['35%', '70%'], center: ['50%', '48%'], data: d.talentStatusDist, label: { fontSize: 10, formatter: '{b} {c}' } }],
        });
      }
      if (cTask.value) {
        charts.task = charts.task || echarts.init(cTask.value);
        charts.task.setOption({
          grid: { left: 55, right: 20, top: 10, bottom: 25 },
          xAxis: { type: 'value', minInterval: 1 },
          yAxis: { type: 'category', data: d.taskStatusDist.map(x => x.name), axisLabel: { fontSize: 10 } },
          series: [{ type: 'bar', data: d.taskStatusDist.map(x => x.value), itemStyle: { color: '#6366f1', borderRadius: [0, 4, 4, 0] }, barWidth: 12, label: { show: true, position: 'right', fontSize: 10 } }],
        });
      }
      if (cRate.value) {
        charts.rate = charts.rate || echarts.init(cRate.value);
        charts.rate.setOption({
          tooltip: { trigger: 'item' },
          series: [{
            type: 'pie', radius: ['55%', '75%'], center: ['50%', '48%'],
            data: [{ name: '已完成', value: d.completionRate, itemStyle: { color: '#10b981' } }, { name: '未完成', value: 100 - d.completionRate, itemStyle: { color: '#e2e8f0' } }],
            label: { show: false },
          }],
          graphic: [{ type: 'text', left: 'center', top: '44%', style: { text: d.completionRate + '%', fontSize: 20, fontWeight: 'bold', fill: '#0f172a' } }],
        });
      }
      setTimeout(() => Object.values(charts).forEach(c => c && c.resize()), 60);
    }

    /* ---------- 页面切换 ---------- */
    function goPage(key) {
      page.value = key;
      if (key === 'dashboard') loadDashboard();
      if (key === 'talents') loadTalents();
      if (key === 'tasks') loadTasks();
      if (key === 'logs') loadLogs();
    }
    async function openTalent(id) {
      detail.value = await api('GET', '/api/talents/' + id);
      page.value = 'talent';
    }

    /* ---------- 达人操作 ---------- */
    const modals = reactive({ talent: false, status: false, reject: false, followup: false, task: false, taskAction: false });
    const talentForm = reactive({ id: '', name: '', contact: '', douyin: '', fans: '', channel: '抖音直播', level: 'B', contentTypes: '', categories: '', tags: '', owner: '李婷', note: '' });
    const statusForm = reactive({ id: '', name: '', current: '', status: '', reason: '' });
    const rejectForm = reactive({ id: '', name: '', reason: '' });
    const followupForm = reactive({ content: '', method: '微信', nextAt: '' });
    const taskForm = reactive({ talentId: '', product: '', commission: '', campaignId: '', owner: '李婷' });
    const taskAction = reactive({ task: null, actions: [], chosen: '', fields: {}, to: '' });

    function splitList(s) { return String(s || '').split(/[,，、]/).map(x => x.trim()).filter(Boolean); }
    function openTalentForm(t) {
      Object.assign(talentForm, { id: '', name: '', contact: '', douyin: '', fans: '', channel: '抖音直播', level: 'B', contentTypes: '', categories: '', tags: '', owner: '李婷', note: '' });
      if (t) Object.assign(talentForm, {
        id: t.id, name: t.name, contact: t.contact || '', douyin: t.douyin || '', fans: t.fans || '',
        channel: t.channel || '抖音直播', level: t.level || 'B', contentTypes: (t.contentTypes || []).join(','),
        categories: (t.categories || []).join(','), tags: (t.tags || []).join(','), owner: t.owner || '李婷', note: t.note || '',
      });
      modals.talent = true;
    }
    async function saveTalent() {
      try {
        const body = { ...talentForm, contentTypes: splitList(talentForm.contentTypes), categories: splitList(talentForm.categories), tags: splitList(talentForm.tags), fans: talentForm.fans };
        if (talentForm.id) { await api('PUT', '/api/talents/' + talentForm.id, body); showToast('达人资料已更新'); }
        else { await api('POST', '/api/talents', body); showToast('达人已创建，状态：待联系'); }
        modals.talent = false;
        await loadTalents();
        if (page.value === 'talent' && detail.value) await openTalent(detail.value.talent.id);
      } catch (e) { showToast(e.message); }
    }
    function openStatusModal(t) {
      Object.assign(statusForm, { id: t.id, name: t.name, current: t.status, status: t.status, reason: '' });
      modals.status = true;
    }
    async function saveStatus() {
      try {
        await api('PATCH', '/api/talents/' + statusForm.id + '/status', { status: statusForm.status, reason: statusForm.reason });
        showToast('状态已更新为「' + statusForm.status + '」');
        modals.status = false;
        await loadTalents();
        if (page.value === 'talent' && detail.value) await openTalent(detail.value.talent.id);
      } catch (e) { showToast(e.message); }
    }
    async function auditPass(t) {
      try {
        await api('PATCH', '/api/talents/' + t.id + '/status', { status: '已通过' });
        showToast(t.name + ' 审核通过 ✓');
        await loadTalents();
        if (page.value === 'talent' && detail.value) await openTalent(detail.value.talent.id);
      } catch (e) { showToast(e.message); }
    }
    function openRejectModal(t) { Object.assign(rejectForm, { id: t.id, name: t.name, reason: '' }); modals.reject = true; }
    async function confirmReject() {
      try {
        await api('PATCH', '/api/talents/' + rejectForm.id + '/status', { status: '已拒绝', reason: rejectForm.reason });
        showToast('已拒绝：' + rejectForm.name);
        modals.reject = false;
        await loadTalents();
        if (page.value === 'talent' && detail.value) await openTalent(detail.value.talent.id);
      } catch (e) { showToast(e.message); }
    }
    function openFollowup() { Object.assign(followupForm, { content: '', method: '微信', nextAt: '' }); modals.followup = true; }
    async function saveFollowup() {
      try {
        await api('POST', '/api/talents/' + detail.value.talent.id + '/followups', followupForm);
        showToast('跟进记录已保存');
        modals.followup = false;
        await openTalent(detail.value.talent.id);
      } catch (e) { showToast(e.message); }
    }
    async function deactivate(t) {
      if (!confirm('确认停用达人「' + t.name + '」？\n（逻辑删除：is_active=false，不会物理删除数据）')) return;
      try {
        await api('POST', '/api/talents/' + t.id + '/deactivate');
        showToast('已停用（逻辑删除）');
        await loadTalents();
        if (page.value === 'talent') await openTalent(t.id);
      } catch (e) { showToast(e.message); }
    }

    /* ---------- 任务操作 ---------- */
    function openTaskForm(t) {
      Object.assign(taskForm, { talentId: t ? t.id : '', product: '', commission: '', campaignId: '', owner: '李婷' });
      if (!talents.value.length) loadTalents();
      modals.task = true;
    }
    async function saveTask() {
      try {
        const rec = await api('POST', '/api/tasks', taskForm);
        showToast('任务已创建：' + rec.id + '（待确认）');
        modals.task = false;
        if (page.value === 'talent' && detail.value) await openTalent(detail.value.talent.id);
        if (page.value === 'tasks') await loadTasks();
      } catch (e) { showToast(e.message); }
    }
    function actionsFor(t) {
      return Object.entries(meta.ACTIONS || {}).filter(([, a]) => (a.from || []).includes(t.status)).map(([key, a]) => ({ key, ...a }));
    }
    function openTaskAction(t) {
      const acts = actionsFor(t);
      if (!acts.length) return;
      taskAction.task = t;
      taskAction.actions = acts;
      taskAction.chosen = acts[0].key;
      taskAction.fields = {};
      taskAction.to = '';
      modals.taskAction = true;
    }
    const chosenAction = computed(() => taskAction.actions.find(a => a.key === taskAction.chosen));
    async function submitTaskAction() {
      try {
        const body = { action: taskAction.chosen, ...taskAction.fields };
        if (taskAction.chosen === 'markException') body.to = taskAction.to;
        const rec = await api('PATCH', '/api/tasks/' + taskAction.task.id + '/status', body);
        showToast('任务 ' + rec.id + ' → ' + rec.status);
        modals.taskAction = false;
        await loadTasks();
        if (page.value === 'talent' && detail.value) await openTalent(detail.value.talent.id);
      } catch (e) { showToast(e.message); }
    }

    const statusColor = s => STATUS_COLORS[s] || '#94a3b8';
    const fmt = n => (n === undefined || n === null || n === '') ? '-' : Number(n).toLocaleString('zh-CN');

    /* ---------- 初始化 ---------- */
    (async () => {
      Object.assign(meta, await api('GET', '/api/meta'));
      await loadDashboard();
    })();
    watch(userIdx, i => {
      localStorage.setItem('v1_user', String(i));
      showToast('已切换为 ' + user.value.name + '（' + user.value.role + '）');
    });

    return {
      page, toast, users, userIdx, user, canAudit, canMutate, meta, navMenus, pageTitle,
      talents, tasks, logs, dash, detail, tf, taskFilter, tasksFiltered,
      ownerOptions, channelOptions, tagOptions, kpiTalents, kpiTasks,
      cTrend, cTalent, cTask, cRate,
      goPage, openTalent, resetTf, loadTalents,
      modals, talentForm, statusForm, rejectForm, followupForm, taskForm, taskAction, chosenAction,
      openTalentForm, saveTalent, openStatusModal, saveStatus, auditPass, openRejectModal, confirmReject,
      openFollowup, saveFollowup, deactivate,
      openTaskForm, saveTask, actionsFor, openTaskAction, submitTaskAction,
      statusColor, fmt,
    };
  },
}).mount('#app');
