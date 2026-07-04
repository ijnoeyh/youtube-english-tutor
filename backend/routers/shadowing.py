# routers/shadowing.py — Speak(섀도잉) 모드 평가 API
import logging
import os
import re
import tempfile
from typing import Optional

from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile, File
from sqlalchemy.orm import Session

from database import get_db
import models

router = APIRouter()
logger = logging.getLogger(__name__)


# ── 텍스트 비교 유틸 (프론트의 textCompare.ts와 동일 로직) ──────────────────

def normalize(text: str) -> str:
    """소문자 변환 + 구두점 제거로 비교 가능한 형태를 만든다."""
    text = text.lower()
    # 영문자·숫자·공백·어퍼스트로피만 남기고 나머지 제거
    text = re.sub(r"[^a-z0-9\s']", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def compare_texts(original: str, recognized: str) -> dict:
    """
    정답(original)과 인식된 텍스트(recognized)를 단어 단위로 비교한다.
    프론트의 compareTexts() 함수와 동일한 알고리즘.
    반환: { word_results, score, matched, total }
    """
    orig_words = normalize(original).split()
    recog_words = normalize(recognized).split()

    matched = 0
    word_results = []

    for i, orig_word in enumerate(orig_words):
        if i >= len(recog_words):
            word_results.append({"word": orig_word, "status": "missing"})
        elif orig_word == recog_words[i]:
            matched += 1
            word_results.append({"word": orig_word, "status": "correct"})
        else:
            word_results.append({"word": orig_word, "status": "wrong"})

    score = round((matched / len(orig_words)) * 100) if orig_words else 0
    return {"word_results": word_results, "score": score, "matched": matched, "total": len(orig_words)}


def generate_feedback(score: int) -> str:
    """점수에 따라 격려 피드백 메시지를 반환한다."""
    if score >= 90:
        return "완벽해요! 원어민처럼 말했어요. 🎉"
    elif score >= 70:
        return "훌륭해요! 조금만 더 연습하면 완벽해질 거예요. 👍"
    elif score >= 50:
        return "잘 하고 있어요! 어려운 단어를 중심으로 다시 들어보세요. 💪"
    else:
        return "괜찮아요! 원어민 음성을 다시 들어보고 천천히 따라해보세요. 🎧"


# ── 엔드포인트 ────────────────────────────────────────────────────────────────

@router.post("/shadowing/evaluate")
async def evaluate_shadowing(
    audio: UploadFile = File(...),         # 오디오 파일 (multipart/form-data)
    segment_id: int = Form(...),           # 정답을 조회할 세그먼트 ID
    db: Session = Depends(get_db),
):
    """사용자 음성을 Groq Whisper로 STT한 뒤 정답과 비교해 점수를 반환한다."""
    # 1. Groq API 키 확인
    groq_api_key = os.getenv("GROQ_API_KEY", "")
    if not groq_api_key:
        raise HTTPException(
            status_code=400,
            detail="GROQ_API_KEY가 설정되지 않았습니다. backend/.env 파일에 키를 추가해주세요."
        )

    # 2. DB에서 정답 세그먼트 조회 (오디오 처리 전에 먼저 확인)
    segment = db.query(models.Transcript).filter(models.Transcript.id == segment_id).first()
    if not segment:
        raise HTTPException(status_code=404, detail="세그먼트를 찾을 수 없습니다")

    # 3. 오디오 파일을 임시 파일로 저장 (Groq가 파일 경로로 읽어야 해서 delete=False)
    content_type = audio.content_type or "audio/webm"
    suffix = ".webm" if "webm" in content_type else ".mp4" if "mp4" in content_type else ".wav"

    tmp_path: Optional[str] = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp_path = tmp.name
            audio_bytes = await audio.read()  # 업로드된 파일 읽기
            tmp.write(audio_bytes)

        # 녹음이 비었거나 너무 짧으면 Groq 호출 전에 명확한 에러로 차단
        if len(audio_bytes) < 1024:
            raise HTTPException(status_code=400, detail="녹음된 음성이 없거나 너무 짧습니다. 마이크 권한을 확인하고 다시 녹음해주세요.")

        # 4. Groq Whisper로 STT
        from groq import Groq  # noqa: PLC0415 — 조건부 import (키 없을 때 불필요)
        client = Groq(
            api_key=groq_api_key,
            timeout=float(os.getenv("GROQ_TIMEOUT", "30")),
            max_retries=int(os.getenv("GROQ_MAX_RETRIES", "3")),
        )

        # 외부 STT 실패를 평문 500이 아니라 JSON 에러로 반환(프론트 파싱 안정)
        try:
            with open(tmp_path, "rb") as audio_file:
                transcription = client.audio.transcriptions.create(
                    model="whisper-large-v3",
                    file=audio_file,
                    language="en",              # 영어 강제 지정 (정확도 향상)
                    response_format="text",     # 텍스트만 반환 (타임스탬프 불필요)
                )
        except Exception as e:
            logger.exception("Whisper STT 실패 (segment_id=%s, %d bytes)", segment_id, len(audio_bytes))
            raise HTTPException(status_code=502, detail=f"음성 인식에 실패했습니다 ({type(e).__name__}). 잠시 후 다시 시도해주세요.") from e

        recognized_text = transcription.strip() if isinstance(transcription, str) else str(transcription)

        # 5. 정답 vs 인식 결과 비교
        compare_result = compare_texts(segment.text, recognized_text)

        # 6. 학습 기록 저장
        log = models.StudyLog(
            video_id=segment.video_id,
            segment_id=segment.id,
            mode="speak",
            score=compare_result["score"],
        )
        db.add(log)
        db.commit()

        # 7. 결과 반환
        return {
            "recognized_text": recognized_text,
            "original_text": segment.text,
            "score": compare_result["score"],
            "word_results": compare_result["word_results"],
            "feedback": generate_feedback(compare_result["score"]),
        }

    finally:
        # 임시 파일 반드시 삭제 (성공/실패 무관하게)
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)
