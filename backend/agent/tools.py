# agent/tools.py
# Agent 도구 함수 구현. tool_schemas.py의 스키마와 1:1 대응.
# engine.py에서 LLM의 tool_calls를 받아 execute_tool()을 통해 호출됨.

from __future__ import annotations

import json
import os
import re
import time
from datetime import datetime, timedelta

from fastapi import HTTPException
from sqlalchemy.orm import Session

import models
from utils.youtube import extract_youtube_id, fetch_transcript, fetch_video_metadata, segment_transcript


# ── 공용: 외부 YouTube 검색 헬퍼 ──────────────────────────────────────────────

# 추천에 노출할 "짧은 영상"의 상한(초). 3분 미만으로 통일.
SHORT_MAX_SECONDS = 180

# YouTube Data API search().list는 호출당 100유닛 → 동일 요청을 캐시해 쿼터 절약.
_SEARCH_CACHE_TTL = 1800  # 캐시 유효시간 30분(초)
_search_cache: dict = {}  # key=(query, max_results, max_seconds) -> (만료시각, 결과리스트)


def _youtube_search_status(
    query: str, max_results: int = 5, max_seconds: int = SHORT_MAX_SECONDS
) -> dict:
    """
    YouTube를 검색하고 상태 정보를 함께 반환한다.

    반환: {"items": [...], "status": "ok"|"no_key"|"quota"|"error", "cached": bool}
    """
    api_key = os.getenv("YOUTUBE_API_KEY", "")
    if not api_key:
        return {"items": [], "status": "no_key", "cached": False}

    cache_key = (query.strip().lower(), max_results, max_seconds)
    now = time.time()
    hit = _search_cache.get(cache_key)
    if hit and hit[0] > now:
        return {"items": hit[1], "status": "ok", "cached": True}

    try:
        from googleapiclient.discovery import build  # google-api-python-client
        from googleapiclient.errors import HttpError
        from utils.youtube import _parse_iso8601_duration  # ISO8601("PT2M30S") → 초

        youtube = build("youtube", "v3", developerKey=api_key)

        # 1) <4분 후보를 넉넉히 검색 (정밀 필터로 줄어들 것을 대비)
        fetch_n = min(50, max(max_results * 3, max_results))
        response = youtube.search().list(
            q=query,
            part="snippet",
            type="video",
            maxResults=fetch_n,
            relevanceLanguage="en",
            videoDuration="short",
        ).execute()

        candidates = []
        for item in response.get("items", []):
            snippet = item.get("snippet", {})
            thumbs = snippet.get("thumbnails", {})
            thumb_url = (
                (thumbs.get("high") or thumbs.get("medium") or thumbs.get("default") or {})
                .get("url")
            )
            candidates.append({
                "youtube_id": item["id"]["videoId"],
                "title": snippet.get("title", ""),
                "channel": snippet.get("channelTitle"),
                "thumbnail_url": thumb_url,
                "source": "youtube",
            })

        results: list[dict] = []
        if candidates:
            # 2) 후보들의 실제 길이를 한 번의 videos().list 로 조회
            ids = [c["youtube_id"] for c in candidates]
            details = youtube.videos().list(
                id=",".join(ids), part="contentDetails",
            ).execute()
            duration_map = {
                d["id"]: _parse_iso8601_duration(d.get("contentDetails", {}).get("duration", ""))
                for d in details.get("items", [])
            }
            # 3) max_seconds 미만만 남기고 길이 정보를 붙임
            for c in candidates:
                sec = duration_map.get(c["youtube_id"])
                if sec is not None and sec < max_seconds:
                    c["duration_sec"] = sec
                    results.append(c)
                if len(results) >= max_results:
                    break

        # 성공 결과만 캐시(빈 결과여도 '정상 빈 결과'이므로 캐시 → 반복 검색 방지)
        _search_cache[cache_key] = (now + _SEARCH_CACHE_TTL, results)
        return {"items": results, "status": "ok", "cached": False}

    except HttpError as e:
        # 429 또는 메시지에 quota 가 있으면 쿼터 초과로 분류
        status_code = getattr(getattr(e, "resp", None), "status", None)
        is_quota = status_code == 429 or "quota" in str(e).lower()
        return {"items": [], "status": "quota" if is_quota else "error", "cached": False}
    except Exception:
        return {"items": [], "status": "error", "cached": False}


