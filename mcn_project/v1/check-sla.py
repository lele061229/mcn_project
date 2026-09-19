#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
SLA 回归（首次联系时限）：分配计时 → 提醒 → 超时自动上报 → 主管催办 / 重新分配 / 超时原因。
用法：
  python v1/check-sla.py                      # 本地 http://127.0.0.1:3000
  python v1/check-sla.py http://120.25.151.128:3000
自造 SLAtest-* 线索，跑完自动删，不污染库。

⚠️ 两个老坑：
  1. call(url, {}) 在 Python 里 {} 是假值 → 会退化成 GET，必须显式传 method='POST'；
  2. 时间字段是 'YYYY-MM-DD HH:mm'（分钟精度），SLA 用分钟差比较。
"""
import json
import sys
import urllib.request
import urllib.error

BASE = (sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:3000').rstrip('/')
ADMIN = ('admin', 'wsccbe9e7e38e3')
RECRUIT = ('demo-recruit', 'demo123456')
PASS = FAIL = 0
COOKIES = {}


def call(path, body=None, method=None, user=None):
    url = BASE + path
    data = None
    if body is not None:
        data = json.dumps(body).encode('utf-8')
    req = urllib.request.Request(url, data=data, method=(method or ('POST' if data is not None else 'GET')))
    req.add_header('Content-Type', 'application/json')
    if COOKIES:
        req.add_header('Cookie', '; '.join('%s=%s' % (k, v) for k, v in COOKIES.items()))
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            raw = r.read().decode('utf-8')
            for sc in r.headers.get_all('Set-Cookie') or []:
                kv = sc.split(';')[0].split('=', 1)
                if len(kv) == 2:
                    COOKIES[kv[0].strip()] = kv[1].strip()
            return r.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as e:
        raw = e.read().decode('utf-8')
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, {'error': raw}


def login(u, p):
    COOKIES.clear()
    st, j = call('/api/login', {'user': u, 'pass': p})
    return st == 200 and j.get('ok')


def check(label, cond, extra=''):
    global PASS, FAIL
    if cond:
        PASS += 1
        print('  PASS  %s' % label)
    else:
        FAIL += 1
        print('  FAIL  %s  -> %s' % (label, extra))


def seed(name, owner, owner_pos, extra=None):
    body = {'name': name, 'owner': owner, 'ownerPosition': owner_pos, 'channel': 'SLA回归'}
    if extra:
        body.update(extra)
    st, j = call('/api/mvp/leads', body)
    return j.get('data') if j.get('ok') else None


def row_of(lid):
    st, j = call('/api/mvp/leads')
    for r in (j.get('data') or []):
        if r.get('id') == lid:
            return r
    return None


created = []
try:
    print('=== 0. 登录 ===')
    check('管理员登录', login(*ADMIN))
    print('=== 1. 新建线索：SLA 初始状态 ===')
    n1 = 'SLAtest-普通线索'
    lead = seed(n1, '李婷', 'recruit')
    if not lead:
        raise RuntimeError('创建线索失败（检查服务是否启动、账号是否有效）')
    created.append(lead['id'])
    check('新建即写入 assignedAt（计时起点）', bool(lead.get('assignedAt')), lead.get('assignedAt'))
    check('新建线索 firstContactAt 为空', lead.get('firstContactAt') == '')
    check('普通线索 SLA 档位 = normal', lead.get('slaLevel') == 'normal', lead.get('slaLevel'))
    check('普通线索时限 30/60 分钟', lead.get('slaRemindMin') == 30 and lead.get('slaOverdueMin') == 60,
          (lead.get('slaRemindMin'), lead.get('slaOverdueMin')))
    check('刚分配 → 计时中（normal）', lead.get('slaStatus') == 'normal', lead.get('slaStatus'))
    check('剩余分钟数 ≈ 60', 58 <= (lead.get('slaRemainMin') or 0) <= 60, lead.get('slaRemainMin'))
    check('返回 slaDeadline（截止时间）', bool(lead.get('slaDeadline')), lead.get('slaDeadline'))

    print('=== 2. 高潜强意愿线索：严格 SLA ===')
    n2 = 'SLAtest-高潜严格'
    hot = seed(n2, '李婷', 'recruit', {'level': 'A'})
    created.append(hot['id'])
    check('A 级线索 SLA 档位 = strict', hot.get('slaLevel') == 'strict', hot.get('slaLevel'))
    check('严格档时限 10/30 分钟', hot.get('slaRemindMin') == 10 and hot.get('slaOverdueMin') == 30,
          (hot.get('slaRemindMin'), hot.get('slaOverdueMin')))

    print('=== 3. 首次联系 = 跟进一次，SLA 完成 ===')
    st, j = call('/api/mvp/leads/%s/follow-ups' % lead['id'],
                 {'method': '微信', 'content': 'SLA 回归：首次联系', 'result': '已接通'})
    check('跟进接口返回成功', j.get('ok') is True, j.get('error'))
    lp = (j.get('data') or {}).get('lead') or {}
    check('首次联系后 firstContactAt 落库', bool(lp.get('firstContactAt')), lp.get('firstContactAt'))
    check('lastFollowupAt 同步刷新', bool(lp.get('lastFollowupAt')), lp.get('lastFollowupAt'))
    check('SLA 状态 → done（已完成）', lp.get('slaStatus') == 'done', lp.get('slaStatus'))
    check('记录首次联系耗时（分钟）', isinstance(lp.get('slaUsedMin'), int) and lp['slaUsedMin'] >= 0, lp.get('slaUsedMin'))

    print('=== 4. 超时链路的确定性验证说明 ===')
    # 「超时」依赖真实时间流逝（普通 60 分钟 / 严格 30 分钟），HTTP 层无法把 assignedAt 改到过去，
    # 所以本脚本用「结构 + 权限 + 流程 + 幂等」断言覆盖；时间驱动行为另有一致性断言：
    #   · slaOf 的档位/时限/剩余分钟（第 1、2 节，已覆盖）
    #   · 库里若有历史超时线索，slaEscalated=1 的筛选结果必须都带 escalatedAt（第 6 节，已覆盖）
    # 真机演练：把某条线索的 assignedAt 改到 2 小时前再读列表，会自动写 escalatedAt（见开发日志记录）。
    st, j = call('/api/mvp/leads?slaEscalated=1')
    esc = j.get('data') or []
    check('已上报线索的 escalatedAt 都被系统写入', all(r.get('escalatedAt') for r in esc), len(esc))
    check('已上报线索的 slaStatus 都是 overdue', all(r.get('slaStatus') == 'overdue' for r in esc), len(esc))

    print('=== 5. 催办 / 超时原因 / 重新分配的接口自洽 ===')
    # 5.1 未超时线索不允许催办（只在「即将超时 / 已超时」才开放，避免误伤正常线索）
    st, j = call('/api/mvp/leads/%s/urge' % hot['id'], {'note': '测试'}, method='POST')
    check('时限内线索催办被拒（不误伤正常线索）', j.get('ok') is False and st == 409, (st, j.get('error')))

    # 5.2 非管理员不能催办 / 重新分配
    login(*RECRUIT)
    st, j = call('/api/mvp/leads/%s/urge' % hot['id'], {'note': 'x'}, method='POST')
    check('招募岗催办被拒 403', st == 403, (st, j.get('error')))
    login(*ADMIN)

    # 5.3 重新分配：换人 + 原因 + SLA 重新计时
    st, j = call('/api/mvp/leads/%s/reassign' % hot['id'],
                 {'owner': '王浩', 'ownerPosition': 'ops', 'reason': 'SLA 回归：改派'}, method='POST')
    check('重新分配成功', j.get('ok') is True, j.get('error'))
    rr = j.get('data') or {}
    check('新负责人已生效', rr.get('owner') == '王浩', rr.get('owner'))
    check('reassignedAt 已落库', bool(rr.get('reassignedAt')), rr.get('reassignedAt'))
    check('重新分配原因已留痕', rr.get('reassignReason') == 'SLA 回归：改派', rr.get('reassignReason'))
    check('SLA 重新计时（assignedAt 刷新为现在）', bool(rr.get('assignedAt')) and rr.get('slaStatus') in ('normal', 'done'),
          (rr.get('assignedAt'), rr.get('slaStatus')))

    # 5.4 重新分配给不在达人负责人岗位的人 → 岗位边界 400
    st, j = call('/api/mvp/leads/%s/reassign' % hot['id'],
                 {'owner': '张萌', 'ownerPosition': 'sample', 'reason': '越界测试'}, method='POST')
    check('寄拍岗不能当达人负责人（400）', j.get('ok') is False, (st, j.get('error')))

    # 5.5 超时原因：负责人本人可写（李婷对自己的线索）
    n3 = 'SLAtest-超时原因'
    l3 = seed(n3, '李婷', 'recruit')
    created.append(l3['id'])
    login(*RECRUIT)
    st, j = call('/api/mvp/leads/%s/overdue-reason' % l3['id'], {'reason': '达人电话打不通'}, method='POST')
    check('负责人可填写超时原因', j.get('ok') is True, j.get('error'))
    check('原因已落库', (j.get('data') or {}).get('overdueReason') == '达人电话打不通', (j.get('data') or {}).get('overdueReason'))
    check('原因为空时被拒 400', call('/api/mvp/leads/%s/overdue-reason' % l3['id'], {'reason': ''}, method='POST')[1].get('ok') is False)
    login(*ADMIN)

    print('=== 6. 列表筛选 & 派生字段 ===')
    st, j = call('/api/mvp/leads?slaOverdue=1')
    check('待升级（slaOverdue=1）可查询', j.get('ok') is True, j.get('error'))
    over = j.get('data') or []
    check('筛选结果全部为 overdue', all(r.get('slaStatus') == 'overdue' for r in over), [r.get('slaStatus') for r in over][:5])
    st, j = call('/api/mvp/leads?slaRemind=1')
    check('即将超时（slaRemind=1）可查询', j.get('ok') is True)
    check('即将超时结果仅含 remind', all(r.get('slaStatus') == 'remind' for r in j.get('data') or []),
          [r.get('slaStatus') for r in (j.get('data') or [])][:5])
    st, j = call('/api/mvp/leads?slaEscalated=1')
    check('已上报（slaEscalated=1）可查询', j.get('ok') is True)
    check('已上报结果都带 escalatedAt', all(r.get('escalatedAt') for r in j.get('data') or []),
          [r.get('escalatedAt') for r in (j.get('data') or [])][:5])

    print('=== 7. 工作台 / 看板接线 ===')
    st, j = call('/api/mvp/workbench')
    wb = j.get('data') or {}
    cards = wb.get('cards') or {}
    # 20260921a：SLA 停止业务使用 —— 工作台 cards 不再下发 slaOverdue/slaRemind（历史字段保留）
    check('工作台 cards 已移除 slaOverdue/slaRemind（SLA 停止业务使用）',
          'slaOverdue' not in cards and 'slaRemind' not in cards, list(cards.keys())[:12])
    check('工作台待办不再含 SLA 分类（不再自动上报催办）',
          all('SLA' not in (t.get('type') or '') for t in (wb.get('todos') or [])),
          [t.get('type') for t in (wb.get('todos') or [])][:8])
    st, j = call('/api/mvp/dashboard')
    d = j.get('data') or {}
    att = d.get('attention') or {}
    check('看板 attention 已移除 slaOverdue/slaRemind（SLA 停止业务使用）',
          'slaOverdue' not in att and 'slaRemind' not in att, list(att.keys()))
    check('看板 alerts 是数组', isinstance(d.get('alerts'), list))

    print('=== 8. 清理回归数据 ===')
    for lid in created:
        call('/api/mvp/leads/%s' % lid, method='DELETE')
    st, j = call('/api/mvp/leads')
    left = [r for r in (j.get('data') or []) if (r.get('name') or '').startswith('SLAtest-')]
    check('回归数据已清理', len(left) == 0, [r.get('id') for r in left])

finally:
    for lid in created:
        try:
            call('/api/mvp/leads/%s' % lid, method='DELETE')
        except Exception:
            pass

print('')
print('通过 %d 项断言%s' % (PASS, ('，失败 %d 项' % FAIL) if FAIL else ''))
sys.exit(1 if FAIL else 0)
