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
  /** 내부 정렬용. 화면에는 노출하지 않는다. */
  distanceKm: number | null;
};

function extractLocality(address: string) {
  const match = address.match(/([가-힣0-9]+(?:읍|면|동))/);
  return match?.[1] ?? null;
}

function centroid(restaurants: Restaurant[]) {
  const points = restaurants.filter(
    (restaurant) => restaurant.lat !== null && restaurant.lon !== null,
  );
  if (points.length === 0) return null;

  return {
    lat: points.reduce((sum, restaurant) => sum + (restaurant.lat as number), 0) / points.length,
    lon: points.reduce((sum, restaurant) => sum + (restaurant.lon as number), 0) / points.length,
  };
}

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

  const allShops: Shop[] = [...shopMap.values()].map(({ restaurant, menus }) => ({
    restaurant,
    menus: [...menus].slice(0, 3),
    distanceKm:
      street.lat !== null &&
      street.lon !== null &&
      restaurant.lat !== null &&
      restaurant.lon !== null
        ? haversineKm(street.lat, street.lon, restaurant.lat, restaurant.lon)
        : null,
  }));

  // 시·군 전체를 '거리 식당'으로 잡으면 같은 군 안의 20~30km 떨어진 식당까지
  // 섞일 수 있다. 주소에서 읍·면·동을 읽을 수 있으면 그 생활권을 최우선으로
  // 묶고, 그렇지 않으면 기존 대표점 반경 8km 안의 식당을 거리 군집으로 본다.
  const streetLocality = extractLocality(street.address);
  const localityShops = streetLocality
    ? allShops.filter((shop) => shop.restaurant.address.includes(streetLocality))
    : [];
  const radiusShops = allShops.filter(
    (shop) => shop.distanceKm !== null && shop.distanceKm <= 8,
  );

  const clusteredShops =
    localityShops.length > 0
      ? localityShops
      : radiusShops.length > 0
        ? radiusShops
        : [...allShops]
            .sort((a, b) => (a.distanceKm ?? Number.POSITIVE_INFINITY) - (b.distanceKm ?? Number.POSITIVE_INFINITY))
            .slice(0, 6);

  const representative = centroid(clusteredShops.map((shop) => shop.restaurant)) ??
    (street.lat !== null && street.lon !== null ? { lat: street.lat, lon: street.lon } : null);

  const shops: Shop[] = clusteredShops
    .map((shop) => ({
      ...shop,
      distanceKm:
        representative && shop.restaurant.lat !== null && shop.restaurant.lon !== null
          ? haversineKm(
              representative.lat,
              representative.lon,
              shop.restaurant.lat,
              shop.restaurant.lon,
            )
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
  if (representative) {
    markers.push({
      id: street.id,
      lat: representative.lat,
      lon: representative.lon,
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
          <br />※ 지도 핀은 연결된 거리 식당들의 위치를 바탕으로 계산한 대략적인 중심을 표시합니다.
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
            같은 거리 생활권의
            <br />등록 식당 우선
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
        <p>식당 추천은 대표 음식과 연결된 식당 중 거리 주소의 읍·면·동 생활권을 우선 사용하고, 생활권 정보를 찾기 어려운 경우 대표 위치 주변 식당을 사용합니다.</p>
      </footer>
    </main>
  );
}
