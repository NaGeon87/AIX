import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "전라맛도 — 취향으로 찾는 남도 음식",
  description:
    "맵기·국물·날것·주재료 네 가지 취향을 고르면, 당신의 취향에 맞는 광주·전남 음식과 그 음식이 모여 있는 지역특화거리를 찾아 드립니다.",
};

export const viewport: Viewport = {
  themeColor: "#1c1815",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <head>
        {/* 한글 본문용 웹폰트. 없으면 시스템 고딕으로 떨어진다. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700&family=Noto+Serif+KR:wght@600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
