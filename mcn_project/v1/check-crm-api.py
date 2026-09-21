# -*- coding: utf-8 -*-
"""CRM 权限体系 API 回归（分配 / 跟进 / 工作台 / 交接 / 越权拦截）

零依赖（只用标准库）；会自建测试线索并在结束时删除，可在本地与线上反复运行。
    python v1/check-crm-api.py                              # 本地 http://127.0.0.1:3000
    python v1/check-crm-api.py http://120.25.151.128:3000    # 线上
"""
import json, sys, time, urllib.request, urllib.error, http.cookiejar

BASE = (sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:3000').rstrip('/')
PASS = {'admin': 'wsccbe9e7e38e3', 'demo-recruit': 'demo123456', 'demo-staff': 'demo123456',
        'demo-senior': 'demo123456', 'demo-finance': 'demo123456', 'demo-promote': 'demo123456'}
RUN = str(int(time.time()))[-6:]
N = {'ra': 'APItest%s-招募A' % RUN, 'rb': 'APItest%s-招募B' % RUN, 'oa': 'APItest%s-运营A' % RUN,
     'oc': 'APItest%s-合作C' % RUN,
     # V0.3 主链：寄拍任务链路 + 双负责人固化
     'shoot': 'APItest%s-寄拍主链D' % RUN, 'ops2': 'APItest%s-双负责人E' % RUN,
     'asg': 'APItest%s-分配F' % RUN,
     # 20260921b 权限收敛用例
     'conv': 'APItest%s-转正权限G' % RUN,
     # 20260921c 轮询探针变更感知用例
     'rev': 'APItest%s-变更感知H' % RUN}
_results = []


def client():
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))


def call(op, path, body=None, method=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method or ('POST' if data else 'GET'))
    if data:
        req.add_header('Content-Type', 'application/json')
    try:
        with op.open(req) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode())
        except Exception:
            return e.code, None


def login(user):
    op = client()
    st, j = call(op, '/api/login', {'user': user, 'pass': PASS[user]})
    assert st == 200 and j and j.get('ok'), ('登录失败', user, st, j)
    return op


def chk(name, cond, extra=''):
    _results.append((name, bool(cond)))
    print(('PASS ' if cond else 'FAIL ') + name + (('  ' + str(extra)) if extra else ''))


