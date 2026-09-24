/* 一键体验（login.html 的 DEMO 区块）回归
   覆盖 1 个管理员 + 5 个岗位（推广 / 招募 / 普通运营 / 高级运营 / 财务）：
   点击按钮 → 校验登录身份（/api/me 的 user / role / position）与左侧菜单差异。

   设计要点：
   - 按钮用 [data-demo] 定位，改按钮文案不会让脚本失效；
   - 口径与产品一致：菜单由 **角色 role** 决定，线索数据范围由 **岗位 position** 决定。
   用法：node v1/check-demo-roles.js [base]   默认 http://127.0.0.1:3000 */
const { spawn } = require('child_process');
const os = require('os');
const path = require('path');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9226;
const BASE = process.argv[2] || 'http://127.0.0.1:3000';
const profile = path.join(os.tmpdir(), 'edge-cdp-' + Date.now());
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const check = (label, cond, got) => {
  if (cond) { pass++; console.log('  \u2713 ' + label); }
  else { fail++; console.log('  \u2717 ' + label + '  \u2192 \u5b9e\u9645: ' + JSON.stringify(got)); }
};

(async () => {
  const child = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile, '--window-size=1600,1200', 'about:blank'], { stdio: 'ignore' });
  let targets = null;
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json/list`); targets = await r.json(); if (targets.some(t => t.type === 'page')) break; } catch (e) {}
  }
  if (!targets || !targets.some(t => t.type === 'page')) { console.log('无法启动 Edge 或未找到页面 target'); process.exit(1); }
  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pending = new Map(); const errors = [];
  const send = (m, p) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p || {} })); });
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result || m.error); pending.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') errors.push((m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text);
  };
  await new Promise(r => { ws.onopen = r; });
  await send('Runtime.enable'); await send('Page.enable');
  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) return { __err: r.exceptionDetails.text + ' ' + ((r.exceptionDetails.exception || {}).description || '') };
    return r && r.result ? r.result.value : null;
  };

  // 期望值：菜单看 role + 岗位（链路分工），数据范围看 position
  // 20260922 增：chip = 工作台标题旁的岗位徽标；sub = 该岗位工作台副标题里的特征短语
  // 20260922c 改：经营看板页面整体删除（含管理员），全岗位只有「我的工作台」；落地页=工作台
  const cases = [
    { key: 'admin',        label: '管理员', user: 'admin',        role: 'admin',   position: 'admin',   fin: true,  accounts: true,  ai: true,  talents: true,  chan: true,  acc: true,  chip: '管理员',   sub: '系统整体状态', dash: false },
    { key: 'demo-promote', label: '推广',   user: 'demo-promote', role: 'staff',   position: 'promote', fin: false, accounts: false, ai: false, talents: false, chan: true,  acc: false, chip: '推广',     sub: '今天投哪里', dash: false },
    { key: 'demo-recruit', label: '招募',   user: 'demo-recruit', role: 'staff',   position: 'recruit', fin: false, accounts: false, ai: false, talents: true,  chan: false, acc: false, chip: '招募',     sub: '今天该联系谁', dash: false },
    { key: 'demo-staff',   label: '运营',   user: 'demo-staff',   role: 'staff',   position: 'ops',     fin: false, accounts: false, ai: false, talents: true,  chan: false, acc: true,  chip: '普通运营', sub: '今天该处理哪些达人', dash: false },
    { key: 'demo-senior',  label: '高级运营', user: 'demo-senior',  role: 'staff',   position: 'senior_ops', fin: false, accounts: false, ai: false, talents: true,  chan: false, acc: true,  chip: '高级运营', sub: '今天要分配、审核', dash: false },
    { key: 'demo-finance', label: '财务',   user: 'demo-finance', role: 'finance', position: 'finance', fin: true,  accounts: false, ai: false, talents: false, chan: false, acc: false, chip: '财务',     sub: '今天哪些钱需要确认', dash: false },
  ];

  // ---- 0. DEMO 区块结构：管理员 + 5 个岗位按钮，且带说明小字 ----
  console.log('--- DEMO 区块 ---');
  await send('Page.navigate', { url: BASE + '/login.html' });
  await sleep(2000);
  const keys = JSON.parse((await evalJs(`JSON.stringify([...document.querySelectorAll('#demoBlock [data-demo]')].map(b=>b.getAttribute('data-demo')))`)) || '[]');
  check('按钮共 6 个（管理员 + 推广/招募/运营/高级运营/财务）', keys.length === 6, keys);
  for (const c of cases) check(`存在「${c.label}」按钮`, keys.includes(c.key), keys);
  const tip = String((await evalJs(`(document.querySelector('#demoBlock')||{innerText:''}).innerText`)) || '').replace(/\s+/g, ' ');
  check('带岗位说明小字（链路分工）', /岗位/.test(tip) && /链路/.test(tip) && /管理员看全部/.test(tip), tip.slice(0, 90));

  // ---- 1. 逐个岗位登录 ----
  for (const c of cases) {
    console.log(`--- ${c.label}（${c.user}） ---`);
    await send('Page.navigate', { url: BASE + '/login.html' });
    await sleep(1800);
    const clicked = await evalJs(`(() => { const b=document.querySelector('#demoBlock [data-demo="${c.key}"]'); if(!b) return 'BTN_NOT_FOUND'; b.click(); return 'clicked'; })()`);
    check('按钮可点击', clicked === 'clicked', clicked);

    let arrived = false;
    for (let i = 0; i < 20; i++) { await sleep(500); if ((await evalJs('location.pathname')) === '/') { arrived = true; break; } }
    check('登录后跳转主界面', arrived, await evalJs('location.pathname'));
    if (!arrived) { await evalJs(`fetch('/api/logout',{method:'POST'})`); continue; }
    await sleep(2200);

    const me = JSON.parse((await evalJs(`fetch('/api/me').then(r=>r.json()).then(j=>JSON.stringify(j.data||{}))`)) || '{}');
    check(`账号 = ${c.user}`, me.user === c.user, me.user);
    check(`角色 = ${c.role}`, me.role === c.role, me.role);
    check(`岗位 = ${c.position}`, me.position === c.position, me.position);

    // 只看左侧导航（页面文案可能提到链路名，不代表菜单可见）
    const nav = JSON.parse((await evalJs(`JSON.stringify((() => { const t=[...document.querySelectorAll('nav a')].map(x=>x.textContent).join('|'); return {fin:t.includes('收益结算'),accounts:t.includes('账号管理'),ai:t.includes('AI 生图'),talents:t.includes('达人线索'),chan:t.includes('推广获客'),acc:t.includes('账号运营')}; })())`)) || '{}');
    check(`菜单·收益结算 ${c.fin ? '可见' : '隐藏'}`, nav.fin === c.fin, nav);
    check(`菜单·账号管理 ${c.accounts ? '可见' : '隐藏'}`, nav.accounts === c.accounts, nav);
    check(`菜单·AI 生图 ${c.ai ? '可见' : '隐藏'}`, nav.ai === c.ai, nav);
    check(`菜单·达人线索 ${c.talents ? '可见' : '隐藏'}`, nav.talents === c.talents, nav);
    check(`菜单·推广获客 ${c.chan ? '可见' : '隐藏'}`, nav.chan === c.chan, nav);
    check(`菜单·账号运营 ${c.acc ? '可见' : '隐藏'}`, nav.acc === c.acc, nav);

    /* 20260922 信息架构调整（工作台统一首页）：
       ① 经营看板页面整体删除（20260922c，含管理员——全局信息由工作台面板承载）② 我的工作台入口在
       ③ 落地页直接是工作台 ④ 工作台有该岗位的交代（岗位徽标 + 岗位化副标题） */
    const ia = JSON.parse((await evalJs(`JSON.stringify((() => {
      const navTxt=[...document.querySelectorAll('nav a')].map(x=>x.textContent).join('|');
      const h1=(document.querySelector('h1')||{innerText:''}).innerText;
      const t=document.body.innerText;
      return {
        dash: navTxt.includes('\u7ecf\u8425\u770b\u677f'),
        wb: navTxt.includes('\u6211\u7684\u5de5\u4f5c\u53f0'),
        landed: h1.includes('\u6211\u7684\u5de5\u4f5c\u53f0'),
        chip: t.includes(${JSON.stringify(c.chip)}),
        sub: t.includes(${JSON.stringify(c.sub)}),
      };
    })())`)) || '{}');
    check('菜单·经营看板 已全岗位下线（页面已删除）', ia.dash === c.dash, ia);
    check('菜单·我的工作台 可见', ia.wb === true, ia);
    check('落地页 = 我的工作台（不再默认经营看板）', ia.landed === true, ia);
    check(`工作台岗位交代·徽标「${c.chip}」`, ia.chip === true, ia);
    check(`工作台岗位交代·副标题「${c.sub}」`, ia.sub === true, ia);

    await evalJs(`fetch('/api/logout',{method:'POST'})`);
  }

  console.log('--- JS 错误 ---');
  check('无运行时异常', errors.length === 0, errors.slice(0, 3));
  console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
  ws.close(); child.kill();
  await sleep(500); process.exit(fail ? 1 : 0);
})().catch(e => { console.log('异常:', e && e.stack); process.exit(1); });
