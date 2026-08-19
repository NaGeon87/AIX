"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { OptionGroup } from "@/components/OptionGroup";
import { RegionMap, type MapMarker } from "@/components/RegionMap";
import { TasteBadges } from "@/components/TasteChart";
import { WhyThisFood } from "@/components/WhyThisFood";
import {
  LOW_CONFIDENCE,
  formatDistance,
  rankByDistance,
  type NearbyCandidate,
  type NearbyFood,
  type Preference,
} from "@/lib/recommend";

export type SortMode = "취향순" | "거리순";

interface Coords {
  lat: number;
  lon: number;
}

/**
 * 위치는 있거나 없거나가 아니라 네 가지 상태를 갖는다. 버튼 하나로 뭉뚱그리면
 * "눌렀는데 아무 일도 안 일어난다"로 보이는 구간(locating)이 생긴다.
 */
type LocationState =
  | { status: "idle" }
  | { status: "locating" }
  | { status: "ready"; coords: Coords }
  | { status: "error"; message: string };

/** 브라우저가 주는 코드를 사람이 읽을 문장으로. 무엇을 하면 되는지까지 적는다. */
function describeGeolocationError(error: GeolocationPositionError): string {
  switch (error.code) {
    case error.PERMISSION_DENIED:
      return "위치 권한이 거부되었습니다. 주소창의 자물쇠 아이콘에서 위치를 허용한 뒤 다시 눌러 주세요.";
    case error.POSITION_UNAVAILABLE:
      return "지금은 위치를 확인할 수 없습니다. 잠시 뒤 다시 시도해 주세요.";
    case error.TIMEOUT:
      return "위치 확인이 오래 걸립니다. 다시 시도해 주세요.";
    default:
      return "위치를 가져오지 못했습니다. 다시 시도해 주세요.";
  }
}

export function FoodRecommendations({
  candidates,
  streetMarkers,
  pref,
  prefQuery,
  limit = 4,
}: {
  /** 취향순으로 이미 정렬된 제철 후보 전부. */
  candidates: NearbyCandidate[];
  /** 지도에 함께 찍을 특화거리 마커. 정렬 모드와 무관하게 그대로 둔다. */
  streetMarkers: MapMarker[];
  /** 채점을 화면에서 그대로 되짚기 위해 취향 자체를 넘긴다. */
  pref: Preference;
  /** 특화거리 링크에 취향을 그대로 물려주기 위한 쿼리스트링. */
  prefQuery: string;
  limit?: number;
}) {
  const [sort, setSort] = useState<SortMode>("취향순");
  const [location, setLocation] = useState<LocationState>({ status: "idle" });

  const byPreference = useMemo(() => candidates.slice(0, limit), [candidates, limit]);

  const byDistance = useMemo<NearbyFood[]>(() => {
    if (location.status !== "ready") return [];
    return rankByDistance(candidates, location.coords, limit);
  }, [candidates, location, limit]);

  // 위치를 못 받은 동안에는 거리순을 고를 수 없으므로 취향순으로 되돌린다.
  const activeSort: SortMode = location.status === "ready" ? sort : "취향순";

  const markers = useMemo<MapMarker[]>(() => {
    const showing =
      activeSort === "거리순" ? byDistance.map((d) => d.candidate) : byPreference;

    const list: MapMarker[] = [...streetMarkers];
    for (const candidate of showing) {
      for (const spot of candidate.spots) {
        list.push({
          id: `${candidate.id}-${spot.name}-${spot.lat}`,
          lat: spot.lat,
          lon: spot.lon,
          label: spot.name,
          kind: "restaurant",
        });
      }
    }
    if (location.status === "ready") {
      list.push({
        id: "me",
        lat: location.coords.lat,
        lon: location.coords.lon,
        label: "내 위치",
        kind: "me",
        highlight: true,
      });
    }
    return list;
  }, [streetMarkers, activeSort, byDistance, byPreference, location]);

  function requestLocation() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setLocation({
        status: "error",
        message: "이 브라우저는 위치 기능을 지원하지 않습니다.",
      });
      return;
    }

    setLocation({ status: "locating" });
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocation({
          status: "ready",
          coords: { lat: position.coords.latitude, lon: position.coords.longitude },
        });
        // 사용자가 "가까운 것"을 보려고 눌렀으니 곧바로 거리순으로 바꾼다.
        setSort("거리순");
      },
      (error) => setLocation({ status: "error", message: describeGeolocationError(error) }),
      // 캐시된 좌표를 5분까지 받아들인다. 이 서비스의 판단 단위는 시군구라
      // 몇 분 사이의 이동으로 답이 바뀌지 않는다.
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 5 * 60_000 },
    );
  }

  return (
    <>
      <section className="px-5 pt-4">
        <h2 className="mb-2 text-[13px] font-bold text-fg-muted">추천 지점 한눈에 보기</h2>
        <RegionMap markers={markers} height={220} />
        <p className="mt-2 text-[11px] text-fg-muted">
          <span className="font-bold text-brand">●</span> 특화거리 ·{" "}
          <span className="font-bold text-accent">●</span> 실제로 파는 집
          {location.status === "ready" && (
            <>
              {" · "}
              <span className="font-bold text-salty">●</span> 내 위치
            </>
          )}
        </p>
      </section>

      <section className="px-5 pt-6">
        <h2 className="font-display text-[20px]">취향에 맞는 남도 음식</h2>

        <div className="mt-3 rounded-2xl border border-line bg-surface-alt px-4 py-3.5">
          {location.status === "ready" ? (
            <OptionGroup<SortMode>
              legend="추천 순서"
              options={[
                { value: "취향순", label: "취향순", icon: "🎯" },
                { value: "거리순", label: "거리순", icon: "📍" },
              ]}
              value={activeSort}
              onChange={setSort}
              columns={2}
            />
          ) : (
            <>
              <button
                type="button"
                onClick={requestLocation}
                disabled={location.status === "locating"}
                className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-[15px] font-bold text-fg-inverse transition-all hover:-translate-y-0.5 hover:shadow-lg disabled:cursor-wait disabled:opacity-70 disabled:hover:translate-y-0 disabled:hover:shadow-none"
              >
                <span aria-hidden="true">📍</span>
                {location.status === "locating"
                  ? "위치를 확인하는 중…"
                  : "내 위치에서 가까운 추천 음식 보기"}
              </button>
              <p
                className="mt-2 text-center text-[11px] text-fg-muted"
                role={location.status === "error" ? "alert" : undefined}
              >
                {location.status === "error"
                  ? location.message
                  : "위치는 이 기기 안에서 거리 계산에만 씁니다. 어디에도 보내지 않습니다."}
              </p>
            </>
          )}
        </div>

        {activeSort === "거리순" && (
          <p className="mt-2.5 text-[12px] text-fg-muted">
            내 위치에서 파는 집이 가까운 순입니다. 취향 점수는 순서에 넣지 않되, 같은 재료는
            두 가지까지만 보여 줍니다.
          </p>
        )}

        {activeSort === "거리순" && byDistance.length === 0 ? (
          <p className="mt-3 rounded-2xl border border-line bg-surface px-4 py-6 text-center text-[13px] text-fg-muted">
            제철 후보 중에 좌표가 있는 집을 찾지 못했습니다.
            <br />
            취향순으로 보시거나 다른 달을 골라 보세요.
          </p>
        ) : (
          <ol className="mt-3 space-y-3">
            {activeSort === "거리순"
              ? byDistance.map((item, index) => (
                  <FoodCard
                    key={item.candidate.id}
                    candidate={item.candidate}
                    rank={index + 1}
                    pref={pref}
                    poolSize={candidates.length}
                    prefQuery={prefQuery}
                    nearby={item}
                  />
                ))
              : byPreference.map((candidate, index) => (
                  <FoodCard
                    key={candidate.id}
                    candidate={candidate}
                    rank={index + 1}
                    pref={pref}
                    poolSize={candidates.length}
                    prefQuery={prefQuery}
                  />
                ))}
          </ol>
        )}
      </section>
    </>
  );
}

