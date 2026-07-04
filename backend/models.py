# models.py — SQLAlchemy ORM 모델 정의. 각 클래스가 DB 테이블에 대응.

from datetime import datetime
from sqlalchemy import Column, Integer, String, Float, ForeignKey, DateTime, Text
from sqlalchemy.orm import relationship

from database import Base


class Video(Base):
    """유튜브 영상 정보 테이블."""
    __tablename__ = "videos"

    id = Column(Integer, primary_key=True, index=True)
    youtube_id = Column(String, unique=True, nullable=False, index=True)
    title = Column(String, nullable=False)
    # API 키 미설정/호출 실패 시 폴백을 허용하기 위해 nullable=True
    channel = Column(String, nullable=True)
    description = Column(Text, nullable=True)
    thumbnail_url = Column(String, nullable=True)
    duration_sec = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    # cascade="all, delete-orphan": 영상 삭제 시 관련 자막/로그도 함께 자동 삭제
    transcripts = relationship("Transcript", back_populates="video", cascade="all, delete-orphan")
    study_logs = relationship("StudyLog", back_populates="video", cascade="all, delete-orphan")


class Transcript(Base):
    """자막 세그먼트 테이블. Listen/Speak/Write 학습의 기본 단위."""
    __tablename__ = "transcripts"

    id = Column(Integer, primary_key=True, index=True)
    video_id = Column(Integer, ForeignKey("videos.id"), nullable=False)
    start_sec = Column(Float, nullable=False)
    end_sec = Column(Float, nullable=False)
    text = Column(Text, nullable=False)

    video = relationship("Video", back_populates="transcripts")
    study_logs = relationship("StudyLog", back_populates="segment")
    writing_tasks = relationship("WritingTask", back_populates="segment")
    bookmarks = relationship("Bookmark", back_populates="segment")


class StudyLog(Base):
    """학습 기록 테이블. Listen/Speak/Write 완료 시마다 1건 추가."""
    __tablename__ = "study_logs"

    id = Column(Integer, primary_key=True, index=True)
    video_id = Column(Integer, ForeignKey("videos.id"), nullable=False)
    segment_id = Column(Integer, ForeignKey("transcripts.id"), nullable=True)
    mode = Column(String, nullable=False)     # "listen" / "speak" / "write"
    score = Column(Float, nullable=True)      # 0~100 점수 (채점 안 된 경우 NULL)
    created_at = Column(DateTime, default=datetime.utcnow)

    video = relationship("Video", back_populates="study_logs")
    segment = relationship("Transcript", back_populates="study_logs")


class WritingTask(Base):
    """응용 작문 과제 테이블. 세그먼트당 1회 생성 후 재활용 (API 비용 절감)."""
    __tablename__ = "writing_tasks"

    id = Column(Integer, primary_key=True, index=True)
    segment_id = Column(Integer, ForeignKey("transcripts.id"), nullable=False)
    target_expression = Column(String, nullable=False)
    pattern_explanation = Column(Text, nullable=False)
    task_prompt = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    segment = relationship("Transcript", back_populates="writing_tasks")


class UserPreference(Base):
    """학습자 프로필을 key-value 형태로 저장. Agent가 레벨/관심사/목표 기억에 사용."""
    __tablename__ = "user_preferences"

    id = Column(Integer, primary_key=True, index=True)
    key = Column(String, unique=True, nullable=False)
    value = Column(Text, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Bookmark(Base):
    """중요 표현 북마크 테이블."""
    __tablename__ = "bookmarks"

    id = Column(Integer, primary_key=True, index=True)
    segment_id = Column(Integer, ForeignKey("transcripts.id"), nullable=False)
    note = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    segment = relationship("Transcript", back_populates="bookmarks")
