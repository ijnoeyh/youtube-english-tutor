# routers/stats.py — 학습 대시보드용 통계 API
from datetime import datetime, timedelta, date
from collections import defaultdict

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from database import get_db
import models

router = APIRouter()

# StudyLog.created_at은 UTC 저장이므로, 사용자 체감 날짜(KST) 기준 집계를 위해 +9h 적용
KST_OFFSET = timedelta(hours=9)

# 응답에서 항상 이 3개 키가 나오도록 고정 (데이터가 없어도 0으로 표시)
MODES = ["listen", "speak", "write"]

# 일별 활동 그래프에 보여줄 최근 일수
DAILY_WINDOW = 14


def _to_kst_date(dt: datetime) -> date:
    """UTC naive datetime을 KST 기준 날짜로 변환한다."""
    return (dt + KST_OFFSET).date()


@router.get("/stats/dashboard")
def get_dashboard_stats(db: Session = Depends(get_db)):
    """
    학습 대시보드용 집계 통계를 반환한다.

    반환 구조:
      {
        "totals":   {"sessions": 전체 학습 횟수, "videos": 학습한 영상 수, "sentences": 학습한 문장 수},
        "by_mode":  {"listen": {"count": N, "avg_score": 87.3 | None}, "speak": {...}, "write": {...}},
        "streak":   {"current": 현재 연속 학습일, "longest": 최장 연속 학습일},
        "daily":    [{"date": "2026-06-14", "count": 3, "avg_score": 80.0 | None}, ... 최근 14일]
      }
    """
    logs = (
        db.query(models.StudyLog)
        .order_by(models.StudyLog.created_at.asc())
        .all()
    )

    # ── 1) 총계 ──────────────────────────────────────────────────────────────
    video_ids = set()
    segment_ids = set()
    for log in logs:
        video_ids.add(log.video_id)
        if log.segment_id is not None:
            segment_ids.add(log.segment_id)

    totals = {
        "sessions": len(logs),
        "videos": len(video_ids),
        "sentences": len(segment_ids),
    }

    # ── 2) 모드별 횟수 + 평균 점수 ───────────────────────────────────────────
    mode_count = defaultdict(int)
    mode_score_sum = defaultdict(float)
    mode_score_n = defaultdict(int)

    for log in logs:
        mode_count[log.mode] += 1
        if log.score is not None:
            mode_score_sum[log.mode] += log.score
            mode_score_n[log.mode] += 1

    by_mode = {}
    for mode in MODES:
        n = mode_score_n[mode]
        # 채점된 기록이 없으면 None (프론트에서 '-'로 표시)
        avg = round(mode_score_sum[mode] / n, 1) if n > 0 else None
        by_mode[mode] = {"count": mode_count[mode], "avg_score": avg}

    # ── 3) 일별 집계 ─────────────────────────────────────────────────────────
    day_count = defaultdict(int)
    day_score_sum = defaultdict(float)
    day_score_n = defaultdict(int)
    active_days = set()

    for log in logs:
        d = _to_kst_date(log.created_at)
        day_count[d] += 1
        active_days.add(d)
        if log.score is not None:
            day_score_sum[d] += log.score
            day_score_n[d] += 1

    # 활동 없는 날도 0으로 포함해 그래프가 끊기지 않게 함
    today_kst = _to_kst_date(datetime.utcnow())
    daily = []
    for i in range(DAILY_WINDOW - 1, -1, -1):
        d = today_kst - timedelta(days=i)
        n = day_score_n[d]
        daily.append({
            "date": d.isoformat(),
            "count": day_count[d],
            "avg_score": round(day_score_sum[d] / n, 1) if n > 0 else None,
        })

    # ── 4) 연속 학습일(streak) ───────────────────────────────────────────────
    streak = _compute_streak(active_days, today_kst)

    return {
        "totals": totals,
        "by_mode": by_mode,
        "streak": streak,
        "daily": daily,
    }


def _compute_streak(active_days: set[date], today: date) -> dict:
    """
    연속 학습일을 계산한다.

    - current: 오늘(또는 어제)부터 거꾸로 며칠 연속 학습했는지.
        WHY '어제'도 허용: 오늘 자정까지 학습하면 이어지므로, 어제까지 연속이면 끊겼다고 보지 않음.
    - longest: 전체 기록 중 가장 길었던 연속 구간.
    """
    if not active_days:
        return {"current": 0, "longest": 0}

    # current: 기준점(오늘 학습했으면 오늘, 아니면 어제)부터 연속 카운트
    if today in active_days:
        anchor = today
    elif (today - timedelta(days=1)) in active_days:
        anchor = today - timedelta(days=1)
    else:
        anchor = None   # 오늘도 어제도 학습 없음 → 현재 연속은 0

    current = 0
    if anchor is not None:
        d = anchor
        while d in active_days:
            current += 1
            d -= timedelta(days=1)

    # longest: 모든 활동일을 정렬해 연속 구간의 최대 길이를 찾는다
    longest = 0
    run = 0
    prev = None
    for d in sorted(active_days):
        if prev is not None and (d - prev) == timedelta(days=1):
            run += 1
        else:
            run = 1
        longest = max(longest, run)
        prev = d

    return {"current": current, "longest": longest}
