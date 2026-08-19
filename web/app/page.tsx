import Link from "next/link";

import { HeroMap } from "@/components/HeroMap";
import { meta } from "@/lib/data";

/**
 * 시작 화면.
 *
 * 참고 이미지처럼 지도를 배경으로 깔고, 중앙에 브랜드명과 시작 버튼만
 * 선명하게 보이도록 구성한다. 모바일 전용 카드형이 아니라 데스크톱 웹 전체를
 * 채우는 랜딩 화면으로 바꿔, 첫 인상에서 서비스 범위를 바로 읽게 만든다.
 */
export default function LandingPage() {
  return (
    <main className="relative isolate min-h-dvh w-full overflow-hidden bg-ink">
      <HeroMap className="absolute inset-0 -z-20 pointer-events-none" />

      {/* 전체 배경을 어둡게 눌러 지도 위 텍스트 가독성을 높인다. */}
      <div className="pointer-events-none absolute inset-0 -z-10 bg-black/45" />

      {/* 중앙부를 조금 더 밝게 열어 제목이 묻히지 않게 한다. */}
      <div
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(circle at 50% 48%, rgba(0,0,0,0.10) 0%, rgba(0,0,0,0.34) 34%, rgba(0,0,0,0.58) 100%)",
        }}
      />

      <div className="relative z-10 flex min-h-dvh flex-col items-center justify-center px-6 text-center">
        <div className="mx-auto w-full max-w-4xl">
          <p className="mb-3 text-[13px] font-bold tracking-[0.28em] text-[#d1a43b] sm:text-[15px]">
            나의 지도
          </p>

          <h1 className="font-display text-[72px] leading-[0.95] text-fg-inverse drop-shadow-[0_6px_20px_rgba(0,0,0,0.35)] sm:text-[96px] lg:text-[120px]">
            전라맛도
          </h1>

          <p className="mt-5 text-[18px] text-[#ece6dc] sm:text-[20px] lg:text-[22px]">
            내 취향으로 찾는 남도 음식
          </p>

          <div className="mt-10 flex justify-center">
            <Link
              href="/taste"
              className="inline-flex min-w-[260px] items-center justify-center rounded-md bg-brand px-10 py-5 text-[18px] font-bold text-fg-inverse shadow-[0_14px_40px_rgba(0,0,0,0.28)] transition-all duration-150 hover:-translate-y-0.5 hover:opacity-95 hover:shadow-[0_18px_48px_rgba(0,0,0,0.32)] active:translate-y-0"
            >
              음식 탐색 시작하기
            </Link>
          </div>

          <div className="mt-7 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[12px] text-[#d9d2c8] sm:text-[13px]">
            <span>광주 · 전남 음식 {meta.foodCount}건</span>
            <span className="hidden sm:inline">•</span>
            <span>특화거리 {meta.streetCount}건</span>
            <span className="hidden sm:inline">•</span>
            <Link
              href="/how"
              className="underline decoration-[#d9d2c8]/60 underline-offset-4 transition-colors hover:text-fg-inverse"
            >
              추천 방식 보기
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
