# 得物 MCN 达人招募 CRM —— 权限 / 分配 / 待办 / 交接 交付说明

> **2026-09-16 增补：组织与业务流已按链路重构**（推广获客 → 一线招募对接 → 达人运营 → 寄拍执行 → 收益结算 → 管理员总览），见文末第十一节。

> 本次改动范围严格限定在：**分配 → 跟进 → 待办 → 交接 → 接收 → 留痕**。
> 未重构项目、未更换技术栈、未重做现有页面；沿用原有「零依赖 Node.js + Vue3 + JSON 文件库」结构与视觉风格。
> 新增/修改的 5 个功能文件全部落在原目录原位，其余页面零改动。

---

## 一、新增文件

| 文件 | 说明 |
|---|---|
| `v1/check-crm-api.py` | **零依赖接口回归脚本（自清理）**。用 5 个账号真实登录，覆盖数据权限、越权拦截、单条/批量分配、工作台待办、跟进、交接正反向、历史留痕；脚本自己造 3 条 `APItest-*` 线索，跑完自动删除，不在库里留垃圾。共 50 项断言。 |
| `v1/check-crm-ui.js` | **浏览器端 UI 回归脚本（headless Edge / CDP）**。覆盖 A 管理员总表 / B 筛选与统计 / C 批量分配 / D 招募岗视角 / E 寄拍岗隔离 / F 跟进弹窗 8 字段持久化 / G 工作台 5 张卡 + 待办 / H 交接全流程 / I 详情页留痕 / J 清理。共 48 项断言。 |

> 说明：此次**没有新增业务代码文件**。所有业务能力都增量写进了原有 4 个文件，避免出现「新旧两套实现」。

---

## 二、修改文件

| 文件 | 改动 |
|---|---|
| `v1/server.js` | 后端主体。新增 5 个数据字段组 + 6 个接口 + 行级权限内核 + 工作台规则引擎；`doAssign()` / `createHandover()` 做成公共函数，供单条与批量共用。 |
| `talent-leads.js` | 前端线索模块。新增「勾选 + 批量分配」层、总表筛选（负责人/岗位/未分配/逾期/待交接）、跟进弹窗 8 字段、跟进记录加载、交接字段映射。 |
| `app.js` | 「我的工作台」由静态展示改为**服务端驱动的待办**：`loadWorkbench()` 拉 `/api/mvp/workbench`，`wbCards` / `wbTodos` 直接用服务端结果，并保留一份本地规则兜底（`wbLocal`），断网时仍可用。 |
| `index.html` | 工作台 5 张卡 + 待办表格（含「来源」列与按类型着色的操作按钮）；管理员总表模式（筛选栏 + 批量分配条 + 勾选列 + 13 列 + 分页页脚）；跟进弹窗改造；详情弹窗加「最近一次交接」「跟进记录」两块。缓存版本号 `20260915r → 20260915s`。 |
| `v1/check-perm.js` | 断言同步新语义：交接确认后**状态保留为 `confirmed`**（而非旧版清空为 `none`），以便总表仍能看到最近一次交接摘要。 |

---

## 三、数据库 / 飞书新增字段

**`talents` 集合（达人 / 线索）新增：**

| 字段 | 含义 | 用途 |
|---|---|---|
| `ownerId` | 负责人**账号 ID** | 权限判断的唯一依据（不再只靠中文名） |
| `ownerPosition` | 负责人所属岗位 | 总表「当前岗位」列、岗位级可见范围 |
| `assignedAt` | 分配时间 | 「新分配给我」待办的 7 天窗口 |
| `nextFollowAt` | 下次跟进时间 | 「今日待跟进」「逾期未跟进」待办依据 |
| `potentialLevel` | 达人潜力（高/中/低） | 「高潜强意愿未推进」待办依据 |
| `intentLevel` | 合作意愿（强/中/弱） | 同上 |
| `talentClass` | 达人分类 | 跟进时评估落库 |
| `coopPath` | 合作路径 | 推进方向 |
| `incubationFee` / `feeStatus` | 孵化服务费 / 收款状态 | 与财务模块衔接 |
| `handoverStatus` | 交接状态（none/pending/confirmed/rejected/cancelled） | 总表「交接状态」列 |
| `handoverFrom` / `handoverFromId` / `handoverFromPosition` | 原负责人（名/ID/岗位） | 交接摘要 |
| `handoverTo` / `handoverToId` / `handoverToPosition` | 接收人（名/ID/岗位） | 交接摘要 |
| `handoverReason` / `handoverNote` | 交接原因 / 说明 | 交接详情 |
| `handoverAt` / `handoverReceivedAt` / `handoverBy` | 发起时间 / 接收时间 / 发起人 | 留痕 |

