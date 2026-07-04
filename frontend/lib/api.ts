import type { Video, VideoDetail } from "@/types";

// 기본은 상대경로("") → 페이지와 같은 출처로 /api 호출, rewrites/프록시가 백엔드로 전달.
// 별도 백엔드를 직접 가리킬 때만 NEXT_PUBLIC_API_URL에 절대주소 지정.
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

// 학습 완료 시 대시보드가 통계를 즉시 갱신하도록 브로드캐스트하는 커스텀 이벤트
export const STUDYLOG_SAVED_EVENT = "studylog:saved";
function notifyStudyLogSaved() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(STUDYLOG_SAVED_EVENT));
  }
}

// ── 학습 기록 ──────────────────────────────────────────────────────────────

export interface StudyLogPayload {
  video_id: number;
  segment_id?: number;
  mode: "listen" | "speak" | "write";
  score?: number;
}

export async function postStudyLog(data: StudyLogPayload): Promise<void> {
  const res = await fetch(`${API_URL}/api/study-logs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("학습 기록 저장에 실패했습니다");
  notifyStudyLogSaved();
}

// ── 섀도잉 평가 ───────────────────────────────────────────────────────────────

export interface WordResult {
  word: string;
  status: "correct" | "wrong" | "missing";
}

export interface ShadowingResult {
  recognized_text: string;
  original_text: string;
  score: number;
  word_results: WordResult[];
  feedback: string;
}

export async function evaluateShadowing(
  audioBlob: Blob,
  segmentId: number
): Promise<ShadowingResult> {
  const formData = new FormData();
  formData.append("audio", audioBlob, "recording.webm");
  formData.append("segment_id", String(segmentId));

  const res = await fetch(`${API_URL}/api/shadowing/evaluate`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail ?? "발음 평가에 실패했습니다");
  }
  const data = await res.json();
  notifyStudyLogSaved();
  return data;
}

// ── 응용 작문 ──────────────────────────────────────────────────────────────

export interface WritingTask {
  task_id: number;
  segment_text: string;
  target_expression: string;
  pattern_explanation: string;
  task_prompt: string;
}

export interface WritingEvaluation {
  score: number;
  used_expression_correctly: boolean;
  grammar_feedback: string;
  naturalness_feedback: string;
  improved_sentence: string;
  encouragement: string;
}

export async function generateWritingTask(segmentId: number): Promise<WritingTask> {
  const res = await fetch(`${API_URL}/api/writing/generate-task`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ segment_id: segmentId }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail ?? "과제 생성에 실패했습니다");
  }
  return res.json();
}

export async function evaluateWriting(
  taskId: number,
  userSentence: string
): Promise<WritingEvaluation> {
  const res = await fetch(`${API_URL}/api/writing/evaluate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ task_id: taskId, user_sentence: userSentence }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail ?? "평가에 실패했습니다");
  }
  const data = await res.json();
  notifyStudyLogSaved();
  return data;
}

// ── Agent 채팅 ──────────────────────────────────────────────────────────────

export interface AgentConversationMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AgentResponse {
  reply: string;
  actions_taken: string[];
  data: Record<string, any>;
}

export async function sendAgentMessage(
  message: string,
  conversationHistory: AgentConversationMessage[]
): Promise<AgentResponse> {
  const res = await fetch(`${API_URL}/api/agent/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, conversation_history: conversationHistory }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail ?? "Agent 오류가 발생했습니다");
  }
  return res.json();
}

// ── 영상 ───────────────────────────────────────────────────────────────────

export async function registerVideo(url: string): Promise<Video> {
  const res = await fetch(`${API_URL}/api/videos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail ?? "영상 등록에 실패했습니다");
  }
  return res.json();
}

export async function getVideos(): Promise<Video[]> {
  const res = await fetch(`${API_URL}/api/videos`);
  if (!res.ok) throw new Error("영상 목록 조회에 실패했습니다");
  return res.json();
}

export async function getVideo(id: number): Promise<VideoDetail> {
  const res = await fetch(`${API_URL}/api/videos/${id}`);
  if (!res.ok) throw new Error("영상 정보 조회에 실패했습니다");
  return res.json();
}

export async function deleteVideo(id: number): Promise<void> {
  const res = await fetch(`${API_URL}/api/videos/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("영상 삭제에 실패했습니다");
}

// ── 추천 / 관심사 ──────────────────────────────────────────────────────────

// source="local": 등록된 영상(video_id로 바로 학습), "youtube": 미등록 외부 영상(등록 후 학습)
export interface RecommendItem {
  source: "local" | "youtube";
  title: string;
  reason?: string;
  thumbnail_url?: string | null;
  channel?: string | null;
  video_id?: number;
  youtube_id?: string;
  segment_count?: number;
  duration_sec?: number | null;
}

// notice: 쿼터 초과·키 없음 등 안내 문구 (정상이면 null)
export interface RecommendResult {
  items: RecommendItem[];
  notice: string | null;
}

export async function getRecommendations(count = 20): Promise<RecommendResult> {
  const res = await fetch(`${API_URL}/api/recommendations?count=${count}`);
  if (!res.ok) throw new Error("추천 영상을 불러오지 못했습니다");
  const data = await res.json();
  return { items: data.recommendations ?? [], notice: data.notice ?? null };
}

export async function searchVideos(query: string, count = 20): Promise<RecommendResult> {
  const res = await fetch(
    `${API_URL}/api/search?query=${encodeURIComponent(query)}&count=${count}`
  );
  if (!res.ok) throw new Error("검색에 실패했습니다");
  const data = await res.json();
  return { items: data.recommendations ?? [], notice: data.notice ?? null };
}

export async function getInterests(): Promise<string> {
  const res = await fetch(`${API_URL}/api/preferences/interests`);
  if (!res.ok) throw new Error("관심 키워드 조회에 실패했습니다");
  const data = await res.json();
  return data.interests ?? "";
}

export async function setInterests(interests: string): Promise<string> {
  const res = await fetch(`${API_URL}/api/preferences/interests`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ interests }),
  });
  if (!res.ok) throw new Error("관심 키워드 저장에 실패했습니다");
  const data = await res.json();
  return data.interests ?? "";
}

// ── 학습 대시보드 통계 ────────────────────────────────────────────────────────

export interface ModeStat {
  count: number;
  avg_score: number | null;
}

export interface DailyStat {
  date: string;        // "2026-06-27"
  count: number;
  avg_score: number | null;
}

export interface DashboardStats {
  totals: { sessions: number; videos: number; sentences: number };
  by_mode: { listen: ModeStat; speak: ModeStat; write: ModeStat };
  streak: { current: number; longest: number };
  daily: DailyStat[];
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const res = await fetch(`${API_URL}/api/stats/dashboard`);
  if (!res.ok) throw new Error("학습 통계를 불러오지 못했습니다");
  return res.json();
}
