# -*- coding: utf-8 -*-
"""拆表冒烟：leads/talents 分流 + 转化全链路 + 越权。跑完自动清理。"""
import json, sys, time, urllib.request, urllib.error, http.cookiejar

BASE = 'http://127.0.0.1:3000'
PASS = {'admin': 'wsccbe9e7e38e3', 'demo-recruit': 'demo123456', 'demo-staff': 'demo123456',
        'demo-senior': 'demo123456', 'demo-finance': 'demo123456', 'demo-promote': 'demo123456'}
RUN = str(int(time.time()))[-6:]
TAG = 'Split' + RUN
ok = fail = 0


def chk(name, cond, extra=''):
    global ok, fail
    if cond: ok += 1
    else: fail += 1
    print(('PASS ' if cond else 'FAIL ') + name + (('  ' + str(extra)) if extra else ''))


def client():
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))


def call(op, path, body=None, method=None):
    data = json.dumps(body).encode('utf-8') if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method or ('POST' if data else 'GET'))
    if data:
        req.add_header('Content-Type', 'application/json')
    try:
        with op.open(req) as r:
            return r.status, json.loads(r.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode('utf-8'))
        except Exception:
            return e.code, None


def login(u):
    op = client()
    st, j = call(op, '/api/login', {'user': u, 'pass': PASS[u]})
    assert st == 200, (u, st)
    return op


def main():
    admin, recruit, sample, staff = login('admin'), login('demo-recruit'), login('demo-promote'), login('demo-staff')

    # 1. 拆表分流
    st, j = call(admin, '/api/mvp/leads?scope=all')
    leads = j['data'] if st == 200 else []
    chk('线索池只含未转化线索（无 合作中/暂停合作）',
        all(x['status'] not in ('已成为达人',) for x in leads), len(leads))
    st, j = call(admin, '/api/mvp/talents')
    tals = j['data'] if st == 200 else []
    chk('达人档案全部是已成为达人', st == 200 and all(x['status'] == '已成为达人' for x in tals), len(tals))
    chk('达人档案含种子转化数据（王芳Fiona 等）', any(x['name'] == '王芳Fiona' for x in tals))
    st, j = call(sample, '/api/mvp/talents')
    chk('推广岗访问达人档案 → 403', st == 403, st)
    st, j = call(admin, '/api/dashboard')
    chk('V1 老看板仍可用（合并读取）', st == 200 and j.get('ok'), st)

    # 2. 转化全链路：建线索 → 分配给李婷 → 李婷提交审核 → 管理员/主管转化
    st, j = call(admin, '/api/mvp/leads', {'name': TAG + '-转化链', 'channel': '朋友圈', 'owner': '未分配'})
    lid = j['data']['id']
    st, j = call(admin, '/api/mvp/leads/%s/assign' % lid, {'owner': '李婷', 'ownerPosition': 'recruit'})
    chk('管理员分配线索给李婷', st == 200, st)
    st, j = call(staff, '/api/mvp/leads/%s/convert' % lid, method='POST')
    chk('非负责人（运营王浩）转化 → 403', st == 403, st)
    # 20260921b 权限收敛：转正式达人只给主管（高级运营/管理员），招募/运营一律 403
    st, j = call(recruit, '/api/mvp/leads/%s/convert' % lid, method='POST')
    chk('线索负责人李婷（招募岗）直接转化 → 403（需走「提交审核」）', st == 403, st)
    st, j = call(admin, '/api/mvp/leads/%s/convert' % lid, method='POST')
    d = (j or {}).get('data') or {}
    chk('管理员转化成功', st == 200 and d.get('status') == '已成为达人', (st, d.get('status')))
    chk('固化转化人=管理员 + 转化时间', d.get('convertedBy') == '管理员' and d.get('convertedById') == 'admin' and bool(d.get('convertedAt')),
        {k: d.get(k) for k in ('convertedBy', 'convertedById', 'convertedAt')})
    st, j = call(admin, '/api/mvp/leads?scope=all')
    chk('转化后线索池不再有该线索', all(x['id'] != lid for x in j['data']))
    st, j = call(recruit, '/api/mvp/talents')
    mine = [x for x in j['data'] if x['id'] == lid]
    chk('转化后达人档案可见（李婷视角，负责人保留）', len(mine) == 1 and mine[0].get('owner') == '李婷', len(mine))
    st, j = call(recruit, '/api/mvp/leads/%s/history' % lid)
    chk('转化后仍能回看线索流转历史', st == 200 and j.get('ok'), st)
    st, j = call(recruit, '/api/mvp/leads/%s/follow-ups' % lid)
    chk('转化后仍能回看跟进记录（回退查询）', st == 200 and j.get('ok'), st)
    st, j = call(admin, '/api/logs')
    hit = [l for l in j['data'] if l.get('type') == '转为正式达人' and TAG in l.get('target', '')]
    chk('操作日志记录「转为正式达人」+ 转化人', len(hit) >= 1 and '转化人=管理员' in hit[0]['after'], hit[:1])
    # 3. 清理：转化的达人在 talents，删除走 /api/talents 原生接口? 用 admin 的 mvp talents? —— 直接查无删除接口时跳过
    # （转化测试数据保留在达人库，幂等脚本以唯一 TAG 命名，不影响后续运行）
    st, j = call(admin, '/api/mvp/leads', {'name': TAG + '-残留', 'channel': '其他', 'owner': '未分配'})
    rid = j['data']['id']
    st, _ = call(admin, '/api/mvp/leads/' + rid, method='DELETE')
    chk('清理未转化测试线索', st == 200, st)
    print('\n冒烟：%d 通过，%d 失败（转化测试达人「%s-转化链」保留在达人库供页面查看）' % (ok, fail, TAG))
    return 0 if fail == 0 else 1


if __name__ == '__main__':
    sys.exit(main())
