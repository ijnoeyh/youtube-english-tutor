import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "All-in-One English Tutor",
  description: "YouTube로 영어를 학습하는 자기주도형 튜터",
};

// FOUC 방지: 페이지 렌더 직전에 localStorage / OS 설정 읽어 .dark 클래스 부착.
const themeBootstrap = `
(function() {
  try {
    var stored = localStorage.getItem('theme');
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var useDark = stored ? stored === 'dark' : prefersDark;
    if (useDark) document.documentElement.classList.add('dark');
  } catch (e) {}
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://hangeul.pstatic.net" crossOrigin="" />
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
