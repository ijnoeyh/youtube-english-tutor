// MediaRecorder 래퍼 — startRecording/stopRecording 인터페이스 제공

const MAX_RECORDING_MS = 30_000; // Groq 25MB 제한 방어용 최대 녹음 시간

export class AudioRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private stream: MediaStream | null = null;
  private autoStopTimer: ReturnType<typeof setTimeout> | null = null;

  async startRecording(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.chunks = [];

    // Chrome은 webm/opus, Safari는 mp4 지원 — 호환 포맷 우선 선택
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : MediaRecorder.isTypeSupported("audio/mp4")
      ? "audio/mp4"
      : "";

    this.mediaRecorder = new MediaRecorder(
      this.stream,
      mimeType ? { mimeType } : undefined
    );

    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };

    this.mediaRecorder.start(100);

    this.autoStopTimer = setTimeout(() => {
      if (this.mediaRecorder?.state === "recording") {
        this.mediaRecorder.stop();
      }
    }, MAX_RECORDING_MS);
  }

  // onstop 이벤트 완료 후 Blob을 resolve — stop()이 즉시 반환하지 않으므로 Promise로 래핑
  stopRecording(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      if (!this.mediaRecorder) {
        reject(new Error("녹음이 시작되지 않았습니다"));
        return;
      }

      if (this.autoStopTimer) {
        clearTimeout(this.autoStopTimer);
        this.autoStopTimer = null;
      }

      this.mediaRecorder.onstop = () => {
        const blob = new Blob(this.chunks, {
          type: this.mediaRecorder?.mimeType || "audio/webm",
        });
        this.cleanup();
        resolve(blob);
      };

      this.mediaRecorder.onerror = (e) => {
        this.cleanup();
        reject(e);
      };

      this.mediaRecorder.stop();
    });
  }

  // 마이크 표시등 해제
  private cleanup() {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.chunks = [];
    this.mediaRecorder = null;
  }

  get isRecording(): boolean {
    return this.mediaRecorder?.state === "recording";
  }
}
