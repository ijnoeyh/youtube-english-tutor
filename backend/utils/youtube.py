# utils/youtube.py — YouTube URL 파싱, 자막 조회, 자막 병합, 영상 메타데이터 조회.
from __future__ import annotations

import logging
import os
import re

from youtube_transcript_api import (
    YouTubeTranscriptApi,
    NoTranscriptFound,
    TranscriptsDisabled,
)
from fastapi import HTTPException

logger = logging.getLogger(__name__)


def extract_youtube_id(url: str) -> str:
    """YouTube URL에서 동영상 ID(11자리)를 추출한다.

    지원 형식: watch?v=, youtu.be/, shorts/
    """
    patterns = [
        r'[?&]v=([A-Za-z0-9_-]{11})',
        r'youtu\.be/([A-Za-z0-9_-]{11})',
        r'shorts/([A-Za-z0-9_-]{11})',
    ]
    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1)
    raise HTTPException(status_code=400, detail="유효하지 않은 YouTube URL입니다")


def fetch_transcript(youtube_id: str) -> tuple[list[dict], bool]:
    """영어 자막을 가져온다. 수동 자막 우선, 없으면 자동 생성 자막 사용.

    반환: ([{"text": "...", "start": 0.0, "duration": 2.5}, ...], is_generated)
    is_generated=True면 자동 생성 자막(구두점 없음)이라 문장 재구성이 필요.
    """
    try:
        # v1.x: 클래스 메서드 대신 인스턴스 메서드 사용
        ytt = YouTubeTranscriptApi()
        transcript_list = ytt.list(youtube_id)

        try:
            transcript = transcript_list.find_manually_created_transcript(
                ['en', 'en-US', 'en-GB']
            )
        except NoTranscriptFound:
            transcript = transcript_list.find_generated_transcript(
                ['en', 'en-US', 'en-GB']
            )

        is_generated = bool(getattr(transcript, "is_generated", False))

        # v1.x에서 반환값이 객체로 변경되어 dict로 변환
        fetched = transcript.fetch()
        return (
            [{"text": s.text, "start": s.start, "duration": s.duration} for s in fetched],
            is_generated,
        )

    except (NoTranscriptFound, TranscriptsDisabled):
        raise HTTPException(
            status_code=400,
            detail="영어 자막이 없는 영상입니다. 영어 자막이 있는 영상을 사용해주세요."
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"자막 가져오기 실패: {str(e)}"
        )


# ── 자막 큐 → 문장 단위 병합 ──────────────────────────────────────────────────

def merge_into_sentences(
    raw_segments: list[dict],
    max_chars: int = 140,
    max_gap: float = 1.2,
) -> list[dict]:
    """자막 큐를 문장 단위로 병합한다.

    YouTube 자막은 타이밍 단위로 잘려 있어 자연스러운 문장 단위로 재병합이 필요.
    반환: [{"text": "...", "start": 0.0, "end": 5.3}, ...]

    max_chars: 구두점 없는 자동 자막의 무한 연장 방지용 길이 상한.
    max_gap:   큐 간 침묵/장면 전환 경계 판단 기준(초).
    """
    sentences: list[dict] = []

    buf_text: list[str] = []
    buf_start: float | None = None
    buf_end: float | None = None

    def flush() -> None:
        """버퍼에 모인 큐들을 하나의 문장 세그먼트로 확정하고 버퍼를 비운다."""
        nonlocal buf_text, buf_start, buf_end
        if not buf_text:
            return
        sentences.append({
            "text": " ".join(buf_text).strip(),
            "start": buf_start,
            "end": buf_end,
        })
        buf_text = []
        buf_start = None
        buf_end = None

    for seg in raw_segments:
        text = seg["text"].strip().replace("\n", " ")
        if not text:
            continue

        start = seg["start"]
        end = start + seg.get("duration", 0)

        # 긴 침묵/장면 전환이면 문장 경계로 처리
        if buf_end is not None and (start - buf_end) > max_gap:
            flush()

        if buf_start is None:
            buf_start = start
        buf_text.append(text)
        buf_end = end

        joined = " ".join(buf_text).strip()

        # 구두점으로 끝나거나 max_chars 초과 시 flush
        # rstrip('"\''): 'He said "go."' 처럼 종결부호 뒤 따옴표 케이스 처리
        ends_with_punct = joined.rstrip('"\'').endswith((".", "!", "?"))
        should_flush = ends_with_punct or len(joined) >= max_chars

        if should_flush:
            flush()

    flush()

    return sentences