def _youtube_search(query: str, max_results: int = 5, max_seconds: int = SHORT_MAX_SECONDS) -> list[dict]:
    """
    YouTube 검색 결과(max_seconds 미만)를 리스트로 반환하는 얇은 래퍼.

    실패/키 없음/결과 없음 → 빈 리스트 (예외를 던지지 않음).
    """
    return _youtube_search_status(query, max_results=max_results, max_seconds=max_seconds)["items"]


# ── 1. 영상 검색 ──────────────────────────────────────────────────────────────

def search_youtube_videos(query: str, db: Session) -> dict:
    """키워드로 YouTube 영상을 검색한다. 로컬 DB를 먼저 확인하고 없으면 YouTube API를 호출한다."""
    # 1단계: 로컬 DB 검색 (기존 로직 유지)
    db_results = db.query(models.Video).filter(
        models.Video.title.ilike(f"%{query}%") |
        models.Video.youtube_id.ilike(f"%{query}%")
    ).all()

    local_videos = []
    for v in db_results:
        segment_count = db.query(models.Transcript).filter(
            models.Transcript.video_id == v.id
        ).count()
        local_videos.append({
            "video_id": v.id,
            "youtube_id": v.youtube_id,
            "title": v.title,
            "segment_count": segment_count,
            "source": "local",  # 이미 등록된 영상임을 표시
        })

    if local_videos:
        return {
            "local_videos": local_videos,
            "youtube_videos": [],
            "message": f"등록된 영상 {len(local_videos)}개를 찾았습니다.",
        }

    # 2단계: 로컬에 없으면 YouTube Data API v3 실시간 검색
    api_key = os.getenv("YOUTUBE_API_KEY", "")
    if not api_key:
        return {
            "local_videos": [],
            "youtube_videos": [],
            "message": f"'{query}' 검색 결과가 없습니다. YOUTUBE_API_KEY를 설정하면 유튜브 실시간 검색도 가능해요.",
        }

    youtube_videos = _youtube_search(query, max_results=10)

    if youtube_videos:
        return {
            "local_videos": [],
            "youtube_videos": youtube_videos,
            "message": f"유튜브에서 {len(youtube_videos)}개 영상을 찾았어요. 카드를 눌러 바로 학습을 시작할 수 있어요!",
        }
    return {
        "local_videos": [],
        "youtube_videos": [],
        "message": f"'{query}' 관련 영상을 찾지 못했습니다. 다른 키워드로 시도해보세요.",
    }


# ── 2. 영상 등록 ──────────────────────────────────────────────────────────────

def register_video(url: str, db: Session) -> dict:
    """
    YouTube URL을 받아 영상과 자막을 DB에 저장한다.

    utils/youtube.py가 raise하는 HTTPException을 잡아 dict로 변환하므로
    Agent 루프가 500 에러로 중단되지 않는다.
    """
    try:
        youtube_id = extract_youtube_id(url)
    except HTTPException as e:
        return {"error": e.detail}

    # 이미 등록된 영상이면 기존 정보 반환
    existing = db.query(models.Video).filter(
        models.Video.youtube_id == youtube_id
    ).first()
    if existing:
        segment_count = db.query(models.Transcript).filter(
            models.Transcript.video_id == existing.id
        ).count()
        return {
            "video_id": existing.id,
            "youtube_id": youtube_id,
            "title": existing.title,
            "segment_count": segment_count,
            "already_registered": True,
            "message": "이미 등록된 영상입니다."
        }

    # 자막 가져오기 + 문장 단위 재구성 (videos.py와 동일 처리)
    try:
        raw_segments, is_generated = fetch_transcript(youtube_id)
    except HTTPException as e:
        return {"error": e.detail}
    segments = segment_transcript(raw_segments, is_generated)

    # fetch_video_metadata로 실제 제목/채널/썸네일/길이를 채워 라이브러리 표시 일관성 확보
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
    db.commit()
    db.refresh(video)

    # 빈 텍스트나 1초 미만 세그먼트는 학습에 의미가 없으므로 제외 (videos.py와 동일 기준)
    transcript_objects = [
        models.Transcript(
            video_id=video.id,
            start_sec=seg["start"],
            end_sec=seg["end"],
            text=seg["text"].strip(),
        )
        for seg in segments
        if seg.get("text", "").strip() and (seg["end"] - seg["start"]) >= 1.0
    ]
    db.bulk_save_objects(transcript_objects)
    db.commit()

    return {
        "video_id": video.id,
        "youtube_id": youtube_id,
        "title": video.title,
        "segment_count": len(transcript_objects),
        "message": "영상이 성공적으로 등록되었습니다!"
    }


