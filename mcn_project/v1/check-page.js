/* 零依赖页面回归检查工具（CDP 驱动本机 Edge 无头模式）
 *
 * 用途：部署后验证页面真实渲染（Vue 是否挂载、有无 JS 报错、关键区域内容是否正确）。
 * 不需要安装 agent-browser / puppeteer / playwright，只要本机有 Edge 即可。
 *
 * 用法：
 *   node v1/check-page.js http://127.0.0.1:3000/
 *   node v1/check-page.js http://120.25.151.128:3000/
 *
 * 检查项：Vue 挂载 / 控制台异常 / 收益结算页 KPI 与表格 / 生成结算单弹窗实时测算 / 详情抽屉。
 * 改其它页面时，把第 3~5 步的断言换成对应页面的关键字即可。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9222;
const URL_ = process.argv[2] || 'http://127.0.0.1:3100/';
const profile = path.join(os.tmpdir(), 'edge-cdp-' + Date.now());

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
    } catch (e) { /* 还没起来 */ }
  }
  if (!targets) { console.log('!! 浏览器没起来'); child.kill(); process.exit(1); }

  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const errors = [];
  const logs = [];

  const send = (method, params) => new Promise(res => {
    const mid = ++id;
    pending.set(mid, res);
    ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
  });

  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result || m.error); pending.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      errors.push('[异常] ' + (d.exception && (d.exception.description || d.exception.value) || d.text));
    }
    if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) {
      const txt = m.params.args.map(a => a.value !== undefined ? a.value : (a.description || a.type)).join(' ');
      (m.params.type === 'error' ? errors : logs).push('[' + m.params.type + '] ' + txt);
    }
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
      errors.push('[网络/资源] ' + m.params.entry.text);
    }
  };

  await new Promise(r => { ws.onopen = r; });
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1200, deviceScaleFactor: 1, mobile: false });

  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) return { __err: r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception || {}).description };
    return r && r.result ? r.result.value : null;
  };

  await send('Page.navigate', { url: URL_ });
  // 可选：先登录再检查（环境变量 WS_PASS）
  if (process.env.WS_PASS) {
    await sleep(1500);
    await evalJs(`fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({user:'admin',pass:${JSON.stringify(process.env.WS_PASS)}})}).then(r=>r.json())`);
    await send('Page.navigate', { url: URL_ });
  }
  let ready = '';
  for (let i = 0; i < 80; i++) {
    await sleep(500);
    ready = await evalJs(`(window.Vue ? 'VUE' : '-') + '|' + document.readyState + '|' + (document.querySelector('#app') ? document.querySelector('#app').children.length : -1)`);
    if (ready && ready.includes('VUE|complete|') && parseInt(ready.split('|')[2], 10) > 0) break;
  }
  console.log('就绪状态:', ready);
  await sleep(1500);

  console.log('=== 1. 首屏是否挂载成功 ===');
  console.log(await evalJs(`(() => {
    const app = document.querySelector('#app');
    return JSON.stringify({
      hasVueApp: !!app && app.children.length > 0,
      htmlLen: document.documentElement.innerHTML.length,
      navCount: document.querySelectorAll('aside *').length,
      title: document.title
    });
  })()`));

  console.log('\n=== 2. 点击「收益结算」导航 ===');
  console.log(await evalJs(`(() => {
    const nodes = [...document.querySelectorAll('a,button,li,div,span')].filter(e => e.textContent.includes('收益结算'));
    if (!nodes.length) return '未找到导航项';
    nodes.sort((a, b) => a.textContent.length - b.textContent.length);
    const el = nodes[0];
    el.click();
    return '已点击最内层节点（' + el.tagName + ' / 文本=' + el.textContent.trim().slice(0, 24) + ' / 命中 ' + nodes.length + ' 个）';
  })()`));
  await sleep(1500);

  console.log('\n=== 3. 收益结算页渲染结果 ===');
  const dump = await evalJs(`(() => {
    const main = document.querySelector('main');
    if (!main) return 'no main';
    const txt = main.innerText;
    const kpis = [...main.querySelectorAll('.text-2xl')].map(e => e.innerText.trim());
    const rows = [...main.querySelectorAll('tbody tr')].map(tr => [...tr.querySelectorAll('td')].map(td => td.innerText.replace(/\\n/g,' ').trim()).join(' | '));
    const heads = [...main.querySelectorAll('thead th')].map(e => e.innerText.trim());
    return JSON.stringify({
      isFinance: txt.includes('平台收益合计') || txt.includes('MCN 分成留存'),
      kpis, heads, rowCount: rows.length, rows: rows.slice(0, 4),
      hasGenerateBtn: txt.includes('生成结算单'),
      noteOk: txt.includes('已结清') && txt.includes('资金流水累加判定')
    }, null, 1);
  })()`);
  console.log(dump);

  console.log('\n=== 4. 打开「生成结算单」弹窗并看实时测算 ===');
  console.log(await evalJs(`(() => {
    const btns = [...document.querySelectorAll('button')].filter(b => b.innerText.trim().includes('生成结算单'));
    if (!btns.length) return '未找到按钮';
    btns[0].click();
    return '已点击';
  })()`));
  await sleep(900);
  console.log(await evalJs(`(() => {
    const dlg = [...document.querySelectorAll('div')].find(d => d.className.includes('max-w-lg') && d.innerText.includes('生成结算单'));
    if (!dlg) return '弹窗未出现';
    const inputs = [...dlg.querySelectorAll('input')];
    const income = inputs.find(i => i.type === 'number');
    if (income) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(income, '10000');
      income.dispatchEvent(new Event('input', { bubbles: true }));
    }
    return '已填入 10000';
  })()`));
  await sleep(600);
  console.log(await evalJs(`(() => {
    const dlg = [...document.querySelectorAll('div')].find(d => d.className.includes('max-w-lg') && d.innerText.includes('生成结算单'));
    const money = [...dlg.querySelectorAll('span')].filter(s => s.innerText.includes('¥')).map(s => s.innerText.trim());
    return '实时测算显示: ' + JSON.stringify(money);
  })()`));

  // 关掉弹窗
  await evalJs(`(() => { const b=[...document.querySelectorAll('button')].find(x=>x.innerText.trim()==='取消'); if(b) b.click(); return 1; })()`);
  await sleep(400);

  console.log('\n=== 5. 打开第一张结算单详情 ===');
  console.log(await evalJs(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.innerText.trim() === '详情');
    if (!b) return '没有详情按钮';
    b.click(); return '已点击详情';
  })()`));
  await sleep(1000);
  console.log(await evalJs(`(() => {
    const panel = [...document.querySelectorAll('div')].find(d => d.className.includes('max-w-xl') && d.innerText.includes('分账明细'));
    if (!panel) return '抽屉未出现';
    return panel.innerText.replace(/\\n\\n+/g, '\\n').slice(0, 1200);
  })()`));

  console.log('\n=== 6. 页面报错汇总 ===');
  console.log('error 数:', errors.length);
  errors.slice(0, 12).forEach(e => console.log('  ', e.slice(0, 300)));
  console.log('warning 数:', logs.length);
  logs.slice(0, 6).forEach(e => console.log('  ', e.slice(0, 300)));

  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  if (shot && shot.data) {
    const out = path.join(process.env.TEMP || '.', 'finance_page.png');
    fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
    console.log('\n截图已保存:', out);
  }

  ws.close();
  child.kill();
  await sleep(500);
  process.exit(0);
})().catch(e => { console.log('脚本异常:', e && e.stack); process.exit(1); });
