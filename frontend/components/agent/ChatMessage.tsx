"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  actionsTaken?: string[];
  data?: Record<string, any>;
}

interface Props {
  message: ChatMessage;
  onSelectVideo?: (videoId: number) => void;
  onStudyExternal?: (youtubeId: string) => Promise<void> | void;
}

const MODE_LABEL: Record<string, string> = {
  listen: "🎧 듣기",
  speak: "🎤 말하기",
  write: "✍️ 작문",
};

function renderText(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={i}>{part.slice(2, -2)}</strong>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

export default function ChatMessageBubble({ message, onSelectVideo, onStudyExternal }: Props) {
  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="bg-blue-600 text-white rounded-2xl rounded-tr-none px-4 py-3 text-sm max-w-[280px] whitespace-pre-wrap">
          {message.content}
        </div>
      </div>
    );
  }

  const actions = message.actionsTaken ?? [];
  const data = message.data ?? {};

  return (
    <div className="flex gap-3">
      <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0 text-sm">
        🤖
      </div>
      <div className="flex-1 space-y-2 max-w-[280px]">
        {/* 텍스트 말풍선 */}
        <div className="bg-gray-100 rounded-2xl rounded-tl-none px-4 py-3 text-sm whitespace-pre-wrap leading-relaxed">
          {renderText(message.content)}
        </div>

        {/* ── 문법 설명 카드 ── */}
        {actions.includes("explain_grammar") && data.explain_grammar && !data.explain_grammar.error && (
          <GrammarCard data={data.explain_grammar} />
        )}

        {/* ── 영상 추천 카드 (local=바로 학습 / youtube=등록+학습) ── */}
        {actions.includes("recommend_videos") && data.recommend_videos?.recommendations?.length > 0 && (
          <VideoSuggestionCards
            items={data.recommend_videos.recommendations}
            onSelectVideo={onSelectVideo}
            onStudyExternal={onStudyExternal}
          />
        )}

        {/* ── 외부 YouTube 검색 결과 카드 (local_videos + youtube_videos 통합) ── */}
        {actions.includes("search_youtube_videos") && (() => {
          const sr = data.search_youtube_videos ?? {};
          const items = [...(sr.local_videos ?? []), ...(sr.youtube_videos ?? [])];
          return items.length > 0 ? (
            <VideoSuggestionCards
              items={items}
              onSelectVideo={onSelectVideo}
              onStudyExternal={onStudyExternal}
            />
          ) : null;
        })()}

        {/* ── 복습 계획 카드 ── */}
        {actions.includes("get_review_plan") && data.get_review_plan?.review_items?.length > 0 && (
          <ReviewPlanCards items={data.get_review_plan.review_items} />
        )}

        {/* ── 학습 통계 카드 ── */}
        {actions.includes("get_learning_history") && data.get_learning_history?.total_sessions > 0 && (
          <LearningStatsCard data={data.get_learning_history} />
        )}
      </div>
    </div>
  );
}

function GrammarCard({ data }: { data: any }) {
  return (
    <div className="bg-white border border-blue-100 rounded-xl p-3 space-y-2 text-xs">
      <p className="font-semibold text-blue-700">📚 {data.expression}</p>
      <p className="text-gray-600 leading-relaxed">{data.explanation_ko}</p>
      {data.usage_pattern && (
        <p className="bg-blue-50 rounded-lg p-2 font-mono text-blue-800">{data.usage_pattern}</p>
      )}
      {data.example_sentences?.slice(0, 2).map((ex: any, i: number) => (
        <div key={i} className="border-l-2 border-blue-200 pl-2">
          <p className="font-medium text-gray-800">{ex.en}</p>
          <p className="text-gray-500">{ex.ko}</p>
        </div>
      ))}
      {data.similar_expressions?.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-1">
          {data.similar_expressions.map((expr: string, i: number) => (
            <Badge key={i} variant="secondary" className="text-xs">{expr}</Badge>
          ))}
        </div>
      )}
    </div>
  );
}