# ── 3. 학습 이력 조회 ─────────────────────────────────────────────────────────

def get_learning_history(days: int = 7, db: Session = None) -> dict:
    """최근 N일간의 학습 통계(모드별 점수, 연속 학습일, 약한 영역)를 집계해서 반환한다."""
    since = datetime.utcnow() - timedelta(days=days)

    logs = db.query(models.StudyLog).filter(
        models.StudyLog.created_at >= since
    ).all()

    if not logs:
        return {
            "total_sessions": 0,
            "mode_stats": {},
            "streak_days": 0,
            "weak_areas": [],
            "total_segments_studied": len(logs),
            "message": f"최근 {days}일간 학습 기록이 없습니다. 오늘 첫 학습을 시작해보세요! 🌱"
        }

    # 모드별 통계 계산
    mode_data: dict[str, list[float]] = {}
    for log in logs:
        mode_data.setdefault(log.mode, [])
        if log.score is not None:
            mode_data[log.mode].append(log.score)

    mode_stats = {}
    for mode, scores in mode_data.items():
        mode_stats[mode] = {
            "count": len(scores),
            "avg_score": round(sum(scores) / len(scores), 1) if scores else 0,
        }

    # 약한 영역: 평균 점수가 가장 낮은 모드
    weak_areas = []
    if mode_stats:
        min_score = min(v["avg_score"] for v in mode_stats.values())
        weak_areas = [m for m, v in mode_stats.items() if v["avg_score"] == min_score]

    # 연속 학습일(streak) 계산
    studied_dates = set(log.created_at.date() for log in logs)
    streak = 0
    check_date = datetime.utcnow().date()
    while check_date in studied_dates:
        streak += 1
        check_date -= timedelta(days=1)

    # 최근 학습 영상 목록 (중복 제거)
    seen_video_ids: set[int] = set()
    recent_videos = []
    for log in sorted(logs, key=lambda l: l.created_at, reverse=True):
        if log.video_id not in seen_video_ids:
            seen_video_ids.add(log.video_id)
            video = db.query(models.Video).filter(
                models.Video.id == log.video_id
            ).first()
            if video:
                recent_videos.append({
                    "video_id": video.id,
                    "title": video.title,
                    "youtube_id": video.youtube_id,
                })
        if len(recent_videos) >= 5:
            break

    return {
        "total_sessions": len(logs),
        "mode_stats": mode_stats,
        "recent_videos": recent_videos,
        "streak_days": streak,
        "weak_areas": weak_areas,
        "total_segments_studied": len(set(log.segment_id for log in logs if log.segment_id)),
    }


# ── 4. 영상 추천 ──────────────────────────────────────────────────────────────

