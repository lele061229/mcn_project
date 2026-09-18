"""统一返回结构 + 异常类"""
from fastapi.responses import JSONResponse
from typing import Any, Optional


def success(data: Any = None, message: str = "success", code: int = 0) -> dict:
    """成功返回体"""
    return {"code": code, "message": message, "data": data}


def error(message: str, code: int = 40001, status_code: int = 400) -> JSONResponse:
    """失败返回体（直接给 FastAPI 路由返回）"""
    return JSONResponse(
        status_code=status_code,
        content={"code": code, "message": message, "data": None},
    )


# ─── 自定义异常（方便全局处理器区分层级）───

class BizError(Exception):
    """业务错误（400）：参数校验、数据不存在、Excel 格式等"""
    def __init__(self, message: str, code: int = 40001, status_code: int = 400):
        self.message = message
        self.code = code
        self.status_code = status_code
        super().__init__(message)


class FeishuError(Exception):
    """飞书层错误（500）：token 获取失败、API 请求失败"""
    def __init__(self, message: str, code: int = 50001):
        self.message = message
        self.code = code
        self.status_code = 502
        super().__init__(message)
