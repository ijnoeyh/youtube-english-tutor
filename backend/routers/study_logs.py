# routers/study_logs.py — 학습 기록(StudyLog) 저장/조회 API
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
import models

router = APIRouter()


# ── 요청/응답 스키마 ──────────────────────────────────────────────────────────

class StudyLogRequest(BaseModel):
    """학습 모드 완료 시 프론트에서 전송하는 요청 본문."""
    video_id: int
    segment_id: Optional[int] = None   # 특정 세그먼트 학습이면 segment_id 포함
    mode: str                          # "listen" / "speak" / "write"
    score: Optional[float] = None      # 0~100 점수 (채점 없는 경우 None)


class StudyLogResponse(BaseModel):
    """POST 응답: 저장된 학습 기록 ID 반환."""
    id: int
    video_id: int
    segment_id: Optional[int]
    mode: str
    score: Optional[float]
    created_at: str

    class Config:
        from_attributes = True


# ── 엔드포인트 ────────────────────────────────────────────────────────────────

@router.post("/study-logs", response_model=StudyLogResponse)
def create_study_log(request: StudyLogRequest, db: Session = Depends(get_db)):
    """학습 기록을 DB에 저장한다."""
    log = models.StudyLog(
        video_id=request.video_id,
        segment_id=request.segment_id,
        mode=request.mode,
        score=request.score,
    )
    db.add(log)
    db.commit()
    db.refresh(log)

    return StudyLogResponse(
        id=log.id,
        video_id=log.video_id,
        segment_id=log.segment_id,
        mode=log.mode,
        score=log.score,
        created_at=log.created_at.isoformat(),
    )


@router.get("/study-logs")
def get_study_logs(
    video_id: Optional[int] = Query(None),
    mode: Optional[str] = Query(None),
    days: Optional[int] = Query(None),
    db: Session = Depends(get_db),
):
    """학습 기록을 조회한다. video_id / mode / days 필터 선택 지원."""
    query = db.query(models.StudyLog)

    if video_id is not None:
        query = query.filter(models.StudyLog.video_id == video_id)

    if mode is not None:
        query = query.filter(models.StudyLog.mode == mode)

    if days is not None:
        from datetime import timedelta
        cutoff = datetime.utcnow() - timedelta(days=days)
        query = query.filter(models.StudyLog.created_at >= cutoff)

    logs = query.order_by(models.StudyLog.created_at.desc()).all()

    return [
        {
            "id": log.id,
            "video_id": log.video_id,
            "segment_id": log.segment_id,
            "mode": log.mode,
            "score": log.score,
            "created_at": log.created_at.isoformat(),
        }
        for log in logs
    ]
