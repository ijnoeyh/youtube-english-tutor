# routers/videos.py — 영상(Video) 등록/조회/삭제 API
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import func

from database import get_db
import models
from utils.youtube import (
    extract_youtube_id,
    fetch_transcript,
    fetch_video_metadata,
    segment_transcript,
)

router = APIRouter()


# ── 요청/응답 스키마 ──────────────────────────────────────────────────────────

class VideoRegisterRequest(BaseModel):
    """POST /api/videos 요청 본문."""
    url: str


class VideoResponse(BaseModel):
    """영상 등록/조회 응답 스키마."""
    id: int
    youtube_id: str
    title: str
    # API 키 미설정/호출 실패 시 None 가능
    channel: Optional[str] = None
    description: Optional[str] = None
    thumbnail_url: Optional[str] = None
    duration_sec: Optional[int] = None
    segment_count: int
    created_at: str

    class Config:
        from_attributes = True


# ── 엔드포인트 ────────────────────────────────────────────────────────────────

@router.post("/videos", response_model=VideoResponse)
def register_video(request: VideoRegisterRequest, db: Session = Depends(get_db)):
    """
    YouTube URL을 받아 영상과 자막을 DB에 저장한다.

    처리 순서:
      1. URL에서 youtube_id 추출
      2. 중복 등록 여부 확인 (이미 있으면 기존 데이터 반환)
      3. 영어 자막 가져오기
      4. Video 레코드 생성
      5. Transcript 레코드 배치 저장
    """
    # 1. URL → youtube_id 추출
    youtube_id = extract_youtube_id(request.url)

    # 2. 중복 체크: 이미 등록된 영상이면 기존 데이터 반환
    existing = db.query(models.Video).filter(
        models.Video.youtube_id == youtube_id
    ).first()

    if existing:
        # 이전 버전에서 메타데이터 없이 등록된 영상은 재등록 시점에 백필
        needs_backfill = (existing.title == existing.youtube_id) or (existing.channel is None)
        if needs_backfill:
            meta = fetch_video_metadata(youtube_id)
            existing.title = meta["title"]
            existing.channel = meta["channel"]
            existing.description = meta["description"]
            existing.thumbnail_url = meta["thumbnail_url"]
            existing.duration_sec = meta["duration_sec"]
            db.commit()
            db.refresh(existing)

        segment_count = db.query(func.count(models.Transcript.id)).filter(
            models.Transcript.video_id == existing.id
        ).scalar()
        return VideoResponse(
            id=existing.id,
            youtube_id=existing.youtube_id,
            title=existing.title,
            channel=existing.channel,
            description=existing.description,
            thumbnail_url=existing.thumbnail_url,
            duration_sec=existing.duration_sec,
            segment_count=segment_count,
            created_at=existing.created_at.isoformat(),
        )

    # 3. 자막 가져오기
    raw_segments, is_generated = fetch_transcript(youtube_id)

    # 화면 타이밍 단위 자막을 문장 단위로 재구성.
    # 자동 생성 자막(구두점 없음)은 LLM으로, 수동 자막은 휴리스틱으로 병합.
    raw_segments = segment_transcript(raw_segments, is_generated)

    # 4. Video 레코드 생성 (API 키 없음/실패 시 fetch_video_metadata가 title=youtube_id 폴백 반환)
    meta = fetch_video_metadata(youtube_id)
    video = models.Video(
        youtube_id=youtube_id,
        title=meta["title"],
        channel=meta["channel"],
        description=meta["description"],
        thumbnail_url=meta["thumbnail_url"],
        duration_sec=meta["duration_sec"],
    )
    db.add(video)
    db.flush()  # flush: commit 없이 video.id만 먼저 확정 (Transcript FK에 필요)

    # 5. Transcript 배치 저장
    transcripts = []
    for seg in raw_segments:
        text = seg["text"].strip()
        start = seg["start"]
        end = seg["end"]

        # 빈 텍스트나 1초 미만 세그먼트는 학습에 의미 없으므로 제외
        if not text or (end - start) < 1.0:
            continue

        transcripts.append(models.Transcript(
            video_id=video.id,
            start_sec=start,
            end_sec=end,
            text=text,
        ))

    db.add_all(transcripts)
    db.commit()
    db.refresh(video)

    return VideoResponse(
        id=video.id,
        youtube_id=video.youtube_id,
        title=video.title,
        channel=video.channel,
        description=video.description,
        thumbnail_url=video.thumbnail_url,
        duration_sec=video.duration_sec,
        segment_count=len(transcripts),
        created_at=video.created_at.isoformat(),
    )


@router.get("/videos")
def get_videos(db: Session = Depends(get_db)):
    """등록된 모든 영상을 최신순으로 반환한다."""
    videos = db.query(models.Video).order_by(models.Video.created_at.desc()).all()

    result = []
    for v in videos:
        segment_count = db.query(func.count(models.Transcript.id)).filter(
            models.Transcript.video_id == v.id
        ).scalar()
        result.append({
            "id": v.id,
            "youtube_id": v.youtube_id,
            "title": v.title,
            "channel": v.channel,
            "thumbnail_url": v.thumbnail_url,
            "duration_sec": v.duration_sec,
            "segment_count": segment_count,
            "created_at": v.created_at.isoformat(),
        })
    return result


@router.delete("/videos/{video_id}")
def delete_video(video_id: int, db: Session = Depends(get_db)):
    """
    영상과 연관된 모든 데이터를 삭제한다.

    cascade 미설정 테이블(Bookmark, WritingTask)이 있어 자식 테이블부터 순서대로 직접 삭제함.
    삭제 순서: Bookmark → WritingTask → StudyLog → Transcript → Video
    """
    video = db.query(models.Video).filter(models.Video.id == video_id).first()
    if not video:
        raise HTTPException(status_code=404, detail="영상을 찾을 수 없습니다")

    segment_ids = [
        row.id for row in
        db.query(models.Transcript.id).filter(models.Transcript.video_id == video_id).all()
    ]

    if segment_ids:
        db.query(models.Bookmark).filter(
            models.Bookmark.segment_id.in_(segment_ids)
        ).delete(synchronize_session=False)
        db.query(models.WritingTask).filter(
            models.WritingTask.segment_id.in_(segment_ids)
        ).delete(synchronize_session=False)

    db.query(models.StudyLog).filter(
        models.StudyLog.video_id == video_id
    ).delete(synchronize_session=False)
    db.query(models.Transcript).filter(
        models.Transcript.video_id == video_id
    ).delete(synchronize_session=False)

    db.delete(video)
    db.commit()

    return {"message": "삭제되었습니다", "video_id": video_id}


@router.get("/videos/{video_id}")
def get_video(video_id: int, db: Session = Depends(get_db)):
    """영상 상세 정보와 전체 자막 세그먼트를 반환한다."""
    video = db.query(models.Video).filter(models.Video.id == video_id).first()
    if not video:
        raise HTTPException(status_code=404, detail="영상을 찾을 수 없습니다")

    segments = db.query(models.Transcript).filter(
        models.Transcript.video_id == video_id
    ).order_by(models.Transcript.start_sec).all()

    return {
        "video": {
            "id": video.id,
            "youtube_id": video.youtube_id,
            "title": video.title,
            "channel": video.channel,
            "description": video.description,
            "thumbnail_url": video.thumbnail_url,
            "duration_sec": video.duration_sec,
            "created_at": video.created_at.isoformat(),
        },
        "segments": [
            {
                "id": s.id,
                "start_sec": s.start_sec,
                "end_sec": s.end_sec,
                "text": s.text,
            }
            for s in segments
        ],
    }
