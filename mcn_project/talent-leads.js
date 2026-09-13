/* ============================================================
 * 达人线索管理模块（独立文件，避免主 app.js 膨胀）
 * 依赖：Vue 全局（CDN）。运行后挂载到 window.TalentLeadsModule
 * 仅 mock 数据，不接后端。
 * ============================================================ */
(function (global) {
  const { ref, reactive, computed, reactive: _r } = Vue;

  /* ---------------- 字段字典（与规格一一对应） ---------------- */
  const SOURCES = ['校园墙', '校园代理', '地推', '抖音直播', '抖音私信', 'BOSS', '转介绍', '私域', '其他'];
  const STAGES = ['新线索', '待初筛', '已联系', '有意向', '已分类', '待交接', '已交接'];
  const POTENTIALS = ['待判断', '高', '中', '低'];
  const WILLINGS = ['待判断', '强', '中', '弱'];
  const CATEGORIES = ['待分类', 'A', 'B', 'C', 'D'];
  const PATHS = ['待判断', '免费签约', '付费孵化', '暂不推进'];
  const FOLLOW_METHODS = ['微信', '电话', '面谈', '其他'];
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
    lead('CL001', '鸟', '2026-09-07 09:40', { wantCategories: '衣服 / 裤子，鞋类', appearWay: '本人出镜，但不露脸', note: '想了解：商单 / 收益相关' }),
    lead('CL002', '11', '2026-09-07 09:44', { wantCategories: '数码产品', appearWay: '都可以，看具体商品要求', note: '想了解：商单 / 收益相关' }),
    lead('CL003', '麒神', '2026-09-07 10:03', { wantCategories: '衣服 / 裤子，鞋类', appearWay: '真人露脸出镜', note: '想了解：其他: 打不打pubg' }),
    lead('CL004', '三温鱼粉', '2026-09-07 10:07', { wantCategories: '衣服 / 裤子，鞋类，美妆护肤', appearWay: '真人露脸出镜，手部 / 局部出镜，都可以，看具体商品要求', note: '想了解：寄拍具体流程，对账号 / 粉丝有没有要求，拍摄有什么要求，作品发布有什么要求，寄拍是否需要费用，商单 / 收益相关' }),
    lead('CL005', '爸爸', '2026-09-07 10:18', { hasMedia: true, platforms: ['抖音'], fans: 50000, wantCategories: '手表 / 饰品，包包，衣服 / 裤子，鞋类，美妆护肤，数码产品，家居 / 日用品，其他', appearWay: '真人露脸出镜，本人出镜，但不露脸，手部 / 局部出镜，只拍产品，不本人出镜，都可以，看具体商品要求', note: '想了解：寄拍具体流程，对账号 / 粉丝有没有要求，商品怎么选择，拍摄有什么要求，作品发布有什么要求，寄拍是否需要费用，商单 / 收益相关，其他' }),
    lead('CL006', '王', '2026-09-07 10:20', { wantCategories: '手表 / 饰品', appearWay: '本人出镜，但不露脸', note: '想了解：寄拍具体流程' }),
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
  function useTalentLeads() {
    const list = reactive(MOCK.map(r => ({ ...r })));
    const filters = reactive({ name: '', source: '', stage: '', potential: '', willing: '', category: '', owner: '' });
    const appliedFilters = reactive({ name: '', source: '', stage: '', potential: '', willing: '', category: '', owner: '' });
    const page = ref(1);
    const pageSize = ref(10);

    const filtered = computed(() => list.filter(r => {
      const f = appliedFilters;
      if (f.name && !r.name.includes(f.name)) return false;
      if (f.source && r.source !== f.source) return false;
      if (f.stage && r.stage !== f.stage) return false;
      if (f.potential && r.potential !== f.potential) return false;
      if (f.willing && r.willing !== f.willing) return false;
      if (f.category && r.category !== f.category) return false;
      if (f.owner && r.owner !== f.owner) return false;
      return true;
    }));
    const total = computed(() => filtered.value.length);
    const pagedList = computed(() => {
      const start = (page.value - 1) * pageSize.value;
      return filtered.value.slice(start, start + pageSize.value);
    });

    function doSearch() { Object.assign(appliedFilters, filters); page.value = 1; }
    function doReset() { Object.assign(filters, { name: '', source: '', stage: '', potential: '', willing: '', category: '', owner: '' }); Object.assign(appliedFilters, filters); page.value = 1; }
    function onPageChange(p) { page.value = p; }

    /* 弹窗状态 */
    const dlg = reactive({
      show: { detail: false, edit: false, follow: false, classify: false, handover: false, create: false },
      current: null,
    });

    /* 表单：用一个对象复用，避免堆太多 ref */
    const forms = reactive({
      edit: blankEditForm(),
      follow: blankFollowForm(),
      classify: blankClassifyForm(),
      handover: blankHandoverForm(),
      create: blankCreateForm(),
    });

    function blankEditForm() { return { name: '', source: '', stage: '', potential: '', willing: '', category: '', coopPath: '', owner: '', nextFollow: '', note: '' }; }
    function blankFollowForm() { return { method: '微信', result: '', note: '', nextFollow: '' }; }
    function blankClassifyForm() { return { potential: '', willing: '', category: '', coopPath: '' }; }
    function blankHandoverForm() { return { from: '', to: '', note: '' }; }
    function blankCreateForm() { return { name: '', contact: '', source: '校园墙', owner: '李婷', note: '' }; }

    function openDetail(row) { dlg.current = row; dlg.show.detail = true; }
    function openEdit(row) {
      dlg.current = row;
      Object.assign(forms.edit, { name: row.name, source: row.source, stage: row.stage, potential: row.potential, willing: row.willing, category: row.category, coopPath: row.coopPath, owner: row.owner, nextFollow: row.nextFollow, note: row.note });
      dlg.show.edit = true;
    }
    function openFollow(row) {
      dlg.current = row;
      Object.assign(forms.follow, blankFollowForm(), { nextFollow: row.nextFollow });
      dlg.show.follow = true;
    }
    function openClassify(row) {
      dlg.current = row;
      Object.assign(forms.classify, { potential: row.potential, willing: row.willing, category: row.category, coopPath: row.coopPath });
      dlg.show.classify = true;
    }
    function openHandover(row) {
      dlg.current = row;
      Object.assign(forms.handover, { from: row.owner, to: '', note: '' });
      dlg.show.handover = true;
    }
    function openCreate() { Object.assign(forms.create, blankCreateForm()); dlg.show.create = true; }

    function closeAll() { for (const k in dlg.show) dlg.show[k] = false; dlg.current = null; }

    /* 保存：mock 阶段直接写回列表，并给出 Toast 回调 */
    function saveEdit(onToast) {
      const r = dlg.current; if (!r) return;
      Object.assign(r, forms.edit);
      closeAll();
      onToast && onToast('已保存：' + r.name);
    }
    function saveFollow(onToast) {
      const r = dlg.current; if (!r) return;
      r.lastFollow = nowStr();
      if (forms.follow.nextFollow) r.nextFollow = forms.follow.nextFollow;
      closeAll();
      onToast && onToast('跟进记录已添加');
    }
    function saveClassify(onToast) {
      const r = dlg.current; if (!r) return;
      Object.assign(r, forms.classify);
      closeAll();
      onToast && onToast('分类已更新');
    }
    function saveHandover(onToast) {
      const r = dlg.current; if (!r) return;
      if (!forms.handover.to) { onToast && onToast('请选择接收负责人'); return; }
      r.owner = forms.handover.to;
      closeAll();
      onToast && onToast('已交接给：' + forms.handover.to);
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

    function openImport() { Object.assign(imp, { show: true, fileName: '', headers: [], rows: [], preview: [], fieldMap: [], matched: 0, done: false, doneCount: 0 }); }
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
      if (!file) return;
      if (typeof XLSX === 'undefined') { onToast && onToast('Excel 解析库未加载，请检查网络后刷新'); return; }
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

    return {
      SOURCES, STAGES, POTENTIALS, WILLINGS, CATEGORIES, PATHS, FOLLOW_METHODS, OWNERS, PLATFORMS, APPEAR_WAYS,
      tagClass,
      // 列表与筛选
      filters, appliedFilters, page, pageSize, filtered, total, pagedList, doSearch, doReset, onPageChange,
      // 弹窗
      dlg, forms,
      openDetail, openEdit, openFollow, openClassify, openHandover, openCreate, closeAll,
      saveEdit, saveFollow, saveClassify, saveHandover, saveCreate,
      // Excel 导入
      imp, openImport, closeImport, handleExcelFile, confirmExcelImport, downloadExcelTemplate,
    };
  }

  function nowStr() {
    const d = new Date(), p2 = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
  }

  global.TalentLeadsModule = { useTalentLeads, SOURCES, STAGES, POTENTIALS, WILLINGS, CATEGORIES, PATHS, FOLLOW_METHODS, OWNERS, PLATFORMS, APPEAR_WAYS, tagClass };
})(window);
