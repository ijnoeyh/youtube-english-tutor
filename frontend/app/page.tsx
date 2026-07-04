"use client";

import { useState, useEffect } from "react";
import YouTube from "react-youtube";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Video, VideoDetail } from "@/types";
import { registerVideo, getVideos, getVideo, deleteVideo } from "@/lib/api";
import ListenMode from "@/components/listen/ListenMode";
import SpeakMode from "@/components/speak/SpeakMode";
import WriteMode from "@/components/write/WriteMode";
import AgentPanel from "@/components/agent/AgentPanel";
import RecommendSection from "@/components/recommend/RecommendSection";
import DashboardSection from "@/components/dashboard/DashboardSection";

/* ── utils ──────────────────────────────────────────────────────────── */

function formatDuration(sec?: number | null): string {
  if (sec == null || sec <= 0) return "";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/* ── 반응형 훅 ────────────────────────────────────────────────────────── */

// CSS만으로 숨기면 YouTube 플레이어가 2개 마운트되어 onReady 경쟁이 발생하므로
// 화면에 보이는 레이아웃 하나만 마운트하기 위해 사용. SSR은 false로 시작해 hydration 불일치 방지.
function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return isDesktop;
}

/* ── 다크모드 토글 ────────────────────────────────────────────────────── */

function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    if (next) document.documentElement.classList.add("dark");
    else document.documentElement.classList.remove("dark");
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {}
  }

  return (
    <button
      onClick={toggle}
      aria-label="테마 전환"
      className="w-10 h-10 rounded-full border border-border bg-card hover:bg-secondary transition-colors flex items-center justify-center text-base"
    >
      {dark ? "🌙" : "☀️"}
    </button>
  );
}

/* ── 브랜드 ──────────────────────────────────────────────────────────── */

function Brand({ onClick }: { onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="홈으로"
      className="flex items-center gap-2.5 rounded-xl transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
    >
      <div className="w-9 h-9 rounded-xl bg-primary grid place-items-center text-primary-foreground text-sm font-bold shadow-sm">
        ET
      </div>
      <div className="leading-tight text-left">
        <p className="font-bold text-[15px] text-foreground tracking-tight">English Tutor</p>
        <p className="text-[10px] text-muted-foreground tracking-wide">YouTube로 영어 학습</p>
      </div>
    </button>
  );
}

/* ── 영상 카드 ────────────────────────────────────────────────────────── */

function VideoCard({
  video,
  selected,
  onSelect,
  onDelete,
}: {
  video: Video;
  selected: boolean;
  onSelect: () => void;
  onDelete: (e: React.MouseEvent) => void;
}) {
  return (
    // <button> 중첩이 무효한 HTML이므로 div[role=button] 사용
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className={`group w-full text-left rounded-2xl p-3 surface card-interactive flex items-start gap-3 cursor-pointer ${
        selected ? "border-primary ring-2 ring-primary/20" : ""
      }`}
    >
      <div className="relative w-20 h-14 shrink-0">
        {video.thumbnail_url ? (
          <img
            src={video.thumbnail_url}
            alt=""
            className="w-full h-full object-cover rounded-lg"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full rounded-lg bg-secondary grid place-items-center text-base text-muted-foreground">
            📺
          </div>
        )}
        {video.duration_sec ? (
          <span className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-black/75 text-white tabular-nums">
            {formatDuration(video.duration_sec)}
          </span>
        ) : null}
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-bold text-foreground line-clamp-2 leading-snug">
          {video.title || video.youtube_id}
        </p>
        <p className="text-[11px] text-muted-foreground truncate mt-1">
          {video.channel ?? "—"}
        </p>
        <p className="text-[10px] text-muted-foreground/80 mt-0.5">
          {video.segment_count} segments
        </p>
      </div>

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDelete(e);
        }}
        aria-label="영상 삭제"
        title="영상 삭제"
        className="grid place-items-center w-7 h-7 rounded-full shrink-0 text-muted-foreground opacity-60 sm:opacity-0 sm:group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-destructive/40 transition-all text-sm leading-none"
      >
        ✕
      </button>
    </div>
  );
}

