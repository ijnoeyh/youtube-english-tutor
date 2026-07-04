# agent/engine.py
# ReAct(Reasoning + Acting) 루프로 사용자 메시지를 처리하는 Agent 핵심 로직.

from __future__ import annotations

import json
import logging
import os

from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

from agent.prompts import AGENT_SYSTEM_PROMPT
from agent.tool_schemas import TOOL_SCHEMAS
from agent.tools import execute_tool

# 무한 루프 방지용 도구 호출 최대 횟수
MAX_TOOL_ITERATIONS = 5


def run(message: str, conversation_history: list, db: Session) -> dict:
    """Agent ReAct 루프를 실행하고 최종 응답을 반환한다."""
    groq_api_key = os.getenv("GROQ_API_KEY", "")
    if not groq_api_key:
        return {
            "reply": "GROQ_API_KEY가 설정되지 않았습니다. backend/.env 파일에 키를 추가해주세요.",
            "actions_taken": [],
            "data": {}
        }

    messages = [
        {"role": "system", "content": AGENT_SYSTEM_PROMPT}
    ] + conversation_history + [
        {"role": "user", "content": message}
    ]

    # 실행된 도구 이름과 결과를 기록 (프론트엔드에서 특별 UI 렌더링에 활용)
    actions_taken: list[str] = []
    accumulated_data: dict = {}

    # ── ReAct 루프 시작 ──────────────────────────────────────────────────────
    from groq import Groq  # noqa: PLC0415
    client = Groq(
        api_key=groq_api_key,
        timeout=float(os.getenv("GROQ_TIMEOUT", "30")),
        max_retries=int(os.getenv("GROQ_MAX_RETRIES", "3")),
    )

    for iteration in range(MAX_TOOL_ITERATIONS):

        try:
            response = client.chat.completions.create(
                model="llama-3.1-8b-instant",
                messages=messages,
                tools=TOOL_SCHEMAS,
                tool_choice="auto",
                temperature=0.7,
            )
        except Exception as e:
            # max_retries 재시도까지 모두 실패한 경우
            logger.exception("Groq 호출 실패 (iteration %d): %s", iteration + 1, e)
            return {
                "reply": f"AI 서비스에 일시적인 문제가 생겼습니다. 잠시 후 다시 시도해주세요. (오류: {e})",
                "actions_taken": actions_taken,
                "data": accumulated_data,
            }

        assistant_message = response.choices[0].message

        # ── 분기 1: 도구 호출 없음 → 최종 텍스트 응답 (루프 종료 조건) ──
        if not assistant_message.tool_calls:
            return {
                "reply": assistant_message.content or "응답을 생성하지 못했습니다.",
                "actions_taken": actions_taken,
                "data": accumulated_data,
            }

        # ── 분기 2: 도구 호출 있음 → 도구 실행 후 결과를 messages에 추가 ──

        # SDK 객체를 dict로 변환해 직렬화 안전성 확보
        tool_calls_data = []
        for tc in assistant_message.tool_calls:
            tool_calls_data.append({
                "id": tc.id,
                "type": "function",
                "function": {
                    "name": tc.function.name,
                    "arguments": tc.function.arguments,
                }
            })

        messages.append({
            "role": "assistant",
            "content": assistant_message.content,  # 도구 호출 시 보통 None
            "tool_calls": tool_calls_data,
        })

        # 각 도구 호출을 순서대로 실행
        for tool_call in assistant_message.tool_calls:
            tool_name = tool_call.function.name

            try:
                tool_args = json.loads(tool_call.function.arguments)
            except json.JSONDecodeError:
                tool_args = {}

            logger.info(
                "도구 호출 [%d/%d] %s args=%s",
                iteration + 1, MAX_TOOL_ITERATIONS, tool_name, tool_args,
            )

            try:
                tool_result = execute_tool(tool_name, tool_args, db)
                actions_taken.append(tool_name)
                accumulated_data[tool_name] = tool_result
                logger.info("도구 성공 %s", tool_name)
            except Exception as e:
                # 도구 실패 시 에러를 LLM에 전달해 자연스러운 안내 메시지 생성
                logger.exception("도구 실패 %s: %s", tool_name, e)
                tool_result = {"error": f"도구 실행 실패: {str(e)}"}

            messages.append({
                "role": "tool",
                "tool_call_id": tool_call.id,
                "content": json.dumps(tool_result, ensure_ascii=False),
            })

    # ── MAX_TOOL_ITERATIONS 초과 시 tools 없이 최종 응답 강제 요청 ──
    try:
        final_response = client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=messages,
            temperature=0.7,
        )
        reply = final_response.choices[0].message.content or "응답을 생성하지 못했습니다."
    except Exception:
        reply = "요청 처리 중 문제가 발생했습니다. 다시 시도해주세요."

    return {
        "reply": reply,
        "actions_taken": actions_taken,
        "data": accumulated_data,
    }
