import Link from "next/link";
import { notFound } from "next/navigation";

import { type MapMarker } from "@/components/RegionMap";
import { StreetMapPanel } from "@/components/StreetMapPanel";
import { TasteBadges } from "@/components/TasteChart";
import { findStreet, foods, streets } from "@/lib/data";
import { streetDisplayName } from "@/lib/korean";
import {
  matchStreets,
  preferenceFromQuery,
  preferenceToQuery,
  recommendFoods,
} from "@/lib/recommend";
import type { Food } from "@/lib/types";

export function generateStaticParams() {
  return streets.map((s) => ({ id: s.id }));
}

export default async function StreetPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const street = findStreet(id);
  if (!street) notFound();

  const query = await searchParams;
  const pref = preferenceFromQuery(query);

  // 이 거리와 실제로 연결되는 추천 음식만 남긴다. 상위 30건까지 훑어야
  // 특정 거리에 걸리는 음식이 충분히 잡힌다.
  const scored = recommendFoods(foods, pref, 30);
  const related = scored.filter((item) =>
    matchStreets(item.food, streets, 3).some((m) => m.street.id === street.id),
  );

  const markers: MapMarker[] = [];
  if (street.lat !== null && street.lon !== null) {
    markers.push({
      id: street.id,
      lat: street.lat,
      lon: street.lon,
      label: street.name,
      kind: "street",
      highlight: true,
    });
  }
  const shops: { food: Food; name: string; address: string; specialty: boolean }[] = [];
  for (const item of related.slice(0, 5)) {
    for (const r of item.food.restaurants) {
      shops.push({
        food: item.food,
        name: r.name,
        address: r.address,
        specialty: r.isLocalSpecialty,
      });
      if (r.lat !== null && r.lon !== null) {
        markers.push({
          id: `${item.food.id}-${r.id}`,
          lat: r.lat,
          lon: r.lon,
          label: r.name,
          kind: "restaurant",
        });
      }
    }
  }

  const mapQuery = encodeURIComponent(street.address || street.name);

  return (
    <main className="mx-auto min-h-dvh w-full max-w-[520px] bg-canvas pb-12">
      {/* 지도가 주인공이라 헤더는 얇은 앱바로 줄인다. */}
      <header className="bg-ink px-5 py-3 text-fg-inverse">
        <div className="flex items-center justify-between gap-3">
          <Link
            href={`/result?${preferenceToQuery(pref)}`}
            className="shrink-0 text-[13px] text-[#b8afa6] hover:text-fg-inverse"
          >
            ← 추천 목록
          </Link>
          <h1 className="font-display truncate text-[16px]">{streetDisplayName(street)}</h1>
          <span className="shrink-0 rounded-full bg-brand-soft px-2 py-0.5 text-[10px] font-bold text-brand">
            {street.category}
          </span>
        </div>
      </header>

      <StreetMapPanel baseMarkers={markers} nearby={street.nearby} />

      <section className="px-5 pt-3">
        {street.coordSource === "주소기반보정" && (
          <p className="mb-2 text-[11px] text-fg-muted">
            ※ 원본에 좌표가 없어 주소를 기준으로 보정한 위치입니다.
          </p>
        )}
        {street.lat === null && (
          <p className="mb-2 text-[11px] text-fg-muted">
            ※ 좌표가 없어 지도에 위치를 찍지 못했습니다. 아래 주소로 확인해 주세요.
          </p>
        )}
        <p className="text-[13px] text-fg-muted">{street.address}</p>
      </section>

      <section className="grid grid-cols-3 gap-2 px-5 pt-3">
        {/* 0은 "점포가 없다"가 아니라 "모른다"이다. 세어 본 적 없는 값을
            0곳으로 적으면 없는 사실을 만들어 낸다. */}
        <Stat label="점포" value={street.shopCount > 0 ? `${street.shopCount}곳` : "-"} />
        <Stat
          label="길이"
          value={
            street.lengthM <= 0
              ? "-"
              : street.lengthM >= 1000
                ? `${(street.lengthM / 1000).toFixed(1)} km`
                : `${street.lengthM} m`
          }
        />
        <Stat label="지정" value={street.designatedYear ? `${street.designatedYear}년` : "-"} />
      </section>

      {street.description && (
        <section className="px-5 pt-4">
          <p className="rounded-2xl bg-accent-soft px-4 py-3.5 text-[13px] leading-relaxed text-fg">
            {street.description}
          </p>
        </section>
      )}

      {street.foodKeywords.length > 0 && (
        <section className="px-5 pt-4">
          <h2 className="text-[13px] font-bold text-fg-muted">대표 먹거리</h2>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {street.foodKeywords.map((kw) => (
              <span
                key={kw}
                className="rounded-full border border-line bg-surface px-2.5 py-1 text-[13px] text-fg"
              >
                {kw}
              </span>
            ))}
          </div>
        </section>
      )}

      <section className="px-5 pt-6">
        <h2 className="font-display text-[20px]">여기서 맞을 만한 제철 음식</h2>
        {related.length === 0 ? (
          <p className="mt-3 rounded-2xl border border-line bg-surface-alt px-4 py-6 text-center text-[13px] leading-relaxed text-fg-muted">
            {pref.month}월 기준으로 이 거리와 연결되는 추천 음식이 없습니다.
            <br />
            다른 달을 골라 보세요.
          </p>
        ) : (
          <ul className="mt-3 space-y-2.5">
            {related.slice(0, 6).map((item) => (
              <li
                key={item.food.id}
                className="result-card flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-4 py-3"
              >
                <div className="min-w-0">
                  <h3 className="font-display truncate text-[17px]">{item.food.name}</h3>
                  <p className="mt-0.5 text-[12px] text-fg-muted">
                    {item.food.ingredient} · 파는 곳 {item.food.restaurantCount}곳
                  </p>
                  <div className="mt-1.5">
                    <TasteBadges food={item.food} compact />
                  </div>
                </div>
                <span className="font-display shrink-0 text-[18px] text-brand">
                  {item.match}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {shops.length > 0 && (
        <section className="px-5 pt-6">
          <h2 className="font-display text-[20px]">이 근처에서 파는 곳</h2>
          <ul className="mt-3 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
            {shops.slice(0, 8).map((shop, index) => (
              <li key={`${shop.name}-${index}`} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-[14px] font-medium text-fg">
                      {shop.name}
                    </span>
                    {shop.specialty && (
                      <span className="shrink-0 rounded-full bg-brand-soft px-1.5 py-0.5 text-[10px] font-bold text-brand">
                        향토
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-[12px] text-fg-muted">
                    {shop.food.name}
                  </p>
                </div>
                <a
                  href={`https://map.kakao.com/link/search/${encodeURIComponent(shop.address || shop.name)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 text-[12px] text-accent hover:underline"
                >
                  길찾기
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="px-5 pt-6">
        <a
          href={`https://map.kakao.com/link/search/${mapQuery}`}
          target="_blank"
          rel="noreferrer"
          className="block rounded-2xl bg-ink py-4 text-center text-[16px] font-bold text-fg-inverse"
        >
          지도에서 이 거리 열기
        </a>
      </section>

      <footer className="px-6 pt-6 text-[11px] leading-relaxed text-fg-muted">
        {street.orgName && (
          <p>
            관리기관 {street.orgName}
            {street.orgTel && ` · ${street.orgTel}`}
          </p>
        )}
        {/* 공공데이터에 없어 직접 넣은 거리가 있다. 출처를 싸잡아 적으면
            공공데이터가 보증하지 않는 항목까지 보증하는 것처럼 읽힌다. */}
        <p>
          {street.dataDate
            ? `공공데이터포털 지역특화거리 ${street.dataDate} 기준`
            : "공공데이터 지역특화거리 목록에는 없어 직접 추가한 거리입니다. 점포수·길이·지정연도 정보가 없습니다."}
        </p>
      </footer>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface py-3 text-center">
      <div className="text-[10px] font-bold text-fg-muted">{label}</div>
      <div className="mt-0.5 text-[16px] font-bold text-fg">{value}</div>
    </div>
  );
}
