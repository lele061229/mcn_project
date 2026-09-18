/* 测试退出登录完整流程：登录 → 找按钮 → 点击 → 验证跳转与 Cookie 清空 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9223;
const URL_ = process.argv[2] || 'http://120.25.151.128:3000/';
const PASS = process.env.WS_PASS || 'wsccbe9e7e38e3';
const profile = path.join(os.tmpdir(), 'edge-cdp-' + Date.now());
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const child = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile,
    '--window-size=1600,1200', 'about:blank',
  ], { stdio: 'ignore' });

  let targets = null;
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      targets = await r.json();
      if (targets.some(t => t.type === 'page')) break;
    } catch (e) {}
  }
  if (!targets) { console.log('!! 浏览器没起来'); child.kill(); process.exit(1); }

  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pending = new Map(); const errors = [];
  const send = (m, p) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p || {} })); });
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result || m.error); pending.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text);
  };
  await new Promise(r => { ws.onopen = r; });
  await send('Runtime.enable'); await send('Page.enable');

  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) return { __err: r.exceptionDetails.text + ' ' + ((r.exceptionDetails.exception || {}).description || '') };
    return r && r.result ? r.result.value : null;
  };

  console.log('--- 1. 打开首页（未登录应跳登录页） ---');
  await send('Page.navigate', { url: URL_ });
  await sleep(2500);
  console.log('当前URL:', await evalJs('location.href'));

  console.log('--- 2. 通过 API 登录 ---');
  console.log(await evalJs(`fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({user:'admin',pass:${JSON.stringify(PASS)}})}).then(r=>r.json()).then(d=>JSON.stringify(d))`));
  console.log('登录后 Cookie:', await evalJs('document.cookie'));
  console.log('ws_auth(HttpOnly,不可见属正常):', await evalJs(`document.cookie.includes('ws_user')`));

  console.log('--- 3. 刷新进后台，找退出按钮 ---');
  await send('Page.navigate', { url: URL_ });
  await sleep(3500);
  console.log('当前URL:', await evalJs('location.href'));
  const btn = await evalJs(`(() => {
    const b = [...document.querySelectorAll('button,a')].find(e => e.innerText.trim() === '退出登录');
    if (!b) return 'NOT_FOUND';
    const r = b.getBoundingClientRect();
    return JSON.stringify({ tag: b.tagName, visible: r.width > 0 && r.height > 0, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), disabled: b.disabled });
  })()`);
  console.log('退出按钮:', btn);

  console.log('--- 4. 点击退出按钮 ---');
  console.log(await evalJs(`(() => { const b = [...document.querySelectorAll('button,a')].find(e => e.innerText.trim() === '退出登录'); if (!b) return 'NOT_FOUND'; b.click(); return 'clicked'; })()`));
  await sleep(3000);
  console.log('点击后URL:', await evalJs('location.href'));
  console.log('点击后可见Cookie:', await evalJs('document.cookie'));
  console.log('登录页渲染:', await evalJs(`(() => { const i = document.querySelector('input'); return JSON.stringify({ hasInput: !!i, title: document.title, bodyLen: document.body.innerText.length }); })()`));

  console.log('--- 5. 退出后直接访问后台（应被弹回登录页） ---');
  await send('Page.navigate', { url: URL_ });
  await sleep(2500);
  console.log('最终URL:', await evalJs('location.href'));
  const me = await evalJs(`fetch('/api/me').then(r=>r.status)`).catch(()=> 'ERR');
  console.log('/api/me 状态码:', me);

  console.log('--- 6. JS报错汇总 ---');
  console.log('error 数:', errors.length); errors.slice(0, 8).forEach(e => console.log('  ', e));

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  if (shot && shot.data) {
    const out = path.join(process.env.TEMP || '.', 'logout_test.png');
    fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
    console.log('截图:', out);
  }
  ws.close(); child.kill();
  await sleep(500); process.exit(0);
})().catch(e => { console.log('脚本异常:', e && e.stack); process.exit(1); });
