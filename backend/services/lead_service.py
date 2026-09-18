"""达人线索业务逻辑：字段映射 / CRUD / Excel 导入预览与确认

真实存储为飞书「达人报名表单」多维表格，字段格式：
- 文本列(type=1)：读写都是 [{"type":"text","text":"..."}] 片段数组
- 多选列：字符串数组
- 单选列：字符串（平台粉丝数为分档选项）
- 微信/手机合并在「联系方式」一个文本列
"""
import io
import logging
import re
from datetime import datetime
from typing import Optional

import openpyxl

from clients.feishu_client import FeishuClient
from config import (
    FIELD_MAP, CONTACT_FIELD, SUBMIT_TIME_FIELD,
    TEXT_FIELDS, MULTI_SELECT_FIELDS, SINGLE_SELECT_FIELDS, FOLLOWER_BUCKETS,
    EXCEL_COLUMN_MAP, EXCEL_REQUIRED_COLUMNS,
)
from utils.response import BizError

logger = logging.getLogger("service")

_SPLIT_RE = re.compile(r"[、，,;；]+")
_PHONE_RE = re.compile(r"1[3-9]\d{9}")

# Q3 表单单选组合值 → 飞书「有无自媒体制作经验」多选的独立选项
SELF_MEDIA_MAP = {
    "有，目前正在做": ["有，目前正在做"],
    "之前做过，现在暂时没做": ["之前做过", "现在暂时没做"],
    "暂时没有，但准备开始做": ["暂时没有", "但准备开始做"],
}


def _norm_contact(v: str) -> str:
    """联系方式归一化：去标点/空白与「微信/手机」标签，转小写，用于重复比对"""
    s = re.sub(r"[\s\-—–().（）:：;；,，]", "", str(v or "")).lower()
    return s.replace("微信", "").replace("手机", "")


def _text_segments(v) -> str:
    """飞书富文本片段数组 → 纯文本（兼容已是字符串的情况）"""
    if v is None:
        return ""
    if isinstance(v, str):
        return v
    if isinstance(v, list):
        return "".join(seg.get("text", "") if isinstance(seg, dict) else str(seg) for seg in v)
    return str(v)


def _split_multi(v) -> list:
    """系统侧字符串 → 多选数组（按常见分隔符拆分去重）；已是 list 直接去空"""
    if isinstance(v, list):
        return [str(x).strip() for x in v if str(x).strip()]
    if v is None:
        return []
    return [p.strip() for p in _SPLIT_RE.split(str(v)) if p.strip()]


# 表单粉丝档位 → 飞书单选分档（飞书无 1000~5000 档，归入 5000～1万）
_FORM_FANS_MAP = {
    "0~500": "0～500",
    "500~1000": "500～1000",
    "1000~5000": "5000～1万",
    "5000~1万": "5000～1万",
    "1万~5万": "1万～5万",
    "5万以上": "5万以上",
}


def _follower_bucket(v) -> Optional[str]:
    """粉丝数（数值或表单档位标签）→ 飞书单选分档"""
    if v is None or v == "":
        return None
    if isinstance(v, str):
        s = v.strip()
        # 已是飞书合法选项
        valid = {name for _, name in FOLLOWER_BUCKETS}
        if s in valid:
            return s
        # 表单档位标签
        if s in _FORM_FANS_MAP:
            return _FORM_FANS_MAP[s]
    try:
        n = int(float(str(v).replace(",", "")))
    except (ValueError, TypeError):
        return None
    for threshold, name in FOLLOWER_BUCKETS:
        if n >= threshold:
            return name
    return FOLLOWER_BUCKETS[-1][1]


