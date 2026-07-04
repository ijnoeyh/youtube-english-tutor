"use client";

import type { WritingEvaluation } from "@/lib/api";

interface Props {
  evaluation: WritingEvaluation;
  userSentence: string;
}

export default function WritingFeedback({ evaluation, userSentence }: Props) {
  const scoreColor =
    evaluation.score >= 80
      ? "text-primary"
      : evaluation.score >= 60
      ? "text-amber-500"
      : "text-destructive";

  const used = evaluation.used_expression_correctly;

  return (
    <div className="space-y-3">
      {/* 점수 카드 */}
      <div className="surface-strong p-6 text-center space-y-3">
        <p className="text-[11px] font-bold text-muted-foreground tracking-wide">
          평가 결과
        </p>
        <div className="flex items-baseline justify-center gap-2">
          <span className={`text-6xl font-bold tabular-nums ${scoreColor}`}>
            {evaluation.score}
          </span>
          <span className="text-2xl font-bold text-muted-foreground">점</span>
        </div>
        <div className="flex justify-center">
          <span
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ${
              used
                ? "bg-primary/10 text-primary"
                : "bg-destructive/10 text-destructive"
            }`}
          >
            {used ? "✓" : "✗"} {used ? "표현을 정확히 사용했어요" : "핵심 표현 미사용"}
          </span>
        </div>
      </div>

      {/* 내 문장 → 개선 문장 */}
      <div className="surface p-5 space-y-4">
        <div className="space-y-1.5">
          <p className="text-[11px] font-bold text-muted-foreground tracking-wide">
            내 문장
          </p>
          <p className="text-sm text-foreground leading-relaxed">
            {userSentence}
          </p>
        </div>
        <div className="h-px bg-border" />
        <div className="space-y-1.5">
          <p className="text-[11px] font-bold text-primary tracking-wide">
            ✨ 개선 문장
          </p>
          <p className="text-sm font-bold text-primary leading-relaxed">
            {evaluation.improved_sentence}
          </p>
        </div>
      </div>

      {/* 항목별 피드백 */}
      <div className="grid gap-2">
        <div className="surface p-4 space-y-1.5">
          <p className="text-[11px] font-bold text-muted-foreground tracking-wide">
            📘 문법
          </p>
          <p className="text-sm text-foreground leading-relaxed">
            {evaluation.grammar_feedback}
          </p>
        </div>
        <div className="surface p-4 space-y-1.5">
          <p className="text-[11px] font-bold text-muted-foreground tracking-wide">
            💬 자연스러움
          </p>
          <p className="text-sm text-foreground leading-relaxed">
            {evaluation.naturalness_feedback}
          </p>
        </div>
      </div>

      {/* 격려 메시지 */}
      <div className="text-center py-2">
        <p className="text-sm font-bold text-primary">
          {evaluation.encouragement}
        </p>
      </div>
    </div>
  );
}
