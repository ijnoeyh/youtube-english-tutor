FROM python:3.11-slim

WORKDIR /app

# 의존성만 먼저 설치해 소스 변경 시 레이어 캐시 재사용
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# SQLite DB 볼륨 마운트 지점
RUN mkdir -p /app/data

EXPOSE 8000

# 0.0.0.0: 컨테이너 외부(다른 컨테이너/호스트)에서 접근 허용
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
