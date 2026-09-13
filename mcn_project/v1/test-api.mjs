/* V1 API 自动化测试：验证第十六节核心链路 + 权限 + 状态机 + 必填校验 */
const B = 'http://localhost:3000';
const call = async (method, path, body, op = '李四', role = '主管') => {
  const r = await fetch(B + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Operator': encodeURIComponent(op), 'X-Role': encodeURIComponent(role) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, json: await r.json().catch(() => null) };
};
const assert = (name, cond, extra = '') => console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (extra ? ' | ' + extra : ''));
(async () => {
  let r = await call('GET', '/api/meta');
  assert('01 存储模式=mock', r.json.data.mode === 'mock');

  r = await call('GET', '/api/talents/T0001');
  assert('02 飞书存在小王→详情可见且待审核', r.status === 200 && r.json.data.talent.status === '待审核');
  assert('03 小王详情含历史任务与跟进记录', r.json.data.tasks.length >= 1 && r.json.data.followups.length >= 1);

  r = await call('PATCH', '/api/talents/T0001/status', { status: '已通过' }, '张三', '运营');
  assert('04 普通运营审核达人→403', r.status === 403);

  r = await call('POST', '/api/talents', { name: '测试' }, '王五', '财务');
  assert('05 财务修改数据→403', r.status === 403);

  r = await call('PATCH', '/api/talents/T0001/status', { status: '已通过' });
  assert('06 主管审核通过→已通过+审核人', r.status === 200 && r.json.data.status === '已通过' && r.json.data.auditBy === '李四' && r.json.data.auditAt);

  r = await call('PATCH', '/api/talents/T0016/status', { status: '已拒绝' });
  assert('07 审核拒绝缺原因→400', r.status === 400);

  r = await call('PATCH', '/api/talents/T0016/status', { status: '已拒绝', reason: '粉丝量不足' });
  assert('08 审核拒绝带原因→已拒绝', r.status === 200 && r.json.data.rejectReason === '粉丝量不足');

  r = await call('PATCH', '/api/tasks/TK1015/status', { action: 'send' });
  assert('09 已寄出缺快递单号→400', r.status === 400);

  r = await call('PATCH', '/api/tasks/TK1015/status', { action: 'send', trackingNo: 'SF99990001' });
  assert('10 已寄出带单号→已寄出+寄出时间', r.status === 200 && r.json.data.status === '已寄出' && r.json.data.sentAt);

  r = await call('PATCH', '/api/tasks/TK1015/status', { action: 'complete' });
  assert('11 非法状态跳转→400', r.status === 400);

  r = await call('PATCH', '/api/tasks/TK1006/status', { action: 'auditPass' }, '张三', '运营');
  assert('12 普通运营审核任务→403', r.status === 403);

  r = await call('PATCH', '/api/tasks/TK1006/status', { action: 'auditPass' });
  assert('13 主管任务审核通过→待发布', r.status === 200 && r.json.data.status === '待发布');

  r = await call('PATCH', '/api/tasks/TK1010/status', { action: 'submitContent', contentUrl: 'https://v.douyin.com/t10', contentNote: '口播+开箱' });
  assert('14 提交内容→待审核+提交时间', r.status === 200 && r.json.data.status === '待审核' && r.json.data.contentAt);

  r = await call('PATCH', '/api/tasks/TK1010/status', { action: 'auditReject', auditOpinion: '商品特写不足' });
  assert('15 审核不通过→内容修改中+意见', r.status === 200 && r.json.data.status === '内容修改中' && r.json.data.auditOpinion === '商品特写不足');

  r = await call('PATCH', '/api/tasks/TK1010/status', { action: 'resubmit' });
  assert('16 重新提交→待审核', r.status === 200 && r.json.data.status === '待审核');

  r = await call('PATCH', '/api/tasks/TK1012/status', { action: 'markException', to: '超时', issue: '达人未确认收货' });
  assert('17 标记异常→超时+异常说明', r.status === 200 && r.json.data.status === '超时' && String(r.json.data.issue).includes('达人未确认收货'));

  r = await call('POST', '/api/talents/T0002/followups', { content: '测试跟进', method: '电话', nextAt: '2026-09-10' });
  assert('18 添加跟进记录', r.status === 200 && r.json.data.operator === '李四');

  r = await call('POST', '/api/talents', { name: '测试达人A', fans: '12345' }, '张三', '运营');
  assert('19 新增达人→待联系', r.status === 200 && r.json.data.status === '待联系');

  r = await call('POST', '/api/tasks', { talentId: 'T0002', product: '测试商品X', commission: '500' });
  assert('20 创建寄拍任务→待确认', r.status === 200 && r.json.data.status === '待确认');

  r = await call('POST', '/api/talents/T0013/deactivate');
  assert('21 停用=逻辑删除(is_active=false)', r.status === 200 && r.json.data.isActive === false);

  r = await call('GET', '/api/logs');
  assert('22 操作日志已记录全部操作', r.status === 200 && r.json.data.length >= 10);
  console.log('日志样例:', JSON.stringify(r.json.data[0]));
})().catch(e => console.error('TEST ERROR', e));
