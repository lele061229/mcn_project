// 登录 + 点击指定导航 + 截图：node shot-page.js <输出路径> <导航文本|-> <账号> <密码> [宽] [高]
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const OUT = process.argv[2] || 'shot.png';
const NAV = process.argv[3] || '-';
const USER = process.argv[4] || 'admin';
const PASS = process.argv[5] || '';
const W = parseInt(process.argv[6] || '1440', 10);
const H = parseInt(process.argv[7] || '900', 10);
const BASE = process.env.WS_BASE || 'http://120.25.151.128:3000';
const PORT = 9800 + Math.floor(Math.random() * 150);
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=' + PORT,
    '--window-size=' + W + ',' + H, '--user-data-dir=' + fs.mkdtempSync(path.join(os.tmpdir(), 'edge-'))], { stdio: 'ignore' });
  let targets = null;
  for (let i = 0; i < 40 && !targets; i++) {
    await sleep(250);
    try { const r = await fetch('http://127.0.0.1:' + PORT + '/json/list'); targets = await r.json(); if (targets.some(t => t.type === 'page')) break; } catch (e) { }
  }
  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  const send = (m, p) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p || {} })); });
  ws.onmessage = ev => { const d = JSON.parse(ev.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d.result || d.error); pending.delete(d.id); } };
  await new Promise(r => { ws.onopen = r; });
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1.5, mobile: false });
  await send('Page.navigate', { url: BASE + '/' });
  await sleep(2500);
  await send('Runtime.enable');
  await send('Runtime.evaluate', { awaitPromise: true, expression:
    `fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({user:${JSON.stringify(USER)},pass:${JSON.stringify(PASS)}})}).then(r=>r.json())` });
  await send('Page.navigate', { url: BASE + '/' });
  await sleep(9000);
  if (NAV !== '-') {
    await send('Runtime.evaluate', { expression:
      `(() => { const el=[...document.querySelectorAll('a,button,li,div,span')].filter(e=>e.innerText && e.innerText.trim().startsWith(${JSON.stringify(NAV)})); el.sort((a,b)=>a.innerText.length-b.innerText.length); if(el[0]){el[0].click();return 'ok';} return 'NOT_FOUND'; })()` });
    await sleep(5000);
  }
  const shot = await send('Page.captureScreenshot', { format: 'png' }); if(!shot||!shot.data){console.log('SHOT_FAIL', JSON.stringify(shot).slice(0,300)); process.exit(1);}
  fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
  console.log('SAVED', OUT);
  ws.close(); edge.kill();
  await sleep(400); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
