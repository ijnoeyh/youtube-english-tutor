# agent/tool_schemas.py
# Groq Tool Use에 전달할 도구 목록을 JSON Schema 형식으로 정의.

TOOL_SCHEMAS = [
    {
        "type": "function",
        "function": {
            "name": "search_youtube_videos",
            "description": "키워드로 YouTube 영상을 검색합니다. 먼저 등록된 영상을 찾고, 없으면 YouTube에서 실시간으로 검색합니다. 사용자가 영상을 찾거나 추천을 원할 때 사용하세요.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "검색 키워드 (예: 'business english', 'ted talk')"
                    }
                },
                "required": ["query"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "register_video",
            "description": "YouTube URL을 등록하고 자막을 추출합니다. 사용자가 새 영상을 추가하거나 학습하고 싶다고 할 때 사용하세요.",
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "YouTube 영상 URL (예: https://www.youtube.com/watch?v=...)"
                    }
                },
                "required": ["url"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_learning_history",
            "description": "사용자의 학습 이력과 통계를 조회합니다. 학습 현황, 진도, 약점 파악에 사용하세요. 추천이나 복습 계획 전에 먼저 호출하는 것이 좋습니다.",
            "parameters": {
                "type": "object",
                "properties": {
                    "days": {
                        "type": "integer",
                        "description": "최근 며칠치 데이터를 조회할지 (기본값: 7)"
                    }
                },
                "required": []
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "recommend_videos",
            "description": "학습 이력 기반으로 다음에 공부할 영상을 추천합니다. '오늘 뭐 공부할까', '영상 추천해줘' 같은 요청에 사용하세요.",
            "parameters": {
                "type": "object",
                "properties": {
                    "count": {
                        "type": "integer",
                        "description": "추천할 영상 수 (기본값: 3)"
                    }
                },
                "required": []
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "explain_grammar",
            "description": "문법 포인트나 영어 표현을 상세히 설명합니다. 사용자가 문법이나 표현을 물어볼 때 반드시 사용하세요.",
            "parameters": {
                "type": "object",
                "properties": {
                    "expression": {
                        "type": "string",
                        "description": "설명할 문법 표현 (예: 'would have p.p.', 'used to', 'have been -ing')"
                    },
                    "context": {
                        "type": "string",
                        "description": "표현이 사용된 문장이나 맥락 (선택사항, 있으면 더 정확한 설명 가능)"
                    }
                },
                "required": ["expression"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_review_plan",
            "description": "복습이 필요한 항목을 추천합니다. 간격 반복(spaced repetition) 원리로 복습 시기가 된 세그먼트를 찾아줍니다.",
            "parameters": {
                "type": "object",
                "properties": {},
                "required": []
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "manage_bookmark",
            "description": "중요한 표현을 북마크하거나 북마크 목록을 조회합니다. 표현 저장/조회/삭제에 사용하세요.",
            "parameters": {
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": ["add", "list", "remove"],
                        "description": "수행할 작업: 'add'=추가, 'list'=목록 조회, 'remove'=삭제"
                    },
                    "segment_id": {
                        "type": "integer",
                        "description": "북마크할 세그먼트 ID (add/remove 시 필요)"
                    },
                    "note": {
                        "type": "string",
                        "description": "북마크 메모 (선택사항)"
                    }
                },
                "required": ["action"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "update_preferences",
            "description": "학습자 프로필(레벨, 관심 주제, 학습 목표 등)을 업데이트합니다.",
            "parameters": {
                "type": "object",
                "properties": {
                    "key": {
                        "type": "string",
                        "description": "설정 키 (예: 'level', 'interests', 'goal', 'daily_goal_minutes')"
                    },
                    "value": {
                        "type": "string",
                        "description": "설정 값 (예: 'intermediate', 'business,travel', 'TOEIC 900점')"
                    }
                },
                "required": ["key", "value"]
            }
        }
    }
]