def recommend_videos(count: int = 3, db: Session = None) -> dict:
    """학습 이력 기반으로 아직 공부하지 않은 영상을 추천한다."""
    # 최근 7일 내 학습한 영상 ID 목록
    since = datetime.utcnow() - timedelta(days=7)
    studied_video_ids = set(
        row.video_id
        for row in db.query(models.StudyLog.video_id)
        .filter(models.StudyLog.created_at >= since)
        .all()
    )

    all_videos = db.query(models.Video).all()
    unstudied = [v for v in all_videos if v.id not in studied_video_ids]
    studied = [v for v in all_videos if v.id in studied_video_ids]

    # source 필드로 프론트가 "local"(바로 학습)과 "youtube"(등록 후 학습)를 구분함
    recommendations = []

    # ── 1순위: 등록된 미학습 영상 ──
    for v in unstudied[:count]:
        segment_count = db.query(models.Transcript).filter(
            models.Transcript.video_id == v.id
        ).count()
        recommendations.append({
            "video_id": v.id,
            "youtube_id": v.youtube_id,
            "title": v.title,
            "thumbnail_url": v.thumbnail_url,
            "segment_count": segment_count,
            "source": "local",
            "reason": "아직 학습하지 않은 새 영상입니다",
        })

    # ── 2순위: 부족하면 외부 YouTube에서 관심사 기반으로 자동 발견 ──
    external_status = None   # 외부 검색을 안 했을 수도 있으므로 기본값
    if len(recommendations) < count:
        # 학습자 관심사를 검색어로 사용; 없으면 기본 키워드
        interests_pref = db.query(models.UserPreference).filter(
            models.UserPreference.key == "interests"
        ).first()
        # "business,travel" 형식 → 공백 구분 키워드로 변환
        raw_interests = interests_pref.value if interests_pref else ""
        query = (raw_interests or "").replace(",", " ").strip() or "english conversation"

        # 이미 등록된 youtube_id는 중복 추천하지 않도록 제외
        existing_youtube_ids = {v.youtube_id for v in all_videos}
        needed = count - len(recommendations)
        # 중복 제거로 줄어들 수 있으니 넉넉히(needed + 3) 가져온 뒤 잘라 씀
        search_result = _youtube_search_status(query, max_results=needed + 3)
        external_status = search_result["status"]
        for item in search_result["items"]:
            if item["youtube_id"] in existing_youtube_ids:
                continue
            recommendations.append({
                "youtube_id": item["youtube_id"],
                "title": item["title"],
                "channel": item.get("channel"),
                "thumbnail_url": item.get("thumbnail_url"),
                "duration_sec": item.get("duration_sec"),  # _youtube_search가 채운 실제 길이(초)
                "source": "youtube",  # 미등록 → 프론트에서 "등록하고 공부하기" 버튼
                "reason": f"'{query}' 관심사에 맞는 새 영상이에요",
            })
            if len(recommendations) >= count:
                break

    # ── 3순위: 그래도 부족하면 이미 학습한 영상을 복습용으로 채움 ──
    if len(recommendations) < count:
        for v in studied:
            if len(recommendations) >= count:
                break
            segment_count = db.query(models.Transcript).filter(
                models.Transcript.video_id == v.id
            ).count()
            recommendations.append({
                "video_id": v.id,
                "youtube_id": v.youtube_id,
                "title": v.title,
                "thumbnail_url": v.thumbnail_url,
                "segment_count": segment_count,
                "source": "local",
                "reason": "복습하면 좋을 영상입니다",
            })

    # 외부 검색 상태를 사용자 안내 문구(notice)로 변환 (쿼터/키 문제일 때만)
    notice = _external_notice(external_status)

    if not recommendations:
        return {
            "recommendations": [],
            "message": "추천할 영상을 찾지 못했어요. 관심 주제를 알려주시거나 YouTube URL을 등록해보세요!",
            "notice": notice,
        }

    return {"recommendations": recommendations, "notice": notice}


def _external_notice(status) -> str | None:
    """외부 검색 status 를 사용자에게 보여줄 한국어 안내로 변환. 정상이면 None."""
    if status == "quota":
        return "YouTube 검색 일일 한도를 초과했어요. 한도가 리셋되는 내일(태평양 자정 ≈ 한국 오후 4~5시) 이후 다시 시도해 주세요. 그 전까지는 내 라이브러리 영상으로 학습할 수 있어요."
    if status == "no_key":
        return "YouTube API 키가 없어 외부 영상 검색이 비활성화돼 있어요. 내 라이브러리 영상은 정상 이용 가능해요."
    if status == "error":
        return "외부 영상 검색 중 일시적인 오류가 있었어요. 잠시 후 다시 시도해 주세요."
    return None


# ── 5. 문법 설명 ──────────────────────────────────────────────────────────────

