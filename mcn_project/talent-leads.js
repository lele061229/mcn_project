/* ============================================================
 * 达人线索管理模块（独立文件，避免主 app.js 膨胀）
 * 依赖：Vue 全局（CDN）。运行后挂载到 window.TalentLeadsModule
 * 仅 mock 数据，不接后端。
 * ============================================================ */
(function (global) {
  const { ref, reactive, computed, reactive: _r } = Vue;

  /* ---------------- 字段字典（与规格一一对应） ---------------- */
  const SOURCES = ['校园墙', '校园代理', '地推', '抖音直播', '抖音私信', 'BOSS', '转介绍', '私域', '其他'];
  const STAGES = ['新线索', '待初筛', '已联系', '有意向', '已分类', '待交接', '已交接', '无效线索'];
  const POTENTIALS = ['待判断', '高', '中', '低'];
  const WILLINGS = ['待判断', '强', '中', '弱'];
  const CATEGORIES = ['待分类', 'A', 'B', 'C', 'D'];
  const PATHS = ['待判断', '免费签约', '付费孵化', '暂不推进'];
  const FOLLOW_METHODS = ['微信', '电话', '面谈', '私信', '其他'];
const FOLLOW_RESULTS = ['已接通', '未接通', '已加微信', '待回复', '已报价', '有兴趣', '已拒绝', '其他'];
  const OWNERS = ['李婷', '王浩', '张萌'];
  const PLATFORMS = ['抖音', '小红书', '快手', 'B站', '微博', '视频号', '无'];
  const APPEAR_WAYS = ['真人出镜', '不露脸', '图文', '混剪', '待定'];

  /* Tag 配色：按字段类型给语义色，保持后台简洁风格 */
  function tagClass(type, val) {
    const map = {
      stage: { '新线索': 'bg-slate-100 text-slate-600', '待初筛': 'bg-sky-100 text-sky-600', '已联系': 'bg-blue-100 text-blue-600',
        '有意向': 'bg-amber-100 text-amber-600', '已分类': 'bg-indigo-100 text-indigo-600', '待交接': 'bg-orange-100 text-orange-600', '已交接': 'bg-emerald-100 text-emerald-600' },
      potential: { '待判断': 'bg-slate-100 text-slate-500', '高': 'bg-rose-100 text-rose-600', '中': 'bg-amber-100 text-amber-600', '低': 'bg-slate-100 text-slate-400' },
      willing: { '待判断': 'bg-slate-100 text-slate-500', '强': 'bg-emerald-100 text-emerald-600', '中': 'bg-sky-100 text-sky-600', '弱': 'bg-slate-100 text-slate-400' },
      category: { '待分类': 'bg-slate-100 text-slate-500', 'A': 'bg-rose-100 text-rose-600', 'B': 'bg-orange-100 text-orange-600', 'C': 'bg-amber-100 text-amber-600', 'D': 'bg-slate-100 text-slate-400' },
      path: { '待判断': 'bg-slate-100 text-slate-500', '免费签约': 'bg-emerald-100 text-emerald-600', '付费孵化': 'bg-indigo-100 text-indigo-600', '暂不推进': 'bg-slate-100 text-slate-400' },
    };
    return (map[type] && map[type][val]) || 'bg-slate-100 text-slate-500';
  }

  /* ---------------- 金数据调研真实线索（19 条，2026-09-07 ~ 09-09 提交） ----------------
     默认值：来源=其他（表单未采集渠道）、阶段=新线索、潜力/意愿/路径=待判断、分类=待分类、负责人未分配；
     粉丝量区间取中值（0～500→250、500～1000→750、5000～1万→7500、1万～5万→30000、5万以上→50000）；
     提交时间作为最近跟进时间；第 9 题疑问与上传截图文件名写入备注。 */
  function lead(id, name, lastFollow, extra) {
    return Object.assign({ id, name, contact: '未填写', source: '其他', hasMedia: false, platforms: ['无'], fans: 0,
      hasExp: false, coopCategories: '无', wantCategories: '待沟通', appearWay: '待定', stage: '新线索',
      potential: '待判断', willing: '待判断', category: '待分类', coopPath: '待判断', owner: '未分配',
      lastFollow, nextFollow: '', note: '' }, extra);
  }
  const MOCK = [
    lead('CL001', '鸟', '2026-09-07 09:40', { owner: '李婷', wantCategories: '衣服 / 裤子，鞋类', appearWay: '本人出镜，但不露脸', note: '想了解：商单 / 收益相关' }),
    lead('CL002', '11', '2026-09-07 09:44', { owner: '李婷', wantCategories: '数码产品', appearWay: '都可以，看具体商品要求', note: '想了解：商单 / 收益相关' }),
    lead('CL003', '麒神', '2026-09-07 10:03', { owner: '王浩', wantCategories: '衣服 / 裤子，鞋类', appearWay: '真人露脸出镜', note: '想了解：其他: 打不打pubg' }),
    lead('CL004', '三温鱼粉', '2026-09-07 10:07', { owner: '王浩', wantCategories: '衣服 / 裤子，鞋类，美妆护肤', appearWay: '真人露脸出镜，手部 / 局部出镜，都可以，看具体商品要求', note: '想了解：寄拍具体流程，对账号 / 粉丝有没有要求，拍摄有什么要求，作品发布有什么要求，寄拍是否需要费用，商单 / 收益相关' }),
    lead('CL005', '爸爸', '2026-09-07 10:18', { owner: '张萌', hasMedia: true, platforms: ['抖音'], fans: 50000, wantCategories: '手表 / 饰品，包包，衣服 / 裤子，鞋类，美妆护肤，数码产品，家居 / 日用品，其他', appearWay: '真人露脸出镜，本人出镜，但不露脸，手部 / 局部出镜，只拍产品，不本人出镜，都可以，看具体商品要求', note: '想了解：寄拍具体流程，对账号 / 粉丝有没有要求，商品怎么选择，拍摄有什么要求，作品发布有什么要求，寄拍是否需要费用，商单 / 收益相关，其他' }),
    lead('CL006', '王', '2026-09-07 10:20', { owner: '张萌', wantCategories: '手表 / 饰品', appearWay: '本人出镜，但不露脸', note: '想了解：寄拍具体流程' }),
    lead('CL007', '小吴', '2026-09-07 10:21', { hasMedia: true, platforms: ['小红书', '抖音'], fans: 250, appearWay: '都可以，看具体商品要求', note: '想了解：寄拍具体流程，对账号 / 粉丝有没有要求，商品怎么选择，拍摄有什么要求，作品发布有什么要求，商单 / 收益相关；主页：Screenshot_2026-09-07-10-21-08-48_2332cb9b27b851b548ba47a91682926c.jpg' }),
    lead('CL008', '小余', '2026-09-07 10:21', { hasMedia: true, platforms: ['抖音', '快手'], fans: 250, wantCategories: '手表 / 饰品，包包，衣服 / 裤子，鞋类，美妆护肤，数码产品，家居 / 日用品', appearWay: '真人露脸出镜，都可以，看具体商品要求', note: '想了解：寄拍具体流程，对账号 / 粉丝有没有要求，商品怎么选择，拍摄有什么要求，作品发布有什么要求，商单 / 收益相关；主页：IMG_2876.png' }),
    lead('CL009', 'kk', '2026-09-07 10:21', { wantCategories: '衣服 / 裤子', appearWay: '本人出镜，但不露脸', note: '想了解：寄拍具体流程，对账号 / 粉丝有没有要求，拍摄有什么要求，寄拍是否需要费用' }),
    lead('CL010', '张哲俊', '2026-09-07 10:37', { wantCategories: '数码产品', appearWay: '本人出镜，但不露脸', note: '想了解：商单 / 收益相关' }),
    lead('CL011', 'tyh', '2026-09-07 10:42', { appearWay: '只拍产品，不本人出镜', note: '想了解：寄拍具体流程，拍摄有什么要求，作品发布有什么要求，寄拍是否需要费用，商单 / 收益相关' }),
    lead('CL012', '小李', '2026-09-07 10:43', { wantCategories: '数码产品', appearWay: '都可以，看具体商品要求', note: '想了解：对账号 / 粉丝有没有要求' }),
    lead('CL013', '房若曦', '2026-09-07 10:44', { hasMedia: true, platforms: ['B站'], fans: 250, wantCategories: '鞋类，家居 / 日用品', appearWay: '真人露脸出镜', note: '想了解：寄拍具体流程，对账号 / 粉丝有没有要求，商单 / 收益相关；主页：1788680993544.png' }),
    lead('CL014', '小诺', '2026-09-07 10:50', { wantCategories: '手表 / 饰品，衣服 / 裤子，鞋类，美妆护肤，数码产品', appearWay: '本人出镜，但不露脸，手部 / 局部出镜，只拍产品，不本人出镜', note: '想了解：寄拍具体流程，对账号 / 粉丝有没有要求，商品怎么选择，拍摄有什么要求，作品发布有什么要求，寄拍是否需要费用，商单 / 收益相关' }),
    lead('CL015', 'xx', '2026-09-07 11:07', { wantCategories: '手表 / 饰品，衣服 / 裤子，鞋类', appearWay: '只拍产品，不本人出镜', note: '想了解：对账号 / 粉丝有没有要求，商品怎么选择' }),
    lead('CL016', '小安', '2026-09-07 15:22', { hasMedia: true, platforms: ['抖音'], fans: 30000, appearWay: '真人露脸出镜', note: '想了解：寄拍具体流程；主页：IMG_9884.png' }),
    lead('CL017', '小陈', '2026-09-07 15:48', { hasMedia: true, platforms: ['快手'], fans: 7500, wantCategories: '手表 / 饰品', appearWay: '真人露脸出镜', note: '想了解：寄拍具体流程；主页：IMG_5454.png' }),
    lead('CL018', 'zhuoxiii', '2026-09-07 21:10', { hasMedia: true, platforms: ['小红书', '抖音', '其他'], fans: 750, hasExp: true, coopCategories: '数码产品', wantCategories: '数码产品', appearWay: '真人露脸出镜', note: '想了解：寄拍具体流程，对账号 / 粉丝有没有要求，商品怎么选择，拍摄有什么要求，作品发布有什么要求，寄拍是否需要费用，商单 / 收益相关；主页：Screenshot_2026-09-07-21-10-37-22_2332cb9b27b851b548ba47a91682926c.jpg' }),
    lead('CL019', '测试1', '2026-09-09 08:41', { hasMedia: true, platforms: ['得物', '小红书'], fans: 30000, hasExp: true, coopCategories: '手表 / 饰品', wantCategories: '衣服 / 裤子', appearWay: '本人出镜，但不露脸', note: '想了解：作品发布有什么要求，寄拍是否需要费用' }),
  ];

  /* ---------------- composable ---------------- */
  function useTalentLeads(opts) {
    const meRef = (opts && opts.me) || null;
    const myRole = computed(() => (meRef && meRef.value && meRef.value.role) || 'staff');
    const myName = computed(() => (meRef && meRef.value && meRef.value.displayName) || '');
    const myPosition = computed(() => (meRef && meRef.value && meRef.value.position) || '');
    const isAdmin = computed(() => myRole.value === 'admin');
    const list = reactive(MOCK.map(r => ({ ...r })));

    /* 接入数据库：把「报名表单」新报名合并进列表（历史 CL 线索保留） */
    function talentToLead(t) {
      const r = t.recruit || {};
      const fromNote = label => { const m = String(t.note || '').match(new RegExp(label + '：([^；]*)')); return m ? m[1] : ''; };
      const selfMedia = r.selfMedia || fromNote('自媒体');
      const platformsTxt = r.platforms || fromNote('平台');
      const fansTxt = r.fansText || fromNote('粉丝量');
      const appearWay = r.appearWay || fromNote('出镜方式');
      const hasExpTxt = r.hasExp || fromNote('合作经历');
      const coopCats = r.coopCategories || fromNote('合作过的品类');
      const wantCats = r.preferredCategories || fromNote('想接的品类');
      const questions = r.questions || fromNote('疑问');
      return {
        id: t.id, name: t.name, contact: t.contact || '未填写', source: t.channel || '其他',
        hasMedia: parseHasMedia(selfMedia),
        platforms: platformsTxt ? platformsTxt.split(/[、,，]/).filter(Boolean) : ['无'],
        fans: parseFans(fansTxt),
        hasExp: parseHasExp(hasExpTxt),
        coopCategories: coopCats || '无', wantCategories: wantCats || '待沟通',
        appearWay: appearWay || '待定',
        stage: { '待审核': '待初筛', '已报名': '待初筛', '已联系': '已联系', '有意向': '有意向', '合作中': '已交接', '已成为达人': '已交接', '已流失': '无效线索', '无效线索': '无效线索' }[t.status] || '新线索',
        // 业务评估字段（服务端真实字段 → 前端展示字段）
        potential: t.potentialLevel || '待判断',
        willing: t.intentLevel || '待判断',
        category: t.talentClass || '待分类',
        coopPath: t.coopPath || '待判断',
        owner: t.owner || '未分配',
        ownerId: t.ownerId || '',
        ownerPosition: t.ownerPosition || '', ownerPositionLabel: t.ownerPositionLabel || '',
        recruitBy: t.recruitBy || '',
        opsBy: t.opsBy || '', opsId: t.opsId || '', opsAt: t.opsAt || '',
        assignedAt: t.assignedAt || '',
        // SLA（首次联系时限）：服务端读时派生，前端只做展示与筛选
        slaStatus: t.slaStatus || 'none',
        slaLevel: t.slaLevel || 'normal', slaRuleLabel: t.slaRuleLabel || '',
        slaRemindMin: t.slaRemindMin || 0, slaOverdueMin: t.slaOverdueMin || 0,
        slaUsedMin: t.slaUsedMin || 0, slaRemainMin: t.slaRemainMin || 0,
        slaOverdueMinute: t.slaOverdueMinute || 0, slaDeadline: t.slaDeadline || '',
        firstContactAt: t.firstContactAt || '', lastFollowupAt: t.lastFollowupAt || '',
        escalatedAt: t.escalatedAt || '', reassignedAt: t.reassignedAt || '',
        overdueReason: t.overdueReason || '', urgeCount: Number(t.urgeCount) || 0, urgedAt: t.urgedAt || '',
        handoverStatus: t.handoverStatus || 'none',
        handoverFrom: t.handoverFrom || '', handoverTo: t.handoverTo || '',
        handoverToPosition: t.handoverToPosition || '', handoverToPositionLabel: t.handoverToPositionLabel || '',
        handoverReason: t.handoverReason || '', handoverNote: t.handoverNote || '',
        handoverAt: t.handoverAt || '', handoverReceivedAt: t.handoverReceivedAt || '',
        incubationFee: Number(t.incubationFee) || 0, feeStatus: t.feeStatus || '未收',
        lastFollow: String(t.lastFollow || '').slice(0, 16),
        nextFollow: String(t.nextFollow || '').slice(0, 16),
        note: (questions ? '想了解：' + questions : '') + ((r.profileScreenshot || t.profileScreenshot) ? '；主页截图：' + (r.profileScreenshot || t.profileScreenshot) : ''),
      };
    }
    function loadFromDb() {
      fetch('/api/mvp/leads').then(r2 => r2.json()).then(j => {
        if (!j || !j.ok || !Array.isArray(j.data)) return;
        // 合并数据库里的全部线索（报名表单 / 后台新增 / Excel 导入），已存在的按 id 跳过。
        // 服务端已按角色裁剪，非管理员拿到的只是自己有权看到的那部分。
        let added = 0;
        for (const t of j.data) {
          if (list.some(x => x.id === t.id)) continue;
          list.unshift(talentToLead(t));
          added++;
        }
        if (added && typeof window !== 'undefined' && window.showToast) window.showToast('已从数据库同步 ' + added + ' 条线索');
      }).catch(() => { /* 接口不可用时保留本地数据 */ });
    }
    loadFromDb();

    /* ---- 岗位数据可见范围 ----
       服务端已按角色强制过滤（越权请求会被降级）；这里保证界面呈现口径一致。
       规则：管理员=全部；其他人=我负责的 / 本岗位池 / 待我确认，公海（未分配）对所有人可见 ---- */
    const OWNER_POS = { '李婷': 'recruit', '王浩': 'ops', '张萌': 'senior_ops' };
    // 达人生命周期（talent_status）：线索达人 → 陪跑达人 → 重点培养达人 → 公司签约达人 → 公司直属达人
    const TALENT_STATUS_LIST = ['lead', 'coaching', 'potential', 'contracted', 'company_owned'];
    // 达人评级（talentLevel）：A 高价值 / B 培养中 / C 普通 / D 沉默 —— 纯展示与排序维度
    const TALENT_LEVEL_LIST = ['待判断', 'A', 'B', 'C', 'D'];
    const TALENT_LEVEL_LABEL = { A: 'A 高价值', B: 'B 培养中', C: 'C 普通', D: 'D 沉默', 待判断: '待判断' };
    function levelTone(k) {
      return ({ A: 'bg-rose-50 text-rose-600', B: 'bg-amber-50 text-amber-600', C: 'bg-slate-100 text-slate-500', D: 'bg-slate-100 text-slate-400', 待判断: 'bg-slate-100 text-slate-400' })[k] || 'bg-slate-100 text-slate-500';
    }
    const TALENT_STATUS_LABEL = { lead: '线索达人', coaching: '陪跑达人', potential: '重点培养达人', contracted: '公司签约达人', company_owned: '公司直属达人' };
    const POSITION_LABEL_MAP = { promote: '推广', recruit: '招募', ops: '普通运营', senior_ops: '高级运营', finance: '财务', admin: '管理员' };
    const scope = ref(''); // '' = 自动（管理员 all / 其他人 mine）
    const isSenior = computed(() => myPosition.value === 'senior_ops');   // 高级运营=主管视角：跨运营负责人看全部
    // 判断字段（评级/潜力/意愿/分类/路径）修改权限：普通运营/高级运营/管理员（与服务端 canJudgeLead 同口径，2026-09-18 分层）
    const canJudge = computed(() => isAdmin.value || ['ops', 'senior_ops'].includes(myPosition.value));
    const effScope = computed(() => scope.value || ((isAdmin.value || myPosition.value === 'senior_ops') ? 'all' : 'mine'));
    function posOf(r) { return r.ownerPosition || OWNER_POS[r.owner] || ''; }
    function posLabelOf(r) { return POSITION_LABEL_MAP[posOf(r)] || '未分配'; }
    const isPublicLead = r => !r.owner || r.owner === '未分配';
    const visibleList = computed(() => list.filter(r => {
      if (isAdmin.value || myPosition.value === 'senior_ops') return true;
      if (isPublicLead(r)) return true;
      if (myName.value && r.handoverTo === myName.value && r.handoverStatus === 'pending') return true;
      const mine = !!myName.value && r.owner === myName.value;
      if (effScope.value === 'position') return mine || (!!myPosition.value && posOf(r) === myPosition.value);
      return mine;
    }));
    function setScope(v) { scope.value = v; page.value = 1; }
    const scopeLabel = computed(() => ({ all: '全部线索', position: '本岗位池', mine: '我负责的' }[effScope.value] || ''));
    const posStats = computed(() => {
      const out = {};
      for (const r of visibleList.value) { const k = posOf(r) || 'unassigned'; out[k] = (out[k] || 0) + 1; }
      return out;
    });
    // owner / position / 未分配 / 逾期未跟进 / 待交接 是「管理员总表」的筛选维度
    const BLANK_FILTERS = {
      name: '', source: '', stage: '', potential: '', willing: '', category: '',
      owner: '', position: '', talentStatus: '', talentLevel: '', unassigned: false, overdue: false, handover: false,
    };
    const filters = reactive(Object.assign({}, BLANK_FILTERS));
    const appliedFilters = reactive(Object.assign({}, BLANK_FILTERS));
    const page = ref(1);
    const pageSize = ref(10);

    /* ---- V0.2：快捷筛选 + 下次跟进时间状态 + 行内「更多」菜单 ---- */
    const TODAY = new Date().toISOString().slice(0, 10);
    const quick = ref(''); // '' | today | overdue | hot | handover
    function nfState(r) {
      if (!r.nextFollow) return 'none';
      const d = r.nextFollow.slice(0, 10);
      if (d < TODAY) return 'overdue';
      if (d === TODAY) return 'today';
      return 'future';
    }
    function nfClass(r) {
      const s = nfState(r);
      return s === 'overdue' ? 'text-rose-600 font-medium'
        : s === 'today' ? 'text-orange-500 font-medium'
        : s === 'future' ? 'text-slate-600' : 'text-slate-300';
    }
    function setQuick(v) { quick.value = quick.value === v ? '' : v; page.value = 1; }
    const moreId = ref('');
    function toggleMore(id) { moreId.value = moreId.value === id ? '' : id; }
    function closeMore() { moreId.value = ''; }

    /* ---- 移动端（<768px）：搜索常驻 + 高级筛选折叠面板 ---- */
    const mFiltersOpen = ref(false);
    function mToggleFilters() { mFiltersOpen.value = !mFiltersOpen.value; }
    const mActiveCount = computed(() => {
      let n = 0;
      for (const k of ['source', 'stage', 'potential', 'willing', 'category', 'owner', 'talentStatus', 'talentLevel']) if (filters[k]) n++;
      if (quick.value) n++;
      return n;
    });

    /* ---- V0.2 合并：看板视图（原「线索管理」页并入，读同一份 list，不再两套数据）---- */
    const view = ref('list'); // 'list' 表格 | 'board' 看板 | 'master' 管理员总表
    function setView(v) { view.value = v; }
    const VIEWS = computed(() => isAdmin.value
      ? [{ key: 'list', label: '列表' }, { key: 'board', label: '看板' }, { key: 'master', label: '总表' }]
      : [{ key: 'list', label: '列表' }, { key: 'board', label: '看板' }]);
    const boardList = st => filtered.value.filter(r => r.stage === st);
    /* 看板上拖动阶段：本地立即生效，能映射到后端状态的顺便落库（best-effort） */
    const TL_TO_MVP = { '新线索': '新线索', '待初筛': '已报名', '已联系': '已联系', '有意向': '有意向', '已交接': '已成为达人', '无效线索': '已流失' };
    function setStage(r, s) {
      if (r.stage === s) return;
      r.stage = s; r.lastFollow = nowStr();
      const mvp = TL_TO_MVP[s];
      if (mvp && !String(r.id || '').startsWith('CL')) {
        fetch('/api/mvp/leads/' + encodeURIComponent(r.id), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: mvp }) }).catch(() => { });
      }
    }

    const filtered = computed(() => visibleList.value.filter(r => {
      const f = appliedFilters;
      if (f.name && !r.name.includes(f.name)) return false;
      if (f.source && r.source !== f.source) return false;
      if (f.stage && r.stage !== f.stage) return false;
      if (f.potential && r.potential !== f.potential) return false;
      if (f.willing && r.willing !== f.willing) return false;
      if (f.category && r.category !== f.category) return false;
      if (f.talentStatus && (r.talentStatus || 'lead') !== f.talentStatus) return false;
      if (f.talentLevel && (r.talentLevel || 'C') !== f.talentLevel) return false;
      if (f.owner && r.owner !== f.owner) return false;
      if (f.position && posOf(r) !== f.position) return false;
      if (f.unassigned && !isPublicLead(r)) return false;
      if (f.overdue && !(r.nextFollow && r.nextFollow.slice(0, 10) < TODAY && r.stage !== '已交接')) return false;
      if (f.handover && r.handoverStatus !== 'pending') return false;
      /* V0.2 快捷筛选 */
      if (quick.value === 'today' && !(r.nextFollow && r.nextFollow.slice(0, 10) === TODAY && r.stage !== '已交接')) return false;
      if (quick.value === 'overdue' && !(r.nextFollow && r.nextFollow.slice(0, 10) < TODAY && r.stage !== '已交接')) return false;
      if (quick.value === 'hot' && !(r.potential === '高' && r.willing === '强')) return false;
      if (quick.value === 'handover' && r.handoverStatus !== 'pending' && r.stage !== '待交接') return false;
      // 待转正式达人：已报名待审核（合作意向已确认），招募的最后一个动作就是转正式
      if (quick.value === 'toconvert' && r.stage !== '已报名') return false;
      // SLA：首次联系时限。待升级 = 已超时（主管要催办/重新分配）；即将超时 = 已进入提醒档
      if (quick.value === 'slaover' && r.slaStatus !== 'overdue') return false;
      if (quick.value === 'slaremind' && !(r.slaStatus === 'remind' || r.slaStatus === 'overdue')) return false;
      return true;
    }));
    const total = computed(() => filtered.value.length);
    const pagedList = computed(() => {
      const start = (page.value - 1) * pageSize.value;
      return filtered.value.slice(start, start + pageSize.value);
    });

    function doSearch() { Object.assign(appliedFilters, filters); page.value = 1; }
    function doReset() { Object.assign(filters, BLANK_FILTERS); Object.assign(appliedFilters, filters); quick.value = ''; checked.splice(0, checked.length); page.value = 1; }
    function onPageChange(p) { page.value = p; }

    /* ============================================================
     * 分配（管理员把线索指派给负责人）—— 与「交接」严格区分
     *   分配：线索还没进入处理（新线索 / 公海），管理员直接指派，立即生效
     *        接口 POST /api/mvp/leads/:id/assign、POST /api/mvp/leads/batch-assign
     *   交接：线索已在处理中，需要转给其他岗位，接收人确认后才生效（见 saveHandover）
     * 两个动作都写操作日志，但流程与语义不同，所以做成了两套。
     * ============================================================ */
    const checked = reactive([]);              // 勾选的线索 id（批量分配用）
    const isChecked = id => checked.includes(id);
    function toggleCheck(id) {
      const i = checked.indexOf(id);
      if (i >= 0) checked.splice(i, 1); else checked.push(id);
    }
    function toggleCheckAll() {
      const ids = pagedList.value.map(r => r.id);
      const allOn = ids.length > 0 && ids.every(id => checked.includes(id));
      if (allOn) {
        for (const id of ids) { const i = checked.indexOf(id); if (i >= 0) checked.splice(i, 1); }
      } else {
        for (const id of ids) if (!checked.includes(id)) checked.push(id);
      }
    }
    const allPagedChecked = computed(() => {
      const ids = pagedList.value.map(r => r.id);
      return ids.length > 0 && ids.every(id => checked.includes(id));
    });
    function clearChecked() { checked.splice(0, checked.length); }
    // 负责人候选：来自账号库（登录账号 + 姓名 + 岗位）。
    // 岗位职责边界：达人只能给 招募 / 运营 岗 —— 推广管投放、寄拍只执行任务、财务管结算
    // 分配弹窗展示 ops 当前在管数量（2026-09-19c）：复用 auto-assign-suggest 的负载统计（仅主管可调，非主管 403 静默）
    const opsLoads = ref({});
    async function loadOpsLoads() {
      try {
        const r = await fetch('/api/mvp/leads/auto-assign-suggest');
        const j = await r.json();
        if (j && j.ok) {
          const m = {};
          for (const c of (j.data.candidates || [])) m[c.name] = c.load;
          opsLoads.value = m;
        }
      } catch (e) { /* 非主管或网络异常：弹窗只不显示在管数，不影响分配 */ }
    }
    const ownerOptions = computed(() => targets.value
      .filter(t => ['recruit', 'ops'].includes(t.position || ''))
      .map(t => (t.position === 'ops' && opsLoads.value[t.name] !== undefined)
        ? Object.assign({}, t, { load: opsLoads.value[t.name] }) : t));

    const assignDlg = reactive({ show: false, mode: 'single', ids: [], busy: false, rows: [] });
    const assignForm = reactive({ owner: '', ownerPosition: '', reason: '', remark: '' });
    function openAssign(row, onToast) {
      assignDlg.mode = 'single'; assignDlg.ids = [row.id];
      // 带上行数据：达人档案页（talent-pool）打开时行不在线索列表里，弹窗仍能显示名字/当前负责人
      assignDlg.rows = [{ id: row.id, name: row.name, owner: row.owner }];
      assignForm.owner = ''; assignForm.ownerPosition = ''; assignForm.reason = ''; assignForm.remark = '';
      loadTargets(row.owner === '未分配' ? '' : row.owner);
      loadOpsLoads();
      assignDlg.show = true;
      if (!row) onToast && onToast('未找到线索');
    }
    /* ---- SLA 主管动作（超时线索）：重新分配复用分配弹窗（mode='reassign'，多一个原因必填） ---- */
    function openReassign(row, onToast) {
      if (!row || !row.id) { onToast && onToast('未找到线索'); return; }
      assignDlg.mode = 'reassign'; assignDlg.ids = [row.id];
      assignDlg.rows = [{ id: row.id, name: row.name, owner: row.owner }];
      assignForm.owner = ''; assignForm.ownerPosition = '';
      assignForm.reason = row.slaStatus === 'overdue'
        ? '分配后 ' + (row.slaUsedMin || 0) + ' 分钟未首次联系（时限 ' + (row.slaOverdueMin || 0) + ' 分钟）'
        : '';
      loadTargets(row.owner === '未分配' ? '' : row.owner, 'recruit,ops');   // 达人负责人只能是招募/运营
      loadOpsLoads();
      assignDlg.show = true;
    }
    function openBatchAssign(onToast) {
      if (!checked.length) { onToast && onToast('请先勾选要分配的线索'); return; }
      assignDlg.mode = 'batch'; assignDlg.ids = checked.slice();
      assignDlg.rows = checked.map(id => { const x = list.find(v => v.id === id); return { id, name: (x && x.name) || id, owner: (x && x.owner) || '' }; });
      assignForm.owner = ''; assignForm.ownerPosition = ''; assignForm.reason = ''; assignForm.remark = '';
      loadTargets('');
      assignDlg.show = true;
    }
    function pickAssignOwner(name) {
      const t = targets.value.find(x => x.name === name);
      assignForm.owner = name;
      assignForm.ownerPosition = t ? (t.position || '') : '';
    }
    // 智能推荐（2026-09-19a）：负载最低原则生成推荐负责人 —— 只填表单不直接分配，由高级运营确认后提交
    async function suggestOwner(onToast) {
      try {
        const r2 = await fetch('/api/mvp/leads/auto-assign-suggest');
        const j = await r2.json();
        if (j && j.ok) {
          const rec = j.data.recommend;
          if (!rec) { onToast && onToast('暂无普通运营账号可推荐'); return; }
          assignForm.owner = rec.name;
          assignForm.ownerPosition = 'ops';
          const staleTip = j.data.staleCount ? '；另有 ' + j.data.staleCount + ' 条线索超 ' + j.data.staleMin + ' 分钟未分配' : '';
          onToast && onToast('已按负载最低推荐 ' + rec.name + '（在管 ' + rec.load + ' 条）' + staleTip + '，请确认后分配');
        } else onToast && onToast((j && j.error) || '获取推荐失败');
      } catch (e) { onToast && onToast('网络错误，获取推荐失败'); }
    }
    // 服务端返回的单条线索 → 回写本地行的 SLA 相关字段（不改其它业务字段）
    const SLA_FIELDS = ['assignedAt', 'firstContactAt', 'lastFollowupAt', 'escalatedAt', 'escalatedBy',
      'reassignedAt', 'reassignFrom', 'reassignReason', 'overdueReason', 'overdueReasonAt',
      'urgeCount', 'urgedAt', 'urgeBy', 'urgeNote', 'slaStatus', 'slaUsedMin', 'slaRemainMin', 'slaOverdueMinute',
      'slaDeadline', 'slaLevel', 'slaRuleLabel', 'slaRemindMin', 'slaOverdueMin'];
    function applySlaRow(row) {
      const local = list.find(x => x.id === row.id);
      if (!local) return null;
      for (const k of SLA_FIELDS) local[k] = row[k];
      if (row.owner) { local.owner = row.owner; local.ownerId = row.ownerId || ''; local.ownerPosition = row.ownerPosition || ''; local.ownerPositionLabel = row.ownerPositionLabel || ''; }
      return local;
    }
    async function saveAssign(onToast) {
      const toast = onToast || (() => { });
      if (!assignForm.owner) { toast('请选择负责人'); return; }
      const isReassign = assignDlg.mode === 'reassign';
      if (isReassign && !String(assignForm.reason || '').trim()) { toast('请填写重新分配原因'); return; }
      if (assignDlg.busy) return;
      assignDlg.busy = true;
      try {
        const isBatch = assignDlg.mode === 'batch';
        const url = isReassign
          ? '/api/mvp/leads/' + encodeURIComponent(assignDlg.ids[0]) + '/reassign'
          : (isBatch ? '/api/mvp/leads/batch-assign' : '/api/mvp/leads/' + encodeURIComponent(assignDlg.ids[0]) + '/assign');
        const payload = { owner: assignForm.owner, ownerPosition: assignForm.ownerPosition };
        if (isBatch) payload.ids = assignDlg.ids;
        if (isReassign) payload.reason = String(assignForm.reason).trim();
        else payload.remark = String(assignForm.remark || '').trim();   // 备注 → 独立分配记录 talentAssignments
        const j = await (await fetch(url, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        })).json();
        if (!j || !j.ok) throw new Error((j && j.error) || '分配失败');
        if (isReassign) {
          applySlaRow(j.data);
          assignDlg.show = false;
          closeMore();
          loadInbox();
          toast('已重新分配给 ' + assignForm.owner + '，SLA 已重新计时');
          return;
        }
        // 只合并负责人相关字段，避免覆盖本地其它业务字段
        for (const row of (j.data.leads || [])) {
          const local = list.find(x => x.id === row.id);
          if (!local) continue;
          local.owner = row.owner; local.ownerId = row.ownerId || '';
          local.ownerPosition = row.ownerPosition || '';
          local.ownerPositionLabel = row.ownerPositionLabel || '';
          local.assignedAt = row.assignedAt || '';
          local.slaStatus = row.slaStatus || local.slaStatus;
        }
        assignDlg.show = false;
        const n = j.data.assigned, skipped = (j.data.skipped || []).length;
        clearChecked();
        loadInbox();
        toast('已分配给 ' + assignForm.owner + '：' + n + ' 条' + (skipped ? '（跳过 ' + skipped + ' 条）' : ''));
      } catch (e) {
        toast('分配失败：' + (e.message || e));
      } finally {
        assignDlg.busy = false;
      }
    }

    /* ---- SLA 催办 / 填写超时原因：两个动作共用一个小弹窗（mode 区分） ---- */
    const slaDlg = reactive({ show: false, mode: 'urge', row: null, busy: false });
    const slaForm = reactive({ note: '', reason: '' });
    function openUrge(row, onToast) {
      if (!row || !row.id) { onToast && onToast('未找到线索'); return; }
      slaDlg.mode = 'urge'; slaDlg.row = row; slaForm.note = '';
      slaDlg.show = true;
    }
    function openOverdueReason(row, onToast) {
      if (!row || !row.id) { onToast && onToast('未找到线索'); return; }
      slaDlg.mode = 'reason'; slaDlg.row = row;
      slaForm.reason = row.overdueReason || '';
      slaDlg.show = true;
    }
    async function saveSlaAct(onToast) {
      const toast = onToast || (() => { });
      const row = slaDlg.row;
      if (!row || !row.id || slaDlg.busy) return;
      const isUrge = slaDlg.mode === 'urge';
      if (!isUrge && !String(slaForm.reason || '').trim()) { toast('请填写超时原因'); return; }
      slaDlg.busy = true;
      try {
        const url = '/api/mvp/leads/' + encodeURIComponent(row.id) + (isUrge ? '/urge' : '/overdue-reason');
        const body = isUrge ? { note: String(slaForm.note || '').trim() } : { reason: String(slaForm.reason || '').trim() };
        const j = await (await fetch(url, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        })).json();
        if (!j || !j.ok) throw new Error((j && j.error) || '操作失败');
        applySlaRow(j.data);
        slaDlg.show = false;
        closeMore();
        toast(isUrge ? ('已催办 ' + row.owner + '（第 ' + ((j.data && j.data.urgeCount) || 1) + ' 次）') : '超时原因已记录');
      } catch (e) {
        toast((isUrge ? '催办失败：' : '记录失败：') + (e.message || e));
      } finally {
        slaDlg.busy = false;
      }
    }
    /* SLA 展示口径：把派生字段翻译成「能扫一眼就懂」的徽标 */
    function slaInfo(r) {
      const s = r.slaStatus;
      if (s === 'overdue') return { text: '已超时 ' + (r.slaOverdueMinute || 0) + ' 分', short: '超时', cls: 'bg-rose-50 text-rose-600 border-rose-200' };
      if (s === 'remind') return { text: '剩 ' + r.slaRemainMin + ' 分', short: '即将超时', cls: 'bg-amber-50 text-amber-600 border-amber-200' };
      if (s === 'done') return { text: '已联系 · 用 ' + r.slaUsedMin + ' 分', short: '已联系', cls: 'bg-emerald-50 text-emerald-600 border-emerald-200' };
      if (s === 'normal') return { text: '剩 ' + r.slaRemainMin + ' 分', short: '计时中', cls: 'bg-slate-50 text-slate-500 border-slate-200' };
      if (s === 'exempt') return { text: '历史线索', short: '—', cls: 'bg-slate-50 text-slate-400 border-slate-200' };
      return { text: '不适用', short: '—', cls: 'bg-slate-50 text-slate-400 border-slate-200' };
    }
    const slaActive = r => r.slaStatus === 'overdue' || r.slaStatus === 'remind';

    /* 弹窗状态 */
    const dlg = reactive({
      show: { detail: false, edit: false, follow: false, classify: false, handover: false, create: false, delete: false },
      current: null,
      busy: false, // 删除请求进行中，防止连点
    });

    /* 表单：用一个对象复用，避免堆太多 ref */
    const forms = reactive({
      edit: blankEditForm(),
      follow: blankFollowForm(),
      classify: blankClassifyForm(),
      handover: blankHandoverForm(),
      create: blankCreateForm(),
    });

    function blankEditForm() { return { name: '', source: '', stage: '', potential: '', willing: '', category: '', coopPath: '', owner: '', nextFollow: '', note: '', talentStatus: 'lead', talentLevel: '待判断' }; }
    // 跟进弹窗：覆盖「跟进方式 / 结果 / 内容 / 阶段 / 意愿 / 潜力 / 下次跟进 / 备注」八个字段
    function blankFollowForm() { return { method: '微信', result: '', content: '', stage: '', potential: '', willing: '', nextFollow: '', note: '', nextAction: '' }; }
    function blankClassifyForm() { return { potential: '', willing: '', category: '', coopPath: '', incubationFee: 0, feeStatus: '未收' }; }
    function blankHandoverForm() { return { toUser: '', toPosition: '', reason: '', situation: '', accountState: '', coopWay: '', contentDirection: '', risk: '', nextSuggest: '', note: '' }; }
    function blankCreateForm() { return { name: '', contact: '', source: '校园墙', owner: '李婷', note: '' }; }

    function openDetail(row) {
      dlg.current = row;
      dlg.show.detail = true;
      loadHistory(row);
      loadFollowups(row);
    }
    function openEdit(row) {
      dlg.current = row;
      Object.assign(forms.edit, { name: row.name, source: row.source, stage: row.stage, potential: row.potential, willing: row.willing, category: row.category, coopPath: row.coopPath, owner: row.owner, nextFollow: row.nextFollow, note: row.note, talentStatus: row.talentStatus || 'lead', talentLevel: row.talentLevel || '待判断' });
      dlg.show.edit = true;
    }
    function openFollow(row) {
      dlg.current = row;
      Object.assign(forms.follow, blankFollowForm(), {
        nextFollow: row.nextFollow || '',
        stage: row.stage || '',
        potential: row.potential || '',
        willing: row.willing || '',
      });
      dlg.show.follow = true;
    }
    function openClassify(row) {
      dlg.current = row;
      Object.assign(forms.classify, { potential: row.potential, willing: row.willing, category: row.category, coopPath: row.coopPath, incubationFee: row.incubationFee || 0, feeStatus: row.feeStatus || '未收' });
      dlg.show.classify = true;
    }
    /* ---- 交接流程（真实接口）：发起 → 接收人确认 → 负责人自动变更，全程留痕 ----
       交接单独立，接收人必须是已存在的账号（下拉带出姓名与岗位） */
    const targets = ref([]);
    const inbox = ref([]); // 待我确认的交接单
    function loadTargets(exclude, positions) {
      // positions：按岗位过滤候选人。达人交接只给 招募/运营；默认不过滤（兼容任务执行人等场景）
      const ps = positions ? '&positions=' + encodeURIComponent(positions) : '';
      return fetch('/api/mvp/handover-targets?exclude=' + encodeURIComponent(exclude || '') + ps).then(r => r.json())
        .then(j => { targets.value = (j && j.ok && Array.isArray(j.data)) ? j.data : []; })
        .catch(() => { targets.value = []; });
    }
    /* ---- 转为正式达人：线索负责人发起（管理员可代操作），服务端把记录迁入达人库并固化转化人 ---- */
    async function convertTalent(row, onToast) {
      const toast = onToast || (() => { });
      if (!row || !row.id) { toast('未找到线索'); return; }
      if (!confirm('确认把「' + row.name + '」转为正式达人？\n转化后该线索将从线索池移入达人档案，并记录你为转化人。')) return;
      try {
        const j = await (await fetch('/api/mvp/leads/' + encodeURIComponent(row.id) + '/convert', { method: 'POST' })).json();
        if (!j || !j.ok) throw new Error((j && j.error) || '转化失败');
        const i = list.findIndex(x => x.id === row.id);
        if (i >= 0) list.splice(i, 1);
        loadInbox();
        toast('「' + row.name + '」已转入达人档案（转化人：' + (j.data.convertedBy || '我') + '）');
      } catch (err) { toast('转化失败：' + (err.message || err)); }
    }
    function loadInbox() {
      return fetch('/api/mvp/handovers?box=inbox').then(r => r.json())
        .then(j => { inbox.value = (j && j.ok && Array.isArray(j.data)) ? j.data : []; })
        .catch(() => { inbox.value = []; });
    }
    loadInbox();
    function openHandover(row) {
      dlg.current = row;
      Object.assign(forms.handover, blankHandoverForm());
      loadTargets(row.owner, 'recruit,ops');   // 达人只能交接给 招募/运营 岗
      dlg.show.handover = true;
    }
    function pickTarget(name) {
      const t = targets.value.find(x => x.name === name);
      forms.handover.toPosition = t ? (t.position || '') : '';
    }
    const scopePending = computed(() => list.filter(r => r.handoverStatus === 'pending'));
    function hoLabel(r) { return r.handoverStatus === 'pending' ? ('待 ' + r.handoverTo + ' 确认') : ''; }
    function hoTone(r) { return r.handoverStatus === 'pending' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'; }
    // 交接 / 分配 / 跟进后重新拉取服务端状态，保证本地与库一致
    function refreshFromDb() {
      return fetch('/api/mvp/leads').then(r => r.json()).then(j => {
        if (!j || !j.ok || !Array.isArray(j.data)) return;
        for (const t of j.data) {
          const row = list.find(x => x.id === t.id);
          if (!row) continue;
          Object.assign(row, {
            owner: t.owner, ownerId: t.ownerId || '',
            ownerPosition: t.ownerPosition, ownerPositionLabel: t.ownerPositionLabel || '',
            recruitBy: t.recruitBy || '',
        opsBy: t.opsBy || '', opsId: t.opsId || '', opsAt: t.opsAt || '',
            assignedAt: t.assignedAt || '',
            handoverStatus: t.handoverStatus, handoverTo: t.handoverTo,
            handoverToId: t.handoverToId || '',
            handoverToPosition: t.handoverToPosition, handoverToPositionLabel: t.handoverToPositionLabel,
            handoverFrom: t.handoverFrom || '', handoverReason: t.handoverReason || '',
            nextFollow: String(t.nextFollow || ''), lastFollow: String(t.lastFollow || ''),
            potential: t.potentialLevel || row.potential, willing: t.intentLevel || row.willing,
            category: t.talentClass || row.category,
          });
        }
      }).catch(() => { });
    }
    function resolveHandover(ho, action, onToast) {
      const label = { confirm: '接收', reject: '驳回', cancel: '撤回' }[action] || action;
      return fetch('/api/mvp/handovers/' + encodeURIComponent(ho.id) + '/' + action, { method: 'POST' })
        .then(x => x.json()).then(j => {
          if (!j || !j.ok) throw new Error((j && j.error) || (label + '失败'));
          const row = list.find(x => x.id === ho.talentId);
          if (row && action === 'confirm') {
            // 确认接收：负责人与我方岗位立即切换（服务端为准，这里做乐观更新）
            row.owner = ho.toUser; row.ownerId = ho.toUserId || '';
            row.ownerPosition = ho.toPosition;
            row.ownerPositionLabel = ho.toPositionLabel;
            row.handoverStatus = 'confirmed'; row.handoverReceivedAt = nowStr();
          } else if (row) {
            row.handoverStatus = (action === 'reject') ? 'rejected' : 'cancelled';
          }
          inbox.value = inbox.value.filter(x => x.id !== ho.id);
          refreshFromDb();
          onToast && onToast('已' + label + '：' + ho.talentName);
        }).catch(e => { onToast && onToast(label + '失败：' + (e.message || e)); });
    }
    const confirmHandover = (ho, onToast) => resolveHandover(ho, 'confirm', onToast);
    const rejectHandover = (ho, onToast) => resolveHandover(ho, 'reject', onToast);
    const cancelHandover = (ho, onToast) => resolveHandover(ho, 'cancel', onToast);
    /* ---- 流转历史（读 /api/mvp/leads/:id/history，含交接 / 状态 / 负责人变化）---- */
    const history = ref({ rows: [], name: '', loading: false });
    function loadHistory(row) {
      history.value = { rows: [], name: row.name, loading: true };
      fetch('/api/mvp/leads/' + encodeURIComponent(row.id) + '/history').then(r => r.json())
        .then(j => { history.value = { rows: (j && j.ok && j.data && j.data.rows) ? j.data.rows : [], name: row.name, loading: false }; })
        .catch(() => { history.value = { rows: [], name: row.name, loading: false }; });
    }
    /* ---- 跟进记录（读 /api/mvp/leads/:id/follow-ups，详情弹窗展示）---- */
    const followHistory = ref({ rows: [], loading: false });
    function loadFollowups(row) {
      if (String(row.id || '').startsWith('CL')) { followHistory.value = { rows: [], loading: false }; return; }
      followHistory.value = { rows: [], loading: true };
      fetch('/api/mvp/leads/' + encodeURIComponent(row.id) + '/follow-ups').then(r => r.json())
        .then(j => { followHistory.value = { rows: (j && j.ok && Array.isArray(j.data)) ? j.data : [], loading: false }; })
        .catch(() => { followHistory.value = { rows: [], loading: false }; });
    }
    function openCreate() { Object.assign(forms.create, blankCreateForm()); dlg.show.create = true; }

    function openDelete(row) { dlg.current = row; dlg.show.delete = true; }
    /* 删除线索：数据库行（T 编号）调后端接口真删；本地演示/导入的 CL 行只删本地列表 */
    function doDelete(onToast) {
      const r = dlg.current; if (!r || dlg.busy) return;
      const isDbRow = /^T\d+/.test(String(r.id));
      const finish = () => {
        const idx = list.findIndex(x => x.id === r.id);
        if (idx !== -1) list.splice(idx, 1);
        closeAll();
        dlg.busy = false;
        onToast && onToast('已删除线索：' + r.name);
      };
      if (!isDbRow) { finish(); return; }
      dlg.busy = true;
      fetch('/api/mvp/leads/' + r.id, { method: 'DELETE' }).then(x => x.json()).then(j => {
        if (!j || j.ok === false) throw new Error((j && j.error) || '删除失败');
        finish();
      }).catch(err => {
        dlg.busy = false;
        onToast && onToast('删除失败：' + (err.message || err));
      });
    }

    function closeAll() { for (const k in dlg.show) dlg.show[k] = false; dlg.current = null; }

    /* 保存：mock 阶段直接写回列表，并给出 Toast 回调 */
    function saveEdit(onToast) {
      const r = dlg.current; if (!r) return;
      const tsChanged = forms.edit.talentStatus && forms.edit.talentStatus !== (r.talentStatus || 'lead');
      const lvChanged = forms.edit.talentLevel && forms.edit.talentLevel !== (r.talentLevel || 'C');
      Object.assign(r, forms.edit);
      // 生命周期（talent_status）+ 达人评级（talentLevel）落库：走同一接口，线索池 / 达人库都兼容
      //（其余字段维持原有本地保存行为不变，避免影响既有交互）
      if ((tsChanged || lvChanged) && !String(r.id || '').startsWith('CL')) {
        const patch = {};
        if (tsChanged) patch.talentStatus = forms.edit.talentStatus;
        if (lvChanged) patch.talentLevel = forms.edit.talentLevel;
        fetch('/api/mvp/talent-meta/' + encodeURIComponent(r.id), {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        }).then(x => x.json()).then(j => {
          if (j && j.ok && j.data) {
            if (j.data.talentStatus) r.talentStatus = j.data.talentStatus;
            if (j.data.talentLevel) r.talentLevel = j.data.talentLevel;
          } else if (onToast && j && j.error) onToast('保存失败：' + j.error);
        }).catch(() => {});
      }
      closeAll();
      onToast && onToast('已保存：' + r.name);
    }
    /* 提交跟进：落库后「最近跟进时间 / 下次跟进时间 / 阶段 / 潜力 / 意愿」一起更新，
       工作台待办由服务端按这些字段重新推导，所以提交后要刷新工作台与会话内的行数据。 */
    function saveFollow(onToast) {
      const r = dlg.current; if (!r) return;
      if (dlg.busy) return;
      const f = forms.follow;
      if (!f.content && !f.result) { onToast && onToast('请填写跟进结果或跟进内容'); return; }
      const applyLocal = () => {
        Object.assign(r, {
          lastFollow: nowStr(),
          nextFollow: f.nextFollow || r.nextFollow,
          stage: f.stage || r.stage,
          potential: f.potential || r.potential,
          willing: f.willing || r.willing,
        });
        if (f.note) r.note = f.note;
      };
      // 本地演示记录（CL 开头）不落库
      if (String(r.id || '').startsWith('CL')) {
        applyLocal(); closeAll();
        onToast && onToast('演示数据：跟进已记录（未落库）');
        return;
      }
      dlg.busy = true;
      fetch('/api/mvp/leads/' + encodeURIComponent(r.id) + '/follow-ups', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: f.method, result: f.result, content: f.content,
          stage: f.stage,
          // 判断字段分层（2026-09-18）：只有运营/高级运营随跟进写判断字段，招募岗提交时忽略（服务端同步剥离）
          potentialLevel: canJudge.value ? f.potential : undefined,
          intentLevel: canJudge.value ? f.willing : undefined,
          nextFollowAt: f.nextFollow, note: f.note || undefined,
          nextAction: f.nextAction || undefined,          // 写进跟进时间轴 + 达人档案「下一步动作」
        }),
      }).then(x => x.json()).then(j => {
        dlg.busy = false;
        if (!j || !j.ok) throw new Error((j && j.error) || '跟进提交失败');
        const lead = j.data.lead || {};
        Object.assign(r, {
          lastFollow: lead.lastFollow || nowStr(),
          nextFollow: lead.nextFollow || r.nextFollow,
          stage: f.stage || r.stage,
          potential: lead.potentialLevel || r.potential,
          willing: lead.intentLevel || r.willing,
        });
        if (f.note) r.note = f.note;
        closeAll();
        onToast && onToast('跟进已记录，待办已重新计算');
      }).catch(e => {
        dlg.busy = false;
        closeAll();
        onToast && onToast('跟进失败：' + (e.message || e));
      });
    }
    /* 分类结果落库：老报名数据（达人库真实记录）写回后端；本地 mock 记录静默跳过 */
    function persistLead(r, patch, onToast) {
      if (String(r.id || '').startsWith('CL')) return; // 本地新建的演示记录不落库
      fetch('/api/mvp/leads/' + encodeURIComponent(r.id), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) })
        .then(res => res.json())
        .then(j => { if (j && j.ok && onToast) onToast('已保存到数据库'); })
        .catch(() => { /* 接口不可用时保留本地状态 */ });
    }

    function saveClassify(onToast) {
      const r = dlg.current; if (!r) return;
      if (!canJudge.value) { onToast && onToast('分类只能由运营/高级运营修改'); return; }
      Object.assign(r, forms.classify);
      r.incubationFee = Number(forms.classify.incubationFee) || 0;
      if (r.coopPath !== '付费孵化') { r.incubationFee = 0; r.feeStatus = '未收'; }
      persistLead(r, { coopPath: r.coopPath, incubationFee: r.incubationFee, feeStatus: r.feeStatus }, onToast);
      closeAll();
      onToast && onToast('分类已更新');
    }
    /* 发起交接：写交接单（pending），等接收人确认后才真正变更负责人 */
    function saveHandover(onToast) {
      const r = dlg.current; if (!r || dlg.busy) return;
      if (!forms.handover.toUser) { onToast && onToast('请选择接收人'); return; }
      if (String(r.id || '').startsWith('CL')) {
        r.owner = forms.handover.toUser;
        r.ownerPosition = forms.handover.toPosition;
        closeAll();
        onToast && onToast('演示数据已本地交接给：' + forms.handover.toUser);
        return;
      }
      dlg.busy = true;
      const f = forms.handover;
      fetch('/api/mvp/handovers', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ talentId: r.id, toUser: f.toUser, toPosition: f.toPosition, reason: f.reason,
          situation: f.situation, accountState: f.accountState, coopWay: f.coopWay,
          contentDirection: f.contentDirection, risk: f.risk, nextSuggest: f.nextSuggest, note: f.note }),
      }).then(x => x.json()).then(j => {
        dlg.busy = false;
        if (!j || !j.ok) throw new Error((j && j.error) || '发起失败');
        const ho = j.data || {};
        r.handoverStatus = 'pending'; r.handoverTo = ho.toUser || forms.handover.toUser;
        r.handoverToPosition = ho.toPosition || forms.handover.toPosition;
        r.handoverToPositionLabel = ho.toPositionLabel || '';
        closeAll();
        onToast && onToast('已发起交接，等待 ' + r.handoverTo + ' 确认');
      }).catch(e => { dlg.busy = false; onToast && onToast('发起失败：' + (e.message || e)); });
    }
    function saveCreate(onToast) {
      if (!forms.create.name) { onToast && onToast('请填写达人昵称'); return; }
      const rec = {
        id: 'CL' + String(list.length + 1).padStart(3, '0'),
        name: forms.create.name, contact: forms.create.contact || '未填写', source: forms.create.source,
        hasMedia: false, platforms: ['无'], fans: 0, hasExp: false, coopCategories: '无', wantCategories: '待沟通',
        appearWay: '待定', stage: '新线索', potential: '待判断', willing: '待判断', category: '待分类', coopPath: '待判断',
        owner: forms.create.owner, lastFollow: nowStr(), nextFollow: '', note: forms.create.note || '',
      };
      list.unshift(rec);
      closeAll();
      onToast && onToast('线索已创建：' + rec.name);
    }

    /* ---------------- Excel 导入 ---------------- */
    // xlsx 按需加载：库体积 861KB，只在真正导入 Excel 时才下载
    function loadXlsxOnce() {
      if (typeof XLSX !== 'undefined') return Promise.resolve();
      if (window.__xlsxLoading) return window.__xlsxLoading;
      window.__xlsxLoading = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = './vendor/xlsx.full.min.js';
        s.onload = resolve;
        s.onerror = () => { window.__xlsxLoading = null; reject(new Error('加载失败')); };
        document.head.appendChild(s);
      });
      return window.__xlsxLoading;
    }
    // 标准模板：中文表头 → 系统字段映射（表头原样保留，不做归一化）
    const EXCEL_FIELD_MAP = {
      '达人昵称': 'name', '昵称': 'name', '姓名': 'name',
      '联系方式': 'contact', '微信': 'contact', '手机号': 'contact', '电话': 'contact',
      '来源渠道': 'source', '渠道': 'source', '来源': 'source',
      '是否有自媒体经验': 'hasMedia', '自媒体经验': 'hasMedia',
      '平台': 'platforms', '自媒体平台': 'platforms',
      '粉丝量': 'fans', '粉丝数': 'fans',
      '是否有寄拍/商单经验': 'hasExp', '寄拍经验': 'hasExp', '商单经验': 'hasExp',
      '合作品类': 'coopCategories', '想做品类': 'wantCategories',
      '出镜方式': 'appearWay',
      '当前阶段': 'stage', '阶段': 'stage',
      '达人潜力': 'potential', '潜力': 'potential',
      '合作意愿': 'willing', '意愿': 'willing',
      '达人分类': 'category', '分类': 'category',
      '合作路径': 'coopPath', '路径': 'coopPath',
      '孵化服务费': 'incubationFee', '服务费': 'incubationFee', '服务费金额': 'incubationFee',
      '收款状态': 'feeStatus', '服务费状态': 'feeStatus',
      '当前负责人': 'owner', '负责人': 'owner',
      '下次跟进时间': 'nextFollow', '下次跟进': 'nextFollow',
      '备注': 'note',
    };
    // 金数据导出表头含「第 N 题」编号与标点，先精确匹配，再按关键词模糊匹配
    function mapHeader(h) {
      if (EXCEL_FIELD_MAP[h]) return EXCEL_FIELD_MAP[h];
      const s = String(h).replace(/第\s*\d+(?:-\d+)?\s*题/g, '').replace(/[\s？?：:，,]/g, '');
      const rules = [
        [/怎么称呼/, 'name'], [/在做自媒体|内容账号/, 'hasMedia'], [/平台/, 'platforms'], [/粉丝/, 'fans'],
        [/接过寄拍或者商单|寄拍或者商单/, 'hasExp'], [/类型的合作/, 'coopCategories'],
        [/想接哪些类型|类型的寄拍/, 'wantCategories'], [/出镜方式/, 'appearWay'],
        [/最想了解/, 'q9'], [/联系方式/, 'contact'], [/提交时间/, 'lastFollow'],
        [/主要账号主页/, 'profileImg'], [/拍摄作品/, 'worksImg'],
      ];
      for (const [re, field] of rules) if (re.test(s)) return field;
      return '';
    }
    const DEFAULT_STAGE = '新线索';

    // 选项值解析：兼容金数据的答案文案（如「有，目前正在做」「暂时没接过」「1万～5万」）
    function parseHasMedia(v) {
      const s = String(v || '').trim();
      if (!s) return false;
      if (s.includes('正在做') || s.includes('做过')) return true;
      if (s.includes('没有') || s.includes('还没')) return false;
      return ['是', '有', 'true', '1', 'yes'].includes(s.toLowerCase()) || s.startsWith('有') || s.startsWith('是');
    }
    function parseHasExp(v) {
      const s = String(v || '').trim();
      if (!s) return false;
      if (s.includes('没接过') || s.includes('没有接过')) return false;
      if (s.includes('接过') || s.includes('有')) return true;
      return ['是', 'true', '1', 'yes'].includes(s.toLowerCase());
    }
    function parseFans(v) {
      const s = String(v || '').trim().replace(/,/g, '');
      if (!s) return 0;
      const n = Number(s);
      if (!isNaN(n) && n > 0) return Math.round(n);
      const t = s.replace(/~/g, '～');
      const RANGES = { '0～500': 250, '500～1000': 750, '1000～5000': 3000, '5000～1万': 7500, '1万～5万': 30000, '5万以上': 50000 };
      if (RANGES[t]) return RANGES[t];
      const m = t.match(/([\d.]+)\s*万/);
      return m ? Math.round(Number(m[1]) * 10000) : 0;
    }

    const imp = reactive({ show: false, fileName: '', headers: [], rows: [], preview: [], fieldMap: [], matched: 0, done: false, doneCount: 0 });

    function openImport() {
      Object.assign(imp, { show: true, fileName: '', headers: [], rows: [], preview: [], fieldMap: [], matched: 0, done: false, doneCount: 0 });
      loadXlsxOnce().catch(() => { /* 打开弹窗时预加载；真正解析失败会在 handleExcelFile 里提示 */ });
    }
    function closeImport() { imp.show = false; }

    function cellToStr(v) {
      if (v === null || v === undefined) return '';
      if (v instanceof Date) { const p2 = n => String(n).padStart(2, '0'); return `${v.getFullYear()}-${p2(v.getMonth() + 1)}-${p2(v.getDate())}`; }
      if (typeof v === 'object') {
        if (v.richText) return v.richText.map(t => t.text || '').join('');
        if (v.text) return String(v.text);
        if (v.result !== undefined) return String(v.result);
      }
      return String(v).trim();
    }

    async function handleExcelFile(e, onToast) {
      const file = e.target.files[0];
      e.target.value = ''; // 立即清空，允许失败后重选同一文件
      if (!file) return;
      if (typeof XLSX === 'undefined') {
        onToast && onToast('正在加载 Excel 组件…');
        try { await loadXlsxOnce(); } catch (err) { onToast && onToast('Excel 组件加载失败，请检查网络后重试'); return; }
      }
      try {
        const buf = await file.arrayBuffer();
        const u8 = new Uint8Array(buf);
        let wb;
        if (u8[0] === 0x50 && u8[1] === 0x4B) {
          // xlsx（ZIP 格式，PK 头）：按二进制解析
          wb = XLSX.read(buf, { type: 'array', cellDates: true });
        } else {
          // CSV/文本：先按 UTF-8 解码，出现乱码再回退 GBK（兼容 Excel 导出的 ANSI CSV）
          let text = new TextDecoder('utf-8').decode(buf);
          if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
          if (text.includes('\uFFFD')) { try { text = new TextDecoder('gbk').decode(buf); } catch (e2) { /* 忽略，沿用 UTF-8 结果 */ } }
          wb = XLSX.read(text, { type: 'string', cellDates: true });
        }
        const ws = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
        if (!json.length) { onToast && onToast('文件内容为空'); return; }
        imp.fileName = file.name;
        imp.headers = json[0].map(h => cellToStr(h));
        const dataRows = json.slice(1).filter(r => r.some(c => String(c).trim() !== ''));
        imp.rows = dataRows.map(r => imp.headers.map((_, i) => cellToStr(r[i])));
        // 字段映射：先精确匹配表头，再按关键词模糊匹配（支持金数据导出格式）
        imp.fieldMap = imp.headers.map(mapHeader);
        imp.matched = imp.fieldMap.filter(Boolean).length;
        imp.preview = imp.rows.slice(0, 5);
        imp.done = false;
        onToast && onToast(`识别 ${imp.rows.length} 行，${imp.matched} 个字段匹配`);
      } catch (err) {
        onToast && onToast('解析失败：' + err.message);
      }
      e.target.value = '';
    }

    function confirmExcelImport(onToast) {
      let count = 0;
      const map = imp.fieldMap;
      imp.rows.forEach(r => {
        const obj = {};
        r.forEach((v, i) => { if (map[i]) obj[map[i]] = v; });
        if (!obj.name) return; // 昵称为空则跳过
        const hasMedia = parseHasMedia(obj.hasMedia);
        const hasExp = parseHasExp(obj.hasExp);
        let platforms = obj.platforms ? String(obj.platforms).split(/[,，、\/]/).map(s => s.trim()).filter(Boolean) : [];
        if (!platforms.length) platforms = hasMedia ? ['抖音'] : ['无'];
        // 备注 = 原备注 + 第 9 题疑问 + 上传的截图文件名（金数据字段）
        const noteParts = [obj.note, obj.q9 ? '想了解：' + obj.q9 : '',
          obj.profileImg ? '主页：' + obj.profileImg : '', obj.worksImg ? '作品：' + obj.worksImg : ''].filter(Boolean);
        list.unshift({
          id: 'CL' + String(list.length + 1).padStart(3, '0'),
          name: obj.name, contact: obj.contact || '未填写', source: SOURCES.includes(obj.source) ? obj.source : '其他',
          hasMedia, platforms, fans: parseFans(obj.fans), hasExp,
          coopCategories: obj.coopCategories || '无', wantCategories: obj.wantCategories || '待沟通',
          appearWay: obj.appearWay || '待定',
          stage: STAGES.includes(obj.stage) ? obj.stage : DEFAULT_STAGE,
          potential: POTENTIALS.includes(obj.potential) ? obj.potential : '待判断',
          willing: WILLINGS.includes(obj.willing) ? obj.willing : '待判断',
          category: CATEGORIES.includes(obj.category) ? obj.category : '待分类',
          coopPath: PATHS.includes(obj.coopPath) ? obj.coopPath : '待判断',
          incubationFee: obj.coopPath === '付费孵化' ? (Number(obj.incubationFee) || 0) : 0,
          feeStatus: obj.coopPath === '付费孵化' ? (obj.feeStatus === '已收' ? '已收' : '未收') : '未收',
          owner: OWNERS.includes(obj.owner) ? obj.owner : '未分配',
          lastFollow: obj.lastFollow ? String(obj.lastFollow).slice(0, 16) : nowStr(), nextFollow: obj.nextFollow || '',
          note: noteParts.join('；'),
        });
        count++;
      });
      imp.done = true;
      imp.doneCount = count;
      onToast && onToast(`成功导入 ${count} 条达人线索`);
    }

    function downloadExcelTemplate() {
      const headers = ['达人昵称', '联系方式', '来源渠道', '是否有自媒体经验', '平台', '粉丝量', '是否有寄拍/商单经验', '合作品类', '想做品类', '出镜方式', '当前阶段', '达人潜力', '合作意愿', '达人分类', '合作路径', '当前负责人', '下次跟进时间', '备注'];
      const sample = ['林小柚', '微信 xiaoyou_99', '抖音直播', '是', '抖音', '52000', '是', '女装、鞋靴', '美妆、配饰', '真人出镜', '有意向', '高', '强', 'A', '免费签约', '李婷', '2026-09-15 10:00', '直播时主动咨询'];
      const csv = '\uFEFF' + [headers, sample].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = '达人线索导入模板.csv';
      a.click();
    }

    /* ---------------- Excel 导入 V1（上传后端解析预览，不写入飞书） ----------------
       与上方旧的浏览器本地导入（imp / handleExcelFile）并存、互不影响。
       流程：选择 .xlsx → 显示文件名 → POST /api/leads/import/preview → 展示统计与预览表 */
    const IMP_V1_STATUS = {
      valid: { label: '有效', cls: 'bg-emerald-100 text-emerald-700' },
      invalid: { label: '无效', cls: 'bg-rose-100 text-rose-600' },
      duplicate: { label: '重复', cls: 'bg-amber-100 text-amber-700' },
    };
    const impV1 = reactive({ show: false, fileName: '', uploading: false, result: null, errorMsg: '', done: false, doneCount: 0 });
    let v1File = null; // 原生 File 对象不放响应式里，避免代理影响 FormData

    function openImportV1() {
      Object.assign(impV1, { show: true, fileName: '', uploading: false, result: null, errorMsg: '', done: false, doneCount: 0 });
      v1File = null;
    }
    function closeImportV1() {
      if (impV1.uploading) return; // 上传中不允许关闭，避免半截请求
      impV1.show = false;
    }
    function pickImportFileV1(e, onToast) {
      const f = e.target.files[0];
      e.target.value = ''; // 允许重复选择同一文件
      if (!f) return;
      if (!/\.xlsx$/i.test(f.name)) { onToast && onToast('V1 仅支持 .xlsx 文件'); return; }
      if (f.size > 10 * 1024 * 1024) { onToast && onToast('文件不能超过 10MB'); return; }
      v1File = f;
      Object.assign(impV1, { fileName: f.name, result: null, errorMsg: '' });
    }
    async function uploadImportV1(onToast) {
      if (!v1File) { onToast && onToast('请先选择 .xlsx 文件'); return; }
      impV1.uploading = true;
      impV1.errorMsg = '';
      try {
        const fd = new FormData();
        fd.append('file', v1File, v1File.name);
        const resp = await fetch('/api/leads/import/preview', { method: 'POST', body: fd });
        const j = await resp.json().catch(() => null);
        if (!resp.ok || !j || j.ok === false) {
          throw new Error((j && (j.error || j.message)) || ('请求失败 HTTP ' + resp.status));
        }
        impV1.result = j.data;
        onToast && onToast(`上传成功：共 ${j.data.total} 行，有效 ${j.data.valid} / 无效 ${j.data.invalid} / 重复 ${j.data.duplicate}`);
      } catch (err) {
        impV1.errorMsg = err.message || String(err);
        onToast && onToast('上传失败：' + impV1.errorMsg);
      } finally {
        impV1.uploading = false;
      }
    }
    function v1StatusLabel(s) { return (IMP_V1_STATUS[s] || { label: s }).label; }
    function v1StatusClass(s) { return (IMP_V1_STATUS[s] || { cls: 'bg-slate-100 text-slate-500' }).cls; }

    // 确认导入：把解析出的有效行真正写入系统（V1 存储 + 当前线索列表）
    async function confirmImportV1(onToast) {
      if (!v1File) { onToast && onToast('请先选择 .xlsx 文件'); return; }
      if (!impV1.result || !impV1.result.valid) { onToast && onToast('没有可导入的有效数据'); return; }
      impV1.uploading = true;
      impV1.errorMsg = '';
      try {
        const fd = new FormData();
        fd.append('file', v1File, v1File.name);
        const resp = await fetch('/api/leads/import/confirm', { method: 'POST', body: fd });
        const j = await resp.json().catch(() => null);
        if (!resp.ok || !j || j.ok === false) {
          throw new Error((j && (j.error || j.message)) || ('请求失败 HTTP ' + resp.status));
        }
        const d = j.data;
        // 同步插入当前线索列表（默认值与 lead() 工厂一致），导入后立即可见
        (d.leads || []).forEach(l => {
          const nextNo = list.reduce((m, r) => Math.max(m, parseInt(String(r.id).slice(2), 10) || 0), 0) + 1;
          list.unshift(Object.assign({
            id: 'CL' + String(nextNo).padStart(3, '0'), contact: '未填写', source: '其他',
            hasMedia: false, platforms: ['无'], fans: 0, hasExp: false,
            coopCategories: '无', wantCategories: '待沟通', appearWay: '待定',
            stage: '新线索', potential: '待判断', willing: '待判断', category: '待分类',
            coopPath: '待判断', owner: '未分配', nextFollow: '', note: '',
          }, l, { lastFollow: nowStr().slice(0, 16) }));
        });
        impV1.done = true;
        impV1.doneCount = d.inserted;
        onToast && onToast(`确认导入成功：${d.inserted} 条已写入系统${d.skipped_invalid || d.skipped_duplicate ? `（跳过无效 ${d.skipped_invalid || 0} / 重复 ${d.skipped_duplicate || 0}）` : ''}`);
      } catch (err) {
        impV1.errorMsg = err.message || String(err);
        onToast && onToast('导入失败：' + impV1.errorMsg);
      } finally {
        impV1.uploading = false;
      }
    }

    return {
      SOURCES, STAGES, POTENTIALS, WILLINGS, CATEGORIES, PATHS, FOLLOW_METHODS, FOLLOW_RESULTS, OWNERS, PLATFORMS, APPEAR_WAYS,
      tagClass,
      // 列表与筛选
      list, filters, appliedFilters, page, pageSize, filtered, total, pagedList, doSearch, doReset, onPageChange,
      // V0.2：快捷筛选 / 跟进时间状态 / 行内更多菜单
      TODAY, quick, setQuick, nfState, nfClass, moreId, toggleMore, closeMore,
      mFiltersOpen, mToggleFilters, mActiveCount,
      view, setView, boardList, setStage, VIEWS,
      // 岗位可见范围
      isAdmin, myRole, myName, myPosition, scope, effScope, setScope, scopeLabel, visibleList,
      POSITION_LABEL_MAP, posOf, posLabelOf, posStats, isPublicLead,
      // 分配（管理员）：勾选 → 单条 / 批量指派负责人
      checked, isChecked, toggleCheck, toggleCheckAll, allPagedChecked, clearChecked,
      ownerOptions, assignDlg, assignForm, openAssign, openBatchAssign, pickAssignOwner, saveAssign, suggestOwner, convertTalent,
      // SLA 主管动作：催办 / 重新分配 / 超时原因 + 展示口径
      slaDlg, slaForm, openUrge, openOverdueReason, saveSlaAct, openReassign, slaInfo, slaActive,
      isSenior, canJudge, TALENT_STATUS_LIST, TALENT_STATUS_LABEL,
      TALENT_LEVEL_LIST, TALENT_LEVEL_LABEL, levelTone,
      // 交接流程与留痕
      targets, inbox, loadTargets, loadInbox, pickTarget, saveHandover, confirmHandover, rejectHandover, cancelHandover,
      hoLabel, hoTone, scopePending, refreshFromDb, history, loadHistory, followHistory, loadFollowups,
      // 弹窗
      dlg, forms,
      openDetail, openEdit, openFollow, openClassify, openHandover, openCreate, openDelete, doDelete, closeAll,
      saveEdit, saveFollow, saveClassify, saveHandover, saveCreate,
      // Excel 导入（旧：浏览器本地解析）
      imp, openImport, closeImport, handleExcelFile, confirmExcelImport, downloadExcelTemplate,
      // Excel 导入 V1（后端解析预览）
      impV1, openImportV1, closeImportV1, pickImportFileV1, uploadImportV1, confirmImportV1, v1StatusLabel, v1StatusClass,
    };
  }

  function nowStr() {
    const d = new Date(), p2 = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
  }

  global.TalentLeadsModule = { useTalentLeads, SOURCES, STAGES, POTENTIALS, WILLINGS, CATEGORIES, PATHS, FOLLOW_METHODS, OWNERS, PLATFORMS, APPEAR_WAYS, tagClass };
})(window);
