const os = require('os'), path = require('path');
const { spawn } = require('child_process');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = process.env.WS_BASE || 'http://120.25.151.128:3000';
const USER = process.env.PROBE_USER || 'demo-senior', PASS = 'demo123456';
const PORT = 9302;
const proc = spawn(EDGE, ['--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port='+PORT,'--user-data-dir='+path.join(os.tmpdir(),'edge-bell-'+Date.now()),'--window-size=1600,1040','about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  await sleep(2500);
  const tabs = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
  const ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl);
  let id = 0; const pend = new Map(); const errs = [];
  const send = (m, p) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p || {} })); });
  ws.onmessage = e => { const m = JSON.parse(e.data);
    if (m.method === 'Runtime.exceptionThrown') { const d = m.params.exceptionDetails; errs.push(((d.exception && d.exception.description) || d.text || '').slice(0, 300)); }
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result || m.error); pend.delete(m.id); } };
  await new Promise(r => ws.onopen = r);
  await send('Runtime.enable'); await send('Page.enable');
  const ev = async ex => { const r = await send('Runtime.evaluate', { expression: ex, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) return 'EVAL_ERR: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text).slice(0, 250); return r.result ? r.result.value : null; };
  await send('Page.navigate', { url: BASE + '/' }); await sleep(1500);
  console.log('login:', await ev(`fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({user:'${USER}',pass:'${PASS}'})}).then(r=>r.json()).then(j=>j.code||j.ok||JSON.stringify(j).slice(0,80))`));
  await send('Page.navigate', { url: BASE + '/' }); await sleep(4200);
  console.log('diag:', await ev(`JSON.stringify({
    appLen: (document.getElementById('app')||{innerHTML:'NOAPP'}).innerHTML.length,
    bodyText: document.body.innerText.slice(0, 120),
    scripts: [...document.querySelectorAll('script')].map(s=>s.src.split('/').pop()+'?'+(s.src.split('?v=')[1]||'')).join('|'),
    res: performance.getEntriesByType('resource').filter(r=>/app|talent|vendor/.test(r.name)).map(r=>r.name.split('/').pop()+' size='+r.transferSize+' dur='+Math.round(r.duration)).join(' | ')
  })`));
  console.log('aria labels:', await ev(`[...document.querySelectorAll('button[aria-label]')].map(b=>b.getAttribute('aria-label')).join('|')`));
  console.log('header html len:', await ev(`(document.querySelector('header')||{innerHTML:''}).innerHTML.length`));
  console.log('bell exists:', await ev(`!!document.querySelector('button[aria-label="消息中心"]')`));
  console.log('badge:', await ev(`(() => { const b=document.querySelector('button[aria-label="消息中心"] span'); return b ? b.textContent.trim() : 'NO_BADGE'; })()`));
  console.log('api in page:', await ev(`fetch('/api/notifications').then(r=>r.json()).then(j=>JSON.stringify({unread:j.data.unread, first:(j.data.items[0]||{}).type}))`));
  console.log('js errors:', JSON.stringify(errs.slice(0,5)));
  // 点开铃铛
  await ev(`document.querySelector('button[aria-label="消息中心"]').click()`);
  await sleep(800);
  console.log('panel first item:', await ev(`(() => { const p=[...document.querySelectorAll('.absolute.right-0 .px-4')]; return p.length ? p[0].innerText.replace(/\n/g,' | ').slice(0,120) : 'PANEL_EMPTY'; })()`));
  proc.kill(); process.exit(0);
})().catch(e => { console.error('PROBE ERR', e); proc.kill(); process.exit(1); });
