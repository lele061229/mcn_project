/* 导航跳转回归检查：验证看板 KPI 卡 / 待办行 / 任务页按钮的跳转是否生效
 * 用法：node v1/check-nav.js http://127.0.0.1:3100/
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9223;
const URL_ = process.argv[2] || 'http://127.0.0.1:3100/';
const profile = path.join(os.tmpdir(), 'edge-cdp-nav-' + Date.now());

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const child = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile,
    '--window-size=1600,1200', 'about:blank',
  ], { stdio: 'ignore', detached: false });

  let targets = null;
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      targets = await r.json();
      if (targets.some(t => t.type === 'page')) break;
    } catch (e) { }
  }
  if (!targets) { console.log('!! 浏览器没起来'); child.kill(); process.exit(1); }

  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const errors = [];

  const send = (method, params) => new Promise(res => {
    const mid = ++id;
    pending.set(mid, res);
    ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
  });

  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errors.push((m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text);
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errors.push('[网络/资源] ' + m.params.entry.text);
  };
  await new Promise(r => ws.onopen = r);
  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');

  const evalJs = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) return { __err: (r.exceptionDetails.exception || {}).description || r.exceptionDetails.text };
    return r && r.result ? r.result.value : null;
  };

  await send('Page.navigate', { url: URL_ });
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    const ready = await evalJs(`window.Vue && document.querySelector('#app') && document.querySelector('#app').children.length > 0 ? 'VUE_OK' : '-'`);
    if (ready === 'VUE_OK') break;
  }
  await sleep(1200);

  // 点击包含指定文字的最内层元素（兼容标签内混排箭头等附加 span）
  const clickByText = txt => `(() => {
    const all = [...document.querySelectorAll('div,span,button,a,td')].filter(e => e.textContent.trim().startsWith('${txt}'));
    if (!all.length) return 'MISS:' + '${txt}';
    const leaf = all.sort((a, b) => a.querySelectorAll('*').length - b.querySelectorAll('*').length)[0];
    let el = leaf;
    for (let i = 0; i < 6 && el.parentElement; i++) {
      if (String(el.className || '').includes('cursor-pointer')) break;
      el = el.parentElement;
    }
    el.click();
    return 'CLICKED:' + '${txt}';
  })()`;

  const currentPage = () => evalJs(`(() => {
    const h1 = [...document.querySelectorAll('section')].find(s => s.style.display !== 'none' && s.offsetParent !== null);
    const nav = [...document.querySelectorAll('nav a')].find(a => String(a.className).includes('bg-indigo-600'));
    return nav ? nav.textContent.trim() : (h1 ? 'unknown' : 'unknown');
  })()`);

  const visibleSectionText = () => evalJs(`(() => {
    const secs = [...document.querySelectorAll('section')].filter(s => s.offsetParent !== null);
    return secs.length ? secs[0].textContent.slice(0, 120) : 'none';
  })()`);

  console.log('=== 1. 默认页（应停在经营看板） ===');
  console.log('当前导航:', await currentPage());

  console.log('=== 2. 点 KPI 卡「本月新增达人」→ 应跳达人线索 ===');
  console.log(await evalJs(clickByText('本月新增达人')));
  await sleep(300);
  console.log('当前导航:', await currentPage());

  console.log('=== 3. 回看板，点 KPI「本月寄拍任务」→ 应跳寄拍任务 ===');
  await evalJs(`[...document.querySelectorAll('nav a')].find(a=>a.textContent.includes('经营看板')).click()`);
  await sleep(300);
  console.log(await evalJs(clickByText('本月寄拍任务')));
  await sleep(300);
  console.log('当前导航:', await currentPage());
  console.log('任务页头部按钮:', await evalJs(`[...document.querySelectorAll('section')].filter(s=>s.offsetParent!==null).map(s=>s.textContent).join('').includes('报名新任务') ? '有「+ 报名新任务（先招达人）」' : '缺失'`));

  console.log('=== 4. 回看板，点 KPI「待付达人」→ 应跳收益结算 ===');
  await evalJs(`[...document.querySelectorAll('nav a')].find(a=>a.textContent.includes('经营看板')).click()`);
  await sleep(300);
  console.log(await evalJs(clickByText('待付达人')));
  await sleep(300);
  console.log('当前导航:', await currentPage());

  console.log('=== 5. 回看板，点待办行「七喜」→ 应跳达人线索 ===');
  await evalJs(`[...document.querySelectorAll('nav a')].find(a=>a.textContent.includes('经营看板')).click()`);
  await sleep(300);
  console.log(await evalJs(clickByText('七喜')));
  await sleep(300);
  console.log('当前导航:', await currentPage());

  console.log('=== 6. 报错汇总 ===');
  const realErr = errors.filter(e => !e.includes('favicon') && !e.includes('Failed to load resource'));
  console.log('JS 报错数:', realErr.length, realErr.slice(0, 3));

  child.kill();
  process.exit(realErr.length ? 1 : 0);
})().catch(e => { console.error('!!', e); process.exit(1); });
