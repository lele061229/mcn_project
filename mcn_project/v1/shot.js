// 零依赖 CDP 截图：node shot.js <url> [宽] [高] [输出路径] [等待ms]
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const URL_ = process.argv[2] || 'http://127.0.0.1:3100/login.html';
const W = parseInt(process.argv[3] || '390', 10);
const H = parseInt(process.argv[4] || '844', 10);
const OUT = process.argv[5] || 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\shot.png';
const WAIT = parseInt(process.argv[6] || '2500', 10);
const PORT = 9400 + Math.floor(Math.random() * 400);

function httpGet(url) {
  return new Promise((res, rej) => { http.get(url, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej); });
}

(async () => {
  const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', '--remote-debugging-port=' + PORT,
    '--no-first-run', '--window-size=' + W + ',' + H,
    '--user-data-dir=' + fs.mkdtempSync(path.join(os.tmpdir(), 'edge-'))], { stdio: 'ignore' });
  let wsUrl = null;
  for (let i = 0; i < 40 && !wsUrl; i++) {
    await new Promise(r => setTimeout(r, 250));
    try {
      const list = JSON.parse(await httpGet('http://127.0.0.1:' + PORT + '/json/list'));
      const page = list.find(t => t.type === 'page');
      if (page) wsUrl = page.webSocketDebuggerUrl;
    } catch (e) { }
  }
  if (!wsUrl) { console.log('EDGE_FAIL'); edge.kill(); return; }

  const WebSocket = global.WebSocket; // Node 22 原生 WebSocket
  const ws = new WebSocket(wsUrl);
  let id = 0; const pending = {};
  ws.onmessage = ev => { const d = JSON.parse(ev.data); if (d.id && pending[d.id]) { pending[d.id](d); delete pending[d.id]; } };
  const send = (method, params) => new Promise(res => { id++; pending[id] = res; ws.send(JSON.stringify({ id, method, params })); });
  await new Promise(r => { ws.onopen = r; });
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: W < 500 });
  await send('Page.navigate', { url: URL_ });
  await new Promise(r => setTimeout(r, WAIT));
  // 可选：先登录再截内页（环境变量 WS_PASS）
  if (process.env.WS_PASS) {
    await send('Runtime.enable');
    await send('Runtime.evaluate', { awaitPromise: true, expression:
      `fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({user:${JSON.stringify(process.env.WS_USER || 'admin')},pass:${JSON.stringify(process.env.WS_PASS)}})}).then(r=>r.json())` });
    await send('Page.navigate', { url: URL_ });
    await new Promise(r => setTimeout(r, WAIT));
  }
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(OUT, Buffer.from(shot.result.data, 'base64'));
  console.log('SAVED', OUT);
  edge.kill();
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
