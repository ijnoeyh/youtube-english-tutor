# database.py — SQLAlchemy DB 연결 설정. engine, SessionLocal, Base, get_db 제공.

import os

from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

# DATABASE_URL 환경변수로 DB 경로/종류 변경 가능 (기본: SQLite)
SQLALCHEMY_DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./app.db")

# SQLite는 멀티스레드 제한이 있어 FastAPI 사용 시 check_same_thread=False 필요
connect_args = {"check_same_thread": False} if SQLALCHEMY_DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args=connect_args,
)

# autocommit=False: 명시적 db.commit() 필요. autoflush=False: 성능 최적화.
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db():
    """요청마다 DB 세션을 생성하고 완료 후 닫는 FastAPI 의존성 함수."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
