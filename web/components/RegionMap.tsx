"use client";

import "leaflet/dist/leaflet.css";

import type L from "leaflet";
import { useEffect, useRef } from "react";

export interface MapMarker {
  id: string;
  lat: number;
  lon: number;
  label: string;
  kind: "street" | "food" | "restaurant" | "me" | "tourism";
  /** 강조할 마커. 라벨을 항상 띄운다. */
  highlight?: boolean;
  /** 음식거리 대표 OpenMoji 코드. street 마커에서만 사용한다. */
  iconCode?: string;
  /** SVG를 불러오지 못했을 때 보여줄 대체 이모지 */
  iconFallback?: string;
  /** 대표 음식 이름 */
  iconLabel?: string;
}

const STREET_COLOR = "#b23a22";
const RESTAURANT_COLOR = "#1f5f52";
// 내 위치는 추천 지점과 다른 계열의 색이어야 한다. 같은 붉은·초록 계열이면
// "가까운 집"과 "나"가 지도에서 섞여 보인다.
const ME_COLOR = "#2e6e8e";
// 관광지는 음식·거리와 또 다른 계열(보라)로 둔다.
const TOURISM_COLOR = "#6b4a8f";

const MARKER_COLOR: Record<MapMarker["kind"], string> = {
  street: STREET_COLOR,
  food: STREET_COLOR,
  restaurant: RESTAURANT_COLOR,
  me: ME_COLOR,
  tourism: TOURISM_COLOR,
};

const STREET_ICON_SRC: Record<string, string> = {
  ST001: "/street-icons/08-bulgogi.png",
  ST002: "/street-icons/19-bibimbap.png",
  ST003: "/street-icons/06-dakgui.png",
  ST004: "/street-icons/16-dwaeji-bulgogi.png",
  ST005: "/street-icons/11-samchi.png",
  ST006: "/street-icons/09-jangeo.png",
  ST007: "/street-icons/05-chamge.png",
  ST008: "/street-icons/08-bulgogi.png",
  ST009: "/street-icons/19-bibimbap.png",
  ST010: "/street-icons/09-jangeo.png",
  ST011: "/street-icons/18-gomtang.png",
  ST012: "/street-icons/17-hongeo.png",
  ST013: "/street-icons/19-bibimbap.png",
  ST014: "/street-icons/03-juksun.png",
  ST015: "/street-icons/04-gukbap.png",
  ST016: "/street-icons/21-minuh.png",
  ST017: "/street-icons/20-nakji.png",
  ST018: "/street-icons/13-bajirak.png",
  ST019: "/street-icons/07-gopchang.png",
  ST020: "/street-icons/04-gukbap.png",
  ST021: "/street-icons/06-dakgui.png",
  ST022: "/street-icons/20-nakji.png",
  ST023: "/street-icons/09-jangeo.png",
  ST024: "/street-icons/07-gopchang.png",
  ST025: "/street-icons/05-chamge.png",
  ST026: "/street-icons/09-jangeo.png",
  ST027: "/street-icons/10-haemul-samhap.png",
  ST028: "/street-icons/01-gulbi.png",
  ST029: "/street-icons/22-dokcheon-nakji.png",
  ST030: "/street-icons/14-jeonbok.png",
  ST031: "/street-icons/02-mirak.png",
  ST032: "/street-icons/12-kijogae.png",
  ST033: "/street-icons/15-hanwoo.png",
  ST034: "/street-icons/23-ganjaemi.png",
  ST035: "/street-icons/19-bibimbap.png",
  ST036: "/street-icons/06-dakgui.png",
};

