"""飞书多维表格客户端：token 缓存 + 记录增删改查"""
import time
import logging
import httpx
from config import (
    FEISHU_APP_ID, FEISHU_APP_SECRET, FEISHU_APP_TOKEN, FEISHU_TABLE_ID,
    validate_feishu_config,
)
from utils.response import FeishuError

logger = logging.getLogger("feishu")

BASE_URL = "https://open.feishu.cn"


class FeishuClient:
    """飞书 API 封装。所有飞书 HTTP 请求都集中在这里，routes/services 不直接拼 URL。"""

    def __init__(self):
        self._token: str | None = None
        self._token_expires: float = 0
        self._http = httpx.AsyncClient(timeout=30)

    async def _get_token(self) -> str:
        """获取 tenant_access_token，缓存到过期前 5 分钟"""
        if self._token and time.time() < self._token_expires:
            return self._token
        try:
            validate_feishu_config()
        except RuntimeError as e:
            raise FeishuError(str(e))
        try:
            resp = await self._http.post(
                f"{BASE_URL}/open-apis/auth/v3/tenant_access_token/internal",
                json={"app_id": FEISHU_APP_ID, "app_secret": FEISHU_APP_SECRET},
            )
            data = resp.json()
        except Exception as e:
            logger.error("飞书 token 请求异常: %s", e)
            raise FeishuError(f"飞书 token 获取失败（网络异常）")
        if data.get("code") != 0:
            logger.error("飞书 token 获取失败: code=%s msg=%s", data.get("code"), data.get("msg"))
            raise FeishuError(f"飞书 token 获取失败: {data.get('msg', '未知错误')}")
        self._token = data["tenant_access_token"]
        self._token_expires = time.time() + (data.get("expire", 3600) - 300)
        logger.info("飞书 token 已刷新，有效期 %ss", data.get("expire", 3600))
        return self._token

    async def _request(self, method: str, path: str, body: dict | None = None) -> dict:
        """统一请求封装：自动带 token、检查飞书业务码"""
        token = await self._get_token()
        url = f"{BASE_URL}{path}"
        try:
            resp = await self._http.request(
                method, url,
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                json=body,
            )
            data = resp.json()
        except Exception as e:
            logger.error("飞书 API 请求异常: %s %s -> %s", method, path, e)
            raise FeishuError(f"飞书 API 请求失败（网络异常）: {method} {path}")
        if data.get("code") != 0:
            logger.error("飞书 API 业务错误: %s %s code=%s msg=%s", method, path, data.get("code"), data.get("msg"))
            raise FeishuError(f"飞书 API 错误 [{data.get('code')}]: {data.get('msg', '未知错误')}")
        return data.get("data", {})

    # ─── 记录操作 ───

    async def list_records(self, page_size: int = 500) -> list[dict]:
        """全量拉取记录（V1 数据量 <1000 行，后续可加分页参数）"""
        path = (
            f"/open-apis/bitable/v1/apps/{FEISHU_APP_TOKEN}"
            f"/tables/{FEISHU_TABLE_ID}/records/search?page_size={page_size}"
        )
        data = await self._request("POST", path, body={})
        return data.get("items", [])

    async def get_record(self, record_id: str) -> dict:
        """获取单条记录（按飞书 record_id）"""
        path = (
            f"/open-apis/bitable/v1/apps/{FEISHU_APP_TOKEN}"
            f"/tables/{FEISHU_TABLE_ID}/records/{record_id}"
        )
        data = await self._request("GET", path)
        return data.get("record", {})

    async def create_record(self, fields: dict) -> dict:
        """新增一条记录"""
        path = (
            f"/open-apis/bitable/v1/apps/{FEISHU_APP_TOKEN}"
            f"/tables/{FEISHU_TABLE_ID}/records"
        )
        data = await self._request("POST", path, body={"fields": fields})
        return data.get("record", {})

    async def update_record(self, record_id: str, fields: dict) -> dict:
        """更新一条记录（部分字段）"""
        path = (
            f"/open-apis/bitable/v1/apps/{FEISHU_APP_TOKEN}"
            f"/tables/{FEISHU_TABLE_ID}/records/{record_id}"
        )
        data = await self._request("PUT", path, body={"fields": fields})
        return data.get("record", {})

    async def batch_create_records(self, records: list[dict]) -> list[dict]:
        """批量新增记录（每批最多 1000 条，这里分批 100）"""
        path = (
            f"/open-apis/bitable/v1/apps/{FEISHU_APP_TOKEN}"
            f"/tables/{FEISHU_TABLE_ID}/records/batch_create"
        )
        all_results = []
        for i in range(0, len(records), 100):
            batch = [{"fields": r} for r in records[i:i + 100]]
            data = await self._request("POST", path, body={"records": batch})
            all_results.extend(data.get("records", []))
        return all_results
