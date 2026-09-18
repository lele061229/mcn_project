const os = require('os'), path = require('path');
const { spawn } = require('child_process');
const EDGE = 'C://Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = process.env.WS_BASE || 'http://120.25.151.128:3000';
const PORT = 9299;
const RUN = String(Date.now()).slice(-6);
const proc = spawn(EDGE, ['--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port='+PORT,'--user-data-dir='+path.join(os.tmpdir(),'edge-probe3-'+Date.now()),'--window-size=1600,1040','about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  await sleep(2500);
  const tabs = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
  const ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl);
  let id = 0; const pend = new Map(); const errs = []; const failed = [];
  const send = (m, p) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p || {} })); });
  ws.onmessage = e => { const m = JSON.parse(e.data);
    if (m.method === 'Runtime.exceptionThrown') { const d = m.params.exceptionDetails; const t = ((d.exception && d.exception.description) || d.text || '').slice(0, 500); errs.push(t); failed.push(t); }
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result || m.error); pend.delete(m.id); } };
  await new Promise(r => ws.onopen = r);
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  const ev = async ex => { const r = await send('Runtime.evaluate', { expression: ex, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) return 'EVAL_ERR: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text).slice(0, 300); return r.result ? r.result.value : null; };
  // 与 check-crm-ui.js 完全一致的序列
  await send('Page.navigate', { url: BASE + '/' }); await sleep(1300);
  await ev(`fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({user:'admin',pass:'wsccbe9e7e38e3'})}).then(r=>r.json())`);
  await send('Page.navigate', { url: BASE + '/' }); await sleep(3200);
  const seed = await ev(`(async () => {
    const mk = (name, owner, ownerPosition) => fetch('/api/mvp/leads',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,owner,ownerPosition,channel:'UI回归'})}).then(r=>r.json());
    const out = [];
    out.push(await mk('UI回归'+RUN+'-招募A','李婷','recruit'));
    out.push(await mk('UI回归'+RUN+'-招募B','李婷','recruit'));
    out.push(await mk('UI回归'+RUN+'-运营A','王浩','ops'));
    out.push(await mk('UI回归'+RUN+'-运营B','王浩','ops'));
    return out.map(x => x && x.ok ? 'ok' : JSON.stringify(x));
  })()`);
  console.log('seed:', JSON.stringify(seed));
  await send('Page.navigate', { url: BASE + '/' }); await sleep(3400);
  console.log('errs-after-load:', JSON.stringify(errs)); errs.length = 0;
  console.log('nav click:', await ev(`(() => { const a=[...document.querySelectorAll('nav a')].find(a=>a.textContent.includes('达人线索')); if(!a) return 'NAV_NOT_FOUND'; a.click(); return 'ok'; })()`));
  await sleep(2200);
  console.log('errs-after-nav:', JSON.stringify(errs));
  console.log('state:', await ev(`JSON.stringify({hasRange: document.body.innerText.includes('数据范围'), vis: (document.body.innerText.match(/可见 (\\d+) 条/)||[])[1]||'-1', tables: document.querySelectorAll('table').length})`));
  // 直接在页面里 fetch 列表接口看响应
  console.log('leads api:', await ev(`fetch('/api/mvp/leads').then(r=>r.text()).then(t=>JSON.stringify({len: t.length, head: t.slice(0, 120)}))`));
  console.log('ALL ERRS:', JSON.stringify(failed, null, 1).slice(0, 2000));
  proc.kill(); process.exit(0);
})().catch(e => { console.error('PROBE ERR', e); proc.kill(); process.exit(1); });
