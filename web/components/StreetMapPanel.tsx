"use client";

import { useMemo, useState } from "react";

import { RegionMap, type MapMarker } from "@/components/RegionMap";
import type { NearbyPlace } from "@/lib/types";

/**
 * 거리 상세의 지도 히어로 + 주변 관광 탐색.
 *
 * 결과 화면과 같은 결로, 지도를 크게 띄우고 상세는 아래 시트에서 스크롤해
 * 본다. '주변 관광 정보 탐색'을 누르면 반경 안의 관광지가 지도에 보라 핀으로
 * 얹히고, 사진과 함께 목록으로 펼쳐진다. 기본은 접혀 있다 — 거리 상세를
 * 보러 온 사람에게 관광지를 먼저 들이밀지 않는다.
 */
export function StreetMapPanel({
  baseMarkers,
  nearby,
}: {
  /** 거리 자신 + 파는 집 마커. 항상 보인다. */
  baseMarkers: MapMarker[];
  nearby: NearbyPlace[];
}) {
  const [showNearby, setShowNearby] = useState(false);

  const nearbyMarkers = useMemo<MapMarker[]>(
    () =>
      nearby
        .filter((p) => p.lat !== null && p.lon !== null)
        .map((p) => ({
          id: `t-${p.id}`,
          lat: p.lat as number,
          lon: p.lon as number,
          label: p.title,
          kind: "tourism" as const,
        })),
    [nearby],
  );

  const markers = showNearby ? [...baseMarkers, ...nearbyMarkers] : baseMarkers;
  const hasMap = baseMarkers.some((m) => m.kind === "street");

  return (
    <>
      <section className="relative h-[56vh] w-full">
        {hasMap ? (
          <RegionMap markers={markers} height="100%" />
        ) : (
          <div className="flex h-full flex-col items-center justify-center bg-accent-soft px-8 text-center">
            <p className="font-display text-[18px] text-fg">지도에 위치를 찍지 못했습니다</p>
            <p className="mt-2 text-[13px] leading-relaxed text-fg-muted">
              이 거리는 좌표가 없습니다. 아래 주소로 확인해 주세요.
            </p>
          </div>
        )}
      </section>

      {/* 시트 머리. 여기서부터 상세를 스크롤해 본다. */}
      <section className="relative z-10 -mt-5 rounded-t-3xl border-t border-line bg-canvas px-5 pt-3 shadow-[0_-10px_30px_rgba(28,24,21,0.12)]">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line-strong" aria-hidden="true" />

        {nearby.length > 0 && (
          <div className="pb-1">
            <button
              type="button"
              onClick={() => setShowNearby((v) => !v)}
              aria-expanded={showNearby}
              className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-2xl border border-texture/40 bg-surface px-4 py-3 transition-colors hover:border-texture"
            >
              <span className="min-w-0 text-left">
                <span className="block text-[14px] font-bold text-texture">
                  🧭 주변 관광 정보 탐색
                </span>
                <span className="mt-0.5 block text-[12px] text-fg-muted">
                  이 거리 반경 5km 안의 관광지 {nearby.length}곳
                </span>
              </span>
              <span
                className="shrink-0 text-[11px] text-fg-muted transition-transform"
                style={{ transform: showNearby ? "rotate(180deg)" : undefined }}
                aria-hidden="true"
              >
                ▼
              </span>
            </button>

            {showNearby && (
              <ul className="mt-3 space-y-2.5">
                {nearby.map((p) => (
                  <li key={p.id}>
                    <a
                      href={`https://map.kakao.com/link/search/${encodeURIComponent(
                        p.addr || p.title,
                      )}`}
                      target="_blank"
                      rel="noreferrer"
                      className="flex gap-3 rounded-2xl border border-line bg-surface p-2.5 transition-colors hover:border-texture"
                    >
                      {p.image ? (
                        // eslint-disable-next-line @next/next/no-img-element -- TourAPI 원격 이미지, next/image 도메인 설정 없이 그대로 쓴다
                        <img
                          src={p.image}
                          alt=""
                          loading="lazy"
                          className="h-16 w-16 shrink-0 rounded-xl object-cover"
                        />
                      ) : (
                        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-[20px]">
                          🏞️
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <h4 className="truncate text-[14px] font-bold text-fg">{p.title}</h4>
                          <span className="shrink-0 text-[11px] text-fg-muted">
                            {p.dist >= 1000 ? `${(p.dist / 1000).toFixed(1)}km` : `${p.dist}m`}
                          </span>
                        </div>
                        <p className="mt-0.5 text-[11px] text-texture">{p.type}</p>
                        <p className="mt-0.5 truncate text-[12px] text-fg-muted">{p.addr}</p>
                      </div>
                    </a>
                  </li>
                ))}
                <li className="px-1 pt-0.5 text-[11px] text-fg-muted">
                  한국관광공사 TourAPI · 이 거리에서 가까운 순
                </li>
              </ul>
            )}
          </div>
        )}
      </section>
    </>
  );
}
