# routers/recommendations.py — 추천 영상 및 관심 키워드 REST API
from datetime import datetime

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from database import get_db
import models
# agent/tools.py의 추천 로직을 재사용 (DRY)
from agent.tools import recommend_videos, _youtube_search_status, _external_notice

router = APIRouter()

# Agent의 update_preferences와 동일한 key 이름
INTERESTS_KEY = "interests"


# ── 추천 영상 ─────────────────────────────────────────────────────────────────

@router.get("/recommendations")
def get_recommendations(
    count: int = Query(20, ge=1, le=50),       # 기본 20개, 1~50개 (YouTube search 1회 상한이 50)
    db: Session = Depends(get_db),
):
    """관심사 기반 추천 영상 목록을 반환한다. (외부 발견 영상은 3분 미만으로 통일)"""
    return recommend_videos(count=count, db=db)


@router.get("/search")
def search_by_keyword(
    query: str = Query(..., min_length=1, max_length=100),
    count: int = Query(20, ge=1, le=50),
    db: Session = Depends(get_db),
):
    """특정 키워드로 내 라이브러리 + 외부 YouTube를 검색해 추천 카드 형태로 반환한다."""
    items: list[dict] = []

    # 1) 내 라이브러리에서 제목/ID에 키워드가 포함된 영상
    local_matches = db.query(models.Video).filter(
        models.Video.title.ilike(f"%{query}%") |
        models.Video.youtube_id.ilike(f"%{query}%")
    ).all()
    for v in local_matches:
        segment_count = db.query(models.Transcript).filter(
            models.Transcript.video_id == v.id
        ).count()
        items.append({
            "video_id": v.id,
            "youtube_id": v.youtube_id,
            "title": v.title,
            "thumbnail_url": v.thumbnail_url,
            "segment_count": segment_count,
            "source": "local",
            "reason": f"'{query}' 관련 내 영상",
        })

    # 2) 외부 YouTube 검색으로 채움 (이미 등록된 영상은 중복 제외)
    existing_youtube_ids = {v.youtube_id for v in db.query(models.Video.youtube_id).all()}
    search_result = _youtube_search_status(query, max_results=count)
    for item in search_result["items"]:
        if item["youtube_id"] in existing_youtube_ids:
            continue
        items.append({
            "youtube_id": item["youtube_id"],
            "title": item["title"],
            "channel": item.get("channel"),
            "thumbnail_url": item.get("thumbnail_url"),
            "duration_sec": item.get("duration_sec"),
            "source": "youtube",
            "reason": f"'{query}' 검색 결과",
        })
        if len(items) >= count:
            break

    notice = _external_notice(search_result["status"])
    return {"recommendations": items, "query": query, "notice": notice}


# ── 관심 키워드 ───────────────────────────────────────────────────────────────

class InterestsResponse(BaseModel):
    """관심 키워드 조회 응답. value는 콤마로 구분된 키워드 문자열."""
    interests: str


class InterestsRequest(BaseModel):
    """관심 키워드 등록 요청. 예: "business english,travel,news"."""
    interests: str = Field("", max_length=300)


@router.get("/preferences/interests", response_model=InterestsResponse)
def get_interests(db: Session = Depends(get_db)):
    """현재 저장된 관심 키워드를 반환한다. 없으면 빈 문자열."""
    pref = db.query(models.UserPreference).filter(
        models.UserPreference.key == INTERESTS_KEY
    ).first()
    return InterestsResponse(interests=pref.value if pref and pref.value else "")


@router.put("/preferences/interests", response_model=InterestsResponse)
def set_interests(request: InterestsRequest, db: Session = Depends(get_db)):
    """관심 키워드를 등록/수정한다 (upsert)."""
    pref = db.query(models.UserPreference).filter(
        models.UserPreference.key == INTERESTS_KEY
    ).first()

    if pref:
        pref.value = request.interests
        pref.updated_at = datetime.utcnow()
    else:
        pref = models.UserPreference(key=INTERESTS_KEY, value=request.interests)
        db.add(pref)

    db.commit()
    return InterestsResponse(interests=request.interests)