# ── LLM 기반 문장 재구성 (자동 생성 자막용) ────────────────────────────────────

def _normalize_words(text: str) -> list[str]:
    """비교용 단어 리스트: 소문자 + 영숫자/어퍼스트로피만 남김."""
    t = re.sub(r"[^a-z0-9\s']", " ", text.lower())
    return t.split()


def _groq_group_cues(cues: list[dict], api_key: str) -> list[tuple[int, int, str]] | None:
    """번호 매긴 자막 조각을 주고 '문장 = 조각번호 범위'로 묶게 한다.

    문장 경계를 원본 조각 경계로 되돌려 받으므로, LLM이 단어 수를 바꿔도
    (I'm→I am, 필러 제거 등) 타임스탬프 드리프트가 없다.
    반환: [(from0, to0, text), ...] (0-based, 양끝 포함) 또는 None(→ 휴리스틱 폴백).
    """
    try:
        from groq import Groq  # noqa: PLC0415 — 키 없을 때 불필요

        client = Groq(
            api_key=api_key,
            timeout=float(os.getenv("GROQ_TIMEOUT", "30")),
            max_retries=int(os.getenv("GROQ_MAX_RETRIES", "3")),
        )
        numbered = "\n".join(f"[{i + 1}] {c['text']}" for i, c in enumerate(cues))
        prompt = (
            "다음은 번호가 매겨진 유튜브 영어 자막 조각들입니다. "
            "연속된 조각들을 자연스러운 영어 문장으로 묶으세요.\n"
            "규칙:\n"
            "- 한 줄에 한 문장씩, 형식은 정확히 `시작번호-끝번호 | 문장` 으로 출력.\n"
            "- 모든 조각을 순서대로 빠짐없이, 겹치지 않게 한 번씩만 사용.\n"
            "- 문장에는 알맞은 구두점을 넣고 첫 글자를 대문자로. 단어 자체는 원본을 유지.\n"
            "- 예: `1-3 | I think the most important thing is to keep practicing.`\n\n"
            f"조각:\n{numbered}"
        )
        resp = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[{"role": "user", "content": prompt}],
            temperature=0,
        )
        content = resp.choices[0].message.content or ""
        groups: list[tuple[int, int, str]] = []
        for line in content.splitlines():
            m = re.match(r"^\s*\[?(\d+)\]?\s*[-~]\s*\[?(\d+)\]?\s*\|\s*(.+?)\s*$", line)
            if m:
                a, b, text = int(m.group(1)), int(m.group(2)), m.group(3).strip()
            else:
                # 단일 조각 문장: `5 | text` 형식도 허용
                m2 = re.match(r"^\s*\[?(\d+)\]?\s*\|\s*(.+?)\s*$", line)
                if not m2:
                    continue
                a = b = int(m2.group(1))
                text = m2.group(2).strip()
            groups.append((a - 1, b - 1, text))
        return groups or None
    except Exception:
        logger.exception("Groq 조각 그룹핑 실패 → 휴리스틱 폴백")
        return None