function escapeHtmlAttr(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function buildFoodIcon(
  leaflet: typeof L,
  marker: MapMarker,
  opts: { interactive?: boolean; selected?: boolean } = {},
): L.DivIcon {
  const size = opts.selected ? 60 : 50;
  const inner = opts.selected ? 48 : 40;
  const cursor = opts.interactive ? "cursor:pointer;" : "";
  const fallback = marker.iconFallback ?? "🍽️";
  const localSrc = STREET_ICON_SRC[marker.id];
  const title = escapeHtmlAttr(marker.iconLabel ?? marker.label);
  const outline = [
    "drop-shadow(1px 0 0 rgba(255,255,255,.98))",
    "drop-shadow(-1px 0 0 rgba(255,255,255,.98))",
    "drop-shadow(0 1px 0 rgba(255,255,255,.98))",
    "drop-shadow(0 -1px 0 rgba(255,255,255,.98))",
    "drop-shadow(1px 1px 0 rgba(255,255,255,.98))",
    "drop-shadow(-1px -1px 0 rgba(255,255,255,.98))",
    "drop-shadow(-1px 1px 0 rgba(255,255,255,.98))",
    "drop-shadow(1px -1px 0 rgba(255,255,255,.98))",
  ].join(" ");
  const shadow = opts.selected
    ? "drop-shadow(0 10px 18px rgba(28,24,21,.34))"
    : "drop-shadow(0 6px 12px rgba(28,24,21,.24))";
  const img = localSrc
    ? `<img src="${localSrc}" alt="" style="width:${inner}px;height:${inner}px;object-fit:contain;transform:${opts.selected ? "scale(1.08)" : "scale(1)"};filter:${outline} ${shadow};" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" />`
    : "";

  return leaflet.divIcon({
    className: "region-map-food-icon",
    html: `<span title="${title}" style="position:relative;display:flex;align-items:center;justify-content:center;width:${size}px;height:${size}px;background:transparent;${cursor}">
      ${img}
      <span aria-hidden="true" style="display:${localSrc ? "none" : "flex"};align-items:center;justify-content:center;width:${inner}px;height:${inner}px;font-size:${opts.selected ? 28 : 24}px;line-height:1;filter:${shadow};">${fallback}</span>
    </span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function buildDivIcon(
  leaflet: typeof L,
  color: string,
  size: number,
  opts: { interactive?: boolean; ring?: boolean } = {},
): L.DivIcon {
  const cursor = opts.interactive ? "cursor:pointer;" : "";
  // 선택된 핀은 흰 테두리를 두껍게 하고 옅은 링을 둘러 눈에 띄게 한다.
  const ring = opts.ring ? `box-shadow:0 0 0 4px ${color}44,0 1px 4px rgba(28,24,21,.35);` : "box-shadow:0 1px 4px rgba(28,24,21,.35);";
  return leaflet.divIcon({
    className: "region-map-dot",
    html: `<span style="
      display:block;width:${size}px;height:${size}px;border-radius:999px;
      background:${color};border:${opts.ring ? 3 : 2}px solid #ffffff;${ring}${cursor}
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
  onSelect,
  selectedId,
  lockToJeonnam = false,
}: {
  markers: MapMarker[];
  height?: number | string;
  /** 마커를 누르면 그 id를 돌려준다. 주면 마커가 클릭 가능해진다. */
  onSelect?: (id: string) => void;
  /** 강조해서 가운데로 옮길 마커. 선택이 바뀌어도 지도를 다시 만들지 않는다. */
  selectedId?: string;
  /** 전라남도 권역 안에서만 지도를 탐색하도록 제한한다. */
  lockToJeonnam?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  // 선택이 바뀔 때 지도를 통째로 다시 그리면 확대·중심이 초기화되고 깜빡인다.
  // 마커를 id로 들고 있다가, 선택만 바뀌면 그 자리로 옮기고 라벨만 연다.
  const markerRefs = useRef<Map<string, L.Marker>>(new Map());
  const leafletRef = useRef<typeof L | null>(null);
  // onSelect가 매 렌더 새 함수여도 지도를 다시 만들지 않게 ref로 우회한다.
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  });

  const points = markers.filter(
    (m) => Number.isFinite(m.lat) && Number.isFinite(m.lon),
  );
  // effect 의존성은 좌표·강조 여부로만 비교한다. markers는 매 렌더 새
  // 배열이라 참조로 비교하면 지도가 매번 다시 만들어져 깜빡인다.
  const pointsKey = points.map((p) => `${p.id}:${p.lat}:${p.lon}`).join("|");

  useEffect(() => {
    if (!containerRef.current || points.length === 0) return;

    let cancelled = false;
    let map: L.Map | undefined;

    import("leaflet").then((leafletModule) => {
      if (cancelled || !containerRef.current) return;
      const leaflet = leafletModule.default;

      // 전남 음식 탐색 화면에서는 사용자가 지도를 멀리 끌어 다른 지역으로
      // 벗어나지 않도록 넉넉한 전남 권역 경계를 maxBounds로 둔다.
      const jeonnamOuterBounds = leaflet.latLngBounds(
        [33.85, 124.85],
        [35.65, 128.05],
      );

      map = leaflet.map(containerRef.current, {
        scrollWheelZoom: false,
        attributionControl: true,
        zoomControl: true,
        ...(lockToJeonnam
          ? {
              maxBounds: jeonnamOuterBounds,
              maxBoundsViscosity: 1,
              minZoom: 8,
            }
          : {}),
      });
      mapRef.current = map;

      leaflet
        .tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        })
        .addTo(map);

      leafletRef.current = leaflet;
      const layerGroup = leaflet.layerGroup().addTo(map);
      markerRefs.current = new Map();

      // 강조 마커를 마지막에 그려 다른 점 위로 올린다.
      const ordered = [...points].sort(
        (a, b) => Number(Boolean(a.highlight)) - Number(Boolean(b.highlight)),
      );

      for (const m of ordered) {
        const color = MARKER_COLOR[m.kind];
        const size = m.highlight ? 20 : m.kind === "street" ? 15 : 12;
        const clickable = Boolean(onSelectRef.current) && m.kind !== "me";
        const markerIcon = m.kind === "street"
          ? buildFoodIcon(leaflet, m, { interactive: clickable, selected: Boolean(m.highlight) })
          : buildDivIcon(leaflet, color, size, { interactive: clickable, ring: Boolean(m.highlight) });
        const marker = leaflet.marker([m.lat, m.lon], {
          icon: markerIcon,
          interactive: true,
          keyboard: false,
        });
        marker.addTo(layerGroup);
        markerRefs.current.set(m.id, marker);

        if (clickable) {
          marker.on("click", () => onSelectRef.current?.(m.id));
        }

        if (m.highlight) {
          marker.bindTooltip(m.label, {
            permanent: true,
            direction: "top",
            offset: [0, m.kind === "street" ? -30 : -size / 2 - 4],
            className: "region-map-label",
          });
        } else {
          marker.bindTooltip(m.label, { direction: "top" });
        }
      }

      if (lockToJeonnam) {
        map.setView([34.72, 126.72], 9);
      } else if (points.length === 1) {
        map.setView([points[0].lat, points[0].lon], 14);
      } else {
        const bounds = leaflet.latLngBounds(points.map((p) => [p.lat, p.lon]));
        map.fitBounds(bounds, { padding: [32, 32], maxZoom: 15 });
      }

      if (selectedId) {
        const selectedMarker = markerRefs.current.get(selectedId);
        if (selectedMarker) {
          const pos = selectedMarker.getLatLng();
          window.setTimeout(() => {
            if (!cancelled && map) {
              map.flyTo(pos, Math.max(map.getZoom(), 13), {
                animate: true,
                duration: 1.15,
              });
              selectedMarker.openTooltip();
            }
          }, 120);
        }
      }
    });

    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
      markerRefs.current = new Map();
    };
  }, [pointsKey, lockToJeonnam]);

  useEffect(() => {
    const leaflet = leafletRef.current;
    if (leaflet) {
      for (const point of points) {
        if (point.kind !== "street" && point.kind !== "food") continue;
        const mapMarker = markerRefs.current.get(point.id);
        if (!mapMarker) continue;
        if (point.kind === "street") {
          mapMarker.setIcon(buildFoodIcon(leaflet, point, {
            interactive: Boolean(onSelectRef.current),
            selected: point.id === selectedId,
          }));
        } else {
          mapMarker.setIcon(buildDivIcon(
            leaflet,
            MARKER_COLOR.food,
            point.id === selectedId ? 20 : 12,
            { interactive: Boolean(onSelectRef.current), ring: point.id === selectedId },
          ));
        }
      }
    }

    if (!selectedId) return;
    const map = mapRef.current;
    const marker = markerRefs.current.get(selectedId);
    if (!map || !marker) return;
    const pos = marker.getLatLng();
    map.flyTo(pos, Math.max(map.getZoom(), 13), { animate: true, duration: 1.15 });
    marker.openTooltip();
  }, [selectedId]);

  if (points.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-2xl border border-line bg-accent-soft text-sm text-fg-muted"
        style={{ height: typeof height === "number" ? `${height}px` : height }}
      >
        좌표 정보가 없어 지도를 그릴 수 없습니다
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      style={{ height: typeof height === "number" ? `${height}px` : height }}
      className="isolate h-full w-full overflow-hidden border border-line lg:rounded-none"
      role="img"
      aria-label={`추천 지점 ${points.length}곳의 위치 지도`}
    />
  );
}
