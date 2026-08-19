import Link from "next/link";
import { notFound } from "next/navigation";

import { foods } from "@/lib/data";
import { seasonNote } from "@/lib/season-notes";
import { SPICY_LEVELS } from "@/lib/types";

type Params = Promise<{ id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function spicyLabel(level: number) {
  return SPICY_LEVELS.find((item) => item.value === level)?.label ?? `${level}`;
}

export default async function FoodDetailPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  const query = await searchParams;
  const place = one(query.place);
  const food = foods.find((item) => item.id === decodeURIComponent(id));
  if (!food) notFound();

  const note = seasonNote(food.ingredient);
  const placeToken = place.replace(/\s+/g, "");
  const filteredRestaurants = place
    ? food.restaurants.filter((restaurant) => {
        const regionArea = `${restaurant.region}${restaurant.area}`.replace(/\s+/g, "");
        return regionArea.includes(placeToken) || placeToken.includes(restaurant.region) || placeToken.includes(restaurant.area);
      })
    : food.restaurants;
  const restaurants = (filteredRestaurants.length ? filteredRestaurants : food.restaurants).slice(0, 12);
  const regions = Array.from(new Set(restaurants.map((restaurant) => `${restaurant.region} ${restaurant.area}`)));

  return (
    <main className="min-h-dvh bg-canvas px-5 py-8 text-fg">
      <div className="mx-auto w-full max-w-[860px]">
        <Link href="/taste" className="text-[12px] font-bold text-brand">
          ← 음식 추천 지도로 돌아가기
        </Link>

        <header className="mt-4 rounded-3xl border border-line bg-surface p-6 shadow-sm">
          <p className="text-[11px] font-bold text-brand">FOOD DETAIL</p>
          <h1 className="mt-1 font-display text-[34px] leading-tight">{food.displayName || food.name}</h1>
          <p className="mt-2 text-[13px] text-fg-muted">
            {food.ingredient} · 맵기 {food.spicy}단계 ({spicyLabel(food.spicy)}) · {food.hasSoup ? "국물 있음" : "국물 없음"} · {food.isRaw ? "날것" : "익힌 음식"}
          </p>
          {place && (
            <p className="mt-3 rounded-xl bg-accent-soft px-3 py-2 text-[12px] font-medium text-accent">
              자연어 추천에서 지정한 지역 · {place}
            </p>
          )}
        </header>

        <section className="mt-6 grid gap-4 md:grid-cols-2">
          <article className="rounded-2xl border border-line bg-surface p-5">
            <p className="text-[11px] font-bold text-brand">WHY NOW</p>
            <h2 className="mt-1 font-display text-[23px]">왜 이 시기에 먹나요?</h2>
            <p className="mt-3 text-[13px] leading-relaxed text-fg-muted">
              {note?.when ?? (food.months.length > 0
                ? `${food.ingredient}은(는) 현재 데이터에서 ${food.months.join("·")}월 제철 재료로 연결되어 있습니다. 구체적인 생태·수확 근거는 데이터에 없어 임의로 덧붙이지 않았습니다.`
                : "이 음식은 현재 데이터에서 특정 제철 월이 명확히 연결되어 있지 않습니다. 계절보다 취향과 지역성을 중심으로 보시는 편이 좋습니다.")}
            </p>
          </article>

          <article className="rounded-2xl border border-line bg-surface p-5">
            <p className="text-[11px] font-bold text-brand">WHY HERE</p>
            <h2 className="mt-1 font-display text-[23px]">왜 이 지역에서 먹나요?</h2>
            <p className="mt-3 text-[13px] leading-relaxed text-fg-muted">
              {note?.where ?? (regions.length > 0
                ? `현재 음식 데이터에는 ${regions.slice(0, 5).join(", ")} 등에 이 메뉴를 취급하는 식당이 등록되어 있습니다. 지역 고유의 유래나 산지 근거가 별도 데이터로 확인되지 않아 그 이상은 추정하지 않습니다.`
                : "현재 등록된 식당 지역 정보가 부족해 특정 지역에서 먹어야 하는 근거를 확인하기 어렵습니다.")}
            </p>
          </article>
        </section>

        <section className="mt-6 rounded-3xl border border-line bg-surface p-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-[11px] font-bold text-brand">RESTAURANTS</p>
              <h2 className="mt-1 font-display text-[24px]">
                {place ? `${place}에서 먹을 수 있는 곳` : "등록된 음식점"}
              </h2>
            </div>
            <span className="text-[11px] text-fg-muted">전체 등록 {food.restaurantCount}곳</span>
          </div>

          {restaurants.length > 0 ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {restaurants.map((restaurant) => (
                <article key={restaurant.id} className="rounded-2xl border border-line bg-canvas p-4">
                  <p className="text-[10px] font-bold text-brand">{restaurant.region} {restaurant.area}</p>
                  <h3 className="mt-1 font-display text-[18px]">{restaurant.name}</h3>
                  <p className="mt-2 text-[12px] leading-relaxed text-fg-muted">{restaurant.address}</p>
                  <Link
                    href={`/nearby?restaurant=${encodeURIComponent(restaurant.name)}&food=${encodeURIComponent(food.displayName || food.name)}&region=${encodeURIComponent(restaurant.region)}&area=${encodeURIComponent(restaurant.area)}&lat=${restaurant.lat ?? ""}&lon=${restaurant.lon ?? ""}`}
                    className="mt-3 inline-block text-[12px] font-bold text-accent hover:text-brand hover:underline"
                  >
                    근처 관광지 · 축제 보기 →
                  </Link>
                </article>
              ))}
            </div>
          ) : (
            <p className="mt-4 rounded-2xl bg-canvas p-4 text-[13px] text-fg-muted">등록된 식당이 없습니다.</p>
          )}
        </section>
      </div>
    </main>
  );
}
