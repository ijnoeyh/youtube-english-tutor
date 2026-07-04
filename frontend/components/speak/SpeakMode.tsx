"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { evaluateShadowing, type ShadowingResult } from "@/lib/api";
import { AudioRecorder } from "@/utils/audioRecorder";
import { speak, stopSpeaking } from "@/utils/tts";
import type { Segment } from "@/types";

interface Props {
  segments: Segment[];
  videoId: number;
  player: any;
}

type SpeakPhase = "ready" | "recording" | "evaluating" | "result";

export default function SpeakMode({ segments, videoId, player }: Props) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [phase, setPhase] = useState<SpeakPhase>("ready");
  const [result, setResult] = useState<ShadowingResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [elapsedSec, setElapsedSec] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recorderRef = useRef<AudioRecorder>(new AudioRecorder());

  // 폴링 콜백이 항상 최신 end_sec을 읽도록 ref로 관리 (오래된 클로저 방지)
  const playIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopAtRef = useRef<number | null>(null);

  const current = segments[currentIndex];

  function stopPlayInterval() {
    if (playIntervalRef.current !== null) {
      clearInterval(playIntervalRef.current);
      playIntervalRef.current = null;
    }
    stopAtRef.current = null;
  }

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      stopPlayInterval();
      stopSpeaking();
    };
  }, []);

  useEffect(() => {
    setElapsedSec(0);
    stopPlayInterval();
  }, [currentIndex]);

  function handleListenNative() {
    if (!player || !current) return;
    stopPlayInterval();
    stopAtRef.current = current.end_sec;
    player.seekTo(current.start_sec, true);
    player.playVideo();
    playIntervalRef.current = setInterval(() => {
      const endSec = stopAtRef.current;
      if (endSec == null) return;
      // getCurrentTime이 과도기 상태에서 비정상 값을 반환할 수 있어 방어적으로 처리
      const t = typeof player.getCurrentTime === "function" ? player.getCurrentTime() : NaN;
      if (typeof t === "number" && !Number.isNaN(t) && t >= endSec) {
        player.pauseVideo();
        stopPlayInterval();
      }
    }, 100);
  }

  async function handleStartRecording() {
    setError(null);
    try {
      await recorderRef.current.startRecording();
      setPhase("recording");
      setElapsedSec(0);
      timerRef.current = setInterval(() => {
        setElapsedSec((s) => s + 1);
      }, 1000);
    } catch {
      setError("마이크 접근 권한이 필요합니다. 브라우저 설정에서 마이크를 허용해주세요.");
    }
  }

  async function handleStopRecording() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setPhase("evaluating");
    try {
      const audioBlob = await recorderRef.current.stopRecording();
      const evalResult = await evaluateShadowing(audioBlob, current.id);
      setResult(evalResult);
      setPhase("result");
    } catch (e) {
      setError(e instanceof Error ? e.message : "평가 중 오류가 발생했습니다");
      setPhase("ready");
    }
  }

  function handleRetry() {
    setPhase("ready");
    setResult(null);
    setError(null);
  }

  function handleNext() {
    if (currentIndex < segments.length - 1) {
      setCurrentIndex((i) => i + 1);
      setPhase("ready");
      setResult(null);
      setError(null);
    }
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
      {/* ── 진행률 ── */}
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

      {/* ── 자막 카드 ── */}
      <div className="surface p-5 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-bold text-muted-foreground tracking-wide">
            STEP 1 · 따라 말할 문장
          </p>
          <button
            onClick={handleListenNative}
            disabled={!player || phase === "recording" || phase === "evaluating"}
            className="text-xs font-bold text-primary hover:text-primary/80 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
          >
            🔊 원어민 듣기
          </button>
        </div>
        <p className="text-base lg:text-lg font-bold text-foreground leading-relaxed">
          {current.text}
        </p>
      </div>

      {/* ── 에러 메시지 ── */}
      {error && (
        <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-sm font-bold text-destructive">
          {error}
        </div>
      )}

      {/* ── 상태별 UI ── */}

      {/* ready: 녹음 시작 */}
      {phase === "ready" && (
        <button
          onClick={handleStartRecording}
          className="group w-full h-28 rounded-2xl bg-card border-2 border-dashed border-border hover:border-primary hover:bg-accent transition-all flex flex-col items-center justify-center gap-2"
        >
          <div className="w-12 h-12 rounded-full bg-secondary group-hover:bg-primary group-hover:text-primary-foreground transition-colors grid place-items-center text-xl">
            🎙
          </div>
          <span className="text-sm font-bold text-foreground">녹음 시작하기</span>
        </button>
      )}

      {/* recording: 녹음 중 */}
      {phase === "recording" && (
        <div className="space-y-3">
          <div className="surface p-5 flex items-center justify-between border-destructive/30">
            <div className="flex items-center gap-3">
              <span className="relative flex w-3 h-3">
                <span className="absolute inset-0 rounded-full bg-destructive animate-ping opacity-75" />
                <span className="relative inline-flex rounded-full w-3 h-3 bg-destructive" />
              </span>
              <span className="text-sm font-bold text-destructive">녹음 중</span>
            </div>
            <span className="text-base font-bold tabular-nums text-foreground">
              {String(Math.floor(elapsedSec / 60)).padStart(2, "0")}:
              {String(elapsedSec % 60).padStart(2, "0")}
            </span>
          </div>
          <Button
            onClick={handleStopRecording}
            className="w-full h-12 bg-destructive hover:bg-destructive/90 text-white font-bold text-base rounded-xl"
          >
            ⏹ 녹음 완료
          </Button>
        </div>
      )}

      {/* evaluating: 분석 중 */}
      {phase === "evaluating" && (
        <div className="surface p-10 flex flex-col items-center gap-4">
          <div className="relative w-12 h-12">
            <div className="absolute inset-0 rounded-full border-4 border-secondary" />
            <div className="absolute inset-0 rounded-full border-4 border-primary border-t-transparent animate-spin" />
          </div>
          <div className="text-center space-y-1">
            <p className="text-sm font-bold text-foreground">분석 중...</p>
            <p className="text-xs text-muted-foreground">Groq Whisper 로 발음을 평가하고 있어요</p>
          </div>
        </div>
      )}

      {/* result: 결과 */}
      {phase === "result" && result && (
        <>
          {/* 점수 카드 */}
          <div className="surface-strong p-6 text-center">
            <p className="text-[11px] font-bold text-muted-foreground tracking-wide mb-2">
              발음 점수
            </p>
            <div className="flex items-baseline justify-center gap-2">
              <span className={`text-6xl font-bold tabular-nums ${scoreColor}`}>
                {result.score}
              </span>
              <span className="text-2xl font-bold text-muted-foreground">점</span>
            </div>
            <p className="text-sm text-muted-foreground mt-3 leading-relaxed">
              {result.feedback}
            </p>
          </div>

          {/* 단어별 비교 */}
          <div className="surface p-4 space-y-2">
            <p className="text-[11px] font-bold text-muted-foreground tracking-wide">
              단어별 비교 (정답 기준)
            </p>
            <div className="flex flex-wrap gap-1.5">
              {result.word_results.map((w, i) => (
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

          {/* 인식된 발음 */}
          <div className="surface p-4 space-y-2">
            <p className="text-[11px] font-bold text-muted-foreground tracking-wide">
              인식된 내 발음
            </p>
            <p className="text-sm text-foreground leading-relaxed">
              {result.recognized_text || (
                <span className="text-muted-foreground italic">인식된 텍스트 없음</span>
              )}
            </p>
          </div>

          {/* TTS 버튼 */}
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => speak(result.original_text)}
              className="h-11 rounded-xl bg-secondary hover:bg-accent transition-colors flex items-center justify-center gap-1.5 text-sm font-bold text-foreground"
            >
              🔈 정답 듣기
            </button>
            <button
              onClick={stopSpeaking}
              className="h-11 rounded-xl bg-secondary hover:bg-accent transition-colors flex items-center justify-center gap-1.5 text-sm font-bold text-foreground"
            >
              ⏹ 정지
            </button>
          </div>

          {/* 액션 */}
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
