# routers/agent.py — Agent 채팅 API 엔드포인트 (HTTP 처리만, AI 로직은 engine.py에 있음)
from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from database import get_db
from agent.engine import run as agent_run

router = APIRouter()


# ── 요청/응답 스키마 ─────────────────────────────────────────────────────────

class ConversationMessage(BaseModel):
    """대화 히스토리 메시지 단위."""
    role: str
    content: str


class AgentChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=2000)
    conversation_history: list[ConversationMessage] = Field(default_factory=list, max_length=50)


class AgentChatResponse(BaseModel):
    reply: str
    actions_taken: list[str]
    data: dict


# ── 엔드포인트 ────────────────────────────────────────────────────────────────

@router.post("/agent/chat", response_model=AgentChatResponse)
def agent_chat(request: AgentChatRequest, db: Session = Depends(get_db)):
    """Agent ReAct 루프를 실행하고 최종 응답을 반환한다."""
    # Pydantic 모델을 Groq SDK가 기대하는 dict 형태로 변환
    history_dicts = [
        {"role": msg.role, "content": msg.content}
        for msg in request.conversation_history
    ]

    result = agent_run(
        message=request.message,
        conversation_history=history_dicts,
        db=db,
    )

    return AgentChatResponse(
        reply=result["reply"],
        actions_taken=result["actions_taken"],
        data=result["data"],
    )
