import Link from "next/link";

import { FoodRecommendations } from "@/components/FoodRecommendations";
import { type MapMarker } from "@/components/RegionMap";
import { foods, streets } from "@/lib/data";
import { streetDisplayName, withParticle } from "@/lib/korean";
import {
  aggregateStreets,
  preferenceFromQuery,
  preferenceToQuery,
  randomSeed,
  rankCandidates,
  substitutionNotice,
  toNearbyCandidates,
} from "@/lib/recommend";
import { CATEGORY_META, RAW_COLOR, SOUP_COLOR, SPICY_COLOR, SPICY_LEVELS } from "@/lib/types";

/** 결과에 보여 줄 음식 개수. */
const FOOD_LIMIT = 4;

// 매번 다르게 뽑으므로 캐시에 걸리면 안 된다. 캐시된 응답을 다시 주면
// 새로고침해도 같은 상이 나와, 다르게 나오게 한 뜻이 사라진다.
export const dynamic = "force-dynamic";

export default async function ResultPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const pref = preferenceFromQuery(query);

  // 제철 후보를 전부 취향순으로 세워 클라이언트로 넘긴다. 상위 몇 개만
  // 넘기면 "가까운 순"이 취향으로 한 번 거른 뒤의 순서가 되어 버린다.
  // 씨앗이 주소에 실려 오면 그것을 쓰고, 없으면 새로 뽑는다. 그냥 들어오면
  // 매번 다른 상을 받고, 공유받은 링크로 들어오면 보낸 사람과 같은 상을 본다.
  const shared = typeof query.seed === "string" ? query.seed : "";
  const seed = shared || randomSeed();
  const nextSeed = randomSeed();
  const ranked = rankCandidates(foods, pref, seed);
  const candidates = toNearbyCandidates(ranked, streets, FOOD_LIMIT);
  const shown = ranked.slice(0, FOOD_LIMIT);
  // 추천이 대표 먹거리로 내건 특화거리. 지도 위 거리 핀이자, 그 핀을 누르면
  // 가는 상세 페이지 목록이다. 절로 따로 나열하지는 않는다.
  const topStreets = aggregateStreets(shown, streets, 6);
  // 조건을 그대로 만족하는 음식이 없으면 목록 위에서 먼저 밝힌다. 카드마다
  // "다만 ~"으로만 흘리면 네 장을 다 펼쳐 봐야 알 수 있다.
  const notice = substitutionNotice(ranked, pref);

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
      {/* 지도가 주인공이라 헤더는 얇은 앱바로 줄인다. 제목·취향은 한 줄에
          몰아 넣고, 채점 안내 문단은 뺀다(카드에서 펼쳐 볼 수 있다). */}
      <header className="bg-ink px-5 py-3 text-fg-inverse">
        <div className="flex items-center justify-between gap-3">
          <Link
            href="/taste"
            className="shrink-0 text-[13px] text-[#b8afa6] transition-colors hover:text-fg-inverse"
          >
            ← 다시
          </Link>
          <h1 className="font-display truncate text-[16px]">
            {pref.month}월의 남도, {Math.min(ranked.length, FOOD_LIMIT)}가지
          </h1>
          <div className="flex shrink-0 items-center gap-2">
            <Link
              href={`/result?${preferenceToQuery(pref)}&seed=${nextSeed}`}
              className="rounded-lg border border-[#6f685f] px-2.5 py-1.5 text-[11px] font-bold text-[#e8dfd4] transition-colors hover:border-fg-inverse hover:text-fg-inverse"
            >
              ↻ 다른 추천
            </Link>
            <Link
              href="/how"
              className="text-[12px] font-bold text-[#b8afa6] transition-colors hover:text-fg-inverse"
            >
              추천 방식
            </Link>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
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
          {(notice.substituted || notice.outOfSeasonOnly) && (
            <SubstitutionBanner
              month={pref.month}
              substituted={notice.substituted}
              unmet={notice.unmet}
            />
          )}

          <FoodRecommendations
            candidates={candidates}
            streetMarkers={streetMarkers}
            pref={pref}
            prefQuery={preferenceToQuery(pref)}
            seed={seed}
            limit={FOOD_LIMIT}
          />
          {/* '가 볼 만한 특화거리'·'파는 집' 절은 여기 없다. 거리·점포 정보는
              지도의 거리 핀을 눌러 들어간 상세 페이지에서만 본다. */}
        </>
      )}
    </main>
  );
}

/**
 * 조건에 맞는 음식이 없을 때 목록 위에 세우는 알림.
 *
 * 점수만 보면 "취향 일치 98"이라 조건을 다 맞춘 것처럼 읽힌다. 그 점수는
 * "상관없음"을 뺀 나머지 배점의 비율이라 조건이 어긋나도 높게 나온다. 그래서
 * 대체 추천이라는 사실을 목록보다 먼저, 못 맞춘 조건까지 짚어서 밝힌다.
 */
function SubstitutionBanner({
  month,
  substituted,
  unmet,
}: {
  month: number;
  substituted: boolean;
  unmet: string[];
}) {
  return (
    <section className="px-5 pt-4">
      <div
        role="alert"
        className="overflow-hidden rounded-2xl border-2 border-brand bg-surface"
      >
        <div className="flex items-start gap-2.5 bg-brand px-4 py-3">
          <span aria-hidden="true" className="text-[20px] leading-none">
            ⚠️
          </span>
          <div className="min-w-0">
            <p className="font-display text-[19px] leading-tight text-fg-inverse">
              대체 추천입니다
            </p>
            <p className="mt-1 text-[13px] font-bold leading-snug text-fg-inverse">
              {substituted
                ? "고른 조건에 맞는 음식이 없습니다"
                : `${month}월 제철 중에는 조건에 맞는 음식이 없습니다`}
            </p>
          </div>
        </div>
        <p className="px-4 py-3 text-[12px] leading-relaxed text-fg">
          {substituted ? (
            <>
              {month}월 후보 중 <b className="font-bold">조건을 모두 만족하는 음식이 하나도 없어</b>,
              아래는 조건에 <b className="font-bold">가장 가까운 음식</b>을 대신 고른 것입니다.
              {unmet.length > 0 && (
                <>
                  {" "}
                  특히 <b className="font-bold text-brand">{unmet.join("·")}</b>
                  {withParticle(unmet[unmet.length - 1], "은/는").slice(-1)} 어떤 후보도
                  맞추지 못했습니다.
                </>
              )}{" "}
              카드의 <b className="font-bold text-brand">대체 추천</b> 표시와 ‘다만 …’ 줄에서
              어느 조건이 어긋났는지 확인하실 수 있습니다.
            </>
          ) : (
            <>
              조건에 맞는 음식은 있으나 {month}월 제철이 아닙니다. 앞뒤 한 달의 제철까지
              넓혀 <b className="font-bold">대신 추천</b>합니다.
            </>
          )}
        </p>
      </div>
    </section>
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
