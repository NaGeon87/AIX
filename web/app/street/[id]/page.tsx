import Link from "next/link";
import { notFound } from "next/navigation";

import { type MapMarker } from "@/components/RegionMap";
import { StreetMapPanel } from "@/components/StreetMapPanel";
import { findStreet, foods, streets } from "@/lib/data";
import type { Food, Restaurant } from "@/lib/types";

export function generateStaticParams() {
  return streets.map((street) => ({ id: street.id }));
}

function normalize(value: string) {
  return value.replace(/\s+/g, "").toLowerCase();
}

function foodMatchesStreet(food: Food, keywords: string[]) {
  const fields = [food.name, food.displayName, food.ingredient].map(normalize);
  return keywords.some((keyword) => {
    const key = normalize(keyword);
    return fields.some((field) => field.includes(key) || key.includes(field));
  });
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toRad = (degree: number) => (degree * Math.PI) / 180;
  const earth = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * earth * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

type Shop = {
  restaurant: Restaurant;
  menus: string[];
  distanceKm: number | null;
};

export default async function StreetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const street = findStreet(id);
  if (!street) notFound();

  const keywordFoods = foods.filter((food) => foodMatchesStreet(food, street.foodKeywords));
  const sourceFoods = keywordFoods.length > 0 ? keywordFoods : foods;
  const shopMap = new Map<string, { restaurant: Restaurant; menus: Set<string> }>();

  for (const food of sourceFoods) {
    for (const restaurant of food.restaurants) {
      if (restaurant.area !== street.sigungu) continue;
      const key = restaurant.id || `${restaurant.name}-${restaurant.address}`;
      const existing = shopMap.get(key);
      if (existing) {
        existing.menus.add(food.displayName || food.name);
      } else {
        shopMap.set(key, {
          restaurant,
          menus: new Set([food.displayName || food.name]),
        });
      }
    }
  }

  const shops: Shop[] = [...shopMap.values()]
    .map(({ restaurant, menus }) => ({
      restaurant,
      menus: [...menus].slice(0, 3),
      distanceKm:
        street.lat !== null &&
        street.lon !== null &&
        restaurant.lat !== null &&
        restaurant.lon !== null
          ? haversineKm(street.lat, street.lon, restaurant.lat, restaurant.lon)
          : null,
    }))
    .sort((a, b) => {
      if (a.distanceKm !== null && b.distanceKm !== null) return a.distanceKm - b.distanceKm;
      if (a.distanceKm !== null) return -1;
      if (b.distanceKm !== null) return 1;
      return Number(b.restaurant.isLocalSpecialty) - Number(a.restaurant.isLocalSpecialty);
    })
    .slice(0, 12);

  const markers: MapMarker[] = [];
  if (street.lat !== null && street.lon !== null) {
    markers.push({
      id: street.id,
      lat: street.lat,
      lon: street.lon,
      label: street.name,
      kind: "street",
      highlight: true,
      iconCode: street.iconCode,
      iconFallback: street.iconFallback,
      iconLabel: street.iconLabel,
    });
  }

  for (const shop of shops.slice(0, 8)) {
    if (shop.restaurant.lat === null || shop.restaurant.lon === null) continue;
    markers.push({
      id: `shop-${shop.restaurant.id}`,
      lat: shop.restaurant.lat,
      lon: shop.restaurant.lon,
      label: shop.restaurant.name,
      kind: "restaurant",
    });
  }

  return (
    <main className="mx-auto min-h-dvh w-full max-w-[720px] bg-canvas pb-12">
      <header className="bg-ink px-5 py-4 text-fg-inverse">
        <div className="flex items-center justify-between gap-3">
          <Link href="/taste" className="shrink-0 text-[13px] text-[#b8afa6] hover:text-fg-inverse">
            ← 음식거리 지도
          </Link>
          <h1 className="truncate font-display text-[17px]">{street.name}</h1>
          <span className="shrink-0 rounded-full bg-brand-soft px-2 py-0.5 text-[10px] font-bold text-brand">
            음식특화거리
          </span>
        </div>
      </header>

      <StreetMapPanel baseMarkers={markers} nearby={[]} />

      <section className="px-5 pt-5">
        <p className="text-[12px] font-bold text-brand">
          {street.sido} {street.sigungu}
        </p>
        <h2 className="mt-1 font-display text-[26px] text-fg">{street.name}</h2>
        <p className="mt-3 text-[14px] leading-relaxed text-fg-muted">
          {street.description || "지역 대표 음식점이 모여 있는 음식특화거리입니다."}
        </p>
        <p className="mt-3 rounded-xl bg-surface-alt px-3 py-2.5 text-[12px] text-fg-muted">
          📍 {street.address}
          <br />※ 지도 핀은 특정 점포의 출입구가 아니라 특화거리의 대표 부근을 표시합니다.
        </p>
      </section>

      {street.foodKeywords.length > 0 && (
        <section className="px-5 pt-5">
          <h2 className="text-[13px] font-bold text-fg-muted">대표 먹거리</h2>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {street.foodKeywords.map((keyword) => (
              <span
                key={keyword}
                className="rounded-full border border-line bg-surface px-3 py-1.5 text-[13px] text-fg"
              >
                {keyword}
              </span>
            ))}
          </div>
        </section>
      )}

      <section className="px-5 pt-7">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold text-brand">FOOD SHOPS</p>
            <h2 className="mt-0.5 font-display text-[22px] text-fg">근처 식당 추천</h2>
          </div>
          <p className="text-right text-[11px] text-fg-muted">
            거리 대표 위치 기준
            <br />가까운 순 우선
          </p>
        </div>

        {shops.length === 0 ? (
          <p className="mt-3 rounded-2xl border border-line bg-surface px-4 py-7 text-center text-[13px] leading-relaxed text-fg-muted">
            현재 음식 데이터에서 이 거리와 연결되는 등록 식당을 찾지 못했습니다.
          </p>
        ) : (
          <ul className="mt-3 space-y-2.5">
            {shops.map((shop, index) => (
              <li key={`${shop.restaurant.id}-${index}`} className="rounded-2xl border border-line bg-surface p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate text-[15px] font-bold text-fg">{shop.restaurant.name}</h3>
                      {shop.restaurant.isLocalSpecialty && (
                        <span className="shrink-0 rounded-full bg-brand-soft px-2 py-0.5 text-[10px] font-bold text-brand">
                          지역특화
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-[11px] text-fg-muted">{shop.restaurant.address}</p>
                    <p className="mt-2 text-[12px] text-fg">
                      {shop.menus.join(" · ")}
                    </p>
                  </div>
                  {shop.distanceKm !== null && (
                    <span className="shrink-0 rounded-full border border-line px-2.5 py-1 text-[11px] font-bold text-accent">
                      {shop.distanceKm < 1
                        ? `${Math.round(shop.distanceKm * 1000)}m`
                        : `${shop.distanceKm.toFixed(1)}km`}
                    </span>
                  )}
                </div>
                <a
                  href={`https://map.kakao.com/link/search/${encodeURIComponent(shop.restaurant.address || shop.restaurant.name)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 block rounded-xl border border-line-strong py-2.5 text-center text-[12px] font-bold text-fg hover:border-brand hover:text-brand"
                >
                  지도에서 식당 찾기
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="px-5 pt-7 text-[11px] leading-relaxed text-fg-muted">
        <p>식당 추천은 현재 프로젝트 음식 데이터에 등록된 식당 중 해당 시·군과 대표 음식이 연결되는 곳을 우선 사용합니다.</p>
      </footer>
    </main>
  );
}