function VideoSuggestionCards({
  items,
  onSelectVideo,
  onStudyExternal,
}: {
  items: any[];
  onSelectVideo?: (id: number) => void;
  onStudyExternal?: (youtubeId: string) => Promise<void> | void;
}) {
  return (
    <div className="space-y-2">
      {items.map((item: any, i: number) => (
        <SuggestionCard
          key={item.video_id ?? item.youtube_id ?? i}
          item={item}
          onSelectVideo={onSelectVideo}
          onStudyExternal={onStudyExternal}
        />
      ))}
    </div>
  );
}

function SuggestionCard({
  item,
  onSelectVideo,
  onStudyExternal,
}: {
  item: any;
  onSelectVideo?: (id: number) => void;
  onStudyExternal?: (youtubeId: string) => Promise<void> | void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isExternal = item.source === "youtube" || item.video_id == null;

  async function handleStudyExternal() {
    if (!onStudyExternal) return;
    setLoading(true);
    setError(null);
    try {
      await onStudyExternal(item.youtube_id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "등록에 실패했어요");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-white border rounded-xl p-3 space-y-1.5 text-xs">
      {item.thumbnail_url && (
        <img
          src={item.thumbnail_url}
          alt=""
          className="w-full h-24 object-cover rounded-lg"
          loading="lazy"
        />
      )}
      <p className="font-medium text-gray-800 line-clamp-2">{item.title || item.youtube_id}</p>
      {item.channel && <p className="text-gray-500">{item.channel}</p>}
      {item.reason && <p className="text-blue-600">{item.reason}</p>}

      {isExternal ? (
        <Button
          size="sm"
          className="w-full h-7 text-xs"
          disabled={loading}
          onClick={handleStudyExternal}
        >
          {loading ? "등록 중..." : "등록하고 공부하기"}
        </Button>
      ) : (
        <Button
          size="sm"
          className="w-full h-7 text-xs"
          onClick={() => onSelectVideo?.(item.video_id)}
        >
          이 영상으로 공부하기
        </Button>
      )}

      {error && <p className="text-red-500">{error}</p>}
    </div>
  );
}

function ReviewPlanCards({ items }: { items: any[] }) {
  return (
    <div className="space-y-2">
      {items.slice(0, 5).map((item: any) => (
        <div key={item.segment_id} className="bg-white border rounded-xl p-3 space-y-1 text-xs">
          <p className="text-gray-700 line-clamp-2 italic">"{item.text}"</p>
          <div className="flex items-center justify-between">
            <Badge variant="outline">{MODE_LABEL[item.mode] ?? item.mode}</Badge>
            {item.last_score != null && (
              <span className="text-gray-400">{Math.round(item.last_score)}점</span>
            )}
          </div>
          <p className="text-blue-600">{item.reason}</p>
        </div>
      ))}
    </div>
  );
}

function LearningStatsCard({ data }: { data: any }) {
  return (
    <div className="bg-white border rounded-xl p-3 space-y-2 text-xs">
      <p className="font-semibold text-gray-700">📊 학습 통계</p>
      <div className="flex gap-2 flex-wrap">
        <Badge variant="outline">🔥 {data.streak_days}일 연속</Badge>
        <Badge variant="outline">총 {data.total_sessions}회</Badge>
        <Badge variant="outline">{data.total_segments_studied}문장 학습</Badge>
      </div>
      {Object.entries(data.mode_stats ?? {}).map(([mode, stats]: [string, any]) => (
        <div key={mode} className="flex justify-between text-gray-600">
          <span>{MODE_LABEL[mode] ?? mode}</span>
          <span className="font-medium">{stats.avg_score}점 ({stats.count}회)</span>
        </div>
      ))}
      {data.weak_areas?.length > 0 && (
        <p className="text-orange-500">⚠️ 약한 영역: {data.weak_areas.map((m: string) => MODE_LABEL[m] ?? m).join(", ")}</p>
      )}
    </div>
  );
}
