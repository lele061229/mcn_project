/* 权限体系与交接流程的接口级回归测试（不依赖浏览器）
   覆盖：身份可信、行级可见范围、越权降级与拦截、交接全流程、留痕 */
const BASE = process.env.WS_BASE || 'http://127.0.0.1:3000';
const P = 'demo123456';
let passCount = 0, failCount = 0;

const D = r => (r && r.j && r.j.data !== undefined ? r.j.data : (r ? r.j : null));
function check(name, cond, extra) {
  if (cond) { passCount++; console.log('  PASS  ' + name); }
  else { failCount++; console.log('  FAIL  ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}
async function login(user, pwd) {
  const r = await fetch(BASE + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user, pass: pwd }) });
  const j = await r.json().catch(() => null);
  const raw = r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie') || ''];
  const cookie = raw.filter(Boolean).map(c => c.split(';')[0]).join('; ');
  return { status: r.status, j, cookie };
}
async function api(cookie, path, method, body, extraHeaders) {
  const r = await fetch(BASE + path, {
    method: method || 'GET',
    headers: Object.assign({ 'Content-Type': 'application/json' }, cookie ? { Cookie: cookie } : {}, extraHeaders || {}),
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => null);
  return { status: r.status, j };
}

(async () => {
  console.log('== 1. 身份可信（以 token 为准，不信任请求头）==');
  const admin = await login('admin', 'wsccbe9e7e38e3');
  check('admin 登录成功', admin.status === 200, admin.j);
  const adminMe = await api(admin.cookie, '/api/me');
  check('admin 会话角色为 admin', D(adminMe) && D(adminMe).role === 'admin', D(adminMe));
  check('admin 会话带出姓名与岗位', D(adminMe) && !!D(adminMe).displayName && !!D(adminMe).position, D(adminMe));

  check('未登录访问线索接口 → 401', (await api('', '/api/mvp/leads')).status === 401);

  const forged = await api(admin.cookie, '/api/mvp/leads?scope=all', 'GET', null, { 'x-role': 'staff' });
  check('伪造 x-role 头无法降低/提升真实权限（仍按 token 判定）', forged.status === 200 && Array.isArray(D(forged)), forged.status);

  console.log('== 2. 岗位账号 ==');
  for (const u of [
    { user: 'demo-recruit', role: 'staff', position: 'recruit', displayName: '李婷' },
    { user: 'demo-promote', role: 'staff', position: 'promote', displayName: '陈晨' },
  ]) {
    const r = await api(admin.cookie, '/api/users', 'POST', Object.assign({ pass: P }, u));
    if (r.status !== 200) console.log('   (账号 ' + u.user + ' 已存在或建号返回 ' + r.status + ')');
  }
  const recruit = await login('demo-recruit', P);
  const ops = await login('demo-staff', P);
  const other = await login('demo-promote', P);   // 「无关岗位」账号：推广岗（原寄拍岗 sample 已随角色模型重构删除）
  check('招募岗账号可登录', recruit.status === 200, recruit.j);
  check('推广岗账号可登录', other.status === 200, other.j);
  const recruitMe = await api(recruit.cookie, '/api/me');
  check('招募岗姓名=李婷 / 岗位=recruit',
    D(recruitMe) && D(recruitMe).displayName === '李婷' && D(recruitMe).position === 'recruit', D(recruitMe));
  const opsMe = await api(ops.cookie, '/api/me');
  check('运营岗姓名=王浩 / 岗位=ops',
    D(opsMe) && D(opsMe).displayName === '王浩' && D(opsMe).position === 'ops', D(opsMe));

  console.log('== 3. 行级可见范围 ==');
  const all = D(await api(admin.cookie, '/api/mvp/leads?scope=all'));
  check('管理员看到全部线索', Array.isArray(all) && all.length > 0, { n: all && all.length });

  const rMine = D(await api(recruit.cookie, '/api/mvp/leads?scope=mine'));
  check('招募岗「我负责的」全部 owner=李婷',
    rMine.length > 0 && rMine.every(l => l.owner === '李婷'), { n: rMine.length, owners: [...new Set(rMine.map(l => l.owner))] });
  check('招募岗看到的条数少于管理员（数据被裁剪）', rMine.length < all.length, { mine: rMine.length, all: all.length });

  const rPos = D(await api(recruit.cookie, '/api/mvp/leads?scope=position'));
  check('招募岗「本岗位池」全部 ownerPosition=recruit',
    rPos.length > 0 && rPos.every(l => l.ownerPosition === 'recruit'), { positions: [...new Set(rPos.map(l => l.ownerPosition))] });

  const rEsc = D(await api(recruit.cookie, '/api/mvp/leads?scope=all'));
  check('越权请求 scope=all 被自动降级为「我负责的」', rEsc.length === rMine.length, { esc: rEsc.length, mine: rMine.length });

  const sMine = D(await api(other.cookie, '/api/mvp/leads?scope=mine'));
  check('推广岗看不到招募岗负责的线索（跨岗位隔离）',
    sMine.every(l => l.owner !== '李婷' && l.ownerPosition !== 'recruit'), { owners: [...new Set(sMine.map(l => l.owner))] });

  console.log('== 4. 越权修改拦截 ==');
  const targetLead = rMine[0];
  check('招募岗有可用于测试的线索', !!targetLead);
  const directChange = await api(recruit.cookie, '/api/mvp/leads/' + targetLead.id, 'PUT', { owner: '王浩' });
  check('非管理员直接改负责人 → 403（必须走交接）', directChange.status === 403, directChange.j);
  const otherLead = all.find(l => l.owner !== '李婷');
  const touchOther = await api(recruit.cookie, '/api/mvp/leads/' + otherLead.id, 'PUT', { note: '越权改一下' });
  check('非负责人改别人的线索 → 403', touchOther.status === 403, touchOther.j);

  console.log('== 5. 交接全流程 ==');
  const targets = D(await api(recruit.cookie, '/api/mvp/handover-targets?exclude=李婷'));
  check('交接候选人接口可用且已排除当前负责人',
    Array.isArray(targets) && targets.length > 0 && targets.every(t => t.name !== '李婷'), { n: targets && targets.length });

  const ho = await api(recruit.cookie, '/api/mvp/handovers', 'POST', { talentId: targetLead.id, toUser: '王浩', toPosition: 'ops', reason: '该达人转向寄拍合作，转运营跟进' });
  check('发起交接成功并返回 pending', ho.status === 200 && D(ho).status === 'pending', D(ho));
  const hoId = D(ho) && D(ho).id;

  const asked = D(await api(admin.cookie, '/api/mvp/leads?scope=all')).find(l => l.id === targetLead.id);
  check('线索被标记「待交接」且接收人正确', asked && asked.handoverStatus === 'pending' && asked.handoverTo === '王浩', asked);
  check('接收岗位带出中文标签', asked && asked.handoverToPositionLabel === '普通运营', asked);

  const dup = await api(recruit.cookie, '/api/mvp/handovers', 'POST', { talentId: targetLead.id, toUser: '张萌' });
  check('同一线索重复发起交接 → 409', dup.status === 409, dup.j);

  const inbox = D(await api(ops.cookie, '/api/mvp/handovers?box=inbox'));
  check('接收人「待我确认」里能看到该交接单', inbox.some(h => h.id === hoId), inbox);
  const inboxOther = D(await api(other.cookie, '/api/mvp/handovers?box=inbox'));
  check('非接收人的待确认列表里没有该交接单', !inboxOther.some(h => h.id === hoId), inboxOther);

  const wrongConfirm = await api(other.cookie, '/api/mvp/handovers/' + hoId + '/confirm', 'POST');
  check('非接收人确认 → 403', wrongConfirm.status === 403, wrongConfirm.j);

  const pendingList = D(await api(ops.cookie, '/api/mvp/leads?scope=mine'));
  check('待确认期间线索已进入接收人视野', pendingList.some(l => l.id === targetLead.id));

  const confirmed = await api(ops.cookie, '/api/mvp/handovers/' + hoId + '/confirm', 'POST');
  check('接收人确认成功', confirmed.status === 200 && D(confirmed).status === 'confirmed', D(confirmed));

  const moved = D(await api(admin.cookie, '/api/mvp/leads?scope=all')).find(l => l.id === targetLead.id);
  check('确认后负责人自动变更为王浩', moved && moved.owner === '王浩', moved);
  check('确认后岗位同步为运营', moved && moved.ownerPosition === 'ops', moved);
  // 新语义：确认后交接状态置为 confirmed，并保留本次交接摘要（原负责人/接收人/岗位/时间）供总表与详情展示
  check('确认后交接状态=已接收（confirmed）', moved && moved.handoverStatus === 'confirmed', moved);
  check('确认后保留交接摘要（原负责人/接收岗位/接收时间）',
    moved && moved.handoverFrom === '李婷' && moved.handoverToPosition === 'ops' && !!moved.handoverReceivedAt, moved);

  const opsMine = D(await api(ops.cookie, '/api/mvp/leads?scope=mine'));
  check('该线索现在归属运营岗「我负责的」', opsMine.some(l => l.id === targetLead.id));
  const recruitMine = D(await api(recruit.cookie, '/api/mvp/leads?scope=mine'));
  check('该线索已从原负责人「我负责的」消失', !recruitMine.some(l => l.id === targetLead.id));

  const reconfirm = await api(ops.cookie, '/api/mvp/handovers/' + hoId + '/confirm', 'POST');
  check('重复确认同一交接单 → 409', reconfirm.status === 409, reconfirm.j);

  console.log('== 6. 留痕（交接 / 状态 / 负责人变化）==');
  const hist = D(await api(ops.cookie, '/api/mvp/leads/' + targetLead.id + '/history'));
  check('流转历史接口可用', hist && Array.isArray(hist.rows), hist);
  const types = hist.rows.map(r => r.type);
  check('历史里有「线索交接-发起」', types.includes('线索交接-发起'), types);
  check('历史里有「线索交接-确认」', types.includes('线索交接-确认'), types);
  const confRow = hist.rows.find(r => r.type === '线索交接-确认');
  check('确认记录含变更前后负责人', confRow && confRow.before.includes('李婷') && confRow.after.includes('王浩'), confRow);
  check('确认记录留有操作人', confRow && !!confRow.operator, confRow);

  const otherHist = await api(other.cookie, '/api/mvp/leads/' + targetLead.id + '/history');
  check('无关岗位查该线索历史 → 403', otherHist.status === 403, otherHist.status);

  const logs = D(await api(admin.cookie, '/api/logs'));
  check('/api/logs 出现交接类日志', logs.some(l => String(l.type).indexOf('线索交接') === 0), logs && logs.slice(0, 3));

  console.log('== 7. 管理员强制指派 ==');
  const second = D(await api(ops.cookie, '/api/mvp/leads?scope=mine'))[0];
  if (second) {
    const forced = await api(admin.cookie, '/api/mvp/handovers', 'POST', { talentId: second.id, toUser: '李婷', toPosition: 'recruit', reason: '管理员指派回招募' });
    check('管理员可发起交接', forced.status === 200, forced.j);
    if (D(forced) && D(forced).id) {
      const f = await api(admin.cookie, '/api/mvp/handovers/' + D(forced).id + '/force', 'POST');
      check('管理员强制指派跳过确认直接变更', f.status === 200 && D(f).status === 'confirmed', D(f));
    }
  }

  console.log('\n结果：通过 ' + passCount + ' 项，失败 ' + failCount + ' 项');
  process.exit(failCount ? 1 : 0);
})().catch(e => { console.error('测试异常：', e); process.exit(1); });