class LeadService:
    def __init__(self):
        self.client = FeishuClient()

    # ─── 字段互转 ───

    def _to_feishu(self, data: dict) -> dict:
        """系统字段 → 飞书写入格式"""
        out = {}
        for k, v in data.items():
            if v is None or v == "" or k not in FIELD_MAP:
                continue
            cn = FIELD_MAP[k]
            if k in MULTI_SELECT_FIELDS:
                # Q3 特殊映射：表单组合值 → 飞书多个独立选项
                if k == "self_media_status" and isinstance(v, str) and v in SELF_MEDIA_MAP:
                    out[cn] = SELF_MEDIA_MAP[v]
                else:
                    opts = _split_multi(v)
                    if opts:
                        out[cn] = opts
            elif k in SINGLE_SELECT_FIELDS:
                bucket = _follower_bucket(v)
                if bucket:
                    out[cn] = bucket
            elif k in TEXT_FIELDS:
                out[cn] = str(v)  # 本表文本列写入只接受纯字符串（读取仍为片段数组）
            else:
                out[cn] = v
        return out

    def _merge_contact(self, data: dict) -> Optional[str]:
        """微信号 + 手机号 → 飞书「联系方式」文本"""
        parts = []
        if data.get("wechat_id"):
            parts.append(f"微信:{data['wechat_id']}")
        if data.get("phone"):
            parts.append(f"手机:{data['phone']}")
        return "；".join(parts) if parts else None

    def _from_feishu(self, fields: dict, record_id: str = "") -> dict:
        """飞书记录 → 系统字段"""
        out = {"lead_id": record_id, "record_id": record_id}
        for k, cn in FIELD_MAP.items():
            if cn not in fields:
                continue
            v = fields[cn]
            if k in TEXT_FIELDS:
                out[k] = _text_segments(v)
            elif k in MULTI_SELECT_FIELDS:
                out[k] = "、".join(v) if isinstance(v, list) else _text_segments(v)
            elif k in SINGLE_SELECT_FIELDS:
                out[k] = v if isinstance(v, str) else _text_segments(v)
            else:
                out[k] = v
        # 联系方式拆成微信 / 手机（按「微信:」「手机:」标签分段解析）
        contact = _text_segments(fields.get(CONTACT_FIELD))
        if contact:
            wechat, phone = "", ""
            for seg in re.split(r"[;；]", contact):
                seg = seg.strip()
                if not seg:
                    continue
                if seg.startswith("微信"):
                    wechat = re.sub(r"^微信[:：]?", "", seg).strip()
                elif seg.startswith("手机"):
                    m = _PHONE_RE.search(seg)
                    phone = m.group(0) if m else re.sub(r"^手机[:：]?", "", seg).strip()
                else:
                    m = _PHONE_RE.search(seg)
                    if m:
                        phone = m.group(0)
                    else:
                        wechat = seg
            out["wechat_id"] = wechat
            out["phone"] = phone
        # 表单提交时间（仅供展示）
        submit_time = _text_segments(fields.get(SUBMIT_TIME_FIELD))
        if submit_time:
            out["submit_time"] = submit_time
        return out

    # ─── 列表 ───

    async def list_leads(
        self, page: int = 1, page_size: int = 20, filters: dict | None = None
    ) -> dict:
        items = await self.client.list_records()
        leads = [
            self._from_feishu(item.get("fields", {}), item.get("record_id", ""))
            for item in items
        ]
        # 服务层筛选（第一版：内存模糊匹配，后续可改为飞书 filter 参数）
        if filters:
            for k, v in filters.items():
                if v:
                    leads = [l for l in leads if v in str(l.get(k, ""))]
        total = len(leads)
        start = (page - 1) * page_size
        paged = leads[start:start + page_size]
        return {"list": paged, "page": page, "page_size": page_size, "total": total}

    # ─── 详情 ───

    async def get_lead(self, lead_id: str) -> Optional[dict]:
        """按飞书 record_id 查找（本表无独立业务ID，lead_id 即 record_id）"""
        items = await self.client.list_records()
        for item in items:
            if item.get("record_id") == lead_id:
                return self._from_feishu(item.get("fields", {}), item.get("record_id", ""))
        return None

    # ─── 新增 ───

    async def create_lead(self, data: dict) -> dict:
        fields = self._to_feishu(data)
        contact = self._merge_contact(data)
        if contact:
            fields[CONTACT_FIELD] = contact
        fields[SUBMIT_TIME_FIELD] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        record = await self.client.create_record(fields)
        return self._from_feishu(record.get("fields", {}), record.get("record_id", ""))

    # ─── 修改 ───

    async def update_lead(self, lead_id: str, data: dict) -> Optional[dict]:
        lead = await self.get_lead(lead_id)
        if not lead:
            return None
        patch = {k: v for k, v in data.items() if v is not None}
        fields = self._to_feishu(patch)
        # 联系方式是合并列：任一字段更新时与原值合并后整列覆盖
        if "wechat_id" in patch or "phone" in patch:
            merged = {
                "wechat_id": patch.get("wechat_id", lead.get("wechat_id", "")),
                "phone": patch.get("phone", lead.get("phone", "")),
            }
            contact = self._merge_contact(merged)
            if contact:
                fields[CONTACT_FIELD] = contact
        if not fields:
            return lead
        record = await self.client.update_record(lead["record_id"], fields)
        return self._from_feishu(record.get("fields", {}), record.get("record_id", ""))

    # ─── Excel 导入：内部处理 ───

    def _parse_excel(self, file_bytes: bytes) -> list[dict]:
        """解析 Excel，返回所有行的校验结果（不截断）"""
        wb = openpyxl.load_workbook(io.BytesIO(file_bytes), data_only=True)
        ws = wb.active
        rows = list(ws.iter_rows(values_only=True))
        if not rows:
            raise BizError("Excel 文件为空")

        headers = [str(h or "").strip() for h in rows[0]]
        missing = [h for h in EXCEL_REQUIRED_COLUMNS if h not in headers]
        if missing:
            raise BizError(f"缺少必填列「{'、'.join(missing)}」，请使用 V1 固定模板")

        col_idx = {h: i for i, h in enumerate(headers) if h in EXCEL_COLUMN_MAP}

        result_rows = []
        for i, row in enumerate(rows[1:], 2):  # Excel 行号从 2 开始
            if not any(str(c or "").strip() for c in row):  # 跳过整行空白
                continue
            data = {}
            for cn, idx in col_idx.items():
                field = EXCEL_COLUMN_MAP[cn]
                val = str(row[idx]).strip() if idx < len(row) and row[idx] is not None else ""
                data[field] = val

            errors = []
            if not data.get("nickname"):
                errors.append("缺少达人昵称")
            if not data.get("source_channel"):
                errors.append("缺少来源渠道")
            if data.get("followers") and not re.match(r"^\d+$", data["followers"].replace(",", "")):
                errors.append("粉丝量需为数字")

            result_rows.append({
                "row_number": i,
                "data": data,
                "status": "invalid" if errors else "valid",
                "error_message": "; ".join(errors),
            })
        return result_rows

    async def _check_duplicates(self, rows: list[dict]) -> list[dict]:
        """检查文件内 + 系统已有的重复（微信号 / 手机号，落在飞书「联系方式」列）"""
        items = await self.client.list_records()
        system_keys = set()
        for item in items:
            contact = _text_segments(item.get("fields", {}).get(CONTACT_FIELD))
            if contact:
                system_keys.add(_norm_contact(contact))

        seen = {}  # 归一化联系方式 → 首次出现的行号
        for r in rows:
            if r["status"] != "valid":
                continue
            data = r["data"]
            dup_reason = ""
            for key, label in [("wechat_id", "微信号"), ("phone", "手机号")]:
                val = data.get(key, "")
                if not val:
                    continue
                norm = _norm_contact(val)
                if norm in seen:
                    dup_reason = f"文件内重复: {label}={val}（第{seen[norm]}行）"
                    break
                # 系统联系方式是合并文本，用包含匹配
                if any(norm and norm in sk for sk in system_keys):
                    dup_reason = f"系统中已存在相同{label}（{val}）"
                    break
            if dup_reason:
                r["status"] = "duplicate"
                r["error_message"] = dup_reason
            else:
                for key in ["wechat_id", "phone"]:
                    val = data.get(key, "")
                    if val:
                        seen[_norm_contact(val)] = r["row_number"]
        return rows

    def _build_feishu_record(self, data: dict) -> dict:
        """一行 Excel 数据 → 飞书记录 fields（含联系方式合并、提交时间）"""
        fields = self._to_feishu(data)
        contact = self._merge_contact(data)
        if contact:
            fields[CONTACT_FIELD] = contact
        fields[SUBMIT_TIME_FIELD] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        return fields

    # ─── 预览 ───

    async def preview_import(self, file_bytes: bytes) -> dict:
        rows = self._parse_excel(file_bytes)
        rows = await self._check_duplicates(rows)
        valid = sum(1 for r in rows if r["status"] == "valid")
        invalid = sum(1 for r in rows if r["status"] == "invalid")
        duplicate = sum(1 for r in rows if r["status"] == "duplicate")
        return {
            "total": len(rows),
            "valid": valid,
            "invalid": invalid,
            "duplicate": duplicate,
            "preview_rows": rows[:20],  # 只返回前 20 条
        }

    # ─── 确认导入 ───

    async def confirm_import(self, file_bytes: bytes) -> dict:
        rows = self._parse_excel(file_bytes)
        rows = await self._check_duplicates(rows)
        # 只导入 valid 且非 duplicate 的数据；重复/无效直接跳过
        to_import = [r["data"] for r in rows if r["status"] == "valid"]
        skipped = len(rows) - len(to_import)

        success_count = 0
        failed_count = 0
        fail_reasons = []

        if to_import:
            records = [self._build_feishu_record(data) for data in to_import]
            try:
                created = await self.client.batch_create_records(records)
                success_count = len(created)
            except Exception as e:
                logger.error("批量导入飞书失败: %s", e)
                failed_count = len(to_import)
                fail_reasons.append(str(e))

        return {
            "success": success_count,
            "skipped": skipped,
            "failed": failed_count,
            "fail_reasons": fail_reasons,
        }