/**
 * 두 정렬 모드가 같은 카드를 쓴다. 오른쪽 숫자 자리만 바뀐다 — 취향순은
 * 일치 점수, 거리순은 거리. 자리를 옮기지 않아야 토글이 다른 화면으로
 * 넘어간 것처럼 보이지 않는다.
 */
function FoodCard({
  candidate,
  rank,
  pref,
  poolSize,
  prefQuery,
  nearby,
}: {
  candidate: NearbyCandidate;
  rank: number;
  pref: Preference;
  poolSize: number;
  prefQuery: string;
  /** 거리순일 때만 넘어온다. */
  nearby?: NearbyFood;
}) {
  return (
    <li className="result-card rounded-2xl border border-line bg-surface px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold text-brand">{rank}</span>
            <h3 className="font-display truncate text-[21px]">{candidate.name}</h3>
          </div>
          <p className="mt-1 text-[12px] text-fg-muted">
            {candidate.ingredient && `${candidate.ingredient} · `}
            {nearby ? nearby.nearest.area : candidate.regions.join(", ")}
            {!candidate.inSeason && " · 이번 달 제철은 아님"}
            {nearby && ` · 취향 일치 ${candidate.match}`}
          </p>
        </div>
        <div className="shrink-0 text-center">
          <div className="font-display text-[24px] text-brand">
            {nearby ? formatDistance(nearby.distanceKm) : candidate.match}
          </div>
          <div className="text-[10px] font-bold text-fg-muted">
            {nearby ? "가장 가까운 집" : "취향 일치"}
          </div>
        </div>
      </div>

      <div className="mt-3">
        <TasteBadges food={candidate} />
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-3">
        <p className="text-[13px] font-medium text-fg">파는 곳 {candidate.restaurantCount}곳</p>
        {nearby ? (
          <p className="min-w-0 truncate text-[13px] text-accent">📍 {nearby.nearest.name}</p>
        ) : (
          candidate.bestStreet && (
            <Link
              href={`/street/${candidate.bestStreet.id}?${prefQuery}`}
              className="min-w-0 truncate text-[13px] text-accent transition-colors hover:text-brand hover:underline"
            >
              → {candidate.bestStreet.name}
            </Link>
          )
        )}
      </div>

      {candidate.mismatches.length > 0 && (
        <p className="mt-2 text-[12px] text-fg-muted">다만 {candidate.mismatches.join(", ")}.</p>
      )}

      {candidate.confidence < LOW_CONFIDENCE && (
        <p className="mt-1 text-[11px] text-fg-muted">
          ※ 메뉴명 정보가 짧아 지표의 근거가 약합니다.
        </p>
      )}

      <WhyThisFood
        candidate={candidate}
        pref={pref}
        rank={rank}
        poolSize={poolSize}
        nearby={nearby}
      />
    </li>
  );
}
