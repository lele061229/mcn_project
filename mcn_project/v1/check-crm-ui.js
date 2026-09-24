/* 前端权限体系 / 管理员总表 / 分配 / 跟进 / 交接 / 工作台 的浏览器回归（真实点击 + DOM 断言）
   零依赖：直接驱动 Edge 的 DevTools 协议。
   用法：node v1/check-crm-ui.js             （本地 http://127.0.0.1:3000）
        WS_BASE=http://120.25.151.128:3000 node v1/check-crm-ui.js  （线上）
   注意：脚本会创建若干「UI回归-*」线索并做分配/交接/跟进，属于写入操作，请在可脏的库上跑。 */
const { spawn } = require('child_process');
const os = require('os'), path = require('path');
const EDGE = process.env.EDGE_BIN || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = process.env.WS_BASE || 'http://127.0.0.1:3000';
const ADMIN_PASS = process.env.WS_PASS || 'wsccbe9e7e38e3';
const DEMO_PASS = process.env.WS_DEMO_PASS || 'demo123456';
const PORT = Number(process.env.CDP_PORT || 9260);
let pass = 0, fail = 0;
const check = (n, c, extra) => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
// 每次运行的线索名带唯一后缀，避免与历史回归数据重名导致断言歧义
const RUN = String(Date.now()).slice(-6);
const N = {
  ra: 'UI回归' + RUN + '-招募A', rb: 'UI回归' + RUN + '-招募B',
  oa: 'UI回归' + RUN + '-运营A', ob: 'UI回归' + RUN + '-运营B',
  // 20260921b：前端演示数据（MOCK）已移除，「未分配」筛选断言需要一条真实公海线索
  pub: 'UI回归' + RUN + '-公海',
};

