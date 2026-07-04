"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  generateWritingTask,
  evaluateWriting,
  type WritingTask,
  type WritingEvaluation,
} from "@/lib/api";
import TaskCard from "./TaskCard";
import WritingFeedback from "./WritingFeedback";
import type { Segment } from "@/types";

interface Props {
  segments: Segment[];
  videoId: number;
  player: any;
}

type WritePhase = "loading" | "writing" | "submitting" | "result";

const MIN_DURATION = 1;

export default function WriteMode({ segments, videoId, player }: Props) {
  const validSegments = segments.filter(
    (s) => s.end_sec - s.start_sec >= MIN_DURATION && s.text.trim()
  );

  const [currentIndex, setCurrentIndex] = useState(0);
  const [phase, setPhase] = useState<WritePhase>("loading");
  const [task, setTask] = useState<WritingTask | null>(null);
  const [evaluation, setEvaluation] = useState<WritingEvaluation | null>(null);
  const [userSentence, setUserSentence] = useState("");
  const [error, setError] = useState<string | null>(null);

  const currentSegment = validSegments[currentIndex];

  const loadTask = useCallback(async (segmentId: number) => {
    setPhase("loading");
    setTask(null);
    setEvaluation(null);
    setUserSentence("");
    setError(null);
    try {
      const newTask = await generateWritingTask(segmentId);
      setTask(newTask);
      setPhase("writing");
    } catch (e) {
      setError(e instanceof Error ? e.message : "과제 생성에 실패했습니다");
      setPhase("writing");
    }
  }, []);

  useEffect(() => {
    if (currentSegment) loadTask(currentSegment.id);
  }, [currentSegment, loadTask]);

  function handleListen() {
    if (!player || !currentSegment) return;
    player.seekTo(currentSegment.start_sec);
    player.playVideo();
    const ms = (currentSegment.end_sec - currentSegment.start_sec + 0.3) * 1000;
    setTimeout(() => player.pauseVideo(), ms);
  }

  async function handleSubmit() {
    if (!userSentence.trim() || !task) return;
    setPhase("submitting");
    setError(null);
    try {
      const result = await evaluateWriting(task.task_id, userSentence);
      setEvaluation(result);
      setPhase("result");
    } catch (e) {
      setError(e instanceof Error ? e.message : "평가에 실패했습니다");
      setPhase("writing");
    }
  }

  function handleRetry() {
    setEvaluation(null);
    setUserSentence("");
    setPhase("writing");
  }

  function handleNext() {
    if (currentIndex < validSegments.length - 1) setCurrentIndex((i) => i + 1);
  }

  function handlePrev() {
    if (currentIndex > 0) setCurrentIndex((i) => i - 1);
  }

  if (validSegments.length === 0) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <p className="text-4xl mb-3">✍️</p>
        <p className="text-sm">학습 가능한 세그먼트가 없습니다.</p>
      </div>
    );
  }

  const progress = Math.round(((currentIndex + 1) / validSegments.length) * 100);

  return (
    <div className="space-y-5">
      {/* ── 진행률 + 네비게이션 ── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-bold text-foreground">
            <span className="text-primary tabular-nums">{currentIndex + 1}</span>
            <span className="text-muted-foreground"> / {validSegments.length}</span>
            <span className="ml-2 text-xs font-normal text-muted-foreground">문장</span>
          </p>
          <div className="flex gap-1.5">
            <button
              onClick={handlePrev}
              disabled={currentIndex === 0}
              className="h-9 px-3 rounded-lg bg-secondary hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed text-xs font-bold text-foreground transition-colors"
            >
              ← 이전
            </button>
            <button
              onClick={handleNext}
              disabled={currentIndex === validSegments.length - 1}
              className="h-9 px-3 rounded-lg bg-secondary hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed text-xs font-bold text-foreground transition-colors"
            >
              다음 →
            </button>
          </div>
        </div>
        <div className="h-2 bg-secondary rounded-full overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all duration-500 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* ── 원문 자막 ── */}
      <div className="surface p-5 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-bold text-muted-foreground tracking-wide">
            STEP 1 · 원문 확인
          </p>
          <button
            onClick={handleListen}
            disabled={!player}
            className="text-xs font-bold text-primary hover:text-primary/80 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
          >
            🔊 원어민 듣기
          </button>
        </div>
        <p className="text-base lg:text-lg font-bold text-foreground leading-relaxed">
          {currentSegment.text}
        </p>
      </div>

      {/* ── 과제 생성 중 ── */}
      {phase === "loading" && (
        <div className="surface p-10 flex flex-col items-center gap-4">
          <div className="relative w-12 h-12">
            <div className="absolute inset-0 rounded-full border-4 border-secondary" />
            <div className="absolute inset-0 rounded-full border-4 border-primary border-t-transparent animate-spin" />
          </div>
          <div className="text-center space-y-1">
            <p className="text-sm font-bold text-foreground">과제 생성 중...</p>
            <p className="text-xs text-muted-foreground">AI 가 핵심 표현을 추출하고 있어요</p>
          </div>
        </div>
      )}

      {/* ── 에러 메시지 ── */}
      {error && (
        <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-sm font-bold text-destructive text-center">
          {error}
        </div>
      )}

      {/* ── 과제 카드 ── */}
      {task && phase !== "loading" && <TaskCard task={task} />}

      {/* ── 문장 작성 ── */}
      {(phase === "writing" || phase === "submitting") && task && (
        <div className="surface p-5 space-y-3">
          <p className="text-[11px] font-bold text-muted-foreground tracking-wide">
            STEP 3 · 영어 문장 작성
          </p>
          <Textarea
            placeholder="핵심 표현을 사용해서 영어 문장을 작성해보세요"
            rows={3}
            value={userSentence}
            onChange={(e) => setUserSentence(e.target.value)}
            disabled={phase === "submitting"}
            className="resize-none text-base bg-secondary border-transparent focus-visible:bg-card focus-visible:border-primary rounded-xl px-4 py-3"
          />
          <Button
            onClick={handleSubmit}
            disabled={phase === "submitting" || !userSentence.trim()}
            className="w-full h-12 bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-base rounded-xl"
          >
            {phase === "submitting" ? "AI 평가 중..." : "제출하기"}
          </Button>
        </div>
      )}

      {/* ── 평가 결과 ── */}
      {phase === "result" && evaluation && (
        <>
          <WritingFeedback evaluation={evaluation} userSentence={userSentence} />
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              onClick={handleRetry}
              className="h-12 font-bold text-base rounded-xl border-border bg-card hover:bg-secondary"
            >
              다시 써보기
            </Button>
            <Button
              onClick={handleNext}
              disabled={currentIndex === validSegments.length - 1}
              className="h-12 bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-base rounded-xl disabled:bg-primary/30"
            >
              다음 문장 →
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
