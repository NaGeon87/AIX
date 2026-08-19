import Link from "next/link";

import { FoodRecommendations } from "@/components/FoodRecommendations";
import { type MapMarker } from "@/components/RegionMap";
import { foods, streets } from "@/lib/data";
import { streetDisplayName } from "@/lib/korean";
import {
  aggregateStreets,
  preferenceFromQuery,
  preferenceToQuery,
  rankCandidates,
  toNearbyCandidates,
} from "@/lib/recommend";
import { CATEGORY_META, RAW_COLOR, SOUP_COLOR, SPICY_COLOR, SPICY_LEVELS } from "@/lib/types";

/** 결과에 보여 줄 음식 개수. */
const FOOD_LIMIT = 4;

export default async function ResultPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const pref = preferenceFromQuery(query);

  // 제철 후보를 전부 취향순으로 세워 클라이언트로 넘긴다. 상위 몇 개만
  // 넘기면 "가까운 순"이 취향으로 한 번 거른 뒤의 순서가 되어 버린다.
  const ranked = rankCandidates(foods, pref);
  const candidates = toNearbyCandidates(ranked, streets, FOOD_LIMIT);
  const topStreets = aggregateStreets(ranked.slice(0, FOOD_LIMIT), streets, 4);

  // 특화거리 마커는 취향 기준으로 고정한다. 아래 "가 볼 만한 특화거리"
  // 절과 같은 목록이어야 지도와 목록이 서로를 설명한다.
  const streetMarkers: MapMarker[] = topStreets
    .filter((agg) => agg.street.lat !== null && agg.street.lon !== null)
    .map((agg, index) => ({
      id: agg.street.id,
      lat: agg.street.lat as number,
      lon: agg.street.lon as number,
      label: streetDisplayName(agg.street),
      kind: "street" as const,
      highlight: index === 0,
    }));

  const spicyLabel = SPICY_LEVELS.find((l) => l.value === pref.spicy)?.label ?? "";

  return (
    <main className="mx-auto min-h-dvh w-full max-w-[520px] bg-canvas pb-12">
      <header className="bg-ink px-6 pb-5 pt-11 text-fg-inverse">
        <div className="flex items-center justify-between gap-3">
          <Link
            href="/taste"
            className="block w-fit text-[13px] text-[#b8afa6] transition-colors hover:text-fg-inverse"
          >
            ← 취향 다시 고르기
          </Link>
          <Link
            href="/how"
            className="shrink-0 rounded-full border border-[#4a423a] px-2.5 py-1 text-[11px] font-bold text-[#b8afa6] transition-colors hover:border-fg-inverse hover:text-fg-inverse"
          >
            추천 방식
          </Link>
        </div>
        <h1 className="font-display mt-2 text-[26px] leading-tight">
          {pref.month}월의 남도, {Math.min(ranked.length, FOOD_LIMIT)}가지
        </h1>
        <p className="mt-1.5 text-[12px] leading-relaxed text-[#b8afa6]">
          {pref.month}월 제철 후보 {ranked.length}가지를 아래 취향으로 채점했습니다. 카드마다
          <b className="font-bold text-fg-inverse"> ‘왜 이 음식인가요?’</b>를 펼치면 점수가
          어떻게 나왔는지 볼 수 있습니다.
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Chip color={SPICY_COLOR} label={`맵기 ${spicyLabel}`} />
          <Chip
            color={SOUP_COLOR}
            label={
              pref.soup === 2 ? "국물 있게" : pref.soup === 0 ? "국물 없이" : "국물 상관없음"
            }
          />
          <Chip color={RAW_COLOR} label={pref.raw === "O" ? "날것도 좋아요" : "익힌 것으로"} />
          <Chip
            color={
              pref.ingredient === "상관없음"
                ? "#b8afa6"
                : CATEGORY_META[pref.ingredient].color
            }
            label={pref.ingredient === "상관없음" ? "주재료 상관없음" : pref.ingredient}
          />
        </div>
      </header>

      {ranked.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <FoodRecommendations
            candidates={candidates}
            streetMarkers={streetMarkers}
            pref={pref}
            prefQuery={preferenceToQuery(pref)}
            limit={FOOD_LIMIT}
          />

          <section className="px-5 pt-7">
            <h2 className="font-display text-[20px]">가 볼 만한 특화거리</h2>
            <p className="mt-1 text-[12px] text-fg-muted">
              취향에 맞는 음식들이 실제로 모여 있는 거리를 득표순으로 모았습니다.
            </p>
            <ol className="mt-3 space-y-2.5">
              {topStreets.map((agg, index) => (
                <li key={agg.street.id}>
                  <Link
                    href={`/street/${agg.street.id}?${preferenceToQuery(pref)}`}
                    className="street-card flex items-center gap-3 rounded-2xl border-y border-r border-line bg-surface px-4 py-3.5"
                  >
                    <span className="font-display flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-soft text-[16px] text-brand">
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-3">
                        <h3 className="font-display truncate text-[18px]">
                          {streetDisplayName(agg.street)}
                        </h3>
                        <span className="shrink-0 text-[12px] text-fg-muted">
                          점포 {agg.street.shopCount}곳
                        </span>
                      </div>
                      <p className="mt-0.5 text-[12px] text-fg-muted">
                        {agg.street.sido} {agg.street.sigungu}
                      </p>
                      <p className="mt-1.5 truncate text-[12px] text-accent">
                        {agg.foods.map((f) => f.name).join(" · ")}
                      </p>
                    </div>
                    <span
                      className="street-card-arrow shrink-0 text-[20px] text-fg-muted"
                      aria-hidden="true"
                    >
                      →
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
            {topStreets.length === 0 && (
              <p className="mt-3 rounded-2xl border border-line bg-surface-alt px-4 py-6 text-center text-[13px] text-fg-muted">
                추천된 음식과 연결되는 특화거리를 찾지 못했습니다.
                <br />
                취향을 조금 바꿔 보세요.
              </p>
            )}
          </section>
        </>
      )}
    </main>
  );
}

function Chip({ color, label }: { color: string; label: string }) {
  return (
    <span
      className="rounded-full border px-2 py-0.5 text-[11px] font-bold"
      style={{ borderColor: color, color }}
    >
      {label}
    </span>
  );
}

function EmptyState() {
  return (
    <section className="px-6 py-16 text-center">
      <p className="font-display text-[20px]">조건에 맞는 음식이 없습니다</p>
      <p className="mt-2 text-[13px] leading-relaxed text-fg-muted">
        선택한 달·종류 조합에 해당하는 데이터가 없습니다.
        <br />
        다른 달을 골라 보세요.
      </p>
      <Link
        href="/taste"
        className="mt-6 inline-block rounded-2xl bg-brand px-6 py-3 text-[15px] font-bold text-fg-inverse transition-all hover:-translate-y-0.5 hover:shadow-lg"
      >
        취향 다시 고르기
      </Link>
    </section>
  );
}
