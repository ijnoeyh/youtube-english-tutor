<div align="center">

# 🎬 YouTube English Tutor

**유튜브 영상으로 영어를 공부하는 웹앱.**
받아쓰기 · 섀도잉 · 응용 작문, 그리고 학습을 추적해주는 AI 튜터까지

<br/>

![License](https://img.shields.io/badge/License-MIT-yellow.svg)
![Next.js](https://img.shields.io/badge/Next.js-000000?logo=nextdotjs&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-009688?logo=fastapi&logoColor=white)
![Python](https://img.shields.io/badge/Python-3776AB?logo=python&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?logo=docker&logoColor=white)
![Groq](https://img.shields.io/badge/Powered%20by-Groq-F55036)

[English](./README.md) · **한국어**

</div>

---

## ✨ 기능

| | |
|---|---|
| 🎧 **Listen** | 자막을 문장 단위로 다시 들으며 받아쓰기 |
| 🎙️ **Speak** | 마이크로 섀도잉 — AI가 내 발화를 원어민 오디오와 비교 |
| ✍️ **Write** | 영상 속 표현으로 만든 AI 작문 과제 |
| 🤖 **AI Agent** | 영상 등록·학습 이력 분석·다음 학습 추천을 해주는 대화형 튜터 |
| 📊 **대시보드** | 연속 학습일, 모드별 평균 점수, 14일 활동 그래프 |

## 📸 스크린샷

<div align="center">
<img src="./docs/screenshots/home.png" alt="홈 화면" width="260"/>
&nbsp;&nbsp;&nbsp;
<img src="./docs/screenshots/study.png" alt="학습 모드" width="260"/>
</div>

## 🚀 빠른 시작 (Docker)

```bash
cp .env.example .env        # .env 열어서 GROQ_API_KEY 붙여넣기
docker compose up           # 또는: docker compose up -d   (백그라운드 실행)
```

브라우저에서 **http://localhost:8080** 접속. 프론트·백엔드·리버스 프록시가 자동으로
연결되고, 데이터는 Docker 볼륨에 보존됩니다. 첫 실행은 이미지 빌드로 몇 분,
이후엔 수 초 만에 뜹니다.

> 종료: `Ctrl+C`(포그라운드) 또는 `docker compose down`(백그라운드).

## 📱 폰에서 보기

내 PC에선 `localhost`라 마이크가 동작하지만, 폰이 LAN으로 접속하면 보안 컨텍스트가
아니라서 마이크/TTS(Speak 모드 등)가 HTTP에선 막힙니다. 8080 포트 앞에 HTTPS 터널을
붙이세요:

```bash
ngrok http 8080                              # https://ngrok.com
# 또는
cloudflared tunnel --url http://localhost:8080   # 계정 없이 임시 URL
```

출력된 `https://…` 주소를 폰에서 열면 됩니다.

## 🛠️ 수동 실행 (Docker 없이)

<details>

```bash
# 1) 환경변수
cp .env.example .env         # GROQ_API_KEY 입력

# 2) 백엔드  → http://localhost:8000  (API 문서: /docs)
cd backend
python -m venv venv && source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload

# 3) 프론트엔드 → http://localhost:3000  (다른 터미널에서)
cd frontend
npm install
npm run dev
```

Node.js 18+ 와 Python 3.10+ 필요.

</details>

## ⚙️ 환경변수

모든 변수는 저장소 루트의 `.env` 하나에 있습니다 (`.env.example` 복사).

| 변수 | 필수 | 기본값 | 용도 |
|---|:---:|---|---|
| `GROQ_API_KEY` | ✅ | — | Whisper(STT) + Llama(LLM) 채점·에이전트 |
| `YOUTUBE_API_KEY` | — | *(폴백)* | 영상 제목/썸네일 메타데이터. 자막은 없어도 동작 |
| `DATABASE_URL` | — | `sqlite:///./app.db` | DB 위치 |
| `CORS_ALLOW_ORIGINS` | — | `http://localhost:3000` | 허용 프론트 origin (수동 실행) |
| `GROQ_TIMEOUT` | — | `30` | Groq 호출 타임아웃(초) |
| `GROQ_MAX_RETRIES` | — | `3` | rate limit 재시도 횟수 |
| `LOG_LEVEL` | — | `INFO` | 로그 레벨 |

> Groq API 키는 **[console.groq.com/keys](https://console.groq.com/keys)** 에서 무료 발급.

## 🧱 기술 스택

- **프론트엔드** — Next.js(App Router), TypeScript, Tailwind CSS
- **백엔드** — FastAPI, SQLAlchemy, SQLite
- **AI** — Groq(Whisper STT + Llama), ReAct 방식 도구 사용 에이전트
- **자막** — youtube-transcript-api

## 📄 라이선스

[MIT](./LICENSE)
