"use client";

import "leaflet/dist/leaflet.css";

import type L from "leaflet";
import { useEffect, useRef } from "react";

export interface MapMarker {
  id: string;
  lat: number;
  lon: number;
  label: string;
  kind: "street" | "restaurant" | "me";
  /** 강조할 마커. 라벨을 항상 띄운다. */
  highlight?: boolean;
}

const STREET_COLOR = "#b23a22";
const RESTAURANT_COLOR = "#1f5f52";
// 내 위치는 추천 지점과 다른 계열의 색이어야 한다. 같은 붉은·초록 계열이면
// "가까운 집"과 "나"가 지도에서 섞여 보인다.
const ME_COLOR = "#2e6e8e";

const MARKER_COLOR: Record<MapMarker["kind"], string> = {
  street: STREET_COLOR,
  restaurant: RESTAURANT_COLOR,
  me: ME_COLOR,
};

function buildDivIcon(leaflet: typeof L, color: string, size: number): L.DivIcon {
  return leaflet.divIcon({
    className: "region-map-dot",
    html: `<span style="
      display:block;width:${size}px;height:${size}px;border-radius:999px;
      background:${color};border:2px solid #ffffff;
      box-shadow:0 1px 4px rgba(28,24,21,.35);
    "></span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

/**
 * OpenStreetMap 타일 위에 마커를 얹은 실제 지도.
 *
 * 이전 버전은 좌표를 SVG 격자에 직접 투영해 점만 찍었다 — 도로도 지형도
 * 없이 회색 배경에 점이 떠 있는 모양이라 "지도가 안 보인다"는 게 정확한
 * 지적이었다. 카카오·네이버 지도는 API 키가 필요해서, 키 없이 쓸 수 있는
 * OSM 표준 타일로 바꿨다.
 *
 * `leaflet`은 모듈 최상단에서 `window`를 참조하기 때문에 Next.js의
 * 서버 렌더 단계에서 그냥 import하면 "window is not defined"로 죽는다.
 * useEffect 안에서 동적 import로 불러와, 브라우저에서만 로드되게 한다.
 * react-leaflet 같은 래퍼를 쓰지 않는 이유도 같다 — React 19와의 peer
 * dependency 호환 범위가 자주 바뀌어서, 배포 시점에 버전이 어긋나는
 * 리스크를 지고 싶지 않았다.
 */
export function RegionMap({
  markers,
  height = 260,
}: {
  markers: MapMarker[];
  height?: number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);

  const points = markers.filter(
    (m) => Number.isFinite(m.lat) && Number.isFinite(m.lon),
  );
  // effect 의존성은 좌표·강조 여부로만 비교한다. markers는 매 렌더 새
  // 배열이라 참조로 비교하면 지도가 매번 다시 만들어져 깜빡인다.
  const pointsKey = points.map((p) => `${p.id}:${p.lat}:${p.lon}:${p.highlight}`).join("|");

  useEffect(() => {
    if (!containerRef.current || points.length === 0) return;

    let cancelled = false;
    let map: L.Map | undefined;

    import("leaflet").then((leafletModule) => {
      if (cancelled || !containerRef.current) return;
      const leaflet = leafletModule.default;

      map = leaflet.map(containerRef.current, {
        scrollWheelZoom: false, // 페이지를 스크롤하다 지도 위에서 확대되는 사고를 막는다
        attributionControl: true,
        zoomControl: true,
      });
      mapRef.current = map;

      leaflet
        .tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        })
        .addTo(map);

      const layerGroup = leaflet.layerGroup().addTo(map);

      // 강조 마커를 마지막에 그려 다른 점 위로 올린다.
      const ordered = [...points].sort(
        (a, b) => Number(Boolean(a.highlight)) - Number(Boolean(b.highlight)),
      );

      for (const m of ordered) {
        const color = MARKER_COLOR[m.kind];
        const size = m.highlight ? 20 : m.kind === "street" ? 15 : 10;
        const marker = leaflet.marker([m.lat, m.lon], {
          icon: buildDivIcon(leaflet, color, size),
        });
        marker.addTo(layerGroup);

        if (m.highlight) {
          marker.bindTooltip(m.label, {
            permanent: true,
            direction: "top",
            offset: [0, -size / 2 - 4],
            className: "region-map-label",
          });
        } else {
          marker.bindTooltip(m.label, { direction: "top" });
        }
      }

      if (points.length === 1) {
        map.setView([points[0].lat, points[0].lon], 14);
      } else {
        const bounds = leaflet.latLngBounds(points.map((p) => [p.lat, p.lon]));
        map.fitBounds(bounds, { padding: [32, 32], maxZoom: 15 });
      }
    });

    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pointsKey가 실질적인 의존성이다.
  }, [pointsKey]);

  if (points.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-2xl border border-line bg-accent-soft text-sm text-fg-muted"
        style={{ height }}
      >
        좌표 정보가 없어 지도를 그릴 수 없습니다
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      style={{ height }}
      // isolate: Leaflet이 내부 pane에 박아 두는 z-index(200~700)가
      // 페이지의 다른 요소와 충돌하지 않게 이 지도만의 stacking context로
      // 가둔다. 랜딩 페이지 배경 지도에서 버튼 클릭이 막힌 원인이었다.
      className="isolate w-full overflow-hidden rounded-2xl border border-line"
      role="img"
      aria-label={`추천 지점 ${points.length}곳의 위치 지도`}
    />
  );
}
