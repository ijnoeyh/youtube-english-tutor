# main.py — FastAPI 앱 진입점. DB 초기화, CORS, 라우터 등록.

import logging
import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

from database import engine, Base

load_dotenv()

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")

app = FastAPI(
    title="YouTube English Tutor API",
    description="유튜브 영상 기반 영어 학습 앱 백엔드 API",
    version="1.0.0"
)

# 허용할 프론트 origin을 환경변수에서 로드 (쉼표로 여러 개 지정 가능)
cors_origins = [
    origin.strip()
    for origin in os.getenv("CORS_ALLOW_ORIGINS", "http://localhost:3000").split(",")
    if origin.strip()
]
logger.info("CORS 허용 origin: %s", cors_origins)
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 앱 시작 시 DB 테이블 자동 생성
import models  # noqa: F401 — models 모듈 import해야 Base.metadata에 테이블 정보가 등록됨
Base.metadata.create_all(bind=engine)


from routers import videos as videos_router          # noqa: E402
from routers import study_logs as study_logs_router  # noqa: E402
from routers import shadowing as shadowing_router    # noqa: E402
from routers import writing as writing_router        # noqa: E402
from routers import agent as agent_router            # noqa: E402  ← 6단계: Agent 채팅
from routers import recommendations as recommendations_router  # noqa: E402  ← 메인 추천/관심사
from routers import stats as stats_router                # noqa: E402  ← 학습 대시보드 통계
app.include_router(videos_router.router, prefix="/api")
app.include_router(study_logs_router.router, prefix="/api")
app.include_router(shadowing_router.router, prefix="/api")
app.include_router(writing_router.router, prefix="/api")
app.include_router(agent_router.router, prefix="/api")
app.include_router(recommendations_router.router, prefix="/api")
app.include_router(stats_router.router, prefix="/api")


@app.get("/health")
def health_check():
    """서버 상태 확인 엔드포인트."""
    return {"status": "ok"}


@app.get("/")
def root():
    """루트 경로 기본 응답."""
    return {
        "message": "YouTube English Tutor API",
        "docs": "http://localhost:8000/docs"
    }