def explain_grammar(expression: str, context: str = "", db: Session = None) -> dict:
    """Groq Llama로 문법 표현을 상세히 설명하고 구조화된 JSON으로 반환한다."""
    groq_api_key = os.getenv("GROQ_API_KEY", "")
    if not groq_api_key:
        return {"error": "GROQ_API_KEY가 설정되지 않았습니다."}

    context_part = f'\n사용된 문장: "{context}"' if context else ""
    prompt = (
        f"다음 영어 표현을 한국어 학습자를 위해 자세히 설명해주세요.\n\n"
        f"표현: {expression}{context_part}\n\n"
        f"반드시 아래 JSON 형식으로만 응답하세요. 다른 텍스트 없이 JSON만:\n"
        f"{{\n"
        f'  "expression": "{expression}",\n'
        f'  "explanation_ko": "한국어로 쉽게 설명 (3-4문장)",\n'
        f'  "usage_pattern": "사용 패턴 설명 (예: 주어 + would have + p.p.)",\n'
        f'  "similar_expressions": ["유사 표현1", "유사 표현2"],\n'
        f'  "example_sentences": [\n'
        f'    {{"en": "영어 예문 1", "ko": "한국어 번역 1"}},\n'
        f'    {{"en": "영어 예문 2", "ko": "한국어 번역 2"}},\n'
        f'    {{"en": "영어 예문 3", "ko": "한국어 번역 3"}}\n'
        f"  ],\n"
        f'  "common_mistakes": ["한국인이 자주 하는 실수 1", "실수 2"]\n'
        f"}}"
    )

    try:
        from groq import Groq  # noqa: PLC0415
        client = Groq(api_key=groq_api_key)
        response = client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.5,
        )
        raw = response.choices[0].message.content
    except Exception as e:
        return {"error": f"Groq API 오류: {e}"}

    return _parse_json_safely(raw, {
        "expression": expression,
        "explanation_ko": f"'{expression}'은(는) 영어에서 자주 쓰이는 중요한 표현입니다.",
        "usage_pattern": "",
        "similar_expressions": [],
        "example_sentences": [],
        "common_mistakes": [],
    })


# ── 6. 복습 계획 ──────────────────────────────────────────────────────────────

def get_review_plan(db: Session) -> dict:
    """간격 반복(Spaced Repetition) 원리로 복습이 필요한 항목을 찾는다."""
    now = datetime.utcnow()
    # 간격 반복 기준: 1일, 3일, 7일, 14일 전 학습한 항목이 복습 대상
    review_windows = [
        (timedelta(days=1), timedelta(hours=6)),    # 1일 전 ± 6시간
        (timedelta(days=3), timedelta(hours=12)),   # 3일 전 ± 12시간
        (timedelta(days=7), timedelta(days=1)),     # 7일 전 ± 1일
        (timedelta(days=14), timedelta(days=2)),    # 14일 전 ± 2일
    ]

    review_items = []
    seen_segment_ids: set[int] = set()

    # 간격 반복 대상 조회
    for target_delta, tolerance in review_windows:
        target_time = now - target_delta
        logs = db.query(models.StudyLog).filter(
            models.StudyLog.created_at.between(
                target_time - tolerance,
                target_time + tolerance,
            ),
            models.StudyLog.segment_id.isnot(None),
        ).all()

        for log in logs:
            if log.segment_id in seen_segment_ids:
                continue
            seen_segment_ids.add(log.segment_id)

            segment = db.query(models.Transcript).filter(
                models.Transcript.id == log.segment_id
            ).first()
            if segment:
                review_items.append({
                    "segment_id": log.segment_id,
                    "text": segment.text,
                    "mode": log.mode,
                    "last_score": log.score,
                    "last_studied": log.created_at.strftime("%Y-%m-%d"),
                    "reason": f"간격 반복: {target_delta.days}일 전 학습한 항목",
                })

    # 점수가 낮았던 항목도 복습 대상에 추가 (점수 70 미만)
    low_score_logs = db.query(models.StudyLog).filter(
        models.StudyLog.score < 70,
        models.StudyLog.segment_id.isnot(None),
        models.StudyLog.created_at >= now - timedelta(days=30),
    ).order_by(models.StudyLog.score.asc()).limit(5).all()

    for log in low_score_logs:
        if log.segment_id in seen_segment_ids:
            continue
        seen_segment_ids.add(log.segment_id)

        segment = db.query(models.Transcript).filter(
            models.Transcript.id == log.segment_id
        ).first()
        if segment:
            review_items.append({
                "segment_id": log.segment_id,
                "text": segment.text,
                "mode": log.mode,
                "last_score": log.score,
                "last_studied": log.created_at.strftime("%Y-%m-%d"),
                "reason": f"점수가 낮았던 항목 ({log.score:.0f}점)",
            })

    if not review_items:
        return {
            "review_items": [],
            "message": "오늘 복습할 항목이 없어요! 새로운 내용을 학습해보세요 🎉"
        }

    return {
        "review_items": review_items[:10],  # 최대 10개
        "message": f"오늘 복습할 항목이 {len(review_items)}개 있어요!"
    }


