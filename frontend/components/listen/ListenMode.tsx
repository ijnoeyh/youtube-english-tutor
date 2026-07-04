"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { compareTexts, type CompareResult } from "@/utils/textCompare";
import { postStudyLog } from "@/lib/api";
import type { Segment } from "@/types";

interface Props {
  segments: Segment[];
  videoId: number;
  player: any;
}

type ListenMode = "typing" | "result";

export default function ListenMode({ segments, videoId, player }: Props) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [mode, setMode] = useState<ListenMode>("typing");
  const [input, setInput] = useState("");
  const [result, setResult] = useState<CompareResult | null>(null);
  const [showCaption, setShowCaption] = useState(false);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // 폴링 콜백이 항상 최신 end_sec을 읽도록 ref로 관리 (오래된 클로저 방지)
  const stopAtRef = useRef<number | null>(null);
  const current = segments[currentIndex];

  function stopInterval() {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    stopAtRef.current = null;
  }

  useEffect(() => {
    return () => stopInterval();
  }, [currentIndex]);

  function playSegment(rate = 1) {
    if (!player || !current) return;
    stopInterval();
    stopAtRef.current = current.end_sec;
    player.setPlaybackRate(rate);
    player.seekTo(current.start_sec, true);
    player.playVideo();
    intervalRef.current = setInterval(() => {
      const endSec = stopAtRef.current;
      if (endSec == null) return;
      // getCurrentTime이 과도기 상태에서 비정상 값을 반환할 수 있어 방어적으로 처리
      const t = typeof player.getCurrentTime === "function" ? player.getCurrentTime() : NaN;
      if (typeof t === "number" && !Number.isNaN(t) && t >= endSec) {
        player.pauseVideo();
        stopInterval();
      }
    }, 100);
  }

  async function handleCheck() {
    if (!input.trim()) return;
    const compareResult = compareTexts(current.text, input);
    setResult(compareResult);
    setMode("result");
    try {
      await postStudyLog({
        video_id: videoId,
        segment_id: current.id,
        mode: "listen",
        score: compareResult.score,
      });
    } catch {}
  }

  function handleNext() {
    if (currentIndex < segments.length - 1) {
      setCurrentIndex((i) => i + 1);
      setMode("typing");
      setInput("");
      setResult(null);
      setShowCaption(false);
    }
  }

  function handleRetry() {
    setMode("typing");
    setInput("");
    setResult(null);
  }

  if (!current) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <p className="text-4xl mb-3">📭</p>
        <p className="text-sm">학습할 세그먼트가 없습니다.</p>
      </div>
    );
  }

  const progress = Math.round(((currentIndex + 1) / segments.length) * 100);
  const scoreColor =
    result == null
      ? ""
      : result.score >= 80
      ? "text-primary"
      : result.score >= 50
      ? "text-amber-500"
      : "text-destructive";

  return (
    <div className="space-y-5">
      {/* ── 상단: 진행률 ── */}
      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <p className="text-sm font-bold text-foreground">
            <span className="text-primary tabular-nums">{currentIndex + 1}</span>
            <span className="text-muted-foreground"> / {segments.length}</span>
            <span className="ml-2 text-xs font-normal text-muted-foreground">문장</span>
          </p>
          <span className="text-xs font-bold tabular-nums text-muted-foreground">
            {progress}%
          </span>
        </div>
        <div className="h-2 bg-secondary rounded-full overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all duration-500 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* ── 재생 제어 ── */}
      <div className="surface p-4 space-y-3">
        <p className="text-[11px] font-bold text-muted-foreground tracking-wide">
          STEP 1 · 듣기
        </p>
        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={() => playSegment(1)}
            disabled={!player}
            className="h-12 rounded-xl bg-secondary hover:bg-accent disabled:opacity-40 transition-colors flex flex-col items-center justify-center gap-0.5 group"
          >
            <span className="text-lg leading-none">🔁</span>
            <span className="text-[11px] font-bold text-foreground">다시 듣기</span>
          </button>
          <button
            onClick={() => playSegment(0.75)}
            disabled={!player}
            className="h-12 rounded-xl bg-secondary hover:bg-accent disabled:opacity-40 transition-colors flex flex-col items-center justify-center gap-0.5 group"
          >
            <span className="text-lg leading-none">🐢</span>
            <span className="text-[11px] font-bold text-foreground">천천히</span>
          </button>
          <button
            onClick={() => setShowCaption((v) => !v)}
            className={`h-12 rounded-xl transition-colors flex flex-col items-center justify-center gap-0.5 ${
              showCaption
                ? "bg-primary text-primary-foreground"
                : "bg-secondary hover:bg-accent text-foreground"
            }`}
          >
            <span className="text-lg leading-none">📝</span>
            <span className="text-[11px] font-bold">
              자막 {showCaption ? "숨김" : "보기"}
            </span>
          </button>
        </div>

        {showCaption && (
          <div className="p-3 rounded-xl bg-accent text-sm text-accent-foreground leading-relaxed border border-primary/15 animate-[fade-in_0.2s_ease-out]">
            {current.text}
          </div>
        )}
      </div>

      {/* ── 입력 영역 ── */}
      {mode === "typing" && (
        <div className="surface p-4 space-y-3">
          <p className="text-[11px] font-bold text-muted-foreground tracking-wide">
            STEP 2 · 받아쓰기
          </p>
          <Textarea
            placeholder="들은 문장을 영어로 입력하세요"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleCheck();
              }
            }}
            rows={3}
            className="resize-none text-base bg-secondary border-transparent focus-visible:bg-card focus-visible:border-primary rounded-xl px-4 py-3"
          />
          <p className="text-[11px] text-muted-foreground">
            Enter 로 제출 · Shift + Enter 로 줄바꿈
          </p>
          <Button
            onClick={handleCheck}
            disabled={!input.trim()}
            className="w-full h-12 bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-base rounded-xl"
          >
            정답 확인
          </Button>
        </div>
      )}

      {/* ── 결과 영역 ── */}
      {mode === "result" && result && (
        <>
          {/* 점수 카드 */}
          <div className="surface-strong p-6 text-center">
            <p className="text-[11px] font-bold text-muted-foreground tracking-wide mb-2">
              점수
            </p>
            <div className="flex items-baseline justify-center gap-2">
              <span className={`text-6xl font-bold tabular-nums ${scoreColor}`}>
                {result.score}
              </span>
              <span className="text-2xl font-bold text-muted-foreground">점</span>
            </div>
            <p className="text-sm text-muted-foreground mt-2">
              <span className="font-bold text-foreground">{result.matched}</span>
              <span> / </span>
              <span>{result.total}</span>
              <span className="ml-1">단어 일치</span>
            </p>
          </div>

          {/* 정답 단어별 색상 표시 */}
          <div className="surface p-4 space-y-2">
            <p className="text-[11px] font-bold text-muted-foreground tracking-wide">
              정답 문장
            </p>
            <div className="flex flex-wrap gap-1.5">
              {result.wordResults.map((w, i) => (
                <span
                  key={i}
                  className={`text-sm px-2 py-1 rounded-lg font-bold ${
                    w.status === "correct"
                      ? "bg-primary/10 text-primary"
                      : w.status === "wrong"
                      ? "bg-destructive/10 text-destructive"
                      : "bg-secondary text-muted-foreground line-through"
                  }`}
                >
                  {w.word}
                </span>
              ))}
            </div>
            <div className="flex gap-3 pt-1 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-primary" /> 정답
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-destructive" /> 오답
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-muted-foreground/60" /> 누락
              </span>
            </div>
          </div>

          {/* 내 입력 */}
          <div className="surface p-4 space-y-2">
            <p className="text-[11px] font-bold text-muted-foreground tracking-wide">
              내가 쓴 문장
            </p>
            <p className="text-sm text-foreground leading-relaxed">{input}</p>
          </div>

          {/* 액션 버튼 */}
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              onClick={handleRetry}
              className="h-12 font-bold text-base rounded-xl border-border bg-card hover:bg-secondary"
            >
              다시 해보기
            </Button>
            {currentIndex < segments.length - 1 ? (
              <Button
                onClick={handleNext}
                className="h-12 bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-base rounded-xl"
              >
                다음 문장 →
              </Button>
            ) : (
              <Button
                disabled
                className="h-12 bg-primary/30 text-primary-foreground font-bold text-base rounded-xl"
              >
                🎉 완료!
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
