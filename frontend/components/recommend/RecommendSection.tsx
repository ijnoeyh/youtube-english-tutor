"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getRecommendations,
  searchVideos,
  getInterests,
  setInterests,
  type RecommendItem,
} from "@/lib/api";

interface Props {
  onSelectVideo?: (videoId: number) => void;
  onStudyExternal?: (youtubeId: string) => Promise<void> | void;
}

const RESULT_COUNT = 20;

// 초 → "m:ss"
function fmtDuration(sec?: number | null): string | null {
  if (sec == null) return null;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function RecommendSection({ onSelectVideo, onStudyExternal }: Props) {
  const [keywords, setKeywords] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [activeKeyword, setActiveKeyword] = useState<string | null>(null);
  const [recs, setRecs] = useState<RecommendItem[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRecs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = activeKeyword
        ? await searchVideos(activeKeyword, RESULT_COUNT)
        : await getRecommendations(RESULT_COUNT);
      setRecs(data.items);
      setNotice(data.notice);
    } catch (e) {
      setError(e instanceof Error ? e.message : "추천을 불러오지 못했어요");
    } finally {
      setLoading(false);
    }
  }, [activeKeyword]);

  useEffect(() => {
    (async () => {
      try {
        const s = await getInterests();
        setKeywords(s ? s.split(",").map((k) => k.trim()).filter(Boolean) : []);
      } catch {
        /* 무시 */
      }
    })();
  }, []);

  useEffect(() => {
    loadRecs();
  }, [loadRecs]);

  async function persistKeywords(next: string[]) {
    setKeywords(next);
    try {
      await setInterests(next.join(","));
    } catch {
      /* 무시 */
    }
    if (!activeKeyword) loadRecs();
  }

  function addKeyword() {
    const k = draft.trim();
    if (!k || keywords.includes(k)) {
      setDraft("");
      return;
    }
    persistKeywords([...keywords, k]);
    setDraft("");
  }

  function removeKeyword(k: string) {
    if (activeKeyword === k) setActiveKeyword(null);
    persistKeywords(keywords.filter((x) => x !== k));
  }

  // 같은 칩을 다시 누르면 종합 추천으로 복귀
  function toggleKeyword(k: string) {
    setActiveKeyword((prev) => (prev === k ? null : k));
  }

  const localRecs = recs.filter((r) => r.source !== "youtube" && r.video_id != null);
  const newRecs = recs.filter((r) => r.source === "youtube" || r.video_id == null);

  return (
    <div className="surface p-6 space-y-5 animate-[fade-in_0.3s_ease-out]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-foreground">오늘 공부할 영상 추천 ✨</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {activeKeyword
              ? `'${activeKeyword}' 키워드 검색 결과`
              : "관심 키워드를 등록하면 그에 맞는 영상을 찾아드려요."}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={loadRecs} disabled={loading} className="shrink-0">
          {loading ? "불러오는 중..." : "↻ 새로고침"}
        </Button>
      </div>

      {/* ── 관심 키워드 칩 (클릭=검색 / ✕=삭제) ── */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {activeKeyword && (
            <button
              type="button"
              onClick={() => setActiveKeyword(null)}
              className="px-2.5 py-1 rounded-full bg-primary text-primary-foreground text-xs font-bold"
            >
              ← 전체 추천
            </button>
          )}
          {keywords.map((k) => {
            const active = activeKeyword === k;
            return (
              <span
                key={k}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                  active
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-foreground hover:bg-secondary/70"
                }`}
              >
                <button type="button" onClick={() => toggleKeyword(k)} className="cursor-pointer">
                  {k}
                </button>
                <button
                  type="button"
                  aria-label={`${k} 삭제`}
                  onClick={() => removeKeyword(k)}
                  className={`leading-none ${active ? "text-primary-foreground/80 hover:text-white" : "text-muted-foreground hover:text-destructive"}`}
                >
                  ✕
                </button>
              </span>
            );
          })}
          {keywords.length === 0 && (
            <span className="text-xs text-muted-foreground">
              아직 키워드가 없어요. 예: business english, travel, news
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <Input
            placeholder="관심 키워드 추가 (Enter)"
            className="bg-secondary border-transparent text-sm h-9"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addKeyword()}
          />
          <Button size="sm" onClick={addKeyword} disabled={!draft.trim()} className="h-9 px-4">
            추가
          </Button>
        </div>
      </div>

      {/* ── 안내 배너 (쿼터 초과 / 키 없음 등) ── */}
      {notice && (
        <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-500/10 border border-amber-500/25 text-amber-700 dark:text-amber-400">
          <span className="text-base leading-none mt-0.5">⚠️</span>
          <p className="text-xs leading-relaxed font-medium">{notice}</p>
        </div>
      )}

      {/* ── 추천 그리드 (저장된 영상 / 새로 발견한 영상 분리) ── */}
      {error ? (
        <p className="text-sm text-destructive font-medium">{error}</p>
      ) : loading && recs.length === 0 ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
          <span className="inline-block w-4 h-4 rounded-full border-2 border-muted-foreground/30 border-t-primary animate-spin" />
          추천 영상을 불러오는 중이에요…
        </div>
      ) : recs.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          추천할 영상을 찾지 못했어요. 키워드를 추가하거나 길이 필터를 바꿔보세요.
        </p>
      ) : (
        <div className="space-y-5">
          <RecommendGroup
            title="📚 내 라이브러리에서"
            subtitle="아직 학습하지 않았거나 복습하면 좋은 영상"
            items={localRecs}
            onSelectVideo={onSelectVideo}
            onStudyExternal={onStudyExternal}
          />
          <RecommendGroup
            title="✨ 새로 발견한 영상"
            subtitle="YouTube에서 찾아온 새 영상"
            items={newRecs}
            onSelectVideo={onSelectVideo}
            onStudyExternal={onStudyExternal}
          />
        </div>
      )}
    </div>
  );
}

function RecommendGroup({
  title,
  subtitle,
  items,
  onSelectVideo,
  onStudyExternal,
}: {
  title: string;
  subtitle: string;
  items: RecommendItem[];
  onSelectVideo?: (id: number) => void;
  onStudyExternal?: (youtubeId: string) => Promise<void> | void;
}) {
  if (items.length === 0) return null;
  return (
    <section className="space-y-2">
      <div className="flex items-baseline gap-2">
        <h3 className="text-sm font-bold text-foreground">{title}</h3>
        <span className="text-[11px] text-muted-foreground">{subtitle}</span>
        <span className="text-[11px] text-muted-foreground tabular-nums">· {items.length}개</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {items.map((item, i) => (
          <RecommendCard
            key={item.video_id ?? item.youtube_id ?? i}
            item={item}
            onSelectVideo={onSelectVideo}
            onStudyExternal={onStudyExternal}
          />
        ))}
      </div>
    </section>
  );
}

function RecommendCard({
  item,
  onSelectVideo,
  onStudyExternal,
}: {
  item: RecommendItem;
  onSelectVideo?: (id: number) => void;
  onStudyExternal?: (youtubeId: string) => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isExternal = item.source === "youtube" || item.video_id == null;

  async function handleExternal() {
    if (!onStudyExternal || !item.youtube_id) return;
    setBusy(true);
    setError(null);
    try {
      await onStudyExternal(item.youtube_id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "등록에 실패했어요");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-border surface overflow-hidden flex flex-col">
      <div className="relative aspect-video bg-secondary">
        {item.thumbnail_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.thumbnail_url} alt="" className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <div className="w-full h-full grid place-items-center text-3xl">📺</div>
        )}
        {isExternal && (
          <span className="absolute top-2 left-2 px-2 py-0.5 rounded-full text-[10px] font-bold bg-primary/90 text-primary-foreground">
            NEW
          </span>
        )}
        {fmtDuration(item.duration_sec) && (
          <span className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded text-[10px] font-bold bg-black/75 text-white tabular-nums">
            {fmtDuration(item.duration_sec)}
          </span>
        )}
      </div>
      <div className="p-3 flex flex-col gap-1.5 flex-1">
        <p className="text-sm font-bold text-foreground line-clamp-2 leading-snug">
          {item.title || item.youtube_id}
        </p>
        {item.channel && <p className="text-[11px] text-muted-foreground truncate">{item.channel}</p>}
        {item.reason && <p className="text-[11px] text-primary">{item.reason}</p>}

        <div className="mt-auto pt-1">
          {isExternal ? (
            <Button size="sm" className="w-full h-8 text-xs font-bold" disabled={busy} onClick={handleExternal}>
              {busy ? "등록 중..." : "등록하고 공부하기"}
            </Button>
          ) : (
            <Button
              size="sm"
              className="w-full h-8 text-xs font-bold"
              onClick={() => item.video_id != null && onSelectVideo?.(item.video_id)}
            >
              이 영상으로 공부하기
            </Button>
          )}
          {error && <p className="text-[11px] text-destructive mt-1">{error}</p>}
        </div>
      </div>
    </div>
  );
}