**`handovers` 集合新增：** `fromUserId`、`toUserId`（账号 ID，用于「待我接收」精确匹配）、`note`（交接说明）。

**`followups` 集合扩充：** `method`（跟进方式）、`result`（跟进结果）、`stage`（跟进时阶段）、`potentialLevel` / `intentLevel` / `talentClass`（本次评估）、`operatorId`（操作人账号 ID）、`nextAt`（下次跟进时间）。

**`logs` 日志新增类型：** `线索分配`、`线索批量分配`、`线索跟进记录`、`线索交接-发起`、`线索交接-确认`、`线索交接-驳回`、`线索交接-撤回`、`线索交接-强制指派`。

> **迁移是自愈的**：`migrateDb()` 每次启动都会补齐缺失字段，并且会把历史上写坏的值修回来——
> `ownerId` 为 `''` 但 `owner` 有名有姓的，会用现在已存在的账号表重新推导 ID；
> `owner` 为「未知用户 / undefined / null / 空」的统一归一为 `未分配`。
> 这条自愈逻辑是本次在**线上真实数据**里发现并修掉的一个坑（详见第九节）。

---

## 四、新增接口

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/api/mvp/workbench` | 登录用户 | 待办卡 + 待办列表；**服务端按规则计算**，非管理员只在自己的可见范围内推导 |
| GET | `/api/mvp/my/leads` | 登录用户 | 「我负责的线索」，等价于 `?scope=mine`，语义更直白 |
| POST | `/api/mvp/leads/:id/assign` | **仅管理员** | 单条分配：立即改负责人 |
| POST | `/api/mvp/leads/batch-assign` | **仅管理员** | 批量分配：一次改多条，跳过分歧项（见下） |
| POST | `/api/mvp/leads/:id/follow-ups` | 负责人 / 管理员 | 提交跟进：更新最近跟进 + 下次跟进 + 阶段 + 三项评估，并写入 `followups` |
| POST | `/api/mvp/leads/:id/handover` | 当前负责人 | **发起交接**（转出方），状态置 `pending`，**原负责人不变** |
| POST | `/api/mvp/handovers/:id/accept` | **仅指定接收人** | 确认接收 → 负责人真正切换到接收人 |
| POST | `/api/mvp/handovers/:id/reject` | **仅指定接收人** | 驳回 → 负责人保持原样 |
| GET | `/api/mvp/handovers` | 登录用户 | 交接列表（收件箱/发件箱，按身份过滤） |

**复用/扩展的既有接口：**
- `GET /api/mvp/leads` 新增筛选参数：`owner`、`position`、`unassigned=1`、`handover=1`、`overdue=1`（**在权限过滤之后叠加**，只能收窄、不能放宽）。
- `GET /api/mvp/leads/:id`（单条，越权直接 403）、`GET /api/mvp/leads/:id/follow-ups`、`GET /api/mvp/leads/:id/history`。
- `POST /api/mvp/handovers/:id/:action` 兼容 `accept|reject|cancel|force`，其中 `accept` 是 `confirm` 的别名（老调用不破）。

---

## 五、管理员完整流程

1. 用 `admin` 登录 → 打开「达人线索」→ 切到 **管理员总表**。
2. 总表看到**全部**线索及：当前负责人 / 当前岗位 / 下次跟进 / 最近跟进 / 交接状态 / 操作。
3. 用筛选栏定位：**负责人**（下拉）、**岗位**（招募/运营/寄拍/财务）、**未分配**、**逾期未跟进**、**待交接**（可叠加）；「重置」一键清空。
4. **单条分配**：行尾「分配」→ 选负责人 + 所属岗位 → 确认，负责人立即变更并写日志。
5. **批量分配**：勾选多条（表头支持全选本页）→ 顶部出现批量分配条，显示「已勾选 N 条」→ 点「批量分配负责人」→ 选负责人 + 岗位 → 确认。
   - 规则：**已是待交接（pending）的线索会被跳过**（避免和交接流程打架）；
   - 目标负责人没变的不重复写日志；
   - 每条成功变更都独立写一条 `线索批量分配` 日志。
6. 点「历史」查看该线索的流转记录（分配 / 跟进 / 交接 / 阶段变更 / 潜力变更）。
7. 管理员在工作台额外多两类待办：**待分配**（公海线索）与**待接收**（可以替接收人看进度，必要时**强制指派**）。

---

## 六、负责人完整流程

1. 用自己的账号（如 `demo-recruit`）登录 → 进 **我的工作台**。
2. 看到 5 张卡：**新分配给我 / 今日待跟进 / 逾期未跟进 / 待我接收交接 / 高潜强意愿未推进**，以及下方合并的待办列表（每行有 达人昵称 / 阶段 / 类型 / 优先级 / **下一步动作** / 截止时间 / **来源**）。
3. 点「去跟进」→ 弹窗填：跟进方式 / 结果 / 内容 / 当前阶段 / 合作意愿 / 达人潜力 / 下次跟进时间 / 备注 → 保存。
   - 保存后：`最近跟进` = 此刻，`下次跟进` = 你填的时间，阶段与两项评估同步落库，写一条 `followups` + 一条 `线索跟进记录` 日志，**待办立即重算**。
4. 如果这条线索自己带不动了 → 点「发起交接」→ 选**接收人** + **接收人岗位** + **原因** + **当前情况** + **下一步建议** → 提交。
   - 状态变 `pending`；**此时负责人仍然是发起人自己**，直到对方确认。
   - 自己这边待办从「待跟进」变成「待交接」（提示：等待 XX 确认接收）。
5. 交接被驳回 → 状态 `rejected`，负责人仍是自己，继续跟。

---

## 七、接收人完整流程

1. 登录自己的账号 → 工作台出现「**待我接收交接**」卡片 + 列表里类型为「待接收」的行（来源显示「XX 发起」）。
2. 点「查看」→ 详情弹窗可看到：原负责人、原岗位、交接原因、交接说明、当前阶段、最近跟进记录。
3. 点「**确认接收**」：
   - 当前负责人 → **切换为自己**；`ownerId` / `ownerPosition` 同步；
   - `assignedAt` 重置为此刻，`handoverReceivedAt` 记录接收时间；
   - 线索上的交接摘要保留（状态 `confirmed`，总表仍能看到「上一次谁交接给谁」）；
   - 写 `线索交接-确认` 日志；
   - 待办里该行消失，线索进入自己的「新分配给我」。
4. 点「**驳回**」：状态 `rejected`，**负责人保持不变**，线索回到原负责人待办中，写 `线索交接-驳回` 日志。

> **分配 vs 交接 的语义边界（本次最关键的区分）**
> - **分配**：管理员对新线索/未分配线索使用 → **立即生效**，不需要对方确认。
> - **交接**：对**已经在跟**的线索使用 → 由当前负责人发起，**必须接收人确认**才真正换人。

---

## 八、权限规则

**双层模型：角色（role）管页面/接口，岗位（position）管数据行。**

| 层 | 取值 | 作用 |
|---|---|---|
| role | `admin` / `staff` / `finance` | 能否进某模块、能否调某接口（分配/批量分配**仅 admin**） |
| position | `recruit` 招募 / `ops` 运营 / `sample` 寄拍 / `finance` 财务 | 能看见哪些行 |

**核心规则：**
1. **行级过滤在服务端**，不在前端。管理员看全部；普通用户 `GET /api/mvp/leads` 只返回自己负责的。
2. **越权直接拒绝**：单条 `GET /:id`、`/follow-ups`、`/history`、`PUT`、`POST /follow-ups` 都会校验可见性，不可见 → **403**，不是返回空。
3. **身份以账号 ID 为准**：`isMine()` 优先比 `ownerId === authUser`，中文名只作为历史数据的兜底。这样「同名不同人」「改名」都不会串数据。
4. **交接接收权唯一**：`accept` / `reject` 只允许 `handoverToId` 本人，其他账号（哪怕同为 staff）一律 403。
5. **筛选不能提权**：`owner` / `position` / `unassigned` 等 query 参数只在已授权集合内收窄，无法借此看到别人的数据。
6. **工作台口径**：普通用户的工作台只在自己可见范围内推导待办；管理员额外多出「待分配」和全局「待接收」。

---

## 九、测试方法（≥3 个测试账号，确保数据不串）

**测试账号：**

| 角色 | 账号 | 密码 | 姓名 / 岗位 |
|---|---|---|---|
| 管理员 | `admin` | `wsccbe9e7e38e3` | 管理员 / admin |
| 负责人 A | `demo-recruit` | `demo123456` | 李婷 / recruit |
| 负责人 B | `demo-sample` | `demo123456` | 张萌 / sample |
| 负责人 C（补充） | `demo-staff` | `demo123456` | 王浩 / ops |
| 财务（补充） | `demo-finance` | `demo123456` | 周妍 / finance |

**一键回归（推荐）：**

```bash
# 接口层：50 项断言，自造数据 + 自清理
python v1/check-crm-api.py                       # 本地  http://127.0.0.1:3000
python v1/check-crm-api.py http://120.25.151.128:3000   # 线上

