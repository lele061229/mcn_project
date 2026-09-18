# -*- coding: utf-8 -*-
"""V0.3 最小闭环验收：管理员分配线索 → 一线负责人工作台

只覆盖用户指定的「下一步唯一任务」这一条链路，其他模块不动：
  1) 管理员在线索总表能看到全部线索（含公海）
  2) 未分配的公海线索，一线招募与其他岗位都看不到（分配前不泄露）
  3) 管理员单条 / 批量把线索分配给一线负责人（recruit）
  4) 分配后该线索立即进入一线负责人可见范围
  5) 一线负责人的线索列表「只含自己负责的」（ownerId 全为自己）
  6) 一线负责人工作台出现「新分配」待办，卡片计数同步 +1
  7) 非管理员调用分配接口 → 403；分配给高级运营 / 财务岗 → 400
  8) 分配动作写操作日志（谁把谁分配给谁）

零依赖（只用标准库）；自建线索并在结束时清理，可反复运行。
    python v1/check-v03-core.py                              # 本地
    python v1/check-v03-core.py http://120.25.151.128:3000    # 线上
"""
import json, sys, time, urllib.request, urllib.error, http.cookiejar

BASE = (sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:3000').rstrip('/')
PASS = {'admin': 'wsccbe9e7e38e3', 'demo-recruit': 'demo123456', 'demo-staff': 'demo123456',
        'demo-senior': 'demo123456', 'demo-finance': 'demo123456', 'demo-promote': 'demo123456'}
RUN = str(int(time.time()))[-6:]
TAG = 'V03core' + RUN
# 一线负责人（招募岗）与其姓名，用于断言「分配给了谁」
RECRUIT_USER, RECRUIT_NAME = 'demo-recruit', '李婷'
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


def data_of(j, default=None):
    return (j or {}).get('data', default)


def chk(name, cond, extra=''):
    _results.append((name, bool(cond)))
    print(('PASS ' if cond else 'FAIL ') + name + (('  ' + str(extra)) if extra else ''))


def leads_of(op):
    st, j = call(op, '/api/mvp/leads')
    return (data_of(j) or []) if st == 200 else []


def main():
    admin = login('admin')
    recruit = login(RECRUIT_USER)
    staff = login('demo-staff')      # 运营 王浩
    sample = login('demo-senior')    # 高级运营 张萌（原寄拍岗已删，账号转为高级运营）
    promote = login('demo-promote')  # 推广 陈晨
    finance = login('demo-finance')  # 财务 周妍

    # ---------- 基准 ----------
    st, j = call(admin, '/api/mvp/leads?scope=all')
    base_all = data_of(j) or []
    chk('管理员可查看全部线索（scope=all 生效）', st == 200 and len(base_all) > 0, len(base_all))

    made = []
    obs = []
    try:
        # ---------- 1. 造一条未分配的公海线索 ----------
        st, j = call(admin, '/api/mvp/leads',
                     {'name': TAG + '-公海', 'channel': '朋友圈', 'level': 'B', 'owner': '未分配'})
        pub = data_of(j) or {}
        pub_id = pub.get('id', '')
        chk('管理员新建线索进入公海（owner=未分配）', st == 200 and pub.get('owner') == '未分配',
            (st, pub.get('owner')))
        if pub_id:
            made.append(pub_id)

        # ---------- 2. 分配前：公海线索对普通岗位不可见（高级运营=主管视角可看全部） ----------
        for label, op in (('一线招募', recruit), ('运营', staff),
                          ('推广', promote), ('财务', finance)):
            ids = [x['id'] for x in leads_of(op)]
            chk('分配前「%s」看不到公海线索' % label, pub_id not in ids, len(ids))
        ids = [x['id'] for x in leads_of(sample)]
        chk('分配前高级运营（主管）能看到公海线索', pub_id in ids, len(ids))

        # ---------- 3. 分配前：一线招募列表只含自己负责的 ----------
        rows = leads_of(recruit)
        chk('分配前一线招募列表只含自己负责的线索',
            all(r.get('ownerId') == RECRUIT_USER for r in rows), len(rows))
        chk('一线招募可见条数 < 管理员全量（范围确实收窄）', len(rows) < len(base_all),
            (len(rows), len(base_all)))

        # ---------- 4. 管理员单条分配 ----------
        st, j = call(admin, '/api/mvp/leads/%s/assign' % pub_id,
                     {'owner': RECRUIT_NAME, 'ownerPosition': 'recruit'})
        d = data_of(j) or {}
        row = (d.get('leads') or [{}])[0]
        chk('管理员单条分配成功（assigned=1）', st == 200 and d.get('assigned') == 1, (st, d.get('assigned')))
        chk('分配后负责人=李婷 / 岗位=招募 / 记录分配时间',
            row.get('owner') == RECRUIT_NAME and row.get('ownerPosition') == 'recruit' and bool(row.get('assignedAt')),
            {k: row.get(k) for k in ('owner', 'ownerPosition', 'assignedAt')})

        # ---------- 5. 分配后：一线负责人立即可见 ----------
        rows = leads_of(recruit)
        mine = next((x for x in rows if x['id'] == pub_id), None)
        chk('分配后一线负责人立即可见该线索', mine is not None and mine.get('owner') == RECRUIT_NAME,
            mine and mine.get('owner'))
        chk('分配后一线招募列表仍只含自己负责的线索',
            all(r.get('ownerId') == RECRUIT_USER for r in rows), len(rows))

        # ---------- 6. 工作台出现「新分配给我」 ----------
        st, j = call(recruit, '/api/mvp/workbench')
        wb = data_of(j) or {}
        cards = wb.get('cards', {})
        todos = wb.get('todos', [])
        hit = [t for t in todos if t.get('talentId') == pub_id]
        chk('一线负责人工作台出现「新分配」待办',
            st == 200 and any(t.get('type') == '新分配' for t in hit),
            [(t.get('type'), t.get('name')) for t in hit])
        chk('工作台卡片「新分配给我」计数 >= 1', cards.get('assigned', 0) >= 1, cards.get('assigned'))
        chk('工作台待办全部来自自己负责的线索（无他人线索）',
            all(t.get('owner') == RECRUIT_NAME for t in todos if t.get('kind') == 'talent'),
            len(todos))

        # ---------- 7. 越权与岗位边界 ----------
        st, _ = call(recruit, '/api/mvp/leads/%s/assign' % pub_id,
                     {'owner': RECRUIT_NAME, 'ownerPosition': 'recruit'})
        chk('非管理员调用分配接口 → 403', st == 403, st)
        st, j = call(admin, '/api/mvp/leads/%s/assign' % pub_id,
                     {'owner': '张萌', 'ownerPosition': 'senior_ops'})
        chk('拒绝把达人负责人指派给高级运营 → 400', st == 400, (st, (j or {}).get('error')))
        st, j = call(admin, '/api/mvp/leads/%s/assign' % pub_id,
                     {'owner': '周妍', 'ownerPosition': 'finance'})
        chk('拒绝把达人负责人指派给财务岗 → 400', st == 400, (st, (j or {}).get('error')))
        st, _ = call(admin, '/api/mvp/leads/%s/assign' % pub_id, {})
        chk('未选负责人 → 400', st == 400, st)

        # ---------- 8. 批量分配 ----------
        batch = []
        for i in range(2):
            st, j = call(admin, '/api/mvp/leads',
                         {'name': '%s-批量%d' % (TAG, i), 'channel': '抖音短视频', 'owner': '未分配'})
            bid = (data_of(j) or {}).get('id', '')
            if bid:
                batch.append(bid)
                made.append(bid)
        st, j = call(admin, '/api/mvp/leads/batch-assign',
                     {'ids': batch, 'owner': RECRUIT_NAME, 'ownerPosition': 'recruit'})
        chk('管理员批量分配 2 条 → assigned=2', st == 200 and (data_of(j) or {}).get('assigned') == 2,
            (st, (data_of(j) or {}).get('assigned')))
        rows = leads_of(recruit)
        chk('批量分配后一线负责人可见条数 +2',
            sum(1 for x in rows if x['id'] in batch) == 2, len(rows))
        st, j = call(admin, '/api/mvp/leads/batch-assign', {'ids': [], 'owner': RECRUIT_NAME})
        chk('批量分配未勾选任何线索 → 400', st == 400, st)

        # ---------- 9. 操作日志留痕 ----------
        st, j = call(admin, '/api/logs')
        logs = data_of(j) or []
        hit = [l for l in logs if l.get('type') == '线索分配' and RECRUIT_NAME in str(l.get('after'))
               and TAG + '-公海' in str(l.get('target'))]
        chk('操作日志记录「谁把哪条线索分配给谁」',
            len(hit) >= 1 and str(hit[0].get('operator')) == '管理员',
            [(l.get('operator'), l.get('target'), l.get('after')) for l in hit[:2]])

        # ---------- 10. 观察项（不计分）：横向越权面 ----------
        st, j = call(admin, '/api/mvp/leads',
                     {'name': TAG + '-越权观察', 'channel': '社群推广', 'owner': '王浩', 'ownerPosition': 'ops'})
        obs_id = (data_of(j) or {}).get('id', '')
        if obs_id:
            obs.append(obs_id)
            st_del, _ = call(recruit, '/api/mvp/leads/' + obs_id, method='DELETE')
            print('INFO 一线招募删除「王浩名下」的线索 → HTTP %s %s'
                  % (st_del, '（存在越权删除面，待确认）' if st_del == 200 else '（已被服务端拦截）'))
    finally:
        # ---------- 11. 清理 ----------
        n = 0
        for tid in made:
            st, _ = call(admin, '/api/mvp/leads/' + tid, method='DELETE')
            if st == 200:
                n += 1
        for tid in obs:   # 观察项可能已被上一步刻意删除，结果不参与计分
            call(admin, '/api/mvp/leads/' + tid, method='DELETE')
        chk('清理本次回归创建的全部线索（%d 条）' % len(made), n == len(made), n)
        st, j = call(admin, '/api/mvp/leads?scope=all')
        chk('清理后线索总数回到基准', len(data_of(j) or []) == len(base_all),
            (len(data_of(j) or []), len(base_all)))

    ok_n = sum(1 for _, p in _results if p)
    print('\nV0.3 最小闭环验收：%d/%d 通过' % (ok_n, len(_results)))
    return 0 if ok_n == len(_results) else 1


if __name__ == '__main__':
    sys.exit(main())