(async () => {
  const profile = path.join(os.tmpdir(), 'edge-crm-' + Date.now());
  const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile, '--window-size=1600,1040', 'about:blank'], { stdio: 'ignore' });
  let tabs = null;
  for (let i = 0; i < 60; i++) { await sleep(250); try { tabs = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json(); if (tabs.some(t => t.type === 'page')) break; } catch (e) { } }
  const page = tabs.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pend = new Map(); const errs = [];
  const send = (m, p) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p || {} })); });
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.exceptionThrown') errs.push(((m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description) || m.params.exceptionDetails.text || '').slice(0, 200));
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result || m.error); pend.delete(m.id); }
  };
  await new Promise(r => ws.onopen = r);
  await send('Runtime.enable'); await send('Network.enable');
  const ev = async ex => { const r = await send('Runtime.evaluate', { expression: ex, returnByValue: true, awaitPromise: true }); return r.result ? r.result.value : null; };
  const clickBtn = txt => ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()===${JSON.stringify(txt)}); if(!b) return 'NOT_FOUND'; b.click(); return 'ok'; })()`);
  const visibleCount = () => ev(`(() => { const m=document.body.innerText.match(/可见 (\\d+) 条/); return m?+m[1]:-1; })()`);
  const hasText = s => ev(`document.body.innerText.includes(${JSON.stringify(s)})`);
  // 列表视图「当前负责人」在第 10 列，总表视图在第 9 列（前面多了勾选框）
  const colAt = headerText => `(() => {
    for (const tb of document.querySelectorAll('table')) {
      if (!tb.offsetParent) continue;   // 跳过隐藏表格（列表/总表两套 DOM 共存）
      const ths=[...tb.querySelectorAll('thead th')];
      const i=ths.findIndex(t=>(t.innerText||'').trim()==='${headerText}');
      if (i<0) continue;
      const out=[...tb.querySelectorAll('tbody tr')].map(tr=>{ const tds=[...tr.children]; if(tds.length<=i) return ''; return (tds[i].innerText||'').split('\\n')[0].trim(); }).filter(Boolean);
      if (out.length) return out;
    }
    return [];
  })()`;
  const rowsCount = () => ev(`document.querySelectorAll('tbody tr').length`);

  async function loginAs(user, pwd) {
    await send('Network.clearBrowserCookies');
    await send('Page.navigate', { url: BASE + '/' });
    await sleep(1300);
    await ev(`fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({user:'${user}',pass:'${pwd}'})}).then(r=>r.json())`);
    await send('Page.navigate', { url: BASE + '/' });
    await sleep(3200);
  }
  const clickNav = text => ev(`(() => { const a=[...document.querySelectorAll('nav a')].find(x=>x.textContent.includes(${JSON.stringify(text)})); if(!a) return 'NOT_FOUND'; a.click(); return 'ok'; })()`);
  const setSelect = (matcher, value) => ev(`(() => {
    const sels=[...document.querySelectorAll('select')];
    const s=sels.find(x=>[...x.options].some(o=>(o.textContent||'').startsWith(${JSON.stringify(matcher)})));
    if(!s) return 'NOT_FOUND';
    s.value=${JSON.stringify(value)};
    s.dispatchEvent(new Event('change',{bubbles:true}));
    return 'ok:'+s.value;
  })()`);

  console.log('== 准备测试数据（管理员建 4 条线索）==');
  await loginAs('admin', ADMIN_PASS);
  const seed = await ev(`(async () => {
    const mk = (name, owner, ownerPosition) => fetch('/api/mvp/leads',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,owner,ownerPosition,channel:'UI回归'})}).then(r=>r.json());
    const names = ${JSON.stringify(N)};
    const out = [];
    out.push(await mk(names.ra,'李婷','recruit'));
    out.push(await mk(names.rb,'李婷','recruit'));
    out.push(await mk(names.oa,'王浩','ops'));
    out.push(await mk(names.ob,'王浩','ops'));
    out.push(await mk(names.pub,'未分配',''));
    return out.map(x => x && x.ok ? 'ok' : JSON.stringify(x));
  })()`);
  check('测试线索创建成功', Array.isArray(seed) && seed.every(s => s === 'ok'), seed);
  // 新建的线索需要重新加载页面才会进入前端列表（loadFromDb 只在页面初始化时拉取）
  await send('Page.navigate', { url: BASE + '/' }); await sleep(3400);

  console.log('== A. 管理员视角（团队池）==');
  await clickNav('达人线索'); await sleep(2200);
  const adminScope = await ev(`(() => { const t=document.body.innerText; return { hasAll: t.includes('全部'), hasPosition: t.includes('本岗位池'), hasMine: t.includes('我负责的'), hasRange: t.includes('数据范围') }; })()`);
  check('出现「数据范围」切换', adminScope.hasRange);
  check('管理员有「全部 / 本岗位池 / 我负责的」三个选项', adminScope.hasAll && adminScope.hasPosition && adminScope.hasMine, adminScope);
  const adminVisible = await visibleCount();
  check('管理员可见条数已显示', adminVisible > 0, adminVisible);
  const adminOwners = await ev(colAt('当前负责人'));
  check('管理员列表含多岗位负责人（招募+运营）', adminOwners.includes('李婷') && adminOwners.includes('王浩'), adminOwners);
  const viewBtns = await ev(`[...document.querySelectorAll('button')].map(b=>b.textContent.trim()).filter(t=>['列表','看板','总表'].includes(t))`);
  check('管理员视图切换含「总表」', viewBtns.includes('总表'), viewBtns);

  console.log('== B. 管理员总表（列 / 统计卡 / 筛选）==');
  await clickBtn('总表'); await sleep(1200);
  const master = await ev(`(() => {
    let hs = ''; for (const tb of document.querySelectorAll('table')) { if (!tb.offsetParent) continue; hs += [...tb.querySelectorAll('thead th')].map(t => (t.innerText || '').trim()).join('|') + '\\n'; }
    const t = document.body.innerText;
    return { hasPos: t.includes('当前岗位'), hasHo: t.includes('交接状态'), hasContact: t.includes('联系方式'), hasFans: t.includes('粉丝量'), hasCats: t.includes('接拍类型'), hasAppear: t.includes('出镜方式'), hasWorks: t.includes('作品'), hasRegAt: t.includes('报名时间'), noPot: !hs.includes('达人潜力'), noWill: !hs.includes('合作意愿'), noPath: !hs.includes('合作路径'), noLevel: !hs.includes('达人评级'), noStatus: !hs.includes('生命周期'), noClass: !hs.includes('达人分类'), hasRecruitStat: t.includes('招募岗'), hasFinanceStat: t.includes('财务岗') };
  })()`);
  check('总表列分层（20260920a：报名数据列齐全；判断字段列头不下发；导航文案不算）',
    master.hasPos && master.hasHo && master.hasContact && master.hasFans && master.hasCats && master.hasAppear && master.hasWorks && master.hasRegAt
    && master.noPot && master.noWill && master.noPath && master.noLevel && master.noStatus && master.noClass, master);
  check('总表顶部有按岗位的统计卡', master.hasRecruitStat && master.hasFinanceStat, master);
  const filterBar = await ev(`(() => { const t=document.body.innerText; return { hasOwner: t.includes('全部负责人'), hasPos: t.includes('全部岗位'), hasUn: t.includes('未分配'), hasOv: t.includes('逾期未跟进'), hasHo: t.includes('待交接') }; })()`);
  check('总表有 负责人/岗位/未分配/逾期/待交接 五个筛选入口',
    filterBar.hasOwner && filterBar.hasPos && filterBar.hasUn && filterBar.hasOv && filterBar.hasHo, filterBar);
  // 用分页脚注的「共 N 条」做断言（表格每页 10 行，行数会被分页截断）
  const totalRows = () => ev(`(() => { const m=document.body.innerText.match(/共 (\\d+) 条/); return m?+m[1]:-1; })()`);
  const allMasterTotal = await totalRows();
  check('总表分页脚注显示总条数', allMasterTotal > 0, allMasterTotal);
  // 未分配筛选：公海线索只有个位数，筛完总数应明显变少
  await ev(`(() => { const l=[...document.querySelectorAll('label')].find(x=>x.textContent.includes('未分配')); if(l) l.querySelector('input').click(); })()`);
  await clickBtn('筛选'); await sleep(900);
  const unassignedTotal = await totalRows();
  check('勾选「未分配」后总数变少', unassignedTotal > 0 && unassignedTotal < allMasterTotal, { all: allMasterTotal, unassigned: unassignedTotal });
  const unassignedOwners = await ev(colAt('当前负责人'));
  check('筛选结果确实都是未分配', unassignedOwners.length > 0 && unassignedOwners.every(o => o === '未分配'), unassignedOwners.slice(0, 4));
  await clickBtn('重置'); await sleep(900);
  const resetTotal = await totalRows();
  check('「重置」后恢复全部条数', resetTotal === allMasterTotal, { reset: resetTotal, all: allMasterTotal });

  console.log('== C. 管理员批量分配 ==');
  // 勾选本次运行创建的两条「招募岗」线索（当前负责人=李婷），分配后才会有真实变化
  const pick2 = await ev(`(() => {
    const rows=[...document.querySelectorAll('tbody tr')];
    const names=[${JSON.stringify(N.ra)}, ${JSON.stringify(N.rb)}];
    const cand=rows.filter(tr => { const tds=[...tr.children]; return tds.length > 2 && names.includes((tds[2].innerText||'').trim()); });
    if (cand.length !== 2) return 'NOT_FOUND:'+cand.length;
    cand.forEach(tr => { const c=tr.querySelector('input[type=checkbox]'); if(c) c.click(); });
    return 'ok';
  })()`);
  check('总表可勾选线索', pick2 === 'ok', pick2);
  const pickedNames = [N.ra, N.rb];
  await sleep(600);
  const barText = await ev(`document.body.innerText.includes('已勾选 2 条线索')`);
  check('出现批量分配条「已勾选 2 条线索」', !!barText, barText);
  const openBatch = await clickBtn('批量分配负责人'); await sleep(900);
  check('打开批量分配弹窗', openBatch === 'ok', openBatch);
  const picked = await setSelect('王浩（', '王浩');
  check('弹窗选择负责人=王浩', typeof picked === 'string' && picked.startsWith('ok'), picked);
  await sleep(300);
  const posAuto = await ev(`(() => { const sels=[...document.querySelectorAll('select')]; const s=sels.find(x=>[...x.options].some(o=>o.textContent==='按账号岗位')); return s? s.value : 'NOT_FOUND'; })()`);
  check('选人后自动带出岗位（运营）', posAuto === 'ops', posAuto);
  await clickBtn('确认分配'); await sleep(2400);
  const afterBatch = await ev(`(async () => {
    const j = await fetch('/api/mvp/leads?scope=all').then(r=>r.json());
    const names = ${JSON.stringify(pickedNames)};
    const hit = (j.data||[]).filter(x => names.includes(x.name));
    return hit.map(x => x.name + '=' + x.owner + '/' + x.ownerPosition + '/' + (x.assignedAt||'').slice(0,10));
  })()`);
  // 「今天」以服务端时区为准（浏览器可能在不同时区）
  const srvToday = await ev(`fetch('/api/mvp/workbench').then(r=>r.json()).then(j=>j.data.today)`);
  check('批量分配后勾选线索负责人=王浩（运营）+ 刷新分配时间',
    Array.isArray(afterBatch) && afterBatch.length === 2 && afterBatch.every(s => s.endsWith('=王浩/ops/' + srvToday)), afterBatch);
  const cleared = await ev(`document.body.innerText.includes('已勾选 2 条线索') || document.body.innerText.includes('批量分配负责人')`);
  check('分配后勾选被清空（批量条消失）', !cleared, cleared);

  console.log('== D. 招募岗（李婷）视角 ==');
  await loginAs('demo-recruit', DEMO_PASS);
  await clickNav('达人线索'); await sleep(2200);
  const rScope = await ev(`(() => { const t=document.body.innerText; const btns=[...document.querySelectorAll('button')].map(b=>b.textContent.trim()); return { hasAllBtn: btns.includes('全部'), hasRange: t.includes('数据范围') }; })()`);
  check('招募岗没有「全部」范围选项（越权选项不下发）', !rScope.hasAllBtn, rScope);
  const rViewBtns = await ev(`[...document.querySelectorAll('button')].map(b=>b.textContent.trim()).filter(t=>['列表','看板','总表'].includes(t))`);
  check('招募岗看不到「总表」视图', !rViewBtns.includes('总表'), rViewBtns);
  const rVisible = await visibleCount();
  check('招募岗可见条数少于管理员（行级被裁剪）', rVisible > 0 && rVisible < adminVisible, { recruit: rVisible, admin: adminVisible });
  const rOwners = await ev(colAt('当前负责人'));
  check('招募岗列表里没有运营岗负责的线索', rOwners.every(o => o !== '王浩'), rOwners);
  check('招募岗能看到自己负责的线索', rOwners.includes('李婷'), rOwners);
  const rNoBatch = await ev(`document.body.innerText.includes('批量分配负责人')`);
  check('非管理员看不到批量分配入口', !rNoBatch, rNoBatch);

  console.log('== E. 高级运营（张萌）视角：主管质检链路 ==');
  await loginAs('demo-senior', DEMO_PASS);
  await sleep(1200);
  // 落地页按岗位分流：员工直接进工作台
  const sLanding = await ev(`(() => { const t=document.body.innerText; return { wb: t.includes('我的工作台') }; })()`);
  check('高级运营落地工作台', sLanding.wb, sLanding);
  const sNav = await ev(`(() => { const links=[...document.querySelectorAll('nav a')].map(x=>x.textContent); return { hasLeads: links.some(x=>x.includes('达人线索')), hasChannels: links.some(x=>x.includes('推广获客')), hasTasks: links.some(x=>x.includes('达人任务中心')), hasFin: links.some(x=>x.includes('收益结算')), hasAcc: links.some(x=>x.includes('账号运营')) }; })()`);
  check('高级运营菜单（有 达人线索/达人任务中心/账号运营，无 推广获客/收益结算）',
    sNav.hasLeads && !sNav.hasChannels && sNav.hasTasks && !sNav.hasFin && sNav.hasAcc, sNav);
  const sWbApi = await ev(`(async () => { const j = await fetch('/api/mvp/workbench').then(r=>r.json()); return j.ok ? { todos: (j.data.todos||[]).length } : null; })()`);
  check('高级运营工作台接口可用（主管视角待办）', !!sWbApi, sWbApi);

  console.log('== F. 跟进弹窗（8 字段，招募岗李婷）==');
  await loginAs('demo-recruit', DEMO_PASS);
  await clickNav('达人线索'); await sleep(2200);
  await clickBtn('列表'); await sleep(600);
  // 必须点「自己负责」的那一行，否则后端会以「只能跟进自己负责的线索」拒绝
  const openFollow = await ev(`(() => {
    const rows=[...document.querySelectorAll('tbody tr')];
    let ci=-1; for (const tb of document.querySelectorAll('table')) { if (!tb.offsetParent) continue; const ths=[...tb.querySelectorAll('thead th')]; const i=ths.findIndex(t=>(t.innerText||'').trim()==='当前负责人'); if (i>=0) { ci=i; break; } }
    const tr=rows.find(x=>{ const tds=[...x.children]; return ci>=0 && tds.length>ci && (tds[ci].innerText||'').includes('李婷'); });
    if(!tr) return 'NO_ROW';
    const b=[...tr.querySelectorAll('button')].find(x=>x.textContent.trim()==='跟进');
    if(!b) return 'NO_FOLLOW_BTN';
    b.click(); return 'ok';
  })()`);
  await sleep(900);
  const followModal = await ev(`(() => { const t=document.body.innerText; return { title: t.includes('跟进登记'), method: t.includes('跟进方式'), result: t.includes('跟进结果'), stage: t.includes('当前阶段'), pot: t.includes('达人潜力'), will: t.includes('合作意愿'), content: t.includes('跟进内容'), next: t.includes('下次跟进时间'), note: t.includes('备注') }; })()`);
  check('跟进弹窗包含 方式/结果/内容/阶段/下次跟进/备注（20260918 字段分层：招募岗无判断字段）',
    openFollow === 'ok' && followModal.title && followModal.method && followModal.result && followModal.stage
    && followModal.content && followModal.next && followModal.note,
    { openFollow, followModal });
  check('招募岗跟进弹窗不出现判断字段编辑（潜力/意愿归运营/高级运营，canJudge 口径）',
    openFollow === 'ok' && !followModal.pot && !followModal.will, { openFollow, followModal });
  // 真提交一条跟进：填内容 + 选阶段 + 下次跟进，验证落库
  await ev(`(() => {
    const ta=[...document.querySelectorAll('textarea')].find(x=>x.placeholder && x.placeholder.includes('沟通了什么'));
    if(ta){ ta.value='UI回归：已加微信，介绍寄拍流程'; ta.dispatchEvent(new Event('input',{bubbles:true})); }
    const inp=[...document.querySelectorAll('input')].find(x=>x.placeholder && x.placeholder.startsWith('YYYY-MM-DD'));
    if(inp){ inp.value='2026-09-20 10:00'; inp.dispatchEvent(new Event('input',{bubbles:true})); }
    return 'ok';
  })()`);
  await clickBtn('保存跟进'); await sleep(2200);
  const followSaved = await ev(`(async () => {
    const j = await fetch('/api/mvp/leads?scope=mine').then(r=>r.json());
    const withNext = (j.data||[]).filter(x => (x.nextFollow||'').startsWith('2026-09-20'));
    if (!withNext.length) return { err:'no lead with new nextFollow' };
    const f = await fetch('/api/mvp/leads/' + encodeURIComponent(withNext[0].id) + '/follow-ups').then(r=>r.json());
    return { lead: withNext[0].name, count: (f.data||[]).length, hasContent: (f.data||[]).some(x => (x.content||'').includes('UI回归')) };
  })()`);
  check('跟进已落库（下次跟进时间更新 + 产生跟进记录）',
    followSaved && followSaved.count > 0 && followSaved.hasContent, followSaved);

  console.log('== G. 工作台（规则待办 + 招募完成提示）==');
  await clickNav('我的工作台'); await sleep(2000);
  const wb = await ev(`(() => { const t=document.body.innerText; return { c1:t.includes('待处理新线索'), c2:t.includes('今日待跟进'), c3:t.includes('高意向达人'), c4:t.includes('待交接达人'), c5:t.includes('首次联系SLA超时数'), todo:t.includes('待办列表'), src:t.includes('来源'), done:t.includes('招募完成'), handoverBtn:t.includes('发起交接') }; })()`);
  check('招募工作台岗位卡齐全（待处理新线索/今日待跟进/高意向达人/待交接达人，20260921a 移除 SLA 卡）',
    wb.c1 && wb.c2 && wb.c3 && wb.c4 && !wb.c5, wb);
  check('工作台待办列表存在且含「来源」列', wb.todo && wb.src, wb);
  // 招募岗位职责的终点提示：名下有「合作中」达人且未交接 → 出现「招募完成」待办与「发起交接」按钮
  check('招募岗出现「招募完成」待办与「发起交接」按钮（达人该转运营了）', wb.done && wb.handoverBtn, wb);
  const wbApi = await ev(`(async () => { const j = await fetch('/api/mvp/workbench').then(r=>r.json()); return j.ok ? j.data.cards : null; })()`);
  check('工作台接口返回卡片统计', !!wbApi && typeof wbApi.assigned === 'number', wbApi);

  console.log('== H. 交接 UI 全流程（管理员发起 → 招募岗李婷接收）==');
  await loginAs('admin', ADMIN_PASS);
  const ho = await ev(`(async () => {
    const list = await fetch('/api/mvp/leads?scope=all').then(r=>r.json());
    const target = (list.data||[]).find(l => l.name === ${JSON.stringify(N.oa)});
    if (!target) return { err: 'target not found' };
    return await fetch('/api/mvp/handovers',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({talentId:target.id,toUser:'李婷',toPosition:'recruit',reason:'UI 回归：交接给招募'})}).then(x=>x.json());
  })()`);
  check('管理员发起交接成功', ho && ho.ok, ho);
  await loginAs('demo-recruit', DEMO_PASS);
  await clickNav('达人线索'); await sleep(2200);
  const banner = await ev(`(() => { const t=document.body.innerText; return { has: t.includes('交接待你确认'), hasBtn: t.includes('确认接收'), hasReject: t.includes('驳回') }; })()`);
  check('接收人页面出现「待我确认的交接」横幅', banner.has, banner);
  check('横幅带「确认接收 / 驳回」按钮', banner.hasBtn && banner.hasReject, banner);
  const wbPending = await ev(`(async () => { const j = await fetch('/api/mvp/workbench').then(r=>r.json()); return j.ok ? { pending: j.data.cards.pending, hasTodo: (j.data.todos||[]).some(t=>t.type==='待接收') } : null; })()`);
  check('接收人工作台出现「待接收」待办', wbPending && wbPending.pending >= 1 && wbPending.hasTodo, wbPending);
  const before = await visibleCount();
  const confirmed = await clickBtn('确认接收');
  check('点击「确认接收」', confirmed === 'ok', confirmed);
  await sleep(2500);
  const after = await ev(`(() => { const t=document.body.innerText; const m=t.match(/可见 (\\d+) 条/); return { visible: m?+m[1]:-1, bannerGone: !t.includes('交接待你确认') }; })()`);
  check('确认后横幅消失', after.bannerGone, after);
  check('确认前后可见条数不变（接收前已因待接收而可见）', after.visible === before, { before, after: after.visible });
  const sOwnerNow = await ev(colAt('当前负责人'));
  check('确认后该线索负责人已变为李婷', sOwnerNow.includes('李婷'), sOwnerNow);

  console.log('== I. 留痕（详情弹窗 跟进记录 / 流转历史）==');
  const hist = await ev(`(async () => {
    const list = await fetch('/api/mvp/leads?scope=mine').then(r=>r.json());
    const t = (list.data||[]).find(l => l.name === ${JSON.stringify(N.oa)});
    if (!t) return { err:'not mine' };
    const h = await fetch('/api/mvp/leads/' + encodeURIComponent(t.id) + '/history').then(x=>x.json());
    return { owner: t.owner, types: (h.data && h.data.rows || []).map(r=>r.type) };
  })()`);
  check('线索负责人已变为李婷', hist.owner === '李婷', hist);
  check('流转历史含「线索交接-发起」「线索交接-确认」',
    hist.types && hist.types.includes('线索交接-发起') && hist.types.includes('线索交接-确认'), hist.types);
  const openDetail = await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='查看'); if(!b) return 'NO_BTN'; b.click(); return 'ok'; })()`);
  await sleep(1800);
  // 断言口径：跟进区块的标题固定为「跟进时间轴」；空态文案才是「还没有跟进记录…」。
  // 只认「跟进记录」四个字会依赖「首行线索恰好没有跟进」，属数据顺序 flake —— 两者任一命中即算有该区块。
  const detail = await ev(`(() => { const t=document.body.innerText; return { hasHistory: t.includes('流转历史'), hasFollow: t.includes('跟进时间轴') || t.includes('跟进记录') }; })()`);
  check('详情弹窗有「跟进记录（时间轴）」与「流转历史」区块', openDetail === 'ok' && detail.hasHistory && detail.hasFollow, { openDetail, detail });

  console.log('== J. 清理本次回归数据 ==');
  await loginAs('admin', ADMIN_PASS);
  const cleaned = await ev(`(async () => {
    const j = await fetch('/api/mvp/leads?scope=all').then(r=>r.json());
    const names = ${JSON.stringify(Object.values(N))};
    const hit = (j.data||[]).filter(x => names.includes(x.name));
    for (const t of hit) await fetch('/api/mvp/leads/' + encodeURIComponent(t.id), { method:'DELETE' });
    return hit.length;
  })()`);
  check('清理本次回归创建的 5 条线索', cleaned === 5, cleaned);

  check('全程无 JS 运行时异常', errs.length === 0, errs.slice(0, 4));

  console.log('\n结果：通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  ws.close(); proc.kill();
  await sleep(500);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('测试异常：', e); process.exit(1); });