# UI 层：48 项断言（需先启动 headless Edge，CDP 端口 9290/9291）
WS_BASE=http://127.0.0.1:3000      CDP_PORT=9290 node v1/check-crm-ui.js
WS_BASE=http://120.25.151.128:3000 CDP_PORT=9291 node v1/check-crm-ui.js

# 权限 / 角色 / 退出（回归不被破坏）
node v1/check-perm.js          # 44 项
node v1/check-demo-roles.js
node v1/check-logout.js
```

**手动验证「不串数据」三步：**

1. `admin` 登录 → 分配一条线索给 **李婷** → 退出。
2. `demo-recruit`（李婷）登录 → 该条出现在工作台；尝试用 URL 直连 `demo-sample` 的某条线索 ID → **403**。
3. `demo-sample`（张萌）登录 → 看不到李婷的任何线索；工作台为空或只有自己的。

**当前回归结果（全部通过）：**

| 脚本 | 本地 | 线上 |
|---|---|---|
| `check-crm-api.py` | 通过 50 / 失败 0 | 通过 50 / 失败 0 |
| `check-crm-ui.js` | 通过 48 / 失败 0 | 通过 48 / 失败 0 |
| `check-perm.js` | 通过 44 / 失败 0 | 通过 44 / 失败 0 |
| `check-demo-roles.js` / `check-logout.js` | 通过 | 通过 |

> **本次在线上真实数据里发现并修掉的一个坑**：线上 15 条历史线索的 `ownerId` 是空字符串——原因是迁移第一次运行时账号表还没加载完，旧判断 `ownerId === undefined` 对已写入的 `''` 不生效，于是永久留空。
> 修法：迁移判断改为 `if (!t.ownerId && t.owner && t.owner !== '未分配')`，从**当前已存在的账号表**重新推导 ID。重新部署后重启，15 条线索自动补齐，线上 50/50 通过。

---

## 十、我最需要理解的代码（5 个关键点）

### 1. 当前登录用户在哪里获取

`v1/server.js:2044`（请求上下文构造处）：

```js
roleCode, displayName, position: tok ? tok.position : '', authUser: tok ? tok.user : '',
```

- 身份来自 **HttpOnly Cookie `ws_auth`** 里的 HMAC token：`exp.user.role.position.signature`；
- 签名把**密码哈希绑进签名**，所以改密码即让所有旧会话失效；
- 校验后填充 `ctx.authUser`（账号 ID，如 `demo-recruit`）、`ctx.displayName`（李婷）、`ctx.roleCode`、`ctx.position`；
- **后续所有权限判断都只认 `ctx.authUser`（ID），不认中文名。**

### 2. 负责人过滤在哪里实现

`v1/server.js:614-635` 四个函数组成一条链：

```js
function isMine(t, ctx)        // 615: if (ctx.authUser && t.ownerId) return t.ownerId === ctx.authUser;  ← 主判断
function isPendingForMe(t, ctx)// 621: if (ctx.authUser && t.handoverToId) return t.handoverToId === ctx.authUser;
function resolveScope(ctx, want)// 625: 解出 all / position / mine，非管理员不能升到 all
function leadVisibleTo(t, ctx, scope) // 630: 最终裁决某行是否可见
```

- 调用点在 `GET /api/mvp/leads`（`server.js:678`）：`arr.filter(...).filter(t => leadVisibleTo(t, ctx, sc))`；
- 单条 `server.js:698` 不可见即 **403**；
- 工作台 `server.js:1084`：`const universe = isAdmin ? all : all.filter(t => leadVisibleTo(t, ctx, 'position'));`
- 前端 `app.js:916` 的 `wbLocal` 只是**断网兜底**，真正口径以服务端为准。

### 3. 分配逻辑在哪里实现

`v1/server.js:736` 的 `doAssign(ids, ownerName, ownerPosition, ctx, mode)`，单条与批量**共用同一函数**，避免两套规则跑偏：

- 入口：单条 `server.js:757`、批量 `server.js:768`（两个路由都做 **admin 校验**）；
- 关键防御：
  - 目标负责人必须真实存在（`uidByName` / `posByName` 解析），否则报错；
  - **跳过 `handoverStatus === 'pending'` 的线索**（正在交接中，不允许被分配覆盖）；
  - 负责人未变化的不重复写日志；
  - 每条成功变更独立写一条日志（`线索分配` / `线索批量分配`）。
- 落库字段：`owner` / `ownerId` / `ownerPosition` / `assignedAt`。
- 前端入口：`talent-leads.js:265` `ownerOptions`（过滤掉 finance）、`:269` `openAssign`、`:276` `openBatchAssign`、`:288` `saveAssign`。

### 4. 工作台待办在哪里生成

`v1/server.js:1060` `GET /api/mvp/workbench` —— **服务端规则引擎，第一版不接 AI**。

判定顺序（`continue` 保证一条线索只落一类待办，避免重复刷屏）：

| 顺序 | 类型 | 条件 |
|---|---|---|
| 1 | **待接收** | 我是交接接收人 且 `handoverStatus === 'pending'` |
| 2 | **待交接** | 我发起的交接仍在 `pending`（等对方确认） |
| 3 | **逾期未跟进** | 我负责 且 `nextFollowAt < 今天` |
| 4 | **今日待跟进** | 我负责 且 `nextFollowAt === 今天` |
| 5 | **新分配** | 我负责 且 `assignedAt` 在 7 天内 且 `lastFollowAt <= assignedAt`（分配后还没碰过） |
| 6 | **高潜强意愿** | 我负责 且 `potentialLevel === '高'` 且 `intentLevel === '强'` 且未进入完成态 |
| 7 | **待分配**（仅 admin） | `owner` 为空 / 未分配 |
| 8 | admin 额外 | 为所有 pending 交接补一行「待接收」，便于盯进度 / 强制指派 |

排序：优先级（高→中→低）→ 截止时间；截取前 200 条。卡片计数由 `byType()` 从同一份 rows 统计，**卡和列表永不打架**。
前端 `app.js:902 loadWorkbench()` / `:937 wbCards` / `:940 wbOpen` / `:948 wbConfirm` / `:954 wbReject`。

### 5. 交接确认后负责人在哪里变更

前半段：`v1/server.js:935` `createHandover(ctx)`（发起）——只写 `handoverStatus='pending'` 和交接摘要，**不动 `owner`**。这也是「发起交接后原负责人仍能继续跟」的实现点。

后半段：`v1/server.js:982` `route('POST','/api/mvp/handovers/:id/:action')` 里的 `confirm` 分支，是负责人真正切换的唯一位置：

```js
t.owner = h.toUser;                       // 新负责人姓名
t.ownerId = h.toUserId || uidByName(h.toUser);   // 新负责人账号 ID（权限判断依据）
t.ownerPosition = h.toPosition || '';     // 新负责人岗位
t.assignedAt = nowT;                      // 视作一次新的「分配起点」
t.handoverStatus = 'confirmed';           // 保留 confirmed，总表仍能看到最后一次交接摘要
t.handoverReceivedAt = nowT;
// + 写日志：线索交接-确认
```

同一路由下：

- `reject` → `handoverStatus='rejected'`，**`owner` 一行不动**（负责人保持原样）；
- `cancel` → 发起人撤回，回到 `cancelled`；
- `force` → 管理员强制指派，直接换人（绕过接收人确认，用于交接卡死场景）。

> 三条路径合起来就是一句话：**只有 `confirm` 和 `force` 会真正改变负责人；`reject` / `cancel` 绝不动负责人。**

---

## 附：部署信息（本次已上线并验证）

- 线上：`http://120.25.151.128:3000`（Linux，`/ai/mcn-admin/`，node16，systemd 服务 `mcn-admin`）
- 本次已把 `server.js` / `index.html` / `app.js` / `talent-leads.js` 同步上线并重启，线上 50/50 + 48/48 全部通过。
- 本地环境已用**改动前的干净数据快照** `v1/data/db.json.bak-crmperm-202609152038` 复位，回归脚本跑完不残留测试数据。

