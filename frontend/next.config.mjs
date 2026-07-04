/** @type {import('next').NextConfig} */
const nextConfig = {
  // 프로덕션 인스턴스를 따로 띄울 때 NEXT_DIST_DIR로 dev의 .next 캐시와 분리
  distDir: process.env.NEXT_DIST_DIR || ".next",
  eslint: { ignoreDuringBuilds: true },
  // /api를 백엔드로 프록시(빌드 타임 고정). Docker 경로에선 caddy가 처리하므로 미사용.
  async rewrites() {
    const backend = process.env.BACKEND_INTERNAL_URL ?? "http://127.0.0.1:8000";
    return [
      { source: "/api/:path*", destination: `${backend}/api/:path*` },
    ];
  },
  webpack: (config, { dev }) => {
    if (dev) {
      // 일부 환경(컨테이너 등)에서 파일 변경 감지가 안 될 때 폴링으로 대체
      config.watchOptions = {
        ignored: ['**/node_modules/**', '**/.git/**'],
        poll: 1000,
        aggregateTimeout: 300,
      };
    }
    return config;
  },
};

export default nextConfig;