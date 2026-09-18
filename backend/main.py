"""MCN 达人线索管理后台 · FastAPI 入口"""
import logging

from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from config import CORS_ORIGIN_REGEX, missing_feishu_config
from routes.leads import router as leads_router
from utils.response import BizError, FeishuError

# ─── 日志配置 ───
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
# 抑制第三方库的调试日志
logging.getLogger("httpx").setLevel(logging.WARNING)
logger = logging.getLogger("app")

app = FastAPI(
    title="MCN 达人线索管理后台",
    description="FastAPI → 飞书 OpenAPI → 飞书多维表格",
    version="1.0.0",
)

# ─── CORS（开发阶段允许 localhost / 127.0.0.1）───
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=CORS_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── 上传文件静态目录（招募表单图片）───
_UPLOAD_DIR = Path(__file__).resolve().parent / "uploads"
_UPLOAD_DIR.mkdir(exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(_UPLOAD_DIR)), name="uploads")

# ─── 路由 ───
app.include_router(leads_router)


@app.on_event("startup")
async def _warn_if_feishu_config_missing():
    """启动时提示飞书配置状态（只警告不退出，保证 /api/health 始终可用）"""
    missing = missing_feishu_config()
    if missing:
        logger.warning(
            "飞书配置缺失: %s —— /api/health 可用，但线索相关接口将报错。"
            "请在 backend/.env 中填写（参考 .env.example）",
            ", ".join(missing),
        )
    else:
        logger.info("飞书配置已加载，线索接口将连接飞书多维表格")


# ─── 请求日志中间件 ───
@app.middleware("http")
async def log_requests(request: Request, call_next):
    logger.info("%s %s", request.method, request.url.path)
    response = await call_next(request)
    return response


# ─── 全局异常处理 ───
@app.exception_handler(BizError)
async def biz_error_handler(request: Request, exc: BizError):
    logger.warning("业务错误: %s %s -> %s", request.method, request.url.path, exc.message)
    return JSONResponse(
        status_code=exc.status_code,
        content={"code": exc.code, "message": exc.message, "data": None},
    )


@app.exception_handler(FeishuError)
async def feishu_error_handler(request: Request, exc: FeishuError):
    logger.error("飞书错误: %s %s -> %s", request.method, request.url.path, exc.message)
    return JSONResponse(
        status_code=exc.status_code,
        content={"code": exc.code, "message": f"[飞书层] {exc.message}", "data": None},
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.exception("未处理异常: %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"code": 50000, "message": f"服务器内部错误: {exc}", "data": None},
    )
