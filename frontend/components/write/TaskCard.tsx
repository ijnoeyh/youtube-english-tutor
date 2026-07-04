"use client";

import type { WritingTask } from "@/lib/api";

interface Props {
  task: WritingTask;
}

export default function TaskCard({ task }: Props) {
  return (
    <div className="surface p-5 space-y-4">
      {/* 핵심 표현 */}
      <div className="space-y-2">
        <p className="text-[11px] font-bold text-muted-foreground tracking-wide">
          STEP 2 · 핵심 표현
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <span className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-bold tracking-tight">
            {task.target_expression}
          </span>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          {task.pattern_explanation}
        </p>
      </div>

      {/* 과제 프롬프트 */}
      <div className="rounded-xl bg-accent p-4 border border-primary/15">
        <p className="text-[11px] font-bold text-primary tracking-wide mb-1.5">
          📝 작문 과제
        </p>
        <p className="text-sm text-accent-foreground leading-relaxed font-bold">
          {task.task_prompt}
        </p>
      </div>
    </div>
  );
}
