import Link from "next/link";

import { HeroMap } from "@/components/HeroMap";
import { meta } from "@/lib/data";

/**
 * 시작 화면. 취향 입력 폼(/taste)으로 들어가기 전의 짧은 인트로다.
 *
 * "전라맛도" 뒤에 광주·전남 전역 지도를 배경으로 깔아 이 서비스가 다루는
 * 지역을 한눈에 보여준다. 지도는 상호작용이 꺼진 채 배경으로만 존재하고,
 * 실제 취향 선택은 다음 화면(/taste)에서 이뤄진다.
 */
export default function LandingPage() {
  return (
    <main className="relative isolate mx-auto min-h-dvh w-full max-w-[520px] overflow-hidden bg-ink">
      {/* isolate로 이 main을 새 stacking context 루트로 만든다. Leaflet은
          내부 pane에 z-index 200~700을 박아 두는데, 격리하지 않으면 그
          값이 문서 레벨로 새어나가 아래의 버튼보다 위에 그려져 클릭을
          가로챈다. pointer-events-none도 같이 줘서 애초에 배경이 마우스
          이벤트를 받지 않게 한다. */}
      <HeroMap className="absolute inset-0 -z-10 pointer-events-none" />

      {/* 지도 위에 어두운 그라디언트를 깔아 흰 글자가 어디서든 읽히게 한다. */}
      <div className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-b from-ink/75 via-ink/55 to-ink/90" />

      <div className="relative z-10 flex min-h-dvh flex-col justify-between px-8 py-14">
        <p className="text-[12px] font-bold tracking-[0.2em] text-brand-soft">
          광주 · 전남 제철 미식
        </p>

        <div className="text-center">
          <h1 className="font-display text-[64px] leading-none text-fg-inverse drop-shadow-lg">
            전라맛도
          </h1>
          <p className="mt-4 text-[15px] leading-relaxed text-[#e4dccf]">
            취향 네 가지로 찾는 남도 음식,
            <br />그 음식이 모여 있는 지역특화거리까지.
          </p>
        </div>

        <div>
          <Link
            href="/taste"
            className="block w-full cursor-pointer rounded-2xl bg-brand py-4 text-center text-[17px] font-bold text-fg-inverse shadow-lg transition-all duration-150 hover:-translate-y-0.5 hover:opacity-90 hover:shadow-xl active:translate-y-0"
          >
            시작하기
          </Link>
          <p className="mt-4 text-center text-[11px] text-[#b8afa6]">
            음식 {meta.foodCount}건 · 특화거리 {meta.streetCount}건
          </p>
          <Link
            href="/how"
            className="mx-auto mt-3 block w-fit text-[12px] text-[#d8cfc2] underline underline-offset-4 transition-colors hover:text-fg-inverse"
          >
            어떻게 추천하나요?
          </Link>
        </div>
      </div>
    </main>
  );
}
