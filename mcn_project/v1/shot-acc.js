/* 一次性截图：登录指定账号后点击指定导航并截图
   用法: node v1/shot-acc.js <base> <user> <pass> <navText> <outfile> [extraJs] [mobile]
   extraJs（可选）：点击导航后、截图前在页面里执行的一段 JS（可 async，用于打开弹窗等）
   第 7 参传 "mobile"：390x844 移动端视口（触发 <768px 响应式布局） */
const { spawn } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const [BASE, USER, PASS, NAV, OUT, EXTRA, MODE] = process.argv.slice(2);
const MOBILE = MODE === 'mobile';
const PORT = 9295;
const profile = path.join(os.tmpdir(), 'edge-cdp-' + Date.now());
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const winSize = MOBILE ? '--window-size=390,844' : '--window-size=1500,950';
  const child = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile, winSize, 'about:blank'], { stdio: 'ignore' });
  let targets = null;
  for (let i = 0; i < 40; i++) { await sleep(250); try { const r = await fetch('http://127.0.0.1:' + PORT + '/json/list'); targets = await r.json(); if (targets.some(t => t.type === 'page')) break; } catch (e) {} }
  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  const send = (m, p) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p || {} })); });
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result || m.error); pending.delete(m.id); } };
  await new Promise(r => { ws.onopen = r; });
  await send('Runtime.enable'); await send('Page.enable');
  if (MOBILE) await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  const ev = async e => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); return r && r.result ? r.result.value : null; };
  await send('Page.navigate', { url: BASE + '/' }); await sleep(4000);
  await ev("fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({user:" + JSON.stringify(USER) + ",pass:" + JSON.stringify(PASS) + "})}).then(r=>r.json())");
  await send('Page.navigate', { url: BASE + '/' }); await sleep(4000);
  const clicked = await ev("(() => { const a=[...document.querySelectorAll('nav a')].find(x=>x.textContent.includes(" + JSON.stringify(NAV) + ")); if(!a) return 'NAV_NOT_FOUND'; a.click(); return 'ok'; })()");
  console.log('click:', clicked);
  await sleep(3500);
  if (EXTRA) { console.log('extra:', await ev(EXTRA)); await sleep(1500); }
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
  console.log('saved:', OUT);
  child.kill();
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
