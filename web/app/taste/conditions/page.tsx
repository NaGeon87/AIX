import Link from "next/link";

import { TasteForm } from "@/components/TasteForm";
import { meta } from "@/lib/data";
import { getKstMonth } from "@/lib/kst";

const MONTH_NAMES = [
  "1월", "2월", "3월", "4월", "5월", "6월",
  "7월", "8월", "9월", "10월", "11월", "12월",
];

export default function TastePage() {
  const month = getKstMonth();

  return (
    <main className="mx-auto min-h-dvh w-full max-w-[520px] bg-canvas">
      <header className="bg-ink px-6 pb-7 pt-12 text-fg-inverse">
        <Link
          href="/taste"
          className="block w-fit text-[13px] text-[#b8afa6] transition-colors hover:text-fg-inverse"
        >
          ← 말로 적기
        </Link>
        <h1 className="font-display mt-2 text-[28px] leading-tight">
          오늘 당신의 입맛은
          <br />
          어느 쪽입니까
        </h1>
        <p className="mt-3 text-[13px] leading-relaxed text-[#b8afa6]">
          다섯 가지를 하나씩 짚어 고릅니다. 말로 적는 편이 빠르면 위로 돌아가세요.
        </p>
      </header>

      <TasteForm defaultMonth={month} monthNames={MONTH_NAMES} />

      <footer className="px-6 pb-10 text-[11px] leading-relaxed text-fg-muted">
        <p className="font-bold text-fg">데이터 출처</p>
        <ul className="mt-1.5 space-y-0.5">
          {meta.sources.map((s) => (
            <li key={s}>· {s}</li>
          ))}
        </ul>
        <p className="mt-2">
          음식 {meta.foodCount}건 · 특화거리 {meta.streetCount}건 ·{" "}
          {meta.builtAt.slice(0, 10)} 기준
        </p>
      </footer>
    </main>
  );
}
