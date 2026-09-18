"""配置中心：环境变量 + 飞书字段映射（集中维护，不在业务代码里写中文字段名）"""
import os
from dotenv import load_dotenv

load_dotenv()

# ─── 飞书凭证 ───
FEISHU_APP_ID = os.getenv("FEISHU_APP_ID", "")
FEISHU_APP_SECRET = os.getenv("FEISHU_APP_SECRET", "")
FEISHU_APP_TOKEN = os.getenv("FEISHU_APP_TOKEN", "")   # 多维表格 app_token
FEISHU_TABLE_ID = os.getenv("FEISHU_TABLE_ID", "")      # 达人线索表 table_id（tbl 开头）

# ─── CORS ───
# 开发阶段允许 localhost / 127.0.0.1 的任意端口
CORS_ORIGIN_REGEX = r"https?://(localhost|127\.0\.0\.1)(:\d+)?"

# ─── 字段映射：系统字段名 → 飞书真实列名（中文）───
# 真实表是「达人报名表单」收集表，只有以下列；表头若调整只需改这一处。
# 注意：系统模型中的 current_stage / potential_level / intent_level /
#       talent_class / cooperation_path / owner / next_followup_at / remark
#       在飞书表中暂无对应列，写入时会被自动跳过。
FIELD_MAP = {
    "nickname":                "达人姓名",          # 富文本
    "source_channel":          "了解渠道",          # 文本
    "self_media_status":       "有无自媒体制作经验",  # 多选
    "platforms":               "主要平台",          # 多选
    "followers":               "平台粉丝数",         # 单选（分档，非数字）
    "profile_screenshot":      "账号主页截图",       # 文本（URL）
    "business_experience":     "有无商单经验",       # 文本
    "cooperation_categories":  "曾经合作品类",       # 文本
    "preferred_categories":    "期望寄拍产品",       # 多选
    "appearance_style":        "出境方式",          # 多选
    "works":                   "曾经拍摄作品",       # 文本（URL）
    "questions":               "想了解的问题",       # 多选
}

# 微信/手机在飞书表中合并为一个「联系方式」文本列
CONTACT_FIELD = "联系方式"
# 表单提交时间（文本列，API 新增记录时自动写入当前时间）
SUBMIT_TIME_FIELD = "提交时间"

# 按飞书字段类型分组（决定写入/读取时的值格式转换）
TEXT_FIELDS = {
    "nickname", "source_channel", "business_experience", "cooperation_categories",
    "profile_screenshot", "works",
}
MULTI_SELECT_FIELDS = {
    "self_media_status", "platforms", "preferred_categories", "appearance_style", "questions",
}
SINGLE_SELECT_FIELDS = {"followers"}

# followers 数值 → 飞书单选分档（表中没有 1000～5000 档，1000-4999 归入相邻档）
FOLLOWER_BUCKETS = [
    (50000, "5万以上"),
    (10000, "1万～5万"),
    (5000,  "5000～1万"),
    (500,   "500～1000"),
    (0,     "0～500"),
]

# ─── Excel 导入 V1 固定模板列映射 ───
# 中文表头 → 系统字段名
EXCEL_COLUMN_MAP = {
    "达人昵称":   "nickname",
    "微信号":     "wechat_id",
    "手机号":     "phone",
    "来源渠道":   "source_channel",
    "自媒体平台": "platforms",
    "粉丝量":     "followers",
    "合作经历":   "business_experience",
    "备注":       "remark",
}
EXCEL_REQUIRED_COLUMNS = ["达人昵称", "来源渠道"]


def missing_feishu_config() -> list:
    """返回缺失的飞书配置项（空列表 = 配置齐全）"""
    mapping = {
        "FEISHU_APP_ID": FEISHU_APP_ID,
        "FEISHU_APP_SECRET": FEISHU_APP_SECRET,
        "FEISHU_APP_TOKEN": FEISHU_APP_TOKEN,
        "FEISHU_TABLE_ID": FEISHU_TABLE_ID,
    }
    return [k for k, v in mapping.items() if not v]


def validate_feishu_config():
    """检查飞书关键配置是否齐全；缺失时抛出清晰错误（不影响 /api/health）"""
    missing = missing_feishu_config()
    if missing:
        raise RuntimeError(
            f"飞书配置缺失: {', '.join(missing)} —— "
            f"请在 backend/.env 中填写（参考 .env.example）"
        )
