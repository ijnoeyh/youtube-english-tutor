"use client";

import { useEffect, useState } from "react";
import { getDashboardStats, STUDYLOG_SAVED_EVENT, type DashboardStats } from "@/lib/api";

const MODE_META = [
  { key: "listen", label: "Listen", icon: "🎧" },
  { key: "speak", label: "Speak", icon: "🎤" },
  { key: "write", label: "Write", icon: "✍️" },
] as const;

function scoreColor(score: number | null): string {
  if (score == null) return "text-muted-foreground";
  if (score >= 80) return "text-primary";
  if (score >= 50) return "text-amber-500";
  return "text-destructive";
}

export default function DashboardSection() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;

    getDashboardStats()
      .then((s) => alive && setStats(s))
      .catch(() => alive && setError(true))
      .finally(() => alive && setLoading(false));

    // 학습 완료 시 스켈레톤 없이 조용히 갱신 (깜빡임 방지)
    const onSaved = () => {
      getDashboardStats()
        .then((s) => alive && setStats(s))
        .catch(() => {});
    };
    window.addEventListener(STUDYLOG_SAVED_EVENT, onSaved);

    return () => {
      alive = false;
      window.removeEventListener(STUDYLOG_SAVED_EVENT, onSaved);
    };
  }, []);

  if (loading) {
    return (
      <div className="surface p-5 animate-pulse">
        <div className="h-4 w-24 bg-secondary rounded mb-4" />
        <div className="grid grid-cols-3 gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-20 bg-secondary rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !stats) return null;

  if (stats.totals.sessions === 0) {
    return (
      <div className="surface-strong p-6 text-center space-y-2">
        <p className="text-3xl">🌱</p>
        <p className="text-sm font-bold text-foreground">아직 학습 기록이 없어요</p>
        <p className="text-xs text-muted-foreground">
          영상을 골라 첫 학습을 시작하면 여기에 진행 상황이 쌓입니다.
        </p>
      </div>
    );
  }

  const maxDaily = Math.max(1, ...stats.daily.map((d) => d.count));
  const todayStr = stats.daily[stats.daily.length - 1]?.date;

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between px-1">
        <h2 className="text-base font-bold text-foreground tracking-tight">📊 학습 현황</h2>
        <span className="text-[11px] text-muted-foreground">최근 14일</span>
      </div>

      {/* ── 연속 학습일(streak) + 총계 ── */}
      <div className="grid grid-cols-2 gap-3">
        {/* streak hero */}
        <div className="surface-strong p-4 flex flex-col justify-center">
          <p className="text-[11px] font-bold text-muted-foreground tracking-wide mb-1">
            연속 학습
          </p>
          <div className="flex items-baseline gap-1.5">
            <span className="text-4xl leading-none">🔥</span>
            <span className="text-4xl font-bold tabular-nums text-foreground">
              {stats.streak.current}
            </span>
            <span className="text-base font-bold text-muted-foreground">일</span>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1.5">
            최장 기록 <span className="font-bold text-foreground">{stats.streak.longest}</span>일
          </p>
        </div>

        {/* totals 2x2 */}
        <div className="grid grid-cols-1 gap-3">
          <div className="surface p-3 flex items-center justify-between">
            <span className="text-[11px] font-bold text-muted-foreground">총 학습</span>
            <span className="text-xl font-bold tabular-nums text-foreground">
              {stats.totals.sessions}
              <span className="text-xs font-normal text-muted-foreground ml-0.5">회</span>
            </span>
          </div>
          <div className="surface p-3 flex items-center justify-between">
            <span className="text-[11px] font-bold text-muted-foreground">영상 · 문장</span>
            <span className="text-xl font-bold tabular-nums text-foreground">
              {stats.totals.videos}
              <span className="text-xs font-normal text-muted-foreground mx-0.5">·</span>
              {stats.totals.sentences}
            </span>
          </div>
        </div>
      </div>

      {/* ── 모드별 횟수 + 평균 점수 ── */}
      <div className="grid grid-cols-3 gap-3">
        {MODE_META.map((m) => {
          const stat = stats.by_mode[m.key];
          return (
            <div key={m.key} className="surface p-3 text-center">
              <p className="text-lg leading-none mb-1">{m.icon}</p>
              <p className="text-[11px] font-bold text-muted-foreground">{m.label}</p>
              <p className={`text-2xl font-bold tabular-nums mt-1 ${scoreColor(stat.avg_score)}`}>
                {stat.avg_score == null ? "–" : stat.avg_score}
              </p>
              <p className="text-[10px] text-muted-foreground">
                평균 · {stat.count}회
              </p>
            </div>
          );
        })}
      </div>

      {/* ── 일별 활동 막대 ── */}
      <div className="surface p-4">
        <p className="text-[11px] font-bold text-muted-foreground tracking-wide mb-3">
          일별 학습량
        </p>
        <div className="flex items-end justify-between gap-1">
          {stats.daily.map((d) => {
            const isToday = d.date === todayStr;
            // 픽셀 고정 높이(트랙 h-20 = 80px). %는 부모 높이 확정 전엔 안 그려질 수 있어 px 사용.
            const barPx = d.count === 0 ? 4 : Math.round(10 + (d.count / maxDaily) * 66);
            return (
              <div key={d.date} className="flex-1 flex flex-col items-center gap-1 group">
                <div className="relative w-full flex items-end justify-center h-20">
                  <div
                    className={`w-full max-w-[14px] rounded-md transition-all ${
                      d.count === 0
                        ? "bg-secondary"
                        : isToday
                        ? "bg-primary"
                        : "bg-primary opacity-60 group-hover:opacity-100"
                    }`}
                    style={{ height: `${barPx}px` }}
                    title={`${d.date} · ${d.count}회${d.avg_score != null ? ` · 평균 ${d.avg_score}점` : ""}`}
                  />
                </div>
                <span
                  className={`text-[9px] tabular-nums ${
                    isToday ? "font-bold text-primary" : "text-muted-foreground"
                  }`}
                >
                  {d.date.slice(8)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
