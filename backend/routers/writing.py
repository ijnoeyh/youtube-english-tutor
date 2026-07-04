# routers/writing.py — Write(응용 작문) 모드 API (과제 생성 + 평가)
import json
import os
import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from database import get_db
import models

router = APIRouter()


# ── 요청 스키마 ───────────────────────────────────────────────────────────────

class GenerateTaskRequest(BaseModel):
    """POST /api/writing/generate-task 요청 본문."""
    segment_id: int


class EvaluateRequest(BaseModel):
    """POST /api/writing/evaluate 요청 본문."""
    task_id: int
    user_sentence: str = Field(..., min_length=1, max_length=1000)


# ── Groq 유틸 함수 ────────────────────────────────────────────────────────────

def _call_groq_llama(messages: list, groq_api_key: str) -> str:
    """Groq Llama 3.1 8B-Instant에 메시지를 전송하고 텍스트 응답을 반환한다."""
    from groq import Groq  # noqa: PLC0415
    client = Groq(
        api_key=groq_api_key,
        timeout=float(os.getenv("GROQ_TIMEOUT", "30")),
        max_retries=int(os.getenv("GROQ_MAX_RETRIES", "3")),
    )
    response = client.chat.completions.create(
        model="llama-3.1-8b-instant",
        messages=messages,
        temperature=0.7,
    )
    return response.choices[0].message.content


def _parse_json_safely(text: str, fallback: dict) -> dict:
    """
    LLM 응답 문자열에서 JSON을 추출한다. 실패하면 fallback 딕셔너리를 반환.

    LLM이 마크다운 코드 블록이나 설명 텍스트로 감싸는 경우가 많아 3단계로 파싱을 시도한다.
    """
    # 1차: 응답 전체를 바로 JSON으로 파싱
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # 2차: ```json ... ``` 마크다운 코드 블록에서 추출
    match = re.search(r"```(?:json)?\s*([\s\S]+?)\s*```", text)
    if match:
        try:
            return json.loads(match.group(1))
        except json.JSONDecodeError:
            pass

    # 3차: 첫 번째 { ... } 블록 찾기
    match = re.search(r"\{[\s\S]+\}", text)
    if match:
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError:
            pass

    return fallback


# ── 엔드포인트 ────────────────────────────────────────────────────────────────

@router.post("/writing/generate-task")
def generate_writing_task(request: GenerateTaskRequest, db: Session = Depends(get_db)):
    """
    자막 세그먼트에서 핵심 표현을 추출해 작문 과제를 생성한다.

    처리 순서:
      1. DB에서 세그먼트 조회
      2. 이미 생성된 과제가 있으면 재활용 (Groq API 호출 생략)
      3. 없으면 Groq Llama로 과제 생성 → DB 저장
    """
    # 1. 세그먼트 존재 확인
    segment = db.query(models.Transcript).filter(
        models.Transcript.id == request.segment_id
    ).first()
    if not segment:
        raise HTTPException(status_code=404, detail="세그먼트를 찾을 수 없습니다")

    # 2. 이미 생성된 과제 재활용 (Groq API 호출 없이 바로 반환 → 할당량 절약)
    existing = db.query(models.WritingTask).filter(
        models.WritingTask.segment_id == request.segment_id
    ).first()
    if existing:
        return {
            "task_id": existing.id,
            "segment_text": segment.text,
            "target_expression": existing.target_expression,
            "pattern_explanation": existing.pattern_explanation,
            "task_prompt": existing.task_prompt,
        }

    # 3. Groq API 키 확인
    groq_api_key = os.getenv("GROQ_API_KEY", "")
    if not groq_api_key:
        raise HTTPException(
            status_code=400,
            detail="GROQ_API_KEY가 설정되지 않았습니다. backend/.env 파일에 키를 추가해주세요.",
        )

    # 4. Groq Llama로 과제 생성
    prompt = (
        f'다음 영어 문장에서 핵심 문법 표현 1개를 추출하고 '
        f'한국어 학습자를 위한 작문 과제를 만들어주세요.\n\n'
        f'영어 문장: "{segment.text}"\n\n'
        f'반드시 아래 JSON 형식으로만 응답하세요. 다른 텍스트 없이 JSON만:\n'
        f'{{\n'
        f'  "target_expression": "핵심 표현 (영어, 예: would have p.p.)",\n'
        f'  "pattern_explanation": "이 표현의 문법 패턴 설명 (한국어, 2-3문장)",\n'
        f'  "task_prompt": "이 표현을 사용해서 문장을 만들어보세요 (한국어 지시문, 구체적 상황 제시)"\n'
        f'}}'
    )

    try:
        raw = _call_groq_llama([{"role": "user", "content": prompt}], groq_api_key)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Groq API 오류: {e}")

    # 5. JSON 파싱 (실패 시 기본값으로 대체)
    parsed = _parse_json_safely(raw, {
        "target_expression": segment.text.split()[0] if segment.text else "expression",
        "pattern_explanation": "이 표현은 영어에서 자주 쓰이는 중요한 표현입니다.",
        "task_prompt": f"오늘 배운 표현을 사용해서 나만의 문장을 만들어보세요.",
    })

    # 6. DB 저장
    task = models.WritingTask(
        segment_id=request.segment_id,
        target_expression=parsed.get("target_expression", ""),
        pattern_explanation=parsed.get("pattern_explanation", ""),
        task_prompt=parsed.get("task_prompt", ""),
    )
    db.add(task)
    db.commit()
    db.refresh(task)

    return {
        "task_id": task.id,
        "segment_text": segment.text,
        "target_expression": task.target_expression,
        "pattern_explanation": task.pattern_explanation,
        "task_prompt": task.task_prompt,
    }