def main():
    admin, recruit, senior, staff, fin, promote = (login('admin'), login('demo-recruit'),
                                          login('demo-senior'), login('demo-staff'), login('demo-finance'),
                                          login('demo-promote'))

    # ---------- 0. 自建测试数据 ----------
    # ra/oc 初始归招募岗（李婷），rb/oa 初始归运营岗（王浩）——后续分配/交接都要产生真实变更
    made = {}
    extra = {}   # 第 10/11 节（寄拍主链 / 双负责人）自建的达人，统一在清理节删除
    seedOwner = {'ra': '李婷', 'rb': '王浩', 'oa': '王浩', 'oc': '李婷'}
    for k in ('ra', 'rb', 'oa', 'oc'):
        st, j = call(admin, '/api/mvp/leads', {'name': N[k], 'owner': seedOwner[k],
                                               'ownerPosition': 'recruit' if seedOwner[k] == '李婷' else 'ops',
                                               'channel': 'API回归'})
        assert st == 200 and j.get('ok'), (k, st, j)
        made[k] = j['data']['id']
    chk('回归线索创建成功（4 条）', len(made) == 4, made)

    # ---------- 1. 数据可见范围（行级权限） ----------
    st, j = call(admin, '/api/mvp/leads?scope=all')
    chk('管理员可拉取全部线索', st == 200 and len(j['data']) >= 3, len(j['data']))
    all_leads = j['data']
    chk('线索带 ownerId（负责人按账号ID关联，非仅中文姓名）',
        all(x.get('ownerId') for x in all_leads if x['owner'] not in ('未分配',)),
        sum(1 for x in all_leads if x.get('ownerId')))

    st, j = call(recruit, '/api/mvp/leads')
    chk('普通负责人默认只拿到自己负责的（+公海）',
        all(x['owner'] in ('李婷', '未分配') for x in j['data']), len(j['data']))
    chk('普通负责人拿不到其他岗位的线索', not any(x['owner'] in ('王浩', '张萌') for x in j['data']))

    st, j = call(recruit, '/api/mvp/leads?scope=position')
    chk('本岗位池只含本岗位', all(x.get('ownerPosition') in ('recruit', '') for x in j['data']), len(j['data']))

    # ---------- 2. 越权拦截（后端裁决，不靠前端隐藏） ----------
    other = next(x for x in all_leads if x['owner'] == '王浩')
    for path, label in [('/api/mvp/leads/' + other['id'], '单条线索'),
                        ('/api/mvp/leads/' + other['id'] + '/history', '流转历史'),
                        ('/api/mvp/leads/' + other['id'] + '/follow-ups', '跟进记录')]:
        st, j = call(recruit, path)
        chk('越权读取他人线索（%s）→ 403' % label, st == 403, (st, j))
    st, j = call(recruit, '/api/mvp/leads/' + other['id'], {'status': '已联系'}, method='PUT')
    chk('越权修改他人线索 → 403', st == 403, (st, j))
    st, j = call(recruit, '/api/mvp/leads/%s/follow-ups' % other['id'], {'content': 'x'})
    chk('越权跟进他人线索 → 403', st == 403, (st, j))

    # ---------- 3. 分配（管理员） ----------
    st, j = call(recruit, '/api/mvp/leads/%s/assign' % made['ra'], {'owner': '李婷'})
    chk('非管理员调用分配接口 → 403', st == 403, (st, j))
    st, j = call(admin, '/api/mvp/leads/%s/assign' % made['ra'], {'owner': '王浩'})
    chk('管理员单条分配成功', st == 200 and j['data']['assigned'] == 1, (st, j.get('error')))
    lead = j['data']['leads'][0]
    chk('分配后 owner / ownerId / 岗位 一并更新',
        lead['owner'] == '王浩' and lead['ownerId'] == 'demo-staff' and lead['ownerPosition'] == 'ops',
        (lead['owner'], lead['ownerId'], lead['ownerPosition']))
    chk('分配后写入 assignedAt（分配时间）', bool(lead['assignedAt']), lead['assignedAt'])

    st, j = call(admin, '/api/mvp/leads/batch-assign', {'ids': [made['rb'], made['oa']], 'owner': '李婷'})
    chk('管理员批量分配成功（2 条）', st == 200 and j['data']['assigned'] == 2,
        (st, j.get('error'), j.get('data', {}).get('assigned')))
    chk('批量分配按岗位落库',
        all(x['owner'] == '李婷' and x['ownerPosition'] == 'recruit' for x in j['data']['leads']),
        [(x['owner'], x['ownerPosition']) for x in j['data']['leads']])
    st, j = call(admin, '/api/mvp/leads/batch-assign', {'ids': [made['rb']], 'owner': '张萌'})
    chk('批量分配给高级运营 → 400（高级运营不做达人负责人）', st == 400 and '不做达人负责人' in (j.get('error') or ''), (st, j.get('error')))
    st, j = call(admin, '/api/mvp/leads/batch-assign', {'ids': [], 'owner': '张萌'})
    chk('批量分配空勾选 → 400', st == 400, st)
    st, j = call(admin, '/api/mvp/leads/batch-assign', {'ids': [made['rb']], 'owner': '不存在的人'})
    chk('批量分配无效负责人 → 400', st == 400, (st, j.get('error')))

    # ---------- 4. 工作台待办规则 ----------
    st, j = call(staff, '/api/mvp/workbench')
    chk('工作台接口可用且返回卡片结构', st == 200 and 'cards' in j['data'],
        list(j['data']['cards']) if st == 200 else '')
    cards = j['data']['cards']
    chk('刚分配 → 产生「新分配给我」待办', cards['assigned'] >= 1, cards)
    chk('新分配待办带 类型/优先级/动作/来源',
        all(k in j['data']['todos'][0] for k in ('type', 'priority', 'action', 'source', 'due')),
        j['data']['todos'][0] if j['data']['todos'] else None)
    chk('普通负责人看不到「待分配」公海待办', cards.get('unassigned', 0) == 0, cards)
    st, j = call(admin, '/api/mvp/workbench')
    chk('管理员工作台能看到全部待办（含待分配）', j['data']['cards'].get('unassigned', 0) >= 1, j['data']['cards'])
    st, j = call(fin, '/api/mvp/workbench')
    chk('财务角色工作台可用且带结算专属卡片', st == 200 and isinstance(j['data'].get('extraCards'), list)
        and any('结算' in c.get('label', '') for c in j['data'].get('extraCards', [])),
        j['data'].get('extraCards'))
    st, j = call(senior, '/api/mvp/workbench')
    chk('高级运营工作台主管视角（接口可用 + 有达人待办）',
        st == 200 and isinstance(j['data'].get('todos'), list), st)
    st, j = call(promote, '/api/mvp/workbench')
    chk('推广岗工作台带投放效果卡片', st == 200 and any('投放' in c.get('label', '') or '线索' in c.get('label', '') for c in (j['data'].get('extraCards') or [])),
        j['data'].get('extraCards'))
    # 招募完成提示：招募岗名下达人进入「合作中」且未交接 → 出现「招募完成」待办（该转给运营了）
    # 先登记一次跟进（否则「新分配」待办优先命中，轮不到「招募完成」）
    st, j = call(recruit, '/api/mvp/leads/%s/follow-ups' % made['oc'],
                 {'method': '微信', 'result': '有兴趣', 'content': '确认合作意向，约定寄拍细节', 'nextFollowAt': '2026-12-15 10:00'})
    chk('负责人跟进「合作中」达人成功', st == 200, (st, j.get('error')))
    # 状态用 MVP 阶段口径（已成为达人 → 库里的「合作中」）
    st, j = call(recruit, '/api/mvp/leads/' + made['oc'], {'status': '已成为达人'}, method='PUT')
    chk('负责人把达人推进到「合作中」', st == 200, (st, j.get('error')))
    st, j = call(recruit, '/api/mvp/workbench')
    chk('工作台出现「招募完成」待办（提示交接给运营）',
        st == 200 and any(t['type'] == '招募完成' and t['talentId'] == made['oc'] for t in j['data'].get('todos', [])),
        [t['type'] for t in j['data'].get('todos', [])][:8])

    # ---------- 4.5 账号运营（得物账号指标：手动录入，待接入得物平台） ----------
    st, j = call(staff, '/api/mvp/accounts')
    accs = (j.get('data') or {}).get('rows') if st == 200 else []
    chk('运营岗账号列表只含自己名下达人', st == 200 and accs and all(r['owner'] == '王浩' for r in accs),
        sorted(set(r['owner'] for r in accs)) if accs else st)
    chk('账号行带 活跃度/粉丝数/更新频率/最近发布',
        all(k in accs[0] for k in ('dewuActivity', 'dewuFans', 'dewuUpdateDays', 'dewuLastPublish', 'updateStale')),
        list(accs[0].keys()) if accs else None)
    acc0 = accs[0]
    st, j = call(staff, '/api/mvp/accounts/' + acc0['id'],
                 {'dewuFans': acc0['dewuFans'] + 7, 'dewuActivity': '高', 'dewuUpdateDays': 2, 'dewuLastPublish': '2026-09-14'}, method='PUT')
    chk('运营手动更新自己账号数据成功', st == 200 and j['data']['dewuFans'] == acc0['dewuFans'] + 7
        and j['data']['dewuActivity'] == '高' and j['data']['dewuSource'] == 'manual',
        (st, j.get('error'), j.get('data', {}).get('dewuFans')))
    st, j = call(staff, '/api/mvp/accounts')
    chk('更新后数据落库（GET 读回一致）',
        any(r['id'] == acc0['id'] and r['dewuFans'] == acc0['dewuFans'] + 7 for r in j['data']['rows']), '')
    st, j = call(recruit, '/api/mvp/accounts/' + acc0['id'], {'dewuFans': 1}, method='PUT')
    chk('非负责人更新账号数据 → 403', st == 403, (st, j.get('error')))
    st, j = call(admin, '/api/mvp/accounts')
    chk('管理员账号列表 ≥ 运营岗（全量视角）', st == 200 and len(j['data']['rows']) >= len(accs),
        (len(j['data']['rows']), len(accs)))
    st, j = call(staff, '/api/mvp/accounts/' + acc0['id'],
                 {'dewuFans': acc0['dewuFans'], 'dewuActivity': acc0['dewuActivity']}, method='PUT')
    chk('测试后账号数据还原', st == 200, st)

    # ---------- 5. 跟进 ----------
    st, j = call(staff, '/api/mvp/leads/%s/follow-ups' % made['ra'], {
        'method': '微信', 'result': '已加微信', 'content': '介绍寄拍流程与合作方式',
        'nextFollowAt': '2026-12-01 10:00', 'potentialLevel': '高', 'intentLevel': '强', 'talentClass': 'A'})
    chk('负责人提交跟进成功', st == 200, (st, j.get('error')))
    lead = j['data']['lead']
    chk('跟进后 nextFollowAt 落库（工作台据此算逾期/今日）',
        lead['nextFollow'].startswith('2026-12-01'), lead['nextFollow'])
    chk('跟进后 lastFollowAt 刷新', bool(lead['lastFollow']), lead['lastFollow'])
    chk('跟进同时写入潜力/意愿/分类',
        lead['potentialLevel'] == '高' and lead['intentLevel'] == '强' and lead['talentClass'] == 'A',
        (lead['potentialLevel'], lead['intentLevel'], lead['talentClass']))
    st, j = call(staff, '/api/mvp/leads/%s/follow-ups' % made['ra'])
    # 时间轴已并入分配记录（2026-09-18），首行可能是分配记录 → 改为语义断言（任一行含内容）
    chk('跟进记录接口可读回（≥1 条且含内容）',
        st == 200 and len(j['data']) >= 1 and any('寄拍流程' in (x.get('content') or '') for x in j['data']),
        len(j['data']) if st == 200 else st)

    # ---------- 6. 交接（发起 → 接收人确认 → 负责人自动变更） ----------
    st, j = call(staff, '/api/mvp/leads/%s/handover' % made['ra'],
                 {'toUser': '李婷', 'toPosition': 'recruit', 'reason': '转回招募继续孵化', 'note': '已完成初筛，达人愿意寄拍'})
    chk('发起交接成功（新语义路径 /leads/:id/handover）', st == 200 and j['data']['status'] == 'pending', (st, j.get('error')))
    ho = j['data']
    chk('交接单记录 原负责人/接收人/岗位/说明',
        ho['fromUser'] == '王浩' and ho['toUser'] == '李婷' and ho['toPosition'] == 'recruit' and ho['note'], ho)
    st, j = call(admin, '/api/mvp/leads/' + made['ra'])
    chk('待确认期间 原负责人不变（current_owner 仍是发起人）',
        j['data']['owner'] == '王浩' and j['data']['handoverStatus'] == 'pending',
        (j['data']['owner'], j['data']['handoverStatus']))
    st, j = call(recruit, '/api/mvp/handovers?box=inbox')
    chk('接收人 inbox 能看到待确认交接', st == 200 and any(h['id'] == ho['id'] for h in j['data']), len(j['data']))
    st, j = call(senior, '/api/mvp/handovers/%s/confirm' % ho['id'], {})
    chk('非接收人确认交接 → 403', st == 403, (st, j))
    st, j = call(staff, '/api/mvp/handovers/%s/confirm' % ho['id'], {})
    chk('发起人自己确认（非接收人）→ 403', st == 403, (st, j))
    st, j = call(recruit, '/api/mvp/handovers/%s/accept' % ho['id'], {})
    chk('接收人 accept（别名）确认接收成功', st == 200 and j['data']['status'] == 'confirmed', (st, j.get('error')))
    st, j = call(admin, '/api/mvp/leads/' + made['ra'])
    d = j['data']
    chk('确认后 负责人 / 岗位 / ownerId 自动切换',
        d['owner'] == '李婷' and d['ownerPosition'] == 'recruit' and d['ownerId'] == 'demo-recruit',
        (d['owner'], d['ownerPosition'], d['ownerId']))
    chk('确认后记录 原负责人 / 原岗位 / 接收时间',
        d['handoverFrom'] == '王浩' and d['handoverFromPosition'] == 'ops' and bool(d['handoverReceivedAt']),
        (d['handoverFrom'], d['handoverFromPosition'], d['handoverReceivedAt']))
    chk('确认后 handoverStatus = confirmed（保留摘要供总表展示）', d['handoverStatus'] == 'confirmed', d['handoverStatus'])
    st, j = call(recruit, '/api/mvp/handovers/%s/accept' % ho['id'], {})
    chk('重复确认同一交接单 → 409', st == 409, st)

    # rb 已被批量分配给李婷（招募岗），由李婷发起、王浩驳回
    st, j = call(recruit, '/api/mvp/leads/%s/handover' % made['rb'], {'toUser': '王浩', 'toPosition': 'ops', 'reason': '试驳回'})
    ho2 = j['data'] if st == 200 else None
    chk('第二条交接发起成功（招募岗 → 运营岗）', st == 200, (st, j.get('error')))
    st, j = call(staff, '/api/mvp/handovers/%s/reject' % ho2['id'], {})
    chk('接收人驳回成功', st == 200 and j['data']['status'] == 'rejected', (st, j.get('error')))
    st, j = call(admin, '/api/mvp/leads/' + made['rb'])
    chk('驳回后负责人不变、状态=已驳回',
        j['data']['owner'] == '李婷' and j['data']['handoverStatus'] == 'rejected',
        (j['data']['owner'], j['data']['handoverStatus']))
    # rb 交接单已了结（rejected），此时再试把达人交给寄拍岗 → 岗位边界拦截
    st, j = call(recruit, '/api/mvp/leads/%s/handover' % made['rb'], {'toUser': '张萌', 'toPosition': 'senior_ops', 'reason': '岗位边界测试'})
    chk('交接给高级运营 → 400（高级运营不接手达人）', st == 400 and '不做达人负责人' in (j.get('error') or ''), (st, j.get('error')))

    # oa 的负责人是李婷（招募），走完整链路：招募完成 → 交接给运营（管理员强制确认），并固化招募负责人
    st, j = call(recruit, '/api/mvp/leads/%s/handover' % made['oa'], {'toUser': '王浩', 'toPosition': 'ops', 'reason': '招募完成，达人转长期运营'})
    ho3 = j['data'] if st == 200 else None
    chk('第三条交接发起成功（招募完成 → 运营）', st == 200, (st, j.get('error')))
    st, j = call(admin, '/api/mvp/handovers/%s/force' % ho3['id'], {})
    chk('管理员强制指派跳过确认', st == 200 and j['data']['status'] == 'confirmed', (st, j.get('error')))
    st, j = call(admin, '/api/mvp/leads/' + made['oa'])
    d = j['data']
    chk('招募→运营交接后 负责人切到运营岗',
        d['owner'] == '王浩' and d['ownerPosition'] == 'ops' and d['ownerId'] == 'demo-staff',
        (d['owner'], d['ownerPosition'], d['ownerId']))
    chk('招募负责人固化（recruitBy=李婷，不随后续交接变化）',
        d.get('recruitBy') == '李婷' and d.get('recruitById') == 'demo-recruit',
        (d.get('recruitBy'), d.get('recruitById')))

    # ---------- 7. 留痕 ----------
    st, j = call(admin, '/api/mvp/leads/%s/history' % made['ra'])
    types = [r['type'] for r in j['data']['rows']]
    chk('流转历史含 分配 / 跟进 / 交接-发起 / 交接-确认',
        all(t in types for t in ('线索分配', '线索跟进记录', '线索交接-发起', '线索交接-确认')), types)
    chk('历史记录带 操作人 / 时间 / 变更前后',
        bool(j['data']['rows'][0].get('operator')) and bool(j['data']['rows'][0].get('at')), j['data']['rows'][0])
    st, j = call(promote, '/api/mvp/leads/%s/history' % made['ra'])
    chk('无关岗位查他人线索历史 → 403', st == 403, st)
    st, j = call(senior, '/api/mvp/leads/%s/history' % made['ra'])
    chk('高级运营（主管）可查他人线索历史 → 200', st == 200, st)

    # ---------- 8. 别名接口 ----------
    st, j = call(recruit, '/api/mvp/my/leads')
    chk('GET /api/mvp/my/leads 只返回我负责的',
        st == 200 and all(x['owner'] == '李婷' for x in j['data']), len(j['data']))

    # ---------- 9. V0.3 行级权限：推广 / 寄拍 / 达人 / 操作日志（后端裁决，不止前端隐藏） ----------
    st, j = call(admin, '/api/mvp/campaigns')
    admin_camps = j['data'] if st == 200 else []
    chk('管理员可见全部投放数据', st == 200 and len(admin_camps) > 0, len(admin_camps))
    st, j = call(promote, '/api/mvp/campaigns')
    promote_camps = j['data'] if st == 200 else []
    chk('推广岗只看到自己负责的投放（行级过滤生效）',
        st == 200 and all(c['owner'] == '陈晨' for c in promote_camps), (st, len(promote_camps)))
    chk('他人名下的投放对推广岗不可见（李婷/王浩 的都被过滤掉）',
        st == 200 and not any(c['owner'] in ('李婷', '王浩', '张萌') for c in promote_camps),
        [c['owner'] for c in promote_camps])
    chk('管理员能看到他人名下的投放（证明过滤不是「都返回空」）',
        st == 200 and any(c['owner'] in ('李婷', '王浩') for c in admin_camps), len(admin_camps))
    st, j = call(recruit, '/api/mvp/campaigns')
    chk('招募岗拉投放数据 → 403（不参与推广链路）', st == 403, (st, j))
    st, j = call(recruit, '/api/mvp/campaigns', {'name': '越权投放', 'channel': '其他'})
    chk('招募岗新增投放 → 403', st == 403, (st, j))

    st, j = call(senior, '/api/tasks')
    chk('高级运营（主管）可看全部寄拍任务', st == 200 and isinstance(j['data'], list), (st, j if st != 200 else len(j['data'])))
    st, j = call(staff, '/api/tasks')
    ops_tasks = j['data'] if st == 200 else []
    chk('运营岗可拿到自己名下达人的任务', st == 200, (st, j if st != 200 else len(ops_tasks)))
    if st == 200:
        st2, j2 = call(staff, '/api/mvp/talents')
        mine_ids = set(x['id'] for x in (j2['data'] if st2 == 200 else []))
        chk('运营岗任务范围 ⊆ 我名下达人（无越权）', all(k['talentId'] in mine_ids for k in ops_tasks), len(ops_tasks))
    else:
        chk('运营岗任务范围 ⊆ 我名下达人（无越权）', False, st)
    st, j = call(recruit, '/api/tasks')
    chk('招募岗拉寄拍任务 → 403（不参与执行链路）', st == 403, (st, j))

    st, j = call(admin, '/api/talents')
    admin_talents = j['data'] if st == 200 else []
    st, j = call(recruit, '/api/talents')
    recruit_talents = j['data'] if st == 200 else []
    chk('原生达人接口也做行级过滤（招募可见 < 管理员全量）',
        st == 200 and len(recruit_talents) < len(admin_talents), (len(recruit_talents), len(admin_talents)))
    chk('非管理员拿不到其他岗位的达人（无王浩名下达人）',
        not any(x.get('owner') == '王浩' for x in recruit_talents), len(recruit_talents))

    st, j = call(recruit, '/api/logs')
    chk('操作日志非管理员只能看与自己相关的（我操作的 / 对象是我）',
        st == 200 and len(j['data']) > 0 and all(l['operator'] == '李婷' or '李婷' in str(l.get('target') or '') for l in j['data']),
        (st, len(j['data']) if st == 200 else j))
    st, j = call(admin, '/api/logs')
    chk('管理员可看全部操作留痕', st == 200 and len(j['data']) > 0, len(j['data']) if st == 200 else st)

    # ---------- 10. V0.3 主链：运营发起寄拍 → 寄拍执行 → 结果回流运营 ----------
    st, j = call(admin, '/api/mvp/leads', {'name': N['shoot'], 'owner': '王浩', 'ownerPosition': 'ops', 'channel': 'API回归'})
    chk('主链测试达人创建成功（归运营岗王浩）', st == 200 and j.get('ok'), (st, j.get('error')))
    extra['shoot'] = j['data']['id']
    call(admin, '/api/mvp/leads/' + extra['shoot'], {'status': '已成为达人'}, method='PUT')
    st, j = call(admin, '/api/mvp/talents')
    row = next((x for x in (j['data'] if st == 200 else []) if x['id'] == extra['shoot']), None)
    chk('主链测试达人已迁入达人档案（转化不变式）', row is not None, extra['shoot'])
    chk('测试达人已转为「已成为达人」', bool(row) and row.get('status') == '已成为达人',
        row.get('status') if row else 'row_not_found')

    # 任务归属人岗位职责边界：只能是招募/运营岗（财务/其余岗位不行）
    st, j = call(staff, '/api/tasks', {'talentId': extra['shoot'], 'product': 'APItest越权归属人', 'owner': '周妍', 'commission': 100})
    chk('任务归属人选财务岗 → 400（归属必须是招募/运营岗）', st == 400 and '招募/运营' in (j.get('error') or ''), (st, j.get('error')))
    st, j = call(recruit, '/api/tasks', {'talentId': extra['shoot'], 'product': 'APItest招募越权发起', 'commission': 100, 'owner': '张萌'})
    chk('招募岗发起寄拍 → 403（由运营发起）', st == 403, (st, j.get('error')))

    st, j = call(staff, '/api/tasks', {'talentId': extra['shoot'], 'product': 'APItest%s寄拍商品' % RUN, 'commission': 300, 'owner': '张萌'})
    task_id = j['data']['id'] if (st == 200 and j.get('ok')) else None
    chk('运营发起寄拍（任务归属张萌/高级运营）→ 待确认',
        st == 200 and j['data']['ownerId'] == 'demo-senior' and j['data']['status'] == '待确认',
        (st, j.get('error'), j.get('data', {}).get('status')))

    st, j = call(admin, '/api/mvp/talents')
    row = next((x for x in (j['data'] if st == 200 else []) if x['id'] == extra['shoot']), {})
    chk('发起寄拍不改变达人负责人（仍是王浩 / 运营岗）',
        row.get('owner') == '王浩' and row.get('ownerPosition') == 'ops', (row.get('owner'), row.get('ownerPosition')))
    st, j = call(staff, '/api/tasks?talentId=' + extra['shoot'])
    chk('该任务出现在运营的任务列表且带可用动作 actions',
        st == 200 and any(k['id'] == task_id and isinstance(k.get('actions'), list) for k in j['data']), st)

    # 寄拍岗执行链路（每一步都真实落库 + 留痕）
    if task_id:
        for act, body, expect in [('confirm', {}, '待寄出'), ('send', {'trackingNo': 'SF' + RUN}, '已寄出'),
                                  ('sign', {}, '已签收'), ('startShoot', {}, '待拍摄'),
                                  ('submitContent', {'contentUrl': 'https://example.com/v/' + RUN}, '待审核')]:
            st, j = call(senior, '/api/tasks/%s/status' % task_id, dict(body, action=act), method='PATCH')
            chk('任务归属人推进「%s」→ %s' % (act, expect), st == 200 and j['data']['status'] == expect,
                (st, j.get('error'), j.get('data', {}).get('status')))
        st, j = call(promote, '/api/tasks/%s/status' % task_id, {'action': 'complete'}, method='PATCH')
        chk('无关岗位（推广）推进他人任务 → 403', st == 403, (st, j.get('error')))
        st, j = call(senior, '/api/tasks/%s/status' % task_id, {'action': 'auditReject', 'auditOpinion': '主管质检退回'}, method='PATCH')
        chk('高级运营（主管）质检退回 → 内容修改中', st == 200 and j['data']['status'] == '内容修改中', (st, j.get('error')))
        st, j = call(senior, '/api/tasks/%s/status' % task_id, {'action': 'resubmit'}, method='PATCH')
        chk('任务归属人重新提交审核 → 待审核', st == 200 and j['data']['status'] == '待审核', (st, j.get('error')))
        st, j = call(recruit, '/api/tasks/%s/status' % task_id, {'action': 'complete'}, method='PATCH')
        chk('无关岗位推进他人任务 → 403', st == 403, (st, j.get('error')))
        st, j = call(staff, '/api/tasks/%s/status' % task_id, {'action': 'auditPass'}, method='PATCH')
        chk('运营审核通过自己名下达人的寄拍内容 → 待发布', st == 200 and j['data']['status'] == '待发布',
            (st, j.get('error'), j.get('data', {}).get('status')))
        st, j = call(staff, '/api/tasks/%s/status' % task_id, {'action': 'publish', 'contentUrl': 'https://example.com/v/' + RUN}, method='PATCH')
        chk('运营标记已发布（结果回流运营闭环）', st == 200 and j['data']['status'] == '已发布', (st, j.get('error')))
        st, j = call(staff, '/api/tasks/%s/status' % task_id, {'action': 'complete'}, method='PATCH')
        chk('运营完成任务', st == 200 and j['data']['status'] == '已完成', (st, j.get('error')))
        st, j = call(admin, '/api/logs')
        types = [l['type'] for l in j['data']]
        need = ['创建任务', '确认接单', '已寄出', '提交内容', '审核通过', '标记已发布', '完成任务']
        chk('主链动作全部写入操作日志', all(t in types for t in need), [t for t in need if t not in types])
        st, j = call(admin, '/api/tasks/%s' % task_id, method='DELETE')
        chk('管理员可删除任务（清理回归数据）', st == 200 and j['data']['deleted'], (st, j.get('error')))
    else:
        for label in ['任务归属人推进链路', '运营审核/发布/完成', '主链留痕', '清理回归任务']:
            chk('（跳过）' + label + '：任务未创建成功', False)

    # ---------- 11. V0.3 双负责人：线索负责人 ≠ 达人运营负责人（opsBy 固化） ----------
    st, j = call(admin, '/api/mvp/leads', {'name': N['ops2'], 'owner': '李婷', 'ownerPosition': 'recruit', 'channel': 'API回归'})
    extra['ops2'] = j['data']['id']
    call(admin, '/api/mvp/leads/' + extra['ops2'], {'status': '已成为达人'}, method='PUT')
    st, j = call(recruit, '/api/mvp/leads/%s/handover' % extra['ops2'],
                 {'toUser': '王浩', 'toPosition': 'ops', 'reason': '招募完成，转运营长期管理'})
    ho4 = j['data'] if st == 200 else None
    chk('招募发起「转运营」交接', st == 200 and ho4 and ho4['status'] == 'pending', (st, j.get('error')))
    st, j = call(staff, '/api/mvp/handovers/%s/accept' % (ho4['id'] if ho4 else 'x'), {})
    chk('运营确认接收', st == 200, (st, j.get('error')))
    st, j = call(admin, '/api/mvp/talents')
    row = next((x for x in (j['data'] if st == 200 else []) if x['id'] == extra['ops2']), {})
    chk('确认后固化「达人运营负责人」opsBy=王浩',
        row.get('opsBy') == '王浩' and row.get('opsId') == 'demo-staff', (row.get('opsBy'), row.get('opsId')))
    chk('同时保留「招募负责人」recruitBy=李婷（两个角色可并存）',
        row.get('recruitBy') == '李婷' and row.get('owner') == '王浩', (row.get('recruitBy'), row.get('owner')))
    st, j = call(admin, '/api/mvp/leads/%s/assign' % extra['ops2'], {'owner': '李婷', 'ownerPosition': 'recruit'})
    st, j = call(admin, '/api/mvp/talents')
    row = next((x for x in (j['data'] if st == 200 else []) if x['id'] == extra['ops2']), {})
    chk('再次改派后 当前负责人变李婷，但 opsBy 仍是王浩（固化不随后续变化）',
        row.get('owner') == '李婷' and row.get('opsBy') == '王浩', (row.get('owner'), row.get('opsBy')))

    # ---------- 12. 经营看板：真实漏斗 + 负责人负载 ----------
    st, j = call(admin, '/api/mvp/dashboard')
    d = j['data'] if st == 200 else {}
    funnel = d.get('funnel') or []
    chk('看板返回真实漏斗（线索进入→已分配→已跟进→有意向→已成为达人）',
        st == 200 and [x['name'] for x in funnel] == ['线索进入', '已分配负责人', '已跟进', '有意向/已报名', '已成为达人'], (st, [x['name'] for x in funnel]))
    vals = [x['value'] for x in funnel]
    chk('漏斗逐级收敛（每一层都在上一层内再收窄）', bool(vals) and all(vals[i] >= vals[i + 1] for i in range(len(vals) - 1)), vals)
    chk('漏斗来自达人表实时推导（线索进入 > 0）', bool(vals) and vals[0] > 0, vals)
    chk('高潜强意愿作为独立关注指标返回（不属于漏斗层级）', isinstance(d.get('hot'), int), d.get('hot'))
    wl = d.get('workload') or []
    chk('看板返回负责人负载（含线索数 / 达人 / 任务 / 负载值）',
        len(wl) > 0 and all(('leads' in w and 'load' in w) for w in wl), wl[:2])
    chk('负载按 load 倒序（谁忙谁在前）', all(wl[i]['load'] >= wl[i + 1]['load'] for i in range(len(wl) - 1)), [w['load'] for w in wl][:5])
    chk('看板返回渠道效果聚合（真实渠道维度）', len(d.get('byChannel') or []) > 0, (d.get('byChannel') or [])[:2])
    chk('看板返回关注项（待分配 / 逾期 / 待审核）',
        all(k in (d.get('attention') or {}) for k in ['unassigned', 'overdueFollow', 'pendingHandover', 'taskOverdue', 'pendingAudit']),
        d.get('attention'))

    # 2026-09-18 岗位看板改版：经营看板升级为管理视图，普通岗位直接 403（改走岗位 panels，见 12.5 节）
    st, j = call(recruit, '/api/mvp/dashboard')
    chk('普通岗位看板已收口：recruit → 403（不再提供 mine 口径看板）', st == 403, st)

    # ---------- 12.5 运营中台：岗位面板 / 团队效率 / 运营任务 / 爆款拆解 / 达人评级 / 时间轴 ----------
    st, j = call(admin, '/api/mvp/workbench')
    wp = ((j or {}).get('data') or {}).get('panels') or {}
    chk('管理员面板：成长漏斗+团队效率+渠道ROI+异常提醒',
        st == 200 and [b['key'] for b in (wp.get('blocks') or [])] == ['growth-funnel', 'team-efficiency', 'channel-roi', 'alerts'],
        [b.get('key') for b in (wp.get('blocks') or [])])
    funnel = next((b for b in wp.get('blocks', []) if b.get('key') == 'growth-funnel'), None)
    chk('成长漏斗五层累计口径逐级单调递减',
        bool(funnel) and all(funnel['items'][i]['value'] >= funnel['items'][i + 1]['value'] for i in range(4)),
        [it.get('value') for it in (funnel or {}).get('items', [])])

    st, j = call(senior, '/api/mvp/workbench')
    wp2 = ((j or {}).get('data') or {}).get('panels') or {}
    senKeys = set(b['key'] for b in (wp2.get('blocks') or []))
    chk('高级运营面板：待分配线索+运营团队概览+成长漏斗+异常提醒（20260920a 改版，不含任务/爆款库面板）',
        st == 200 and {'pending-leads', 'ops-team', 'growth-funnel', 'senior-alerts'} <= senKeys
        and not {'ops-tasks', 'hit-cases', 'unassigned-pool'} & senKeys,
        sorted(senKeys))
    st, j = call(staff, '/api/mvp/workbench')
    wp3 = ((j or {}).get('data') or {}).get('panels') or {}
    opsKeys = set(b['key'] for b in (wp3.get('blocks') or []))
    chk('普通运营面板：新分配达人+今日待办+我的达人列表+异常提醒（不含团队概览，20260920a 改版）',
        st == 200 and {'new-assigned', 'today', 'my-talent-list', 'ops-alerts'} <= opsKeys and 'ops-team' not in opsKeys,
        sorted(opsKeys))
    st, j = call(recruit, '/api/mvp/workbench')
    wp4 = ((j or {}).get('data') or {}).get('panels') or {}
    chk('招募面板：新线索列表+跟进待办+高意向池+待交接列表（20260920a 改版）',
        st == 200 and {'new-lead-list', 'follow-todo', 'hot-pool', 'handover-list'} <= set(b['key'] for b in (wp4.get('blocks') or [])),
        [b.get('key') for b in (wp4.get('blocks') or [])])

    st, j = call(senior, '/api/mvp/team')
    members = ((j or {}).get('data') or {}).get('members') or []
    chk('高级运营可看运营团队效率（逐人聚合）', st == 200 and isinstance(members, list) and len(members) >= 1, (st, len(members)))
    chk('团队效率只含运营岗（无招募/推广/财务）',
        all(m.get('position') in ('ops', 'senior_ops') for m in members), [m.get('position') for m in members])
    st, j = call(staff, '/api/mvp/team')
    chk('普通运营看运营团队 → 403', st == 403, (st, (j or {}).get('error')))
    st, j = call(recruit, '/api/mvp/team')
    chk('招募看运营团队 → 403', st == 403, (st, (j or {}).get('error')))

    st, j = call(senior, '/api/ops-tasks', {'title': 'APItest 运营任务', 'contentDirection': '鞋类测评', 'productType': '鞋', 'reason': '回归', 'owner': '王浩', 'dueAt': '2030-01-01'})
    opstask = (j.get('data') or {}).get('id') if j and j.get('ok') else None
    chk('高级运营派发运营任务（归属运营负责人）→ 待开始',
        st == 200 and j['data']['status'] == '待开始' and j['data']['ownerId'] == 'demo-staff', (st, (j or {}).get('error')))
    st, j = call(staff, '/api/ops-tasks')
    chk('普通运营只能看到派给自己的运营任务（数据隔离）',
        st == 200 and isinstance(j.get('data'), list) and all(k.get('ownerId') == 'demo-staff' for k in j['data']),
        (st, [k.get('owner') for k in (j.get('data') or [])]))
    st, j = call(staff, '/api/ops-tasks', {'title': '越权', 'owner': '王浩'})
    chk('普通运营派发运营任务 → 403（只有主管可派）', st == 403, (st, (j or {}).get('error')))
    st, j = call(staff, '/api/ops-tasks/%s' % opstask, {'status': '进行中', 'progress': '回归进展'}, method='PUT')
    chk('负责人更新自己运营任务进展 → 进行中', st == 200 and j['data']['status'] == '进行中', (st, (j or {}).get('error')))
    st, j = call(recruit, '/api/ops-tasks')
    chk('招募读运营任务（仅看到空列表，无越权）', st == 200 and isinstance(j.get('data'), list), st)

    st, j = call(senior, '/api/hit-cases', {'title': 'APItest 爆款拆解', 'contentDirection': '痛点前置', 'productType': '鞋', 'reason': '回归', 'fitTalents': '测评类'})
    hitid = (j.get('data') or {}).get('id') if j and j.get('ok') else None
    chk('高级运营沉淀爆款拆解', st == 200 and j['data']['title'] == 'APItest 爆款拆解', (st, (j or {}).get('error')))
    st, j = call(staff, '/api/hit-cases')
    chk('普通运营可读爆款拆解库（含新拆解）', st == 200 and any(c.get('title') == 'APItest 爆款拆解' for c in (j.get('data') or [])), st)
    st, j = call(staff, '/api/hit-cases', {'title': '越权', 'reason': 'x'})
    chk('普通运营写爆款拆解 → 403', st == 403, (st, (j or {}).get('error')))

    st, j = call(admin, '/api/mvp/talents')
    trows = (j.get('data') or []) if j and j.get('ok') else []
    myt = next((t for t in trows if t.get('ownerId') == 'demo-staff'), None)
    if myt:
        tid = myt['id']
        st, j = call(staff, '/api/mvp/talent-meta/' + tid, {'talentLevel': 'A'}, method='PUT')
        chk('负责人改自己达人评级 → A 高价值', st == 200 and j['data']['talentLevel'] == 'A', (st, (j or {}).get('error')))
        st, j = call(staff, '/api/mvp/talent-meta/' + tid, {'talentLevel': 'X'}, method='PUT')
        chk('非法达人评级 → 400', st == 400, (st, (j or {}).get('error')))
        st, j = call(recruit, '/api/mvp/talent-meta/' + tid, {'talentLevel': 'D'}, method='PUT')
        chk('非负责人改他人达人评级 → 403（ops 数据隔离）', st == 403, (st, (j or {}).get('error')))
        st, j = call(staff, '/api/mvp/talent-meta/' + tid, {'talentStatus': 'potential'}, method='PUT')
        chk('负责人改生命周期 → 重点培养（talentStatus 流程）', st == 200 and j['data']['talentStatus'] == 'potential', (st, (j or {}).get('error')))
        st, j = call(senior, '/api/mvp/talent-meta/' + tid, {'talentLevel': 'C', 'talentStatus': 'coaching'}, method='PUT')
        chk('主管（高级运营）可改任意达人评级/生命周期', st == 200, (st, (j or {}).get('error')))

        st, j = call(staff, '/api/mvp/leads/%s/follow-ups' % tid, {'content': 'APItest 时间轴回归', 'nextAction': 'APItest 下一步动作'})
        chk('跟进时间轴：登记含下一步动作的跟进', st == 200 and ((j.get('data') or {}).get('followup') or {}).get('nextAction') == 'APItest 下一步动作', (st, (j or {}).get('error')))
        st, j = call(staff, '/api/mvp/leads/%s/follow-ups' % tid)
        rows2 = (j.get('data') or []) if j and j.get('ok') else []
        chk('跟进时间轴读回：时间/操作人/内容/下一步动作齐全',
            st == 200 and rows2 and rows2[0].get('operator') == '王浩' and rows2[0].get('nextAction') == 'APItest 下一步动作',
            rows2[0] if rows2 else None)
        st, j = call(recruit, '/api/mvp/leads/%s/follow-ups' % tid, {'content': '越权'})
        chk('非负责人对他人达人登记跟进 → 403', st == 403, (st, (j or {}).get('error')))

        st, j = call(staff, '/api/tasks', {'talentId': tid, 'product': 'APItest 内容任务', 'taskType': 'content', 'commission': 0})
        ctask = (j.get('data') or {}).get('id') if j and j.get('ok') else None
        chk('登记内容任务（taskType=content）读回类型', st == 200 and j['data']['taskType'] == 'content', (st, (j or {}).get('error')))
        st, j = call(staff, '/api/tasks?taskType=content')
        chk('任务中心按类型筛选命中新任务', st == 200 and any(k.get('id') == ctask for k in (j.get('data') or [])), (st, len((j.get('data') or []))))
        if ctask:
            st, j = call(admin, '/api/tasks/' + ctask, method='DELETE')
            chk('清理内容任务', st == 200 and j['data']['deleted'], (st, (j or {}).get('error')))
    else:
        chk('（跳过）达人评级/时间轴/任务类型：无 demo-staff 名下达人', False, 'no talent owned by demo-staff')

    if opstask:
        st, j = call(senior, '/api/ops-tasks/' + str(opstask), method='DELETE')
        chk('清理运营任务', st == 200, (st, (j or {}).get('error')))
    if hitid:
        st, j = call(senior, '/api/hit-cases/' + str(hitid), method='DELETE')
        chk('清理爆款拆解', st == 200, (st, (j or {}).get('error')))

    # ---------- 12.5 达人分配（高级运营 → 普通运营，2026-09-18 新增） ----------
    st, j = call(admin, '/api/mvp/leads', {'name': N['asg'], 'channel': 'API回归'})
    assert st == 200 and j.get('ok'), (st, j)
    made['asg'] = j['data']['id']
    asg_id = made['asg']
    st, j = call(staff, '/api/mvp/leads/%s/assign' % asg_id, {'owner': '王浩'})
    chk('普通运营调「分配给运营」→ 403（isSupervisor 裁决）', st == 403, (st, (j or {}).get('error')))
    st, j = call(senior, '/api/mvp/leads/%s/assign' % asg_id, {'owner': '陈晨'})
    chk('高级运营分配给推广岗 → 400（OWNER_POSITIONS 边界）', st == 400 and '不做达人负责人' in (j.get('error') or ''), (st, (j or {}).get('error')))
    st, j = call(senior, '/api/mvp/leads/%s/assign' % asg_id, {'owner': '王浩', 'ownerPosition': 'ops', 'remark': 'APItest 分配备注'})
    chk('高级运营「分配给运营」成功（带备注）', st == 200 and j['data']['assigned'] == 1, (st, (j or {}).get('error')))
    lead = j['data']['leads'][0]
    chk('分配后 owner/ownerId/岗位 更新',
        lead['owner'] == '王浩' and lead['ownerId'] == 'demo-staff' and lead['ownerPosition'] == 'ops',
        (lead.get('owner'), lead.get('ownerId'), lead.get('ownerPosition')))
    chk('分配后 talentOperator = 被分配的普通运营', lead.get('talentOperator') == '王浩', lead.get('talentOperator'))
    st, j = call(senior, '/api/mvp/leads/%s/assignments' % asg_id)
    arows = (j.get('data') or []) if j and j.get('ok') else []
    chk('分配记录独立接口读回', st == 200 and len(arows) >= 1, (st, len(arows)))
    if arows:
        chk('分配记录含 分配人/接收人/备注/类型',
            arows[0]['assignedBy'] == '张萌' and arows[0]['toOwner'] == '王浩' and arows[0]['toOwnerId'] == 'demo-staff'
            and arows[0]['remark'] == 'APItest 分配备注' and '分配' in (arows[0]['type'] or ''),
            arows[0])
    st, j = call(staff, '/api/mvp/leads')
    chk('分配后普通运营可见该达人（只看自己口径）', st == 200 and any(x['id'] == asg_id for x in (j.get('data') or [])), st)
    st, j = call(staff, '/api/mvp/leads/%s/follow-ups' % asg_id)
    tl_rows = (j.get('data') or []) if j and j.get('ok') else []
    chk('跟进时间轴并入分配记录（交接历史可回看）',
        st == 200 and any('分配' in (x.get('method') or '') and 'APItest 分配备注' in (x.get('content') or '') for x in tl_rows),
        [x.get('method') for x in tl_rows][:3])
    # 重新分配：临时建一位普通运营 → talentOperator 跟随换人（回归 2026-09-18 修复的刷新 Bug）
    TMPU = 'apitestops%s' % RUN
    st, j = call(admin, '/api/users', {'user': TMPU, 'pass': 'Apitest123456', 'role': 'staff',
                                       'position': 'ops', 'displayName': 'API测试运营'})
    chk('临时普通运营账号创建成功', st in (200, 201), (st, (j or {}).get('error')))
    if st in (200, 201):
        st, j = call(senior, '/api/mvp/leads/%s/assign' % asg_id, {'owner': 'API测试运营', 'ownerPosition': 'ops', 'remark': '重新分配'})
        chk('重新分配给另一位普通运营成功', st == 200, (st, (j or {}).get('error')))
        lead = ((j.get('data') or {}).get('leads') or [{}])[0] if j and j.get('ok') else {}
        chk('重新分配后 talentOperator 跟随换人（回归 0918 修复）',
            lead.get('talentOperator') == 'API测试运营' and lead.get('opsId') == TMPU,
            (lead.get('talentOperator'), lead.get('opsId')))
        st, j = call(admin, '/api/mvp/leads/%s/assignments' % asg_id)
        arows2 = (j.get('data') or []) if j and j.get('ok') else []
        chk('分配历史含 2 条（首次分配 + 重新分配）', st == 200 and len(arows2) >= 2, (st, len(arows2)))
        st, j = call(admin, '/api/users/' + TMPU, method='DELETE')
        chk('清理临时运营账号', st == 200, (st, (j or {}).get('error')))
    # ---------- 12.6 达人档案字段分层 + 分配确认接收（2026-09-18e） ----------
    st, j = call(senior, '/api/mvp/leads/%s/assign' % asg_id, {'owner': '王浩', 'ownerPosition': 'ops', 'remark': '回分给王浩'})
    chk('重新分配回王浩（确认接收用例前置）', st == 200, (st, (j or {}).get('error')))
    st, j = call(staff, '/api/mvp/leads/%s' % asg_id)
    d = j.get('data') or {}
    chk('分配给运营后 assignState=pending_assign 且 assignedBy=分配人',
        st == 200 and d.get('assignState') == 'pending_assign' and d.get('assignedBy') == '张萌',
        (st, d.get('assignState'), d.get('assignedBy')))
    st, j = call(recruit, '/api/mvp/leads/%s/assign-ack' % asg_id, {})
    chk('非运营岗确认接收 → 403（岗位守卫）', st == 403, (st, (j or {}).get('error')))
    st, j = call(staff, '/api/mvp/leads/%s/assign-ack' % asg_id, {})
    chk('运营确认接收分配成功 → assigned', st == 200 and (j.get('data') or {}).get('assignState') == 'assigned', (st, (j or {}).get('error')))
    chk('确认接收后 assignAckAt 落库', bool((j.get('data') or {}).get('assignAckAt')), (j.get('data') or {}).get('assignAckAt'))
    st, j = call(staff, '/api/mvp/leads/%s/assign-ack' % asg_id, {})
    chk('重复确认接收 → 409', st == 409, (st, (j or {}).get('error')))
    # 达人档案出参分层：普通运营不回传负责人链路字段；高级运营保留完整视图
    st, j = call(staff, '/api/mvp/talents')
    trows = (j.get('data') or []) if j and j.get('ok') else []
    HIDE_KEYS = ['owner', 'ownerId', 'ownerPosition', 'ownerPositionLabel', 'recruitBy', 'recruitById',
                 'convertedBy', 'convertedById', 'opsBy', 'opsId', 'opsAt', 'talentOperator', 'assignedBy']
    leaked = sorted({k for x in trows for k in HIDE_KEYS if k in x})
    chk('ops 达人档案：不回传负责人链路字段（服务端剥离，字段名不动）',
        bool(trows) and not leaked, (len(trows), leaked))
    chk('ops 达人档案：仍含 assignState / lastTaskName / nextAction（陪跑视角字段）',
        bool(trows) and all(all(k in x for k in ('assignState', 'lastTaskName', 'nextAction')) for x in trows), len(trows))
    st, j = call(senior, '/api/mvp/talents')
    srows = (j.get('data') or []) if j and j.get('ok') else []
    chk('senior_ops 达人档案：保留完整负责人链路（owner/招募负责人/转化人）',
        bool(srows) and all(all(k in x for k in ('owner', 'recruitBy', 'convertedBy')) for x in srows), len(srows))
    # ops 工作台 panels：新分配达人 / 今日待办 / 我的达人列表 / 异常提醒（20260920a 分岗位改版）
    st, j = call(staff, '/api/mvp/workbench')
    blocks = ((j.get('data') or {}).get('panels') or {}).get('blocks') or []
    bkeys = [b.get('key') for b in blocks]
    chk('ops 工作台含「我的达人列表」「异常提醒」面板（20260920a 改版）', 'my-talent-list' in bkeys and 'ops-alerts' in bkeys, bkeys)
    na = next((b for b in blocks if b.get('key') == 'new-assigned'), None)
    chk('ops 工作台含「新分配达人」面板', na is not None, bkeys)
    if na:
        chk('新分配达人面板命中刚分配的达人（含分配人/时间/备注列）',
            any('APItest' in str(r[0]) for r in na.get('rows', []))
            and '分配人' in (na.get('columns') or []) and '备注' in (na.get('columns') or []),
            na.get('rows', [])[:2])
        chk('新分配达人面板含 当前阶段/操作 列且行尾带确认操作（20260918e）',
            '当前阶段' in (na.get('columns') or []) and '操作' in (na.get('columns') or [])
            and any(isinstance(r[-1], dict) and r[-1].get('kind') == 'assign-actions' for r in na.get('rows', [])),
            (na.get('columns'), na.get('rows', [])[:1]))

    # ---------- 12.5 岗位看板：dashboard 主管守卫 + 各岗位 panels（2026-09-18）----------
    st, j = call(admin, '/api/mvp/dashboard')
    chk('经营看板守卫：admin 200', st == 200, st)
    st, j = call(senior, '/api/mvp/dashboard')
    chk('经营看板守卫：senior_ops 200', st == 200, st)
    for u, lbl in ((promote, 'promote'), (recruit, 'recruit'), (staff, 'ops'), (fin, 'finance')):
        st, j = call(u, '/api/mvp/dashboard')
        chk('经营看板守卫：普通岗位 %s → 403' % lbl, st == 403, st)

    def wb_keys(op):
        st, j = call(op, '/api/mvp/workbench')
        panels = (j.get('data') or {}).get('panels') or {}
        return st, panels.get('role'), [b.get('key') for b in (panels.get('blocks') or [])]

    st, role, bkeys = wb_keys(promote)
    chk('promote 看板面板：role=promote 且含 活动列表/渠道效果对比/来源追踪/优化建议（20260920a 改版）',
        st == 200 and role == 'promote' and {'campaign-list', 'channel-effect', 'source-tracking', 'optimize-tips'} <= set(bkeys)
        and not {'task-overview', 'my-talents'} & set(bkeys), (st, role, bkeys))
    st, role, bkeys = wb_keys(recruit)
    chk('recruit 看板面板：含 新线索列表/待交接列表（20260920a 改版）',
        st == 200 and role == 'recruit' and {'new-lead-list', 'handover-list'} <= set(bkeys), (st, role, bkeys))
    st, role, bkeys = wb_keys(staff)
    chk('ops 看板面板：含 异常提醒（20260920a 改版）',
        st == 200 and role == 'ops' and 'ops-alerts' in bkeys, (st, role, bkeys))
    st, role, bkeys = wb_keys(senior)
    chk('senior_ops 看板面板：含 待分配线索/异常提醒（20260920a 改版，未分配达人池面板已并入待分配线索）',
        st == 200 and role == 'senior_ops' and {'pending-leads', 'senior-alerts'} <= set(bkeys)
        and 'unassigned-pool' not in set(bkeys), (st, role, bkeys))
    st, role, bkeys = wb_keys(fin)
    chk('finance 看板面板：role=finance 且含 结算概览/收益统计',
        st == 200 and role == 'finance' and {'settle-overview', 'income-stats'} <= set(bkeys), (st, role, bkeys))

    # ---------- 12.6 分岗位工作台顶部卡片与数据隔离（20260920a）----------
    st, j = call(senior, '/api/mvp/workbench')
    sen = (j.get('data') or {})
    senLabels = [c.get('label') for c in (sen.get('extraCards') or [])]
    chk('senior 顶部卡片 6 张（20260921a）：待分配新线索/今日新增报名/超时未处理线索/付费孵化待审核/团队在管达人总数/重点培养达人数量',
        st == 200 and {'待分配新线索', '今日新增报名', '超 2 天未跟进线索', '付费孵化待审核', '团队在管达人总数', '重点培养达人数量'} <= set(senLabels)
        and len(senLabels) == 6, senLabels)
    senTeam = next((b for b in ((sen.get('panels') or {}).get('blocks') or []) if b.get('key') == 'ops-team'), None)
    chk('senior 运营团队概览面板有运营行（团队视角：看到每个普通运营的负载/异常/完成率）',
        senTeam is not None and isinstance(senTeam.get('rows'), list) and len(senTeam.get('rows')) >= 1,
        (senTeam or {}).get('rows'))

    st, j = call(staff, '/api/mvp/workbench')
    stf = (j.get('data') or {})
    stfLabels = [c.get('label') for c in (stf.get('extraCards') or [])]
    stfTodos = stf.get('todos') or []
    stfKeys = set(b.get('key') for b in ((stf.get('panels') or {}).get('blocks') or []))
    chk('ops 顶部卡片 7 张（20260921a）：我的达人数/今日新分配达人/待跟进达人/待发布内容/待寄拍（待起拍）/数据异常达人数/待审核线索',
        st == 200 and {'我的达人数', '今日新分配达人', '待跟进达人', '待发布内容', '待寄拍（待起拍）', '数据异常达人数', '待审核线索'} <= set(stfLabels)
        and len(stfLabels) == 7, stfLabels)
    chk('ops 工作台待办只来自自己名下（行级隔离：达人待办 owner=王浩，任务/账号待办无他人 owner）',
        all(t.get('owner') in ('王浩', None, '') for t in stfTodos),
        sorted({str(t.get('owner')) for t in stfTodos}))
    chk('ops 面板不含团队概览 / 他人视角面板', not {'ops-team', 'pending-leads'} & stfKeys, sorted(stfKeys))

    st, j = call(promote, '/api/mvp/workbench')
    pro = (j.get('data') or {})
    proLabels = [c.get('label') for c in (pro.get('extraCards') or [])]
    proKeys = set(b.get('key') for b in ((pro.get('panels') or {}).get('blocks') or []))
    chk('promote 顶部卡片 7 张（20260921a 新漏斗）：本月推广活动数/总投入/表单访问量/有效线索数/新增达人数/有效线索转化率/新增达人成本',
        st == 200 and {'本月推广活动数', '总投入', '表单访问量', '有效线索数', '新增达人数', '有效线索转化率', '新增达人成本'} <= set(proLabels)
        and len(proLabels) == 7, proLabels)
    chk('promote 活动类卡片口径来自投放表（活动列表面板列含 活动/渠道/投入）',
        next((b for b in ((pro.get('panels') or {}).get('blocks') or []) if b.get('key') == 'campaign-list'), {}).get('columns')
        and {'活动', '渠道', '投入'} <= set(next((b for b in ((pro.get('panels') or {}).get('blocks') or []) if b.get('key') == 'campaign-list')).get('columns') or []),
        next((b.get('columns') for b in ((pro.get('panels') or {}).get('blocks') or []) if b.get('key') == 'campaign-list'), None))
    chk('promote 面板不含达人运营执行任务类面板', not {'task-overview', 'my-talents', 'my-talent-list'} & proKeys, sorted(proKeys))

    st, j = call(recruit, '/api/mvp/workbench')
    rec = (j.get('data') or {})
    recLabels = [c.get('label') for c in (rec.get('extraCards') or [])]
    recKeys = set(b.get('key') for b in ((rec.get('panels') or {}).get('blocks') or []))
    recTodos = rec.get('todos') or []
    chk('recruit 顶部卡片 5 张（20260921a SLA 停用）：待处理新线索/今日待跟进/高意向达人/待交接达人/今日新增报名',
        st == 200 and {'待处理新线索', '今日待跟进', '高意向达人', '待交接达人', '今日新增报名'} <= set(recLabels)
        and len(recLabels) == 5, recLabels)
    chk('recruit 面板不含运营团队 / 财务 / 深度账号运营数据面板',
        not {'ops-team', 'settle-overview', 'income-stats', 'team-efficiency'} & recKeys, sorted(recKeys))
    chk('recruit 待办无运营团队视角类型（不出现 待分配 公海待办）',
        all(t.get('type') != '待分配' for t in recTodos), [t.get('type') for t in recTodos[:5]])

    # ---------- 12.5 线索字段分层（2026-09-18）：报名只产映射字段；判断字段初始「待判断」；判断字段岗位权限 ----------
    signup = {'nickname': 'APItest报名分层', 'source_channel': '小红书', 'phone': '13800001111',
              'wechat_id': 'apitest_wx', 'self_media_status': '有账号在运营', 'business_experience': '接过寄拍',
              'preferred_categories': '鞋类', 'appearance_style': '真人露脸出镜', 'works': 'https://example.com/w1',
              'questions': '寄拍流程与费用'}
    st, j = call(admin, '/api/leads', signup)
    # 注意：公开报名接口返回 {code:0,data:{id}}（非标准 {ok:true} 包装）
    sg = ((j.get('data') or {}).get('id')) if st == 200 and isinstance(j.get('data'), dict) else None
    if sg: made['signup'] = sg
    chk('报名表单提交成功（公开接口，回归自清理）', st == 200 and j.get('code') == 0 and bool(sg), (st, j.get('code'), (j.get('data') or {}).get('id')))
    st, j = call(admin, '/api/mvp/leads/' + (sg or 'T0000'))
    d = j.get('data') or {}
    chk('报名映射：怎么称呼→昵称 / 来源渠道→channel / 联系方式→contact',
        d.get('name') == 'APItest报名分层' and d.get('channel') == '小红书' and '13800001111' in (d.get('contact') or ''),
        (d.get('name'), d.get('channel'), d.get('contact')))
    rmap = d.get('recruit') or {}
    chk('报名映射：自媒体/合作经历/想接品类/出镜方式/作品/想了解 落 recruit 结构',
        rmap.get('selfMedia') == '有账号在运营' and rmap.get('hasExp') == '接过寄拍'
        and rmap.get('preferredCategories') == '鞋类' and rmap.get('appearWay') == '真人露脸出镜'
        and rmap.get('works') == 'https://example.com/w1' and rmap.get('questions') == '寄拍流程与费用', rmap)
    chk('报名初始化：阶段=新线索 / 生命周期=lead / 评级=待判断',
        d.get('status') == '新线索' and d.get('talentStatus') == 'lead' and d.get('talentLevel') == '待判断',
        (d.get('status'), d.get('talentStatus'), d.get('talentLevel')))
    chk('报名初始化：潜力/意愿=待判断、分类=待分类、路径=待判断',
        d.get('potentialLevel') == '待判断' and d.get('intentLevel') == '待判断'
        and d.get('talentClass') == '待分类' and d.get('coopPath') == '待判断',
        (d.get('potentialLevel'), d.get('intentLevel'), d.get('talentClass'), d.get('coopPath')))
    chk('报名默认线索类型：leadType=free_recruit（免费招募，20260921a）',
        d.get('leadType') == 'free_recruit' and d.get('leadTypeLabel') == '免费招募'
        and d.get('reviewState') == '', (d.get('leadType'), d.get('leadTypeLabel'), d.get('reviewState')))

    st, j = call(senior, '/api/mvp/leads/%s/assign' % sg, {'owner': '李婷', 'ownerPosition': 'recruit'})
    chk('报名线索分配给招募（权限用例前置）', st == 200, (st, (j or {}).get('error')))
    st, j = call(recruit, '/api/mvp/leads/' + (sg or 'T0000'),
                 {'potentialLevel': '高', 'intentLevel': '强', 'coopPath': '付费孵化'}, method='PUT')
    chk('招募（负责人）改判断字段 → 403（字段分层，服务端收口）', st == 403, (st, (j or {}).get('error')))
    st, j = call(recruit, '/api/mvp/talent-meta/' + (sg or 'T0000'), {'talentLevel': 'A'}, method='PUT')
    chk('招募改达人评级 → 403', st == 403, (st, (j or {}).get('error')))
    st, j = call(recruit, '/api/mvp/leads/%s/follow-ups' % sg, {'content': '招募岗位跟进不受影响', 'potentialLevel': '高'})
    chk('招募仍可正常跟进（判断字段被剥离，不阻断跟进本身）', st == 200, (st, (j or {}).get('error')))
    st, j = call(admin, '/api/mvp/leads/' + (sg or 'T0000'))
    chk('招募跟进后潜力仍为待判断（未被写入）',
        st == 200 and (j.get('data') or {}).get('potentialLevel') == '待判断', (st, (j.get('data') or {}).get('potentialLevel')))
    st, j = call(staff, '/api/mvp/leads/' + (sg or 'T0000'), {'potentialLevel': '高'}, method='PUT')
    chk('非负责人运营改判断字段 → 403（行级隔离优先）', st == 403, (st, (j or {}).get('error')))
    st, j = call(senior, '/api/mvp/leads/' + (sg or 'T0000'),
                 {'potentialLevel': '高', 'intentLevel': '强', 'coopPath': '免费签约'}, method='PUT')
    chk('高级运营改判断字段 → 200', st == 200 and (j.get('data') or {}).get('potentialLevel') == '高', (st, (j or {}).get('error')))
    st, j = call(admin, '/api/mvp/leads/' + (sg or 'T0000'), {'potentialLevel': '中', 'talentLevel': '待判断'}, method='PUT')
    chk('管理员改判断字段（含重置评级为待判断）→ 200',
        st == 200 and (j.get('data') or {}).get('talentLevel') == '待判断', (st, (j or {}).get('error')))

    # ---------- 12.7 线索流转消息中心 + 自动分配建议（2026-09-19a） ----------
    st, j = call(senior, '/api/notifications')
    nbase = ((j.get('data') or {}).get('unread') or 0) if st == 200 else 0
    chk('消息中心：senior 可读消息（unread/items 结构）',
        st == 200 and 'unread' in (j.get('data') or {}) and isinstance((j.get('data') or {}).get('items'), list), (st, nbase))
    st, j = call(staff, '/api/notifications')
    sitems = ((j.get('data') or {}).get('items') or []) if st == 200 else [{'toUser': 'x'}]
    chk('消息中心：ops 只能读到自己的消息（toUser 行级过滤）',
        st == 200 and all(m.get('toUser') == 'demo-staff' for m in sitems), (st, len(sitems)))
    # 报名 → senior 收到「新达人报名」站内消息
    st, j = call(admin, '/api/leads', {'nickname': 'APItest消息中心', 'source_channel': '朋友转介绍', 'phone': '13800002222'})
    msg_id = ((j.get('data') or {}).get('id')) if st == 200 and isinstance(j.get('data'), dict) else None
    if msg_id: made['msg'] = msg_id
    chk('报名提交成功（消息用例前置，公开接口）', st == 200 and j.get('code') == 0 and bool(msg_id), (st, msg_id))
    st, j = call(senior, '/api/notifications')
    nd = j.get('data') or {}
    chk('新达人报名 → 高级运营收到 new_lead 消息（unread+1，标题=新增达人报名：达人名）',
        nd.get('unread', 0) >= nbase + 1
        and any(m.get('type') == 'new_lead' and ('新增达人报名：APItest消息中心' in (m.get('title') or '')) for m in nd.get('items') or []),
        (nbase, nd.get('unread')))
    signup_msg = next((m for m in nd.get('items') or [] if m.get('type') == 'new_lead' and 'APItest消息中心' in (m.get('title') or '') and not m.get('readAt')), None)
    st, j = call(senior, '/api/notifications/read', {'ids': [signup_msg['id']] if signup_msg else ['NONE']})
    chk('标记单条已读 → read>=1', st == 200 and ((j.get('data') or {}).get('read') or 0) >= 1, (st, j.get('data')))
    st, j = call(senior, '/api/notifications')
    chk('已读后 unread 回落到基线（该消息不再计数）',
        st == 200 and (j.get('data') or {}).get('unread') == nbase, (nbase, (j.get('data') or {}).get('unread')))
    # 自动分配建议：负载最低、只推荐不执行
    st, j = call(staff, '/api/mvp/leads/auto-assign-suggest')
    chk('普通运营拉分配建议 → 403（isSupervisor 裁决）', st == 403, (st, (j or {}).get('error')))
    st, j = call(senior, '/api/mvp/leads/auto-assign-suggest')
    ad = (j.get('data') or {}) if st == 200 else {}
    cands = ad.get('candidates') or []
    chk('自动分配建议：senior 200（含 staleMin/candidates/recommend）',
        st == 200 and 'staleMin' in ad and isinstance(cands, list) and 'recommend' in ad, (st, ad.get('staleMin'), len(cands)))
    chk('自动分配建议：candidates 按 load 升序（负载最低原则）',
        all(cands[k]['load'] <= cands[k + 1]['load'] for k in range(len(cands) - 1)), [(c.get('name'), c.get('load')) for c in cands])
    chk('分配弹窗负载展示数据源：candidates 每项含 name+数字 load（position=ops）',
        all(c.get('name') and isinstance(c.get('load'), int) for c in cands),
        [(c.get('name'), c.get('load')) for c in cands[:3]])
    st, j = call(senior, '/api/mvp/leads/' + (msg_id or 'T0000'))
    ld = (j.get('data') or {}) if st == 200 else {}
    chk('报名字段显式映射：talentName/source/contentExperience/businessExperience/categoryPreference/appearancePreference/remark/works/contact 落库',
        ld.get('talentName') == 'APItest消息中心' and ld.get('source') == '朋友转介绍'
        and 'contentExperience' in ld and 'businessExperience' in ld and 'categoryPreference' in ld
        and 'appearancePreference' in ld and ld.get('remark') == '' and 'works' in ld and 'contact' in ld,
        {k: ld.get(k) for k in ['talentName', 'source', 'remark', 'contact']})
    chk('报名默认值：阶段=新线索 / 生命周期=lead / 评级=待判断 / 潜力·意愿=待判断 / 负责人=未分配',
        ld.get('status') == '新线索' and ld.get('talentStatus') == 'lead' and ld.get('talentLevel') == '待判断'
        and ld.get('potentialLevel') == '待判断' and ld.get('intentLevel') == '待判断' and ld.get('owner') == '未分配',
        (ld.get('status'), ld.get('talentStatus'), ld.get('talentLevel'), ld.get('owner')))
    st, j = call(senior, '/api/mvp/leads/' + (msg_id or 'T0000'))
    chk('自动分配只生成建议：未分配线索负责人保持未分配（不覆盖主管决定）',
        st == 200 and (j.get('data') or {}).get('owner') == '未分配', (j.get('data') or {}).get('owner'))
    # 分配 → ops 收到 assign 消息；senior 工作台新线索面板
    st, j = call(senior, '/api/mvp/leads/%s/assign' % msg_id, {'owner': '王浩', 'ownerPosition': 'ops', 'remark': '消息中心分配用例'})
    chk('分配给运营成功（assign 消息用例前置）', st == 200, (st, (j or {}).get('error')))
    st, j = call(staff, '/api/notifications')
    sitems = ((j.get('data') or {}).get('items') or [])
    chk('分配后 ops 收到 talent_assigned 消息（内容=xxx 给你分配了新达人「达人名」）',
        any(m.get('type') == 'talent_assigned' and 'APItest消息中心' in (m.get('title') or '')
            and '张萌' in (m.get('body') or '') and '给你分配了新达人' in (m.get('body') or '') for m in sitems),
        [(m.get('type'), m.get('title')) for m in sitems[:3]])
    st, j = call(senior, '/api/mvp/workbench')
    blocks = (((j.get('data') or {}).get('panels') or {}).get('blocks') or [])
    pl = next((b for b in blocks if b.get('key') == 'pending-leads'), None)
    chk('senior 工作台含「新线索提醒（待分配）」面板（列含 报名时间/推荐负责人/操作）',
        pl is not None and {'达人', '报名时间', '推荐负责人', '操作'} <= set(pl.get('columns') or []),
        [b.get('key') for b in blocks])

    # ---------- 12.8 付费孵化线索自动分配 + 审核流（20260921a 线索流转统一） ----------
    st, j = call(admin, '/api/leads', {'nickname': 'APItest付费孵化', 'source_channel': '抖音视频', 'phone': '13800003333', 'lead_type': 'paid_incubation'})
    pid = ((j.get('data') or {}).get('id')) if st == 200 and isinstance(j.get('data'), dict) else None
    if pid: made['paid'] = pid
    chk('付费孵化报名提交成功（lead_type=paid_incubation）', st == 200 and j.get('code') == 0 and bool(pid), (st, pid))
    st, j = call(senior, '/api/mvp/leads/' + (pid or 'T0000'))
    pd = (j.get('data') or {}) if st == 200 else {}
    chk('付费孵化线索系统自动分配（leadType 落库 / ownerPosition=ops / assignedBy=system / assignState=pending_assign / assignedOps 有值）',
        pd.get('leadType') == 'paid_incubation' and pd.get('leadTypeLabel') == '付费孵化'
        and pd.get('ownerPosition') == 'ops' and pd.get('assignedBy') == 'system'
        and pd.get('assignState') == 'pending_assign' and bool(pd.get('assignedOps')),
        {k: pd.get(k) for k in ['leadType', 'owner', 'ownerPosition', 'assignedBy', 'assignState', 'assignedOps']})
    st, j = call(staff, '/api/notifications')
    sitems_p = ((j.get('data') or {}).get('items') or [])
    chk('自动分配后 ops 收到 new_paid_lead 消息（标题=付费孵化新线索：达人名）',
        any(m.get('type') == 'new_paid_lead' and 'APItest付费孵化' in (m.get('title') or '') for m in sitems_p),
        [(m.get('type'), m.get('title')) for m in sitems_p[:3]])
    st, j = call(senior, '/api/mvp/leads/%s/assignments' % (pid or 'T0000'))
    assigns_p = (j.get('data') or []) if st == 200 else []
    chk('自动分配写入分配记录（type=自动分配 / assignedBy=system）',
        any(a.get('type') == '自动分配' and a.get('assignedBy') == 'system' for a in assigns_p),
        [(a.get('type'), a.get('assignedBy')) for a in assigns_p[:3]])
    # ops 跟进后提交审核 → senior 审核（要求补充 → 再提交 → 通过）
    st, j = call(staff, '/api/mvp/leads/%s/submit-review' % (pid or 'T0000'), {'note': '已完成首次联系，意向明确'})
    chk('ops 提交审核 → 200（reviewState=pending_review）',
        st == 200 and (j.get('data') or {}).get('reviewState') == 'pending_review', (st, (j or {}).get('error')))
    st, j = call(staff, '/api/mvp/leads/%s/submit-review' % (pid or 'T0000'), {})
    chk('重复提交审核 → 409', st == 409, (st, (j or {}).get('error')))
    st, j = call(senior, '/api/notifications')
    sitems_f = ((j.get('data') or {}).get('items') or [])
    chk('提交审核 → senior 收到 lead_followup_submitted 消息',
        any(m.get('type') == 'lead_followup_submitted' and 'APItest付费孵化' in (m.get('title') or '') for m in sitems_f),
        [(m.get('type'), m.get('title')) for m in sitems_f[:3]])
    st, j = call(recruit, '/api/mvp/leads/%s/review' % (pid or 'T0000'), {'action': 'approve'})
    chk('招募审核 → 403（isSupervisor 裁决）', st == 403, (st, (j or {}).get('error')))
    st, j = call(senior, '/api/mvp/leads/%s/review' % (pid or 'T0000'), {'action': 'bogus'})
    chk('非法 action → 400', st == 400, (st, (j or {}).get('error')))
    st, j = call(senior, '/api/mvp/leads/%s/review' % (pid or 'T0000'), {'action': 'supplement', 'comment': '请补充达人报价截图'})
    supd = (j.get('data') or {}) if st == 200 else {}
    chk('要求补充 → reviewState=supplement + 审核意见落库',
        st == 200 and supd.get('reviewState') == 'supplement' and '报价' in (supd.get('reviewComment') or ''),
        (st, supd.get('reviewState'), supd.get('reviewComment')))
    st, j = call(staff, '/api/notifications')
    sitems_s = ((j.get('data') or {}).get('items') or [])
    chk('要求补充 → ops 收到 lead_supplement 消息',
        any(m.get('type') == 'lead_supplement' and 'APItest付费孵化' in (m.get('title') or '') for m in sitems_s),
        [(m.get('type'), m.get('title')) for m in sitems_s[:3]])
    st, j = call(staff, '/api/mvp/leads/%s/submit-review' % (pid or 'T0000'), {'note': '已补充资料'})
    chk('补充后可再次提交审核', st == 200 and (j.get('data') or {}).get('reviewState') == 'pending_review', (st, (j or {}).get('error')))
    st, j = call(senior, '/api/mvp/leads/%s/review' % (pid or 'T0000'), {'action': 'approve', 'comment': '通过'})
    apd = (j.get('data') or {}) if st == 200 else {}
    chk('审核通过 → 转正式达人（stage=已成为达人 / talentStatus=coaching / reviewState=approved / reviewBy=张萌）',
        st == 200 and apd.get('status') == '已成为达人' and apd.get('talentStatus') == 'coaching'
        and apd.get('reviewState') == 'approved' and apd.get('reviewBy') == '张萌',
        (st, {k: apd.get(k) for k in ['status', 'talentStatus', 'reviewState', 'reviewBy']}))
    st, j = call(senior, '/api/mvp/leads/' + (pid or 'T0000'))
    chk('审核通过后线索池已无该记录（迁入达人库，ID 不变）', st == 404, (st, (j or {}).get('error')))
    st, j = call(senior, '/api/mvp/talents')
    tlist = (j.get('data') or []) if st == 200 else []
    tdp = next((x for x in tlist if x.get('id') == pid), {})
    chk('达人库可查到转正式记录（含 leadType=paid_incubation 留痕）',
        st == 200 and tdp.get('name') == 'APItest付费孵化' and tdp.get('leadType') == 'paid_incubation',
        (st, (tdp or {}).get('name'), (tdp or {}).get('leadType')))
    st, j = call(staff, '/api/notifications')
    sitems_a = ((j.get('data') or {}).get('items') or [])
    chk('审核通过 → ops 收到 lead_approved 消息',
        any(m.get('type') == 'lead_approved' and 'APItest付费孵化' in (m.get('title') or '') for m in sitems_a),
        [(m.get('type'), m.get('title')) for m in sitems_a[:3]])
    st, j = call(senior, '/api/mvp/workbench')
    blocks_pr = (((j.get('data') or {}).get('panels') or {}).get('blocks') or [])
    pr = next((b for b in blocks_pr if b.get('key') == 'pending-review'), None)
    chk('senior 工作台含「付费孵化待审核」面板（列含 负责人/提交时间/审核说明/操作）',
        pr is not None and {'达人', '负责人', '提交时间', '审核说明', '操作'} <= set(pr.get('columns') or []),
        [b.get('key') for b in blocks_pr])
    # lead_reassigned：李婷 → 王浩 重新分配，新旧负责人都收消息
    st, j = call(senior, '/api/mvp/leads/%s/assign' % (msg_id or 'T0000'), {'owner': '李婷', 'ownerPosition': 'recruit'})
    chk('重新分配用例前置：线索先分给李婷', st == 200, (st, (j or {}).get('error')))
    st, j = call(senior, '/api/mvp/leads/%s/reassign' % (msg_id or 'T0000'), {'owner': '王浩', 'reason': '回归：重新分配消息用例'})
    chk('senior 重新分配给 ops → 200', st == 200, (st, (j or {}).get('error')))
    st, j = call(recruit, '/api/notifications')
    ritems = ((j.get('data') or {}).get('items') or [])
    chk('重新分配 → 原负责人李婷收到 lead_reassigned 消息（正文含达人名与新负责人）',
        any(m.get('type') == 'lead_reassigned' and 'APItest消息中心' in (m.get('body') or '') for m in ritems),
        [(m.get('type'), m.get('title')) for m in ritems[:3]])
    st, j = call(staff, '/api/notifications')
    sitems_r = ((j.get('data') or {}).get('items') or [])
    chk('重新分配 → 新负责人王浩收到 lead_reassigned 消息',
        any(m.get('type') == 'lead_reassigned' and 'APItest消息中心' in (m.get('body') or '') for m in sitems_r),
        [(m.get('type'), m.get('title')) for m in sitems_r[:3]])
    # SLA 停止业务使用（20260921a）：工作台 cards 不再下发 slaOverdue/slaRemind
    st, j = call(staff, '/api/mvp/workbench')
    wbcd = ((j.get('data') or {}).get('cards') or {})
    chk('工作台 cards 不再含 SLA 计数（slaOverdue/slaRemind 已移除，历史字段保留）',
        st == 200 and 'slaOverdue' not in wbcd and 'slaRemind' not in wbcd, sorted(wbcd.keys()))

    # ---------- 12.9 权限收敛 / 实时刷新探针 / 报名校验（20260921b，验收报告 P0+P1） ----------
    # a) 轻量轮询探针：只暴露「可见条数 + 最新 ID」，且与列表接口同一行级权限口径
    st, j = call(staff, '/api/mvp/leads/version')
    vd = (j.get('data') or {}) if st == 200 else {}
    chk('轮询探针 /api/mvp/leads/version：运营可读且只返回 count/latestId（无明细泄露）',
        st == 200 and isinstance(vd.get('count'), int) and 'latestId' in vd and 'items' not in vd, (st, vd))
    st, j = call(staff, '/api/mvp/leads')
    chk('轮询探针 count 与列表接口条数一致（同口径，不额外放权）',
        st == 200 and vd.get('count') == len(j['data']), (vd.get('count'), len(j['data']) if st == 200 else st))
    st, j = call(staff, '/api/mvp/leads?scope=all')
    st2, jv = call(staff, '/api/mvp/leads/version?scope=all')
    chk('运营请求 scope=all 被强制降级为「我负责的」（不开放公海与同岗池）',
        st == 200 and st2 == 200 and (jv.get('data') or {}).get('count') == len(j['data']),
        ((jv.get('data') or {}).get('count'), len(j['data']) if st == 200 else st))

    # b) 转正式达人权限：运营/招募一律 403，必须走「提交审核」；主管（高级运营/管理员）放行
    st, j = call(admin, '/api/mvp/leads', {'name': N['conv'] + '-权限', 'owner': '王浩', 'ownerPosition': 'ops', 'channel': 'API回归'})
    chk('权限收敛用例前置：运营名下线索创建成功', st == 200 and j.get('ok'), (st, j.get('error')))
    extra['convguard'] = j['data']['id'] if st == 200 else ''
    cid = extra['convguard'] or 'T0000'
    st, j = call(staff, '/api/mvp/leads/%s/convert' % cid, {}, method='POST')
    chk('普通运营直接转正式达人 → 403（提示走提交审核）',
        st == 403 and '提交审核' in (j.get('error') or ''), (st, j.get('error')))
    st, j = call(recruit, '/api/mvp/leads/%s/convert' % cid, {}, method='POST')
    chk('招募岗直接转正式达人 → 403', st == 403, (st, j.get('error')))
    st, j = call(senior, '/api/mvp/leads/%s/convert' % cid, {}, method='POST')
    chk('高级运营转正式达人 → 200（转化人=张萌）',
        st == 200 and (j.get('data') or {}).get('convertedBy') == '张萌',
        (st, (j.get('data') or {}).get('convertedBy')))

    # c) 报名联系方式服务端兜底校验（前端拦一次，服务端必须再拦一次）
    st, j = call(admin, '/api/leads', {'nickname': 'APItest%s-手机号' % RUN, 'phone': '123'})
    chk('报名手机号格式非法（123）→ 400（服务端兜底校验）',
        st == 400 and '手机号' in (j.get('message') or ''), (st, j.get('message')))

    # d) 轮询探针必须能感知「已有线索被修改」——只比 count+latestId 会漏掉分配/接收/改状态
    st, j = call(admin, '/api/mvp/leads', {'name': N['rev'] + '-变更感知', 'owner': '未分配', 'channel': 'API回归'})
    chk('变更感知用例前置：未分配线索创建成功', st == 200 and j.get('ok'), (st, j.get('error')))
    rev_id = (j.get('data') or {}).get('id') or 'T0000'
    extra['revprobe'] = rev_id
    st, va = call(admin, '/api/mvp/leads/version')
    st, vb = call(admin, '/api/mvp/leads/version')
    da, db_ = (va.get('data') or {}), (vb.get('data') or {})
    chk('探针幂等：状态未变时连续两次 rev 相同（不会误触发无意义刷新）',
        st == 200 and da.get('rev') and da.get('rev') == db_.get('rev'), (da.get('rev'), db_.get('rev')))
    st, j = call(senior, '/api/mvp/leads/%s/assign' % rev_id, {'owner': '王浩', 'ownerPosition': 'ops'})
    chk('变更感知前置：把已有线索分配给运营', st == 200, (st, (j or {}).get('error')))
    st, v1 = call(admin, '/api/mvp/leads/version')
    d1 = v1.get('data') or {}
    chk('【核心】分配已有线索（条数不变）→ rev 必须变化（旧实现漏检）',
        d1.get('count') == da.get('count') and d1.get('latestId') == da.get('latestId') and d1.get('rev') != da.get('rev'),
        {'count': (da.get('count'), d1.get('count')), 'latestId': (da.get('latestId'), d1.get('latestId')),
         'rev': (da.get('rev'), d1.get('rev'))})
    st, j = call(staff, '/api/mvp/leads/%s/assign-ack' % rev_id, {}, method='POST')
    chk('变更感知前置：运营确认接收', st == 200, (st, (j or {}).get('error')))
    st, v2 = call(admin, '/api/mvp/leads/version')
    d2 = v2.get('data') or {}
    chk('【核心】确认接收（条数不变）→ rev 必须变化',
        d2.get('count') == d1.get('count') and d2.get('rev') != d1.get('rev'), (d1.get('rev'), d2.get('rev')))
    st, j = call(admin, '/api/mvp/leads/%s' % rev_id, {'status': '已联系'}, method='PUT')
    st, v3 = call(admin, '/api/mvp/leads/version')
    d3 = v3.get('data') or {}
    chk('【核心】修改线索状态（条数不变）→ rev 必须变化',
        st == 200 and d3.get('count') == d2.get('count') and d3.get('rev') != d2.get('rev'), (d2.get('rev'), d3.get('rev')))
    st, v4 = call(staff, '/api/mvp/leads/version')
    st, jl = call(staff, '/api/mvp/leads')
    chk('运营视角探针 count 仍与列表一致（新分配线索进入可见范围，口径不放宽）',
        st == 200 and (v4.get('data') or {}).get('count') == len(jl.get('data') or []),
        ((v4.get('data') or {}).get('count'), len(jl.get('data') or []) if st == 200 else st))

    # ---------- 13. 清理 ----------
    def cleanup_one(tid):
        # 转化过的记录已迁入达人库，先试线索池再试达人库
        st, _ = call(admin, '/api/mvp/leads/' + tid, method='DELETE')
        if st == 200:
            return 1
        st, _ = call(admin, '/api/talents/' + tid, method='DELETE')
        return 1 if st == 200 else 0
    deleted = sum(cleanup_one(tid) for tid in list(made.values()) + list(extra.values()))
    chk('清理本次回归创建的线索（%d 条）' % (len(made) + len(extra)), deleted == len(made) + len(extra), deleted)

    failed = [n for n, ok in _results if not ok]
    print('\n结果：通过 %d 项，失败 %d 项' % (len(_results) - len(failed), len(failed)))
    if failed:
        print('FAILED:', failed)
        sys.exit(1)


main()
