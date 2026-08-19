"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { OptionGroup } from "@/components/OptionGroup";
import { RegionMap, type MapMarker } from "@/components/RegionMap";
import { TasteBadges } from "@/components/TasteChart";
import { WhyThisFood } from "@/components/WhyThisFood";
import { seasonNote } from "@/lib/season-notes";
import {
  LOW_CONFIDENCE,
  MAX_PER_INGREDIENT,
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
  seed,
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
  /** 이번 화면의 동점자 순서를 정한 씨앗. 공유 주소에 실어 결과를 고정한다. */
  seed: string;
  limit?: number;
}) {
  const [sort, setSort] = useState<SortMode>("취향순");
  const [location, setLocation] = useState<LocationState>({ status: "idle" });

  // 결과 화면은 요청마다 동점자를 다시 섞는다. router.refresh()로 서버에
  // 다시 물으면 같은 취향 그대로 다른 네 가지를 받는다. 새로고침과 달리
  // 스크롤 위치와 고른 정렬 모드가 남는다.
  const router = useRouter();
  const [reshuffling, startReshuffle] = useTransition();
  const [copied, setCopied] = useState(false);

  /**
   * 씨앗까지 실은 주소를 복사한다.
   *
   * 이 화면은 볼 때마다 동점자를 다시 섞으므로, 주소만 보내면 상대는 다른
   * 넷을 본다. 씨앗을 실어야 "내가 본 그 상"이 건너간다.
   */
  const copyLink = async () => {
    const url = `${window.location.origin}/result?${prefQuery}&seed=${encodeURIComponent(seed)}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // 클립보드가 막힌 환경(http, 권한 거부)에서는 주소창을 대신 바꿔 준다.
      // 복사는 못 해도 사용자가 직접 긁어 갈 수 있어야 한다.
      window.history.replaceState(null, "", url);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  const byPreference = useMemo(() => candidates.slice(0, limit), [candidates, limit]);

  const byDistance = useMemo<NearbyFood[]>(() => {
    if (location.status !== "ready") return [];
    return rankByDistance(candidates, location.coords, limit);
  }, [candidates, location, limit]);

  // 위치를 못 받은 동안에는 거리순을 고를 수 없으므로 취향순으로 되돌린다.
  const activeSort: SortMode = location.status === "ready" ? sort : "취향순";

  // 지도 핀은 특화거리다. 음식 정보는 아래 시트에 다 있으니, 지도는 "가서
  // 먹을 수 있는 거리"를 보여 주고 누르면 그 거리 상세로 넘어간다. 파는 집
  // 좌표까지 핀으로 찍으면 지도가 점으로 뒤덮여 거리 핀이 묻힌다.
  const markers = useMemo<MapMarker[]>(() => {
    const list: MapMarker[] = [...streetMarkers];
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
  }, [streetMarkers, location]);

  // 거리 핀을 누르면 그 거리 상세로 간다. 거리·점포 정보는 거기서만 본다.
  const openStreet = (id: string) => {
    router.push(`/street/${id}?${prefQuery}`);
  };

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
      {/* 히어로 지도. 화면을 크게 차지해 이 화면이 지도임을 먼저 보여 준다.
          아래 시트가 살짝 겹쳐 올라와 바텀시트처럼 읽힌다. */}
      <section className="relative h-[56vh] w-full">
        {streetMarkers.length > 0 ? (
          <RegionMap markers={markers} height="100%" onSelect={openStreet} />
        ) : (
          // 추천 넷이 특화거리와 이어지지 않으면 찍을 핀이 없다. 빈 지도를
          // 내미는 대신, 아래 목록으로 눈을 돌리게 한다.
          <div className="flex h-full flex-col items-center justify-center bg-accent-soft px-8 text-center">
            <p className="font-display text-[18px] text-fg">
              이번 추천과 이어지는 특화거리가 없습니다
            </p>
            <p className="mt-2 text-[13px] leading-relaxed text-fg-muted">
              아래에서 추천 음식을 확인하세요. ‘다른 추천 보기’를 누르면 거리가 있는
              다른 조합이 나올 수 있습니다.
            </p>
          </div>
        )}
      </section>

      {/* 추천 시트. 지도 아래 모서리를 덮으며 올라온다. 위로 스크롤하면
          지도가 밀려 나가고 추천 목록이 드러난다. */}
      <section className="relative z-10 -mt-5 rounded-t-3xl border-t border-line bg-canvas px-5 pb-2 pt-3 shadow-[0_-10px_30px_rgba(28,24,21,0.12)]">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line-strong" aria-hidden="true" />
        <p className="text-[11px] text-fg-muted">
          <span className="font-bold text-brand">●</span> 특화거리 — 누르면 그 거리에서
          파는 곳과 상세를 볼 수 있습니다.
          {location.status === "ready" && (
            <>
              {" "}
              <span className="font-bold text-salty">●</span> 내 위치.
            </>
          )}
        </p>

        <div className="pt-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display text-[20px]">취향에 맞는 남도 음식</h2>
          <div className="flex shrink-0 gap-1.5">
            <button
              type="button"
              onClick={copyLink}
              className="cursor-pointer rounded-full border border-line-strong px-3 py-1.5 text-[12px] font-bold text-fg transition-all hover:border-accent hover:text-accent"
            >
              <span aria-hidden="true" className="mr-1">
                🔗
              </span>
              {copied ? "복사했습니다" : "이 추천 공유"}
            </button>
            <button
              type="button"
              onClick={() =>
                startReshuffle(() => {
                  // 공유 링크로 들어왔다면 주소에 씨앗이 박혀 있어, 그대로
                  // 새로고침하면 같은 넷이 다시 나온다. 씨앗을 떼고 부른다.
                  router.replace(`/result?${prefQuery}`);
                  router.refresh();
                })
              }
              disabled={reshuffling}
              className="cursor-pointer rounded-full border border-line-strong px-3 py-1.5 text-[12px] font-bold text-fg transition-all hover:border-brand hover:text-brand disabled:cursor-wait disabled:opacity-60"
            >
              <span aria-hidden="true" className="mr-1">
                🔄
              </span>
              {reshuffling ? "고르는 중…" : "다른 추천 보기"}
            </button>
          </div>
        </div>
        <p className="mt-1 text-[12px] text-fg-muted">
          같은 취향이라도 누를 때마다 다른 네 가지를 골라 드립니다. 지금 이 네 가지를
          그대로 보내고 싶으면 <b className="font-bold text-fg">‘이 추천 공유’</b>를 누르세요.
        </p>

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
            {" "}
            {MAX_PER_INGREDIENT}가지까지만 보여 줍니다.
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
        </div>
      </section>
    </>
  );
}

/**
 * 왜 지금, 왜 여기인지.
 *
 * 채점 설명과 따로 둔다. 접힌 패널 안에 넣었더니 눌러야만 보여서, 정작 이
 * 서비스가 하려던 말이 가장 깊이 묻혔다. 점수는 취향이 맞는지를 말할 뿐
 * 제철을 말하지 않으므로, 둘은 서로 다른 이야기이기도 하다.
 *
 * 근거 문구가 없는 재료는 절을 통째로 감춘다. 빈 제목만 남기면 무언가
 * 빠진 화면처럼 보인다.
 */
function SeasonReason({ ingredient }: { ingredient: string }) {
  const note = seasonNote(ingredient);
  if (!note) return null;

  return (
    <section className="mt-3 rounded-xl border border-accent/25 bg-accent-soft px-3.5 py-3">
      <h4 className="text-[12.5px] font-bold text-accent">
        왜 지금, 왜 여기서 {ingredient}인가
      </h4>
      <dl className="mt-2 space-y-2 text-[12.5px] leading-relaxed text-fg">
        <div>
          <dt className="inline font-bold">왜 이 시기 </dt>
          <dd className="inline">{note.when}</dd>
        </div>
        <div>
          <dt className="inline font-bold">왜 광주·전남 </dt>
          <dd className="inline">{note.where}</dd>
        </div>
      </dl>
    </section>
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
  highlighted,
}: {
  candidate: NearbyCandidate;
  rank: number;
  pref: Preference;
  poolSize: number;
  prefQuery: string;
  /** 거리순일 때만 넘어온다. */
  nearby?: NearbyFood;
  /** 지도 핀에서 방금 고른 카드. 테두리를 강조하고 스크롤 여백을 준다. */
  highlighted?: boolean;
}) {
  return (
    <li
      id={`food-${candidate.id}`}
      className={`result-card scroll-mt-3 rounded-2xl border bg-surface px-4 py-4 transition-colors ${
        highlighted ? "border-accent ring-2 ring-accent/30" : "border-line"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold text-brand">{rank}</span>
            <h3 className="font-display truncate text-[21px]">{candidate.name}</h3>
            {/* 어긋난 조건이 하나라도 있으면 이 카드는 조건 충족이 아니라 대체다.
                상단 배너만으로는 네 장 중 어느 것이 대체인지 알 수 없다. */}
            {candidate.mismatches.length > 0 && (
              <span className="shrink-0 rounded-full bg-brand px-2 py-0.5 text-[10px] font-bold text-fg-inverse">
                대체 추천
              </span>
            )}
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
          // 대표 먹거리가 겹치는 거리가 있으면 거리로, 없으면 파는 집으로
          // 보낸다. 식당은 상세 페이지가 없으므로 링크가 아니라 표기만 한다.
          candidate.bestPlace &&
          (candidate.bestPlace.kind === "street" ? (
            <Link
              href={`/street/${candidate.bestPlace.id}?${prefQuery}`}
              className="min-w-0 truncate text-[13px] text-accent transition-colors hover:text-brand hover:underline"
            >
              → {candidate.bestPlace.name}
            </Link>
          ) : (
            <p className="min-w-0 truncate text-[13px] text-accent">
              📍 {candidate.bestPlace.name}
              <span className="text-fg-muted"> · {candidate.bestPlace.area}</span>
            </p>
          ))
        )}
      </div>

      {candidate.mismatches.length > 0 && (
        // 배지가 "대체"라고만 말하므로, 무엇이 어긋났는지는 눈에 띄게 붙여 둔다.
        <p className="mt-2 rounded-lg bg-brand-soft px-2.5 py-1.5 text-[12px] leading-relaxed text-fg">
          다만 {candidate.mismatches.join(", ")}.
        </p>
      )}

      {candidate.confidence < LOW_CONFIDENCE && (
        <p className="mt-1 text-[11px] text-fg-muted">
          ※ 메뉴명 정보가 짧아 지표의 근거가 약합니다.
        </p>
      )}

      <SeasonReason ingredient={candidate.ingredient} />

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
