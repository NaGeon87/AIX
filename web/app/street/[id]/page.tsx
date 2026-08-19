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
  /** 대표 먹거리 데이터에 직접 연결됐는지, 지역 식당 보충인지 구분한다. */
  relation: "related" | "local";
  /** 내부 정렬용. 화면에는 노출하지 않는다. */
  distanceKm: number | null;
};

const MIN_VISIBLE_SHOPS = 6;
const MAX_VISIBLE_SHOPS = 12;

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

  const collectShops = (sourceFoods: Food[], relation: Shop["relation"]) => {
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

    return [...shopMap.values()].map<Shop>(({ restaurant, menus }) => ({
      restaurant,
      menus: [...menus].slice(0, 3),
      relation,
      distanceKm:
        street.lat !== null &&
        street.lon !== null &&
        restaurant.lat !== null &&
        restaurant.lon !== null
          ? haversineKm(street.lat, street.lon, restaurant.lat, restaurant.lon)
          : null,
    }));
  };

  const sortShops = (items: Shop[]) =>
    [...items].sort((a, b) => {
      if (a.distanceKm !== null && b.distanceKm !== null) return a.distanceKm - b.distanceKm;
      if (a.distanceKm !== null) return -1;
      if (b.distanceKm !== null) return 1;
      return Number(b.restaurant.isLocalSpecialty) - Number(a.restaurant.isLocalSpecialty);
    });

  // 1순위: 거리의 대표 먹거리와 직접 연결되고 같은 시·군에 있는 식당.
  const relatedShops = sortShops(collectShops(keywordFoods, "related"));

  // 데이터가 희소한 거리에서는 화면이 0~1개로 끝나지 않도록 같은 시·군의
  // 등록 식당을 별도 '지역 추가' 표기로 보충한다. 대표 먹거리 식당인 것처럼
  // 섞어 쓰지 않고 UI에서 출처를 구분해 데이터 부족을 숨기지 않는다.
  const relatedIds = new Set(relatedShops.map((shop) => shop.restaurant.id));
  const localFallback = sortShops(collectShops(foods, "local")).filter(
    (shop) => !relatedIds.has(shop.restaurant.id),
  );

  const shops: Shop[] = relatedShops.slice(0, MAX_VISIBLE_SHOPS);
  if (shops.length < MIN_VISIBLE_SHOPS) {
    shops.push(
      ...localFallback.slice(0, Math.min(
        MAX_VISIBLE_SHOPS - shops.length,
        MIN_VISIBLE_SHOPS - shops.length,
      )),
    );
  }

  // 지도에는 최대 8개 식당을 표시한다. 거리 아이콘은 바로 이 식당들의
  // 중앙점에 놓는다. 좌표가 하나도 없을 때만 원래 거리 좌표를 사용한다.
  const mapShops = shops
    .filter((shop) => shop.restaurant.lat !== null && shop.restaurant.lon !== null)
    .slice(0, 8);

  const representative = centroid(mapShops.map((shop) => shop.restaurant)) ??
    (street.lat !== null && street.lon !== null ? { lat: street.lat, lon: street.lon } : null);

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

  for (const shop of mapShops) {
    if (shop.restaurant.lat === null || shop.restaurant.lon === null) continue;
    markers.push({
      id: `shop-${shop.restaurant.id}`,
      lat: shop.restaurant.lat,
      lon: shop.restaurant.lon,
      label:
        shop.relation === "related"
          ? shop.restaurant.name
          : `지역 추가 · ${shop.restaurant.name}`,
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
          <br />※ 거리 아이콘은 현재 지도에 표시된 관련 식당들의 좌표 중심에 표시됩니다.
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
            대표음식 연결 {relatedShops.length}곳
            <br />현재 표시 {shops.length}곳
          </p>
        </div>

        {relatedShops.length < MIN_VISIBLE_SHOPS && shops.length > relatedShops.length && (
          <div className="mt-3 rounded-2xl border border-soup/40 bg-surface-alt px-4 py-3 text-[12px] leading-relaxed text-fg-muted">
            <b className="font-bold text-fg">대표 먹거리와 직접 연결된 식당 데이터가 {relatedShops.length}곳뿐입니다.</b>{" "}
            식당이 너무 적거나 비어 보이지 않도록 같은 {street.sigungu}의 등록 식당을
            <b className="font-bold text-soup"> 지역 추가</b>로 구분해 함께 표시합니다.
            {street.shopCount > 0 && (
              <> 공식 거리 데이터의 점포 수는 {street.shopCount}곳으로 기록되어 있어 현재 음식 DB가 전체 업소를 모두 포함하지는 않습니다.</>
            )}
          </div>
        )}

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
                      {shop.relation === "local" && (
                        <span className="shrink-0 rounded-full bg-surface-alt px-2 py-0.5 text-[10px] font-bold text-soup">
                          지역 추가
                        </span>
                      )}
                      {shop.restaurant.isLocalSpecialty && (
                        <span className="shrink-0 rounded-full bg-brand-soft px-2 py-0.5 text-[10px] font-bold text-brand">
                          지역특화
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-[11px] text-fg-muted">{shop.restaurant.address}</p>
                    <p className="mt-2 text-[12px] text-fg">
                      {shop.relation === "related" ? "대표 먹거리 연결 · " : "지역 등록 메뉴 · "}
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
        <p>대표 먹거리와 직접 연결된 식당을 먼저 표시합니다. 현재 음식 DB의 직접 연결 식당이 적은 거리만 같은 시·군의 등록 식당을 ‘지역 추가’로 보충하며, 거리 아이콘은 실제 지도에 표시된 식당들의 좌표 중심에 놓습니다.</p>
      </footer>
    </main>
  );
}