def merge_into_sentences_llm(
    raw_segments: list[dict],
    chunk_size: int = 120,
) -> list[dict]:
    """자동 생성 자막을 LLM으로 문장 단위 재구성한다(조각 번호 그룹핑).

    LLM은 '어느 조각들이 한 문장인지'만 정하고, 타이밍은 원본 조각 경계에서 가져와
    드리프트가 없다. Groq 키 없음/큐 부족/호출 실패 시 휴리스틱으로 폴백.
    반환: [{"text": "...", "start": 0.0, "end": 5.3}, ...]
    """
    api_key = os.getenv("GROQ_API_KEY", "")

    cues: list[dict] = []
    for seg in raw_segments:
        t = seg["text"].strip().replace("\n", " ")
        if not t:
            continue
        cues.append({
            "text": t,
            "start": seg["start"],
            "end": seg["start"] + seg.get("duration", 0),
        })

    if not api_key or len(cues) < 2:
        return merge_into_sentences(raw_segments)

    result: list[dict] = []
    # 긴 자막은 출력 토큰 한도를 위해 조각 윈도우 단위로 처리
    for i in range(0, len(cues), chunk_size):
        window = cues[i:i + chunk_size]
        groups = _groq_group_cues(window, api_key)
        if not groups:
            return merge_into_sentences(raw_segments)  # 한 번이라도 실패 시 전체 휴리스틱

        w = len(window)
        prev_to = -1
        for (a, b, text) in groups:
            a = max(0, min(a, w - 1))
            b = max(a, min(b, w - 1))
            if a <= prev_to:          # 겹침 방지: 직전 문장 끝 이후부터 시작
                a = prev_to + 1
            if a >= w or a > b:
                continue
            result.append({
                "text": text,
                "start": window[a]["start"],
                "end": window[b]["end"],
            })
            prev_to = b

        # LLM이 마지막 조각들을 빠뜨렸으면 끝을 실제 끝까지 연장
        if 0 <= prev_to < w - 1 and result:
            result[-1]["end"] = window[w - 1]["end"]

    return result or merge_into_sentences(raw_segments)


def segment_transcript(raw_segments: list[dict], is_generated: bool = False) -> list[dict]:
    """자막을 문장 단위로 만든다.

    자동 생성 자막(구두점 없음)은 LLM 재구성, 수동 자막(구두점 있음)은 휴리스틱 병합.
    """
    if is_generated:
        return merge_into_sentences_llm(raw_segments)
    return merge_into_sentences(raw_segments)


# ── 영상 메타데이터 (제목/채널/길이/썸네일/설명) ───────────────────────────────

def _parse_iso8601_duration(duration: str) -> int | None:
    """ISO 8601 duration 문자열("PT9M42S")을 초 단위 정수로 변환한다."""
    if not duration:
        return None
    m = re.fullmatch(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", duration)
    if not m:
        return None
    h, mi, s = (int(x) if x else 0 for x in m.groups())
    return h * 3600 + mi * 60 + s


def fetch_video_metadata(youtube_id: str) -> dict:
    """YouTube Data API v3로 영상 메타데이터를 가져온다.

    반환: {"title", "channel", "description", "thumbnail_url", "duration_sec"}
    API 키 미설정/네트워크 오류/영상 없음 등 실패 시 title=youtube_id 폴백 반환.
    메타데이터는 보조 정보이므로 예외를 던지지 않고 폴백으로 사용자 경험을 유지.
    """
    fallback = {
        "title": youtube_id,
        "channel": None,
        "description": None,
        "thumbnail_url": None,
        "duration_sec": None,
    }

    api_key = os.getenv("YOUTUBE_API_KEY", "")
    if not api_key:
        return fallback

    try:
        from googleapiclient.discovery import build  # google-api-python-client

        youtube = build("youtube", "v3", developerKey=api_key)
        response = youtube.videos().list(
            id=youtube_id,
            part="snippet,contentDetails",
        ).execute()

        items = response.get("items", [])
        if not items:
            return fallback

        snippet = items[0].get("snippet", {})
        content = items[0].get("contentDetails", {})
        thumbs = snippet.get("thumbnails", {})
        # 썸네일 우선순위: high > medium > default
        thumb_url = (
            (thumbs.get("high") or thumbs.get("medium") or thumbs.get("default") or {})
            .get("url")
        )

        return {
            "title": snippet.get("title") or youtube_id,
            "channel": snippet.get("channelTitle"),
            "description": (snippet.get("description") or "")[:1000] or None,
            "thumbnail_url": thumb_url,
            "duration_sec": _parse_iso8601_duration(content.get("duration", "")),
        }

    except Exception:
        return fallback