@router.post("/writing/evaluate")
def evaluate_writing(request: EvaluateRequest, db: Session = Depends(get_db)):
    """
    사용자가 작성한 문장을 Groq Llama로 평가한다.

    WHY: Write 모드는 정답이 무수히 많아 단어 비교로 채점할 수 없으므로 LLM 평가를 사용한다.
    처리 순서: WritingTask 조회 → Groq 평가 → StudyLog 저장 → 결과 반환
    """
    # 1. 과제 조회
    task = db.query(models.WritingTask).filter(
        models.WritingTask.id == request.task_id
    ).first()
    if not task:
        raise HTTPException(status_code=404, detail="과제를 찾을 수 없습니다")

    # 2. Groq API 키 확인
    groq_api_key = os.getenv("GROQ_API_KEY", "")
    if not groq_api_key:
        raise HTTPException(status_code=400, detail="GROQ_API_KEY가 설정되지 않았습니다.")

    # 3. Groq Llama로 평가
    prompt = (
        f'한국어 영어 학습자가 작성한 문장을 친절하게 평가해주세요.\n\n'
        f'학습 핵심 표현: {task.target_expression}\n'
        f'과제 지시문: {task.task_prompt}\n'
        f'학습자 문장: "{request.user_sentence}"\n\n'
        f'반드시 아래 JSON 형식으로만 응답하세요. 다른 텍스트 없이 JSON만:\n'
        f'{{\n'
        f'  "score": 0에서 100 사이의 정수,\n'
        f'  "used_expression_correctly": true 또는 false,\n'
        f'  "grammar_feedback": "문법 피드백 (한국어, 1-2문장)",\n'
        f'  "naturalness_feedback": "자연스러움 피드백 (한국어, 1-2문장)",\n'
        f'  "improved_sentence": "더 자연스럽게 개선한 영어 문장",\n'
        f'  "encouragement": "학습자를 격려하는 메시지 (한국어, 1문장)"\n'
        f'}}'
    )

    try:
        raw = _call_groq_llama([{"role": "user", "content": prompt}], groq_api_key)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Groq API 오류: {e}")

    parsed = _parse_json_safely(raw, {
        "score": 70,
        "used_expression_correctly": True,
        "grammar_feedback": "문법 분석 중 일시적 오류가 발생했습니다. 다시 시도해주세요.",
        "naturalness_feedback": "전반적으로 자연스러운 표현입니다.",
        "improved_sentence": request.user_sentence,
        "encouragement": "잘 하셨어요! 계속 연습하면 실력이 늘어요.",
    })

    # 4. StudyLog 저장
    segment = db.query(models.Transcript).filter(
        models.Transcript.id == task.segment_id
    ).first()
    if segment:
        log = models.StudyLog(
            video_id=segment.video_id,
            segment_id=segment.id,
            mode="write",
            score=float(parsed.get("score", 70)),
        )
        db.add(log)
        db.commit()

    return {
        "score": parsed.get("score", 70),
        "used_expression_correctly": parsed.get("used_expression_correctly", True),
        "grammar_feedback": parsed.get("grammar_feedback", ""),
        "naturalness_feedback": parsed.get("naturalness_feedback", ""),
        "improved_sentence": parsed.get("improved_sentence", request.user_sentence),
        "encouragement": parsed.get("encouragement", ""),
    }
