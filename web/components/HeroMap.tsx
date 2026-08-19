"use client";

import "leaflet/dist/leaflet.css";

import { useEffect, useRef } from "react";

import { streets } from "@/lib/data";

// 광주·전남 전역이 한눈에 들어오는 중심점과 줌. 시작 화면 배경이라 특정
// 지점을 가리킬 필요는 없고, "이 지역 전체를 다룬다"는 인상만 주면 된다.
const REGION_CENTER: [number, number] = [34.95, 126.95];
const REGION_ZOOM = 9;

/**
 * 시작 화면 배경으로 까는, 상호작용이 꺼진 지도.
 *
 * RegionMap과 따로 둔 이유: 저건 특정 추천 지점에 fitBounds로 맞춰
 * 확대하는 용도고, 이건 지역 전체를 고정된 구도로 보여주면서 클릭·드래그가
 * 전부 막혀 있어야 하는 정반대 용도다. 실제 특화거리 32곳을 옅은 점으로
 * 흩뿌려서, 이 서비스가 다루는 데이터의 지리적 범위를 배경만으로 보여준다.
 */
export function HeroMap({ className }: { className?: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;
    let map: import("leaflet").Map | undefined;

    import("leaflet").then((leafletModule) => {
      if (cancelled || !containerRef.current) return;
      const leaflet = leafletModule.default;

      map = leaflet.map(containerRef.current, {
        center: REGION_CENTER,
        zoom: REGION_ZOOM,
        zoomControl: false,
        dragging: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        touchZoom: false,
        boxZoom: false,
        keyboard: false,
        attributionControl: false,
      });

      leaflet
        .tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
        })
        .addTo(map);

      for (const street of streets) {
        if (street.lat === null || street.lon === null) continue;
        leaflet
          .circleMarker([street.lat, street.lon], {
            radius: 4,
            weight: 0,
            fillColor: "#fbf8f3",
            fillOpacity: 0.85,
          })
          .addTo(map);
      }
    });

    return () => {
      cancelled = true;
      map?.remove();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className={className}
      aria-hidden="true"
      style={{ filter: "grayscale(0.35) sepia(0.12) brightness(0.85)" }}
    />
  );
}
