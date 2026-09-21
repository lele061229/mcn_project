#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""业务主链回归（P0 优化）：负责人分离 / 转正式→待运营接收 / 结构化交接 / 任务负责人与逾期 / 运营计划 / 结果回流 / 风险提醒
用法: python v1/check-biz-chain.py [base]   # 缺省 http://127.0.0.1:3000
"""
import json, sys, urllib.request, http.cookiejar

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:3000'
cj = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))

def call(path, data=None, method=None):
    m = method or ('POST' if data else 'GET')
    req = urllib.request.Request(BASE + path, method=m)
    req.add_header('Content-Type', 'application/json')
    if data: req.data = json.dumps(data).encode()
    try:
        return json.loads(opener.open(req).read().decode())
    except urllib.error.HTTPError as e:
        return {'HTTP': e.code, 'body': e.read().decode()[:300]}

import urllib.error
N = [0]
FAILS = []
def check(name, cond, extra=''):
    N[0] += 1
    tag = '✓' if cond else '✗'
    if not cond: FAILS.append(name)
    print(f"{tag} {name}" + (f" | {extra}" if extra and not cond else ''))
    return cond

import datetime
TODAY = datetime.date.today().isoformat()
YESTERDAY = (datetime.date.today() - datetime.timedelta(days=1)).isoformat()

# ---- 管理员登录 ----
r = call('/api/login', {'user': 'admin', 'pass': 'wsccbe9e7e38e3'})
check('管理员登录', r.get('ok') is True)

# ---- 1 风险提醒 ----
d = call('/api/mvp/dashboard')['data']
alerts = d.get('alerts')
check('看板返回 alerts 数组', isinstance(alerts, list))
check('alerts 每项含 type/count/text/page', all(all(k in a for k in ('type', 'count', 'text', 'page')) for a in alerts))

# ---- 2 建线索 → 报名 → 转正式 → 待运营接收 ----
lead = call('/api/mvp/leads', {'name': '主链回归-' + TODAY, 'contact': 'chain', 'channel': '其他'})
check('创建线索', lead.get('ok') is True)
lid = lead['data']['id']
call('/api/mvp/leads/' + lid, {'status': '已报名'}, 'PUT')
conv = call('/api/mvp/leads/' + lid + '/convert', {}, 'POST')
check('转为正式达人', conv.get('ok') is True)
check('转化人=管理员', conv['data']['convertedBy'] == '管理员')
check('转正后待运营接收(opsPending)', conv['data']['opsPending'] is True)
check('原负责人保留(招募阶段负责人不丢)', conv['data']['owner'] == '管理员')

# ---- 3 结构化交接 → 确认 → talent_operator 更新 ----
ho = call('/api/mvp/leads/' + lid + '/handover', {
    'toUser': '王浩', 'reason': '回归交接', 'situation': '情况S', 'accountState': '账号X',
    'coopWay': '寄拍', 'contentDirection': '开箱', 'risk': '风险R', 'nextSuggest': '建议N', 'note': '备注B'})
check('发起交接', ho.get('ok') is True)
hid = ho['data']['id']
check('交接单含结构化字段', all(ho['data'].get(k) for k in ('situation', 'accountState', 'coopWay', 'contentDirection', 'risk', 'nextSuggest')))
conf = call('/api/mvp/handovers/' + hid + '/confirm', {}, 'POST')
check('运营确认接收', conf.get('ok') is True)
tal = [x for x in call('/api/mvp/talents')['data'] if x['id'] == lid][0]
check('确认后负责人=接收运营(王浩/ops)', tal['owner'] == '王浩' and tal['ownerPosition'] == 'ops')
check('达人运营负责人固化(opsBy=王浩)', tal['opsBy'] == '王浩')
check('确认后 opsPending 消除', tal['opsPending'] is False)
# 拒绝路径
tal2 = call('/api/mvp/leads', {'name': '主链回归拒绝-' + TODAY, 'contact': 'chain2', 'channel': '其他'})
lid2 = tal2['data']['id']
call('/api/mvp/leads/' + lid2, {'status': '已报名'}, 'PUT')
call('/api/mvp/leads/' + lid2 + '/convert', {}, 'POST')
ho2 = call('/api/mvp/leads/' + lid2 + '/handover', {'toUser': '王浩', 'reason': '拒绝测试'})
h2 = call('/api/mvp/handovers/' + ho2['data']['id'] + '/reject', {'reason': '不合适'}, 'POST')
check('交接可驳回', h2.get('ok') is True and h2['data']['statusLabel'] == '已驳回')
tal2row = [x for x in call('/api/mvp/talents')['data'] if x['id'] == lid2][0]
check('驳回后负责人保持不变', tal2row['owner'] == '管理员')

# ---- 4 任务：发起运营 / 截止 / 逾期派生 / 达人归属不变 ----
tk = call('/api/tasks', {'talentId': lid, 'product': '回归鞋', 'commission': 88, 'owner': '张萌', 'dueAt': YESTERDAY, 'note': '回归备注'})
check('运营发起任务', tk.get('ok') is True)
tid = tk['data']['id']
check('任务记录发起运营', tk['data']['createdBy'] == '管理员')
check('任务记录截止时间', tk['data']['dueAt'] == YESTERDAY)
row = [x for x in call('/api/tasks')['data'] if x['id'] == tid][0]
check('逾期任务派生 overdue=True', row['overdue'] is True and row['dueSoon'] is False)
tal = [x for x in call('/api/mvp/talents')['data'] if x['id'] == lid][0]
check('建任务不改达人运营负责人', tal['opsBy'] == '王浩')

# ---- 4.5 交接确认后任务归属跟随新运营（20260921b）----
# 场景：达人还在招募岗李婷名下 → 建任务（归属李婷）→ 交接给运营王浩 → 确认后任务归属必须一起改，
# 否则任务中心仍显示旧负责人，与达人档案的运营负责人自相矛盾（验收报告 P0「任务负责人与当前运营不一致」）。
t3 = call('/api/mvp/leads', {'name': '主链回归任务归属-' + TODAY, 'contact': 'chain3', 'channel': '其他',
                             'owner': '李婷', 'ownerPosition': 'recruit'})
lid3 = t3['data']['id']
call('/api/mvp/leads/' + lid3, {'status': '已报名'}, 'PUT')
call('/api/mvp/leads/' + lid3 + '/convert', {}, 'POST')
tk3 = call('/api/tasks', {'talentId': lid3, 'product': '归属跟随鞋', 'commission': 10, 'owner': '李婷'})
tid3 = tk3['data']['id']
check('交接前任务归属招募岗李婷', tk3['data']['owner'] == '李婷' and tk3['data']['ownerId'] == 'demo-recruit',
      (tk3['data'].get('owner'), tk3['data'].get('ownerId')))
ho3 = call('/api/mvp/leads/' + lid3 + '/handover', {'toUser': '王浩', 'reason': '任务归属跟随回归'})
conf3 = call('/api/mvp/handovers/' + ho3['data']['id'] + '/confirm', {}, 'POST')
check('交接给运营后确认成功', conf3.get('ok') is True, conf3)
trow3 = [x for x in call('/api/mvp/talents')['data'] if x['id'] == lid3][0]
check('确认后达人负责人=王浩(ops) 且 opsBy 固化', trow3['owner'] == '王浩' and trow3['opsBy'] == '王浩',
      (trow3.get('owner'), trow3.get('opsBy')))
row3 = [x for x in call('/api/tasks')['data'] if x['id'] == tid3]
row3 = row3[0] if row3 else {}
check('交接确认后任务归属跟随新运营（owner/ownerId 同步为王浩）',
      row3.get('owner') == '王浩' and row3.get('ownerId') == 'demo-staff',
      (row3.get('owner'), row3.get('ownerId')))

# ---- 4.6 转正式达人权限收敛（20260921b）：招募/运营必须走「提交审核」----
t4 = call('/api/mvp/leads', {'name': '主链回归转正权限-' + TODAY, 'contact': 'chain4', 'channel': '其他',
                             'owner': '李婷', 'ownerPosition': 'recruit'})
lid4 = t4['data']['id']
call('/api/login', {'user': 'demo-recruit', 'pass': 'demo123456'})
cv4 = call('/api/mvp/leads/' + lid4 + '/convert', {}, 'POST')
check('招募岗（线索负责人）直接转正式达人被拒 403', cv4.get('HTTP') == 403, cv4)
call('/api/login', {'user': 'demo-staff', 'pass': 'demo123456'})
cv5 = call('/api/mvp/leads/' + lid4 + '/convert', {}, 'POST')
check('普通运营直接转正式达人被拒 403', cv5.get('HTTP') == 403, cv5)
call('/api/login', {'user': 'admin', 'pass': 'wsccbe9e7e38e3'})
cv6 = call('/api/mvp/leads/' + lid4 + '/convert', {}, 'POST')
check('管理员转正式达人放行（主管特权保留）', cv6.get('ok') is True, cv6)

# 招募岗不能发起（寄拍执行岗位已删除，任务由运营登记、达人完成）
call('/api/login', {'user': 'demo-recruit', 'pass': 'demo123456'})
tk2 = call('/api/tasks', {'talentId': lid, 'product': '越权'})
check('招募岗发起任务被拒(403)', tk2.get('HTTP') == 403 or tk2.get('ok') is False)
call('/api/login', {'user': 'admin', 'pass': 'wsccbe9e7e38e3'})

# ---- 5 运营计划字段 ----
acc = call('/api/mvp/accounts/' + lid, {'opsPlan': '计划P', 'weekGoal': '目标G', 'nextAction': '动作A', 'needShoot': '是', 'opsNote': '备注O'}, 'PUT')
check('更新运营计划', acc.get('ok') is True)
acc2 = [x for x in call('/api/mvp/accounts')['data']['rows'] if x['id'] == lid][0]
check('计划字段读回一致', acc2['opsPlan'] == '计划P' and acc2['needShoot'] == '是' and acc2['nextAction'] == '动作A')

# ---- 6 发布回流 + 档案汇总 ----
chain = [('confirm', {}), ('send', {'trackingNo': 'SF001'}), ('sign', {}), ('startShoot', {}),
         ('submitContent', {'contentUrl': 'http://x', 'contentNote': 'n'}), ('auditPass', {}), ('publish', {'contentUrl': 'http://x'})]
for a, extra in chain:
    call('/api/tasks/' + tid + '/status', dict({'action': a}, **extra), 'PATCH')
acc3 = [x for x in call('/api/mvp/accounts')['data']['rows'] if x['id'] == lid][0]
check('发布后最近发布回流账号视角', acc3['dewuLastPublish'] == TODAY)
trow = [x for x in call('/api/mvp/talents')['data'] if x['id'] == lid][0]
check('档案汇总：累计任务=1', trow['taskTotal'] == 1)
check('档案汇总：累计收益=88', abs(trow['totalCommission'] - 88) < 0.01)
check('档案汇总：最近发布=今天', trow['lastPublish'] == TODAY)

# ---- 7 清理 ----
call('/api/tasks/' + tid, method='DELETE')
call('/api/tasks/' + tid3, method='DELETE')
call('/api/talents/' + lid, method='DELETE')
call('/api/talents/' + lid2, method='DELETE')
call('/api/talents/' + lid3, method='DELETE')
call('/api/talents/' + lid4, method='DELETE')
if FAILS:
    print(f"\n失败 {len(FAILS)} 项：{' | '.join(FAILS)}")
    print(f"通过 {N[0] - len(FAILS)} 项，失败 {len(FAILS)} 项")
    sys.exit(1)
print(f"\n通过 {N[0]} 项断言")
sys.exit(0)