/* ── Library 패널 ────────────────────────────────────────────────────── */

function LibraryPanel({
  videos,
  selectedId,
  urlInput,
  isRegistering,
  error,
  onUrlChange,
  onRegister,
  onSelect,
  onDelete,
}: {
  videos: Video[];
  selectedId: number | undefined;
  urlInput: string;
  isRegistering: boolean;
  error: string | null;
  onUrlChange: (v: string) => void;
  onRegister: () => void;
  onSelect: (v: Video) => void;
  onDelete: (e: React.MouseEvent, id: number) => void;
}) {
  return (
    <div className="flex flex-col gap-4 h-full">
      <div className="surface p-4 animate-[fade-up_0.5s_ease-out]">
        <p className="text-[11px] font-bold text-muted-foreground mb-2 tracking-wide">
          새 영상 등록
        </p>
        <div className="flex gap-2">
          <Input
            placeholder="YouTube URL"
            className="bg-secondary border-transparent text-sm h-10 focus-visible:bg-card focus-visible:border-primary"
            value={urlInput}
            onChange={(e) => onUrlChange(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onRegister()}
            disabled={isRegistering}
          />
          <Button
            size="sm"
            onClick={onRegister}
            disabled={isRegistering || !urlInput.trim()}
            className="bg-primary hover:bg-primary/90 text-primary-foreground h-10 px-4 font-bold"
          >
            {isRegistering ? "..." : "등록"}
          </Button>
        </div>
        {error ? (
          <p className="mt-2 text-xs text-destructive font-bold">{error}</p>
        ) : (
          <p className="mt-2 text-[10px] text-muted-foreground">
            영어 자막이 있는 유튜브 영상을 등록할 수 있어요.
          </p>
        )}
      </div>

      <div className="flex-1 min-h-0 flex flex-col">
        <div className="flex items-baseline justify-between mb-2 px-1">
          <p className="font-bold text-base text-foreground">내 라이브러리</p>
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {videos.length}개
          </span>
        </div>
        <div className="flex-1 overflow-y-auto -mx-1 px-1 pb-2 space-y-2">
          {videos.length === 0 ? (
            <div className="surface p-8 grid place-items-center text-center gap-2">
              <span className="text-3xl">📺</span>
              <p className="text-sm font-bold text-foreground">아직 영상이 없어요</p>
              <p className="text-[11px] text-muted-foreground">
                위 입력창에 URL 을 붙여보세요
              </p>
            </div>
          ) : (
            videos.map((v, i) => (
              <div
                key={v.id}
                style={{ animationDelay: `${i * 50}ms` }}
                className="animate-[fade-up_0.5s_ease-out_both]"
              >
                <VideoCard
                  video={v}
                  selected={selectedId === v.id}
                  onSelect={() => onSelect(v)}
                  onDelete={(e) => onDelete(e, v.id)}
                />
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/* ── 좋아요/북마크 영속화 hook (localStorage) ─────────────────────────── */

function useVideoFlag(key: string) {
  const [map, setMap] = useState<Record<number, boolean>>({});

  useEffect(() => {
    try {
      const stored = localStorage.getItem(key);
      if (stored) setMap(JSON.parse(stored));
    } catch {}
  }, [key]);

  function toggle(videoId: number) {
    setMap((prev) => {
      const next = { ...prev, [videoId]: !prev[videoId] };
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {}
      return next;
    });
  }

  return [map, toggle] as const;
}

/* ── Study 영역 ───────────────────────────────────────────────────────── */

function StudyArea({
  selectedVideo,
  player,
  setPlayer,
  onSelectVideo,
  onStudyExternal,
}: {
  selectedVideo: VideoDetail | null;
  player: any;
  setPlayer: (p: any) => void;
  onSelectVideo?: (videoId: number) => void;
  onStudyExternal?: (youtubeId: string) => Promise<void> | void;
}) {
  const [liked, toggleLiked] = useVideoFlag("likedVideos");
  const [bookmarked, toggleBookmarked] = useVideoFlag("bookmarkedVideos");

  if (!selectedVideo) {
    return (
      <div className="space-y-5">
        <DashboardSection />
        <RecommendSection
          onSelectVideo={onSelectVideo}
          onStudyExternal={onStudyExternal}
        />
      </div>
    );
  }

  const vid = selectedVideo.video.id;
  const isLiked = !!liked[vid];
  const isBookmarked = !!bookmarked[vid];

  return (
    <div className="flex flex-col gap-3 animate-[fade-in_0.3s_ease-out]">
      {/* 영상 플레이어 */}
      <div className="relative rounded-2xl overflow-hidden shrink-0 aspect-video lg:aspect-auto lg:h-[42vh] bg-black shadow-lg">
        <YouTube
          videoId={selectedVideo.video.youtube_id}
          opts={{
            width: "100%",
            height: "100%",
            playerVars: { autoplay: 0 },
          }}
          className="w-full h-full"
          iframeClassName="w-full h-full"
          onReady={(e: { target: any }) => setPlayer(e.target)}
        />
      </div>

      {/* 영상 메타 + 좋아요/북마크 */}
      <div className="flex items-start gap-3 px-1 shrink-0">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg lg:text-xl font-bold text-foreground line-clamp-2 leading-tight tracking-tight">
            {selectedVideo.video.title || selectedVideo.video.youtube_id}
          </h2>
          <p className="text-xs text-muted-foreground mt-1 truncate">
            {[
              selectedVideo.video.channel,
              formatDuration(selectedVideo.video.duration_sec),
              `${selectedVideo.segments.length}개 세그먼트`,
            ]
              .filter(Boolean)
              .join("  ·  ")}
          </p>
        </div>
        <div className="flex gap-1.5 shrink-0">
          <button
            onClick={() => toggleLiked(vid)}
            aria-label={isLiked ? "좋아요 취소" : "좋아요"}
            className={`w-10 h-10 rounded-full border transition-all flex items-center justify-center text-lg ${
              isLiked
                ? "bg-destructive/10 border-destructive/30 text-destructive"
                : "bg-card border-border text-muted-foreground hover:text-foreground hover:border-foreground/30"
            }`}
          >
            {isLiked ? "❤️" : "♡"}
          </button>
          <button
            onClick={() => toggleBookmarked(vid)}
            aria-label={isBookmarked ? "북마크 취소" : "북마크"}
            className={`w-10 h-10 rounded-full border transition-all flex items-center justify-center text-lg ${
              isBookmarked
                ? "bg-primary/10 border-primary/30 text-primary"
                : "bg-card border-border text-muted-foreground hover:text-foreground hover:border-foreground/30"
            }`}
          >
            {isBookmarked ? "🔖" : "🏷"}
          </button>
        </div>
      </div>

      <Tabs defaultValue="listen" className="flex flex-col gap-3">
        {/* 탭 컨트롤 */}
        <TabsList className="bg-secondary p-1 rounded-2xl h-12 grid grid-cols-3 w-full">
          <TabsTrigger
            value="listen"
            className="rounded-xl font-bold text-sm h-full flex items-center justify-center gap-1.5 text-muted-foreground data-[state=active]:bg-card data-[state=active]:text-primary data-[state=active]:shadow-sm transition-all"
          >
            🎧 Listen
          </TabsTrigger>
          <TabsTrigger
            value="speak"
            className="rounded-xl font-bold text-sm h-full flex items-center justify-center gap-1.5 text-muted-foreground data-[state=active]:bg-card data-[state=active]:text-primary data-[state=active]:shadow-sm transition-all"
          >
            🎤 Speak
          </TabsTrigger>
          <TabsTrigger
            value="write"
            className="rounded-xl font-bold text-sm h-full flex items-center justify-center gap-1.5 text-muted-foreground data-[state=active]:bg-card data-[state=active]:text-primary data-[state=active]:shadow-sm transition-all"
          >
            ✍️ Write
          </TabsTrigger>
        </TabsList>

        {/* 탭 컨텐츠 */}
        <div className="surface p-4 lg:p-5">
          <TabsContent value="listen" className="mt-0 animate-[fade-in_0.3s_ease-out]">
            <ListenMode
              segments={selectedVideo.segments}
              videoId={selectedVideo.video.id}
              player={player}
            />
          </TabsContent>
          <TabsContent value="speak" className="mt-0 animate-[fade-in_0.3s_ease-out]">
            <SpeakMode
              segments={selectedVideo.segments}
              videoId={selectedVideo.video.id}
              player={player}
            />
          </TabsContent>
          <TabsContent value="write" className="mt-0 animate-[fade-in_0.3s_ease-out]">
            <WriteMode
              segments={selectedVideo.segments}
              videoId={selectedVideo.video.id}
              player={player}
            />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

/* ── 페이지 본체 ───────────────────────────────────────────────────── */

export default function Home() {
  const [agentOpen, setAgentOpen] = useState(false);
  const [player, setPlayer] = useState<any>(null);

  const [videos, setVideos] = useState<Video[]>([]);
  const [selectedVideo, setSelectedVideo] = useState<VideoDetail | null>(null);
  const [urlInput, setUrlInput] = useState("");
  const [isRegistering, setIsRegistering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [mobileTab, setMobileTab] = useState<"library" | "study" | "agent">("library");

  const isDesktop = useIsDesktop();

  function goHome() {
    setSelectedVideo(null);
    setMobileTab("library");
    setAgentOpen(false);
  }

  useEffect(() => {
    getVideos().then(setVideos).catch(() => {});
  }, []);

  async function handleRegister() {
    if (!urlInput.trim()) return;
    setIsRegistering(true);
    setError(null);
    try {
      await registerVideo(urlInput.trim());
      const updated = await getVideos();
      setVideos(updated);
      setUrlInput("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "등록 실패");
    } finally {
      setIsRegistering(false);
    }
  }

  async function handleSelectVideo(video: Video) {
    try {
      const detail = await getVideo(video.id);
      setSelectedVideo(detail);
      setMobileTab("study");
    } catch {
      setError("영상 정보를 불러오지 못했습니다");
    }
  }

  async function handleDeleteVideo(e: React.MouseEvent, videoId: number) {
    e.stopPropagation();
    if (!confirm("이 영상을 삭제할까요? 학습 기록도 함께 삭제됩니다.")) return;
    try {
      await deleteVideo(videoId);
      setVideos(await getVideos());
      if (selectedVideo?.video.id === videoId) setSelectedVideo(null);
    } catch {
      setError("삭제에 실패했습니다");
    }
  }

  async function handleSelectVideoById(videoId: number) {
    try {
      const detail = await getVideo(videoId);
      setSelectedVideo(detail);
      setAgentOpen(false);
      setMobileTab("study");
    } catch {}
  }

  // 미등록 외부 영상을 등록 후 바로 학습 진입. 실패 시 throw해서 카드가 에러를 표시하게 함.
  async function handleStudyExternalVideo(youtubeId: string) {
    const url = `https://www.youtube.com/watch?v=${youtubeId}`;
    const video = await registerVideo(url);
    setVideos(await getVideos());
    await handleSelectVideoById(video.id);
  }

  return (
    <div className="min-h-screen bg-background text-foreground font-sans">
      {/* ═════════════ Desktop Layout (lg+) ═════════════ */}
      {isDesktop && (
      <div className="hidden lg:flex h-screen overflow-hidden">
        {/* 사이드바 */}
        <aside className="w-[340px] shrink-0 panel p-4 flex flex-col gap-4">
          <header className="flex items-center justify-between px-1 animate-[fade-up_0.5s_ease-out]">
            <Brand onClick={goHome} />
            <ThemeToggle />
          </header>

          <div className="flex-1 min-h-0">
            <LibraryPanel
              videos={videos}
              selectedId={selectedVideo?.video.id}
              urlInput={urlInput}
              isRegistering={isRegistering}
              error={error}
              onUrlChange={setUrlInput}
              onRegister={handleRegister}
              onSelect={handleSelectVideo}
              onDelete={handleDeleteVideo}
            />
          </div>
        </aside>

        {/* 메인 */}
        <main className="flex-1 p-5 overflow-y-auto bg-muted/40">
          <StudyArea
            selectedVideo={selectedVideo}
            player={player}
            setPlayer={setPlayer}
            onSelectVideo={handleSelectVideoById}
            onStudyExternal={handleStudyExternalVideo}
          />
        </main>
      </div>
      )}

      {/* ═════════════ Mobile / Tablet Layout (< lg) ═════════════ */}
      {!isDesktop && (
      <div className="lg:hidden flex flex-col min-h-screen">
        {/* 헤더 */}
        <header className="sticky top-0 z-30 px-4 py-3 flex items-center justify-between bg-background border-b border-border">
          <Brand onClick={goHome} />
          <ThemeToggle />
        </header>

        <div className="flex-1 px-3 py-4 pb-24 overflow-y-auto bg-muted/40">
          {mobileTab === "library" && (
            <div className="h-[calc(100vh-9rem)]">
              <LibraryPanel
                videos={videos}
                selectedId={selectedVideo?.video.id}
                urlInput={urlInput}
                isRegistering={isRegistering}
                error={error}
                onUrlChange={setUrlInput}
                onRegister={handleRegister}
                onSelect={handleSelectVideo}
                onDelete={handleDeleteVideo}
              />
            </div>
          )}
          {mobileTab === "study" && (
            <StudyArea
              selectedVideo={selectedVideo}
              player={player}
              setPlayer={setPlayer}
              onSelectVideo={handleSelectVideoById}
              onStudyExternal={handleStudyExternalVideo}
            />
          )}
          {mobileTab === "agent" && (
            <div className="surface p-6 text-center space-y-3 animate-[fade-in_0.3s_ease-out]">
              <div className="w-16 h-16 mx-auto rounded-2xl bg-accent grid place-items-center text-3xl">
                ✨
              </div>
              <p className="text-xl font-bold">AI 학습 도우미</p>
              <p className="text-sm text-muted-foreground">
                탭하면 채팅창이 열려요.
              </p>
              <Button
                onClick={() => setAgentOpen(true)}
                className="mt-2 bg-primary text-primary-foreground font-bold h-11 px-6"
              >
                대화 시작
              </Button>
            </div>
          )}
        </div>

        {/* 탭바 */}
        <nav className="fixed bottom-0 inset-x-0 z-40 bg-background border-t border-border">
          <div className="max-w-2xl mx-auto px-3 py-2 grid grid-cols-3 gap-1 safe-area-bottom">
            {(
              [
                { key: "library", label: "Library", icon: "📚" },
                { key: "study", label: "Study", icon: "🎯" },
                { key: "agent", label: "Agent", icon: "✨" },
              ] as const
            ).map((t) => (
              <button
                key={t.key}
                onClick={() => {
                  if (t.key === "agent") {
                    setAgentOpen(true);
                  } else {
                    setMobileTab(t.key);
                  }
                }}
                className={`flex flex-col items-center gap-0.5 py-2 rounded-xl transition-colors ${
                  mobileTab === t.key
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                aria-label={t.label}
              >
                <span className="text-xl leading-none">{t.icon}</span>
                <span className="text-[10px] font-bold tracking-wide">
                  {t.label}
                </span>
              </button>
            ))}
          </div>
        </nav>
      </div>
      )}

      {/* FAB */}
      <button
        onClick={() => setAgentOpen(true)}
        className="hidden lg:flex fixed bottom-6 right-6 w-14 h-14 rounded-full bg-primary text-primary-foreground text-2xl shadow-lg items-center justify-center transition-transform hover:scale-110 z-50"
        aria-label="AI 학습 도우미 열기"
      >
        ✨
      </button>

      <AgentPanel
        open={agentOpen}
        onOpenChange={setAgentOpen}
        onSelectVideo={handleSelectVideoById}
        onStudyExternal={handleStudyExternalVideo}
      />
    </div>
  );
}