---

## 十一、组织与业务流优化（2026-09-16 增补）

> 按「**推广获客 → 一线招募对接 → 达人运营 → 寄拍执行 → 收益结算 → 管理员总览**」拆分岗位职责、权限、工作台与菜单。没有新建系统，全部是在原有 4 个业务文件 + 测试脚本上的增量改造。

### 11.1 岗位职责（新口径）

| 岗位 | position | 职责 | 不做什么 |
|---|---|---|---|
| 推广 | `promote` | 各平台广告/活动投放、渠道成本、线索量、转化率 | 不当达人负责人 |
| 招募 | `recruit` | 分配到自己的达人线索：基础沟通、跟进、潜力与合作意愿判断、**A/B/C/D 分类**、合作路径判断；完成后交接给运营 | 不长期管达人 |
| 运营 | `ops` | 得物账号、内容方向、账号成长、任务安排、商业机会（达人**长期负责人**） | — |
| 寄拍 | `sample` | 执行**运营发起的**具体寄拍任务 | **不是达人负责人**，达人归属不变 |
| 财务 | `finance` | 分成、应付、结算 | 不碰线索 |
| 管理员 | `admin` | 全部链路、全部负责人、全部岗位交接 | — |

### 11.2 负责人字段设计

- **`owner` / `ownerId` / `ownerPosition`**：线索/达人的**唯一当前负责人**，是行级权限的唯一依据。招募阶段=招募岗；交接给运营后=运营岗。
- **`recruitBy` / `recruitById`（新增）**：招募负责人留痕。**招募→运营交接确认时固化，只记第一次**，之后运营之间的交接不覆盖（总表/详情可区分「谁招来的」和「谁在管」）。
- **`tasks.owner` / `tasks.ownerId`（ownerId 新增）**：寄拍任务的**执行人**（寄拍岗），任务级归属，**不改变达人归属**。迁移自动回填存量任务的 ownerId。
- 分配 / 交接的候选人下拉只列 **招募 / 运营**（`handover-targets?positions=recruit,ops`），服务端强校验：分给或交接给 寄拍/推广/财务 → **400**「不做达人负责人」。