# ── 7. 북마크 관리 ────────────────────────────────────────────────────────────

def manage_bookmark(action: str, segment_id: int = None, note: str = None, db: Session = None) -> dict:
    """북마크 추가/조회/삭제를 처리한다."""
    if action == "list":
        bookmarks = db.query(models.Bookmark).all()
        result = []
        for bm in bookmarks:
            segment = db.query(models.Transcript).filter(
                models.Transcript.id == bm.segment_id
            ).first()
            result.append({
                "bookmark_id": bm.id,
                "segment_id": bm.segment_id,
                "text": segment.text if segment else "",
                "note": bm.note,
                "created_at": bm.created_at.strftime("%Y-%m-%d"),
            })
        return {"bookmarks": result, "total": len(result)}

    if action == "add":
        if not segment_id:
            return {"error": "add 작업에는 segment_id가 필요합니다"}
        # 이미 북마크된 경우 중복 추가 방지
        existing = db.query(models.Bookmark).filter(
            models.Bookmark.segment_id == segment_id
        ).first()
        if existing:
            return {"message": "이미 북마크된 표현입니다", "bookmark_id": existing.id}

        bm = models.Bookmark(segment_id=segment_id, note=note)
        db.add(bm)
        db.commit()
        db.refresh(bm)
        return {"message": "북마크가 추가되었습니다 🔖", "bookmark_id": bm.id}

    if action == "remove":
        if not segment_id:
            return {"error": "remove 작업에는 segment_id가 필요합니다"}
        bm = db.query(models.Bookmark).filter(
            models.Bookmark.segment_id == segment_id
        ).first()
        if not bm:
            return {"error": "해당 북마크를 찾을 수 없습니다"}
        db.delete(bm)
        db.commit()
        return {"message": "북마크가 삭제되었습니다"}

    return {"error": f"알 수 없는 action: {action}. 'add', 'list', 'remove' 중 하나를 사용하세요."}


# ── 8. 학습 설정 업데이트 ─────────────────────────────────────────────────────

def update_preferences(key: str, value: str, db: Session) -> dict:
    """학습자 프로필 정보를 UserPreference 테이블에 upsert한다."""
    pref = db.query(models.UserPreference).filter(
        models.UserPreference.key == key
    ).first()

    if pref:
        pref.value = value
        pref.updated_at = datetime.utcnow()
    else:
        pref = models.UserPreference(key=key, value=value)
        db.add(pref)

    db.commit()
    return {"message": f"설정이 업데이트되었습니다: {key} = {value}"}


# ── 공통 유틸 ─────────────────────────────────────────────────────────────────

def _parse_json_safely(text: str, fallback: dict) -> dict:
    """LLM 응답에서 JSON을 추출한다. 실패하면 fallback을 반환."""
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    match = re.search(r"```(?:json)?\s*([\s\S]+?)\s*```", text)
    if match:
        try:
            return json.loads(match.group(1))
        except json.JSONDecodeError:
            pass

    match = re.search(r"\{[\s\S]+\}", text)
    if match:
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError:
            pass

    return fallback


# ── Tool 디스패처 ─────────────────────────────────────────────────────────────

def execute_tool(tool_name: str, tool_args: dict, db: Session) -> dict:
    """tool_name에 해당하는 함수를 찾아 실행하고 결과를 반환한다."""
    # 각 도구 이름과 실제 함수를 매핑
    TOOL_MAP = {
        "search_youtube_videos": lambda args: search_youtube_videos(
            args["query"], db
        ),
        "register_video": lambda args: register_video(
            args["url"], db
        ),
        "get_learning_history": lambda args: get_learning_history(
            args.get("days", 7), db
        ),
        "recommend_videos": lambda args: recommend_videos(
            args.get("count", 3), db
        ),
        "explain_grammar": lambda args: explain_grammar(
            args["expression"], args.get("context", ""), db
        ),
        "get_review_plan": lambda args: get_review_plan(db),
        "manage_bookmark": lambda args: manage_bookmark(
            args["action"], args.get("segment_id"), args.get("note"), db
        ),
        "update_preferences": lambda args: update_preferences(
            args["key"], args["value"], db
        ),
    }

    if tool_name not in TOOL_MAP:
        return {"error": f"알 수 없는 도구: {tool_name}"}

    return TOOL_MAP[tool_name](tool_args)
