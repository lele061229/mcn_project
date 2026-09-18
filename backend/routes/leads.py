"""达人线索 API 路由"""
import logging
import os
import uuid
from pathlib import Path
from fastapi import APIRouter, UploadFile, File, Query

from schemas.lead import LeadCreate, LeadUpdate
from services.lead_service import LeadService
from utils.response import success, error, BizError, FeishuError

router = APIRouter(prefix="/api")
logger = logging.getLogger("route")
_service = LeadService()

# 上传文件保存目录（与 main.py 的 StaticFiles 挂载路径保持一致）
UPLOAD_DIR = Path(__file__).resolve().parent.parent / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)
ALLOWED_EXT = {".jpg", ".jpeg", ".png", ".gif", ".bmp", ".psd", ".tif", ".tiff", ".heic", ".heif"}
MAX_UPLOAD_MB = 20


@router.get("/health")
async def health():
    """健康检查，不依赖飞书"""
    return success({"status": "ok"})


@router.get("/leads")
async def list_leads(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    nickname: str | None = None,
    source_channel: str | None = None,
    current_stage: str | None = None,
    potential_level: str | None = None,
    intent_level: str | None = None,
    talent_class: str | None = None,
):
    """达人线索列表（分页 + 筛选）"""
    try:
        filters = {
            k: v for k, v in {
                "nickname": nickname,
                "source_channel": source_channel,
                "current_stage": current_stage,
                "potential_level": potential_level,
                "intent_level": intent_level,
                "talent_class": talent_class,
            }.items() if v
        }
        data = await _service.list_leads(page, page_size, filters)
        return success(data)
    except FeishuError as e:
        return error(e.message, e.code, e.status_code)
    except Exception as e:
        logger.exception("GET /api/leads 异常")
        return error(f"获取线索列表失败: {e}", 50001, 500)


@router.get("/leads/{lead_id}")
async def get_lead(lead_id: str):
    """获取单条线索详情（按 lead_id 或飞书 record_id）"""
    try:
        lead = await _service.get_lead(lead_id)
        if not lead:
            return error(f"线索不存在: {lead_id}", 40401, 404)
        return success(lead)
    except FeishuError as e:
        return error(e.message, e.code, e.status_code)
    except Exception as e:
        logger.exception("GET /api/leads/%s 异常", lead_id)
        return error(f"获取线索详情失败: {e}", 50001, 500)


@router.post("/leads")
async def create_lead(body: LeadCreate):
    """新增线索"""
    try:
        data = body.dict()
        lead = await _service.create_lead(data)
        return success(lead, message="线索已创建")
    except BizError as e:
        return error(e.message, e.code, e.status_code)
    except FeishuError as e:
        return error(e.message, e.code, e.status_code)
    except Exception as e:
        logger.exception("POST /api/leads 异常")
        return error(f"创建线索失败: {e}", 50001, 500)


@router.put("/leads/{lead_id}")
async def update_lead(lead_id: str, body: LeadUpdate):
    """部分更新线索（只更新提交的字段）"""
    try:
        data = body.dict(exclude_unset=True)
        if not data:
            return error("没有需要更新的字段")
        lead = await _service.update_lead(lead_id, data)
        if not lead:
            return error(f"线索不存在: {lead_id}", 40401, 404)
        return success(lead, message="线索已更新")
    except BizError as e:
        return error(e.message, e.code, e.status_code)
    except FeishuError as e:
        return error(e.message, e.code, e.status_code)
    except Exception as e:
        logger.exception("PUT /api/leads/%s 异常", lead_id)
        return error(f"更新线索失败: {e}", 50001, 500)


@router.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    """单文件上传（招募表单 Q6/Q11 用）：限 20MB，仅图片格式，返回可访问的 URL"""
    try:
        if not file.filename:
            return error("文件名无效", 40001, 400)
        ext = os.path.splitext(file.filename)[1].lower()
        if ext not in ALLOWED_EXT:
            return error(f"不支持的文件格式，仅支持: {', '.join(sorted(ALLOWED_EXT))}", 40002, 400)
        content = await file.read()
        if len(content) > MAX_UPLOAD_MB * 1024 * 1024:
            return error(f"文件大小超过 {MAX_UPLOAD_MB}MB 限制", 40003, 400)
        fname = f"{uuid.uuid4().hex}{ext}"
        (UPLOAD_DIR / fname).write_bytes(content)
        return success({"url": f"/uploads/{fname}", "filename": file.filename})
    except Exception as e:
        logger.exception("POST /api/upload 异常")
        return error(f"文件上传失败: {e}", 50001, 500)


@router.post("/leads/import/preview")
async def import_preview(file: UploadFile = File(...)):
    """Excel 导入预览：只解析校验，不写入飞书"""
    try:
        if not file.filename or not file.filename.endswith(".xlsx"):
            return error("V1 仅支持 .xlsx 格式文件")
        file_bytes = await file.read()
        if not file_bytes:
            return error("上传文件为空")
        result = await _service.preview_import(file_bytes)
        return success(result)
    except BizError as e:
        return error(e.message, e.code, e.status_code)
    except FeishuError as e:
        return error(e.message, e.code, e.status_code)
    except Exception as e:
        logger.exception("POST /api/leads/import/preview 异常")
        return error(f"Excel 导入预览失败: {e}", 50001, 500)


@router.post("/leads/import/confirm")
async def import_confirm(file: UploadFile = File(...)):
    """确认导入：只导入 valid 且非 duplicate 的数据"""
    try:
        if not file.filename or not file.filename.endswith(".xlsx"):
            return error("V1 仅支持 .xlsx 格式文件")
        file_bytes = await file.read()
        if not file_bytes:
            return error("上传文件为空")
        result = await _service.confirm_import(file_bytes)
        return success(result, message=f"导入完成: 成功 {result['success']} 条, 跳过 {result['skipped']} 条")
    except BizError as e:
        return error(e.message, e.code, e.status_code)
    except FeishuError as e:
        return error(e.message, e.code, e.status_code)
    except Exception as e:
        logger.exception("POST /api/leads/import/confirm 异常")
        return error(f"Excel 导入确认失败: {e}", 50001, 500)