### 11.3 权限与菜单信息架构

菜单 = 角色（能进哪类页面）+ **岗位（NAV_POSITIONS，链路收敛）**，管理员不受限；岗位未设置的账号不收敛：

| 岗位 | 可见菜单 | 落地页 |
|---|---|---|
| 推广 | 经营看板 / **推广获客** / 我的工作台 | 工作台 |
| 招募 | 经营看板 / **达人线索** / 我的工作台 | 工作台 |
| 运营 | 经营看板 / **达人线索 + 寄拍任务** / 我的工作台 | 工作台 |
| 寄拍 | 经营看板 / **寄拍任务** / 我的工作台 | 工作台 |
| 财务 | 经营看板 / **收益结算** / 我的工作台 | 工作台 |
| 管理员 | 全部（经营看板即全链路总览） | 经营看板 |

左侧菜单分组同步改为链路口径：推广获客 / 一线招募对接 / 达人运营 / 收益结算 / 工具 / 系统设置；员工登录后直接落在自己的工作台。

### 11.4 工作台按岗位生成（`/api/mvp/workbench`）

- **招募 / 运营 / 管理员**：沿用 5 张达人卡（新分配/今日/逾期/待接收/高潜强意愿），运营会收到「招募完成」达人的交接。
- **招募岗新增「招募完成」待办**：名下达人进入「合作中 / 暂停合作」且无未结交接 → 提示「交接给达人运营，达人转长期管理」，按钮直达交接弹窗。
- **寄拍岗**：不产生达人待办；卡片=待执行任务 / 逾期异常 / 已完成（真实任务库），待办=分配给他的任务行（kind=task，「去执行」跳寄拍任务页）。
- **推广岗**：卡片=我的投放 / 有效线索 / 线索转化率（按自己名下 campaign 汇总）。
- **财务岗**：卡片=待核对结算单 / 待付款 / 已结清。

### 11.5 新账号与回归

- 新增推广岗演示账号 **`demo-promote` / demo123456（陈晨）**；一键体验扩为 **6 个按钮**（管理员+推广/招募/运营/寄拍/财务），说明小字改为链路分工口径。
- 回归结果（本地 / 线上一致，全绿）：`check-crm-api` **60** 项（新增 岗位边界 400、招募负责人固化、招募完成待办、分岗位工作台断言）、`check-demo-roles` **69** 项（6 账号+菜单按岗位收敛）、`check-perm` 44 项、`check-crm-ui` **48** 项（寄拍岗改任务视角、交接流程改走招募岗）、`check-logout` 通过。
