"""达人线索 Pydantic 模型"""
from pydantic import BaseModel, Field
from typing import Optional


class LeadCreate(BaseModel):
    """创建线索：nickname / source_channel 必填，其余可选"""
    nickname: str = Field(..., description="达人昵称（必填）")
    source_channel: str = Field(..., description="来源渠道（必填）")
    wechat_id: Optional[str] = None
    phone: Optional[str] = None
    self_media_status: Optional[str] = None
    platforms: Optional[str] = None
    followers: Optional[str] = None
    business_experience: Optional[str] = None
    cooperation_categories: Optional[str] = None
    preferred_categories: Optional[str] = None
    appearance_style: Optional[str] = None
    profile_screenshot: Optional[str] = None
    works: Optional[str] = None
    questions: Optional[str] = None
    current_stage: Optional[str] = None
    potential_level: Optional[str] = None
    intent_level: Optional[str] = None
    talent_class: Optional[str] = None
    cooperation_path: Optional[str] = None
    owner: Optional[str] = None
    next_followup_at: Optional[str] = None
    remark: Optional[str] = None


class LeadUpdate(BaseModel):
    """部分更新：所有字段可选，只更新提交的字段"""
    nickname: Optional[str] = None
    source_channel: Optional[str] = None
    wechat_id: Optional[str] = None
    phone: Optional[str] = None
    self_media_status: Optional[str] = None
    platforms: Optional[str] = None
    followers: Optional[str] = None
    business_experience: Optional[str] = None
    cooperation_categories: Optional[str] = None
    preferred_categories: Optional[str] = None
    appearance_style: Optional[str] = None
    profile_screenshot: Optional[str] = None
    works: Optional[str] = None
    questions: Optional[str] = None
    current_stage: Optional[str] = None
    potential_level: Optional[str] = None
    intent_level: Optional[str] = None
    talent_class: Optional[str] = None
    cooperation_path: Optional[str] = None
    owner: Optional[str] = None
    next_followup_at: Optional[str] = None
    remark: Optional[str] = None


class ImportPreviewRow(BaseModel):
    """Excel 导入预览中的单行结果"""
    row_number: int
    data: dict
    status: str  # valid / invalid / duplicate
    error_message: str = ""
