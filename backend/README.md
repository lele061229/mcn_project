# MCN 达人线索管理后台

FastAPI → 飞书 OpenAPI → 飞书多维表格

## 快速开始（Windows）

### 1. 创建虚拟环境

```bash
cd d:\Projects\mcn_project\backend
python -m venv .venv
.venv\Scripts\activate
```

### 2. 安装依赖

```bash
pip install -r requirements.txt
```

### 3. 创建 .env

```bash
cp .env.example .env
```

编辑 `.env`，填入飞书凭证：

```
FEISHU_APP_ID=cli_xxxxxxxx
FEISHU_APP_SECRET=xxxxxxxxxxxxxxxxxx
FEISHU_APP_TOKEN=xxxxxxxxxxxxxxxx   # 多维表格 URL 中 /base/ 后面那段
FEISHU_TABLE_ID=tblxxxxxxxxxxxxxx   # 达人线索表 table_id
```

### 4. 启动后端

```bash
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

启动后访问：
- Swagger 文档：http://127.0.0.1:8000/docs
- 健康检查：http://127.0.0.1:8000/api/health

### 5. 验证健康检查

```bash
curl http://127.0.0.1:8000/api/health
```

返回：
```json
{"code": 0, "message": "success", "data": {"status": "ok"}}
```

> `/api/health` 不依赖飞书，即使 `.env` 未配置也能返回 ok。

## 目录职责

```
backend/
├── main.py              # FastAPI 入口：CORS、异常处理、日志、路由挂载
├── config.py            # 环境变量 + 飞书字段映射（集中维护）
├── requirements.txt     # 依赖清单
├── .env.example         # 环境变量模板
├── .gitignore
│
├── routes/
│   └── leads.py         # API 路由：health / leads CRUD / Excel 导入
│
├── services/
│   └── lead_service.py  # 业务逻辑：字段映射、分页筛选、Excel 解析校验
│
├── clients/
│   └── feishu_client.py # 飞书 API 封装：token 缓存、记录增删改查、批量新增
│
├── schemas/
│   └── lead.py          # Pydantic 模型：请求体校验
│
└── utils/
    └── response.py      # 统一返回结构 + 自定义异常类
```

**调用关系：**
```
前端请求
  → routes/leads.py        （参数校验、统一返回）
  → services/lead_service.py  （业务逻辑、字段映射、Excel 解析）
  → clients/feishu_client.py  （飞书 HTTP 请求、token 缓存）
  → 飞书 OpenAPI
  → 返回 JSON
  → 前端展示
```

## 接口列表

| 方法 | 路径 | 说明 |
|------|------|------|
| GET  | `/api/health` | 健康检查（不依赖飞书） |
| GET  | `/api/leads` | 线索列表（分页 + 筛选） |
| GET  | `/api/leads/{id}` | 线索详情 |
| POST | `/api/leads` | 新增线索 |
| PUT  | `/api/leads/{id}` | 部分更新线索 |
| POST | `/api/leads/import/preview` | Excel 导入预览（不写入飞书） |
| POST | `/api/leads/import/confirm` | 确认导入（批量写入飞书） |

## 排查启动失败

1. **`ModuleNotFoundError`** → 确认已激活虚拟环境且 `pip install -r requirements.txt` 成功
2. **`飞书配置缺失`** → `.env` 未创建或字段为空；但 `/api/health` 仍可用
3. **`飞书 token 获取失败`** → 检查 `FEISHU_APP_ID` / `FEISHU_APP_SECRET` 是否正确
4. **`飞书 API 错误`** → 检查 `FEISHU_APP_TOKEN`（多维表格 app_token）和 `FEISHU_TABLE_ID`（表 table_id）
5. **端口被占用** → 改 `--port 8001`
6. **前端跨域** → 确认前端地址是 localhost 或 127.0.0.1（CORS 已允许）

## 飞书字段映射

真实表是「达人报名表单」收集表，字段映射集中在 `config.py` 的 `FIELD_MAP`（系统字段 → 飞书真实列名）。
飞书列名变化时**只改这一处**：

| 系统字段 | 飞书真实列名 | 类型处理 |
|---|---|---|
| nickname | 达人姓名 | 文本（写纯字符串，读拼接片段） |
| source_channel | 了解渠道 | 文本 |
| wechat_id / phone | 联系方式 | 合并为一个文本列：`微信:xxx；手机:yyy`，读时拆分 |
| self_media_status | 有无自媒体制作经验 | 多选（字符串数组） |
| platforms | 主要平台 | 多选 |
| followers | 平台粉丝数 | 单选分档（数字自动映射到 0～500 … 5万以上） |
| business_experience | 有无商单经验 | 文本 |
| cooperation_categories | 曾经合作品类 | 文本 |
| preferred_categories | 期望寄拍产品 | 多选 |
| appearance_style | 出境方式 | 多选 |
| —（自动） | 提交时间 | 新增记录时自动写入当前时间 |

> 系统模型中的 `current_stage / potential_level / intent_level / talent_class /
> cooperation_path / owner / next_followup_at / remark` 在真实表中暂无对应列，
> 提交后会被自动跳过（不报错）。Excel 模板中的「备注」同样暂不落表。
> 若飞书侧新增了这些列，在 `FIELD_MAP` 加一行即可启用，无需改业务代码。

## Excel 导入模板（V1 固定列名）

第一行表头必须包含以下列名（精确匹配）：

| 列名 | 必填 | 对应字段 |
|------|------|----------|
| 达人昵称 | 是 | nickname |
| 微信号 | 否 | wechat_id |
| 手机号 | 否 | phone |
| 来源渠道 | 是 | source_channel |
| 自媒体平台 | 否 | platforms |
| 粉丝量 | 否 | followers |
| 合作经历 | 否 | business_experience |
| 备注 | 否 | remark |
