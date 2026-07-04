"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { sendAgentMessage, type AgentConversationMessage } from "@/lib/api";
import ChatMessageBubble, { type ChatMessage } from "./ChatMessage";
import QuickActions from "./QuickActions";
import TypingIndicator from "./TypingIndicator";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectVideo?: (videoId: number) => void;
  onStudyExternal?: (youtubeId: string) => Promise<void> | void;
}

const WELCOME_MESSAGE: ChatMessage = {
  id: "welcome",
  role: "assistant",
  content:
    "안녕하세요! 영어 학습 도우미예요 🤖\n\n이런 것들을 도와드릴 수 있어요:\n• 오늘 공부할 영상 추천\n• 문법/표현 설명\n• 학습 기록 분석\n• 복습 계획 세우기\n• 중요 표현 북마크\n\n무엇을 도와드릴까요?",
};

const MAX_MESSAGES = 50;
const MAX_HISTORY = 10; // 토큰 절약을 위해 최근 10개만 전송

export default function AgentPanel({ open, onOpenChange, onSelectVideo, onStudyExternal }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME_MESSAGE]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  function buildHistory(): AgentConversationMessage[] {
    return messages
      .filter((m) => m.id !== "welcome")
      .slice(-MAX_HISTORY)
      .map((m) => ({ role: m.role, content: m.content }));
  }

  const handleSend = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isLoading) return;

      const userMsg: ChatMessage = {
        id: Date.now().toString(),
        role: "user",
        content: trimmed,
      };

      setMessages((prev) => {
        const next = [...prev, userMsg];
        return next.length > MAX_MESSAGES
          ? [WELCOME_MESSAGE, ...next.slice(-(MAX_MESSAGES - 1))]
          : next;
      });
      setInput("");
      setIsLoading(true);

      try {
        const history = buildHistory();
        const response = await sendAgentMessage(trimmed, history);

        const assistantMsg: ChatMessage = {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: response.reply,
          actionsTaken: response.actions_taken,
          data: response.data,
        };

        setMessages((prev) => [...prev, assistantMsg]);
      } catch (e) {
        const errorMsg: ChatMessage = {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: e instanceof Error ? e.message : "오류가 발생했습니다. 다시 시도해주세요.",
        };
        setMessages((prev) => [...prev, errorMsg]);
      } finally {
        setIsLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isLoading, messages]
  );

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend(input);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[400px] sm:w-[400px] flex flex-col p-0">
        <SheetHeader className="p-4 border-b flex-shrink-0">
          <SheetTitle className="flex items-center gap-2 text-base">
            🤖 AI 학습 도우미
          </SheetTitle>
        </SheetHeader>

        {/* ── 채팅 메시지 목록 ── */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map((msg) => (
            <ChatMessageBubble
              key={msg.id}
              message={msg}
              onSelectVideo={onSelectVideo}
              onStudyExternal={onStudyExternal}
            />
          ))}
          {isLoading && <TypingIndicator />}
          <div ref={bottomRef} />
        </div>

        {/* ── 입력 영역 ── */}
        <div className="p-4 border-t space-y-2 flex-shrink-0">
          <QuickActions onSend={handleSend} disabled={isLoading} />
          <div className="flex gap-2">
            <Textarea
              placeholder="메시지를 입력하세요... (Enter 전송, Shift+Enter 줄바꿈)"
              className="resize-none text-sm"
              rows={2}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isLoading}
            />
            <Button
              size="sm"
              className="self-end"
              onClick={() => handleSend(input)}
              disabled={isLoading || !input.trim()}
            >
              전송
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
