import { streetDisplayName } from "./korean";
import { getKstMonth } from "./kst";
import { CATEGORIES, SPICY_LEVELS, type Category, type Food, type Street } from "./types";

/** 국물 선호. 1은 "상관없음"이라 점수에 영향을 주지 않는다. */
export type SoupPreference = 0 | 1 | 2;
/** 날것 선호. O는 날것을 원함, X는 익힌 것을 원함. */
export type RawPreference = "O" | "X";
/** 주재료 선호. "상관없음"이면 점수에 영향을 주지 않는다. */
export type IngredientPreference = Category | "상관없음";

export interface Preference {
  /** 0 안 매움 ~ 3 아주 매움 */
  spicy: number;
  soup: SoupPreference;
  raw: RawPreference;
  ingredient: IngredientPreference;
  month: number;
}

// month는 여기 두지 않는다. 모듈 top-level 상수로 박아 두면 서버리스
// 함수가 warm 상태로 재사용되는 동안 콜드스타트 시점의 달에 고정되어,
// 자정을 넘겨도 값이 안 바뀌는 버그가 난다. 쓰는 자리마다 getKstMonth()를
// 직접 호출하게 해서 항상 요청 시점 값을 쓰도록 강제한다.
export const DEFAULT_PREFERENCE: Omit<Preference, "month"> = {
  spicy: 1,
  soup: 1,
  raw: "X",
  ingredient: "상관없음",
};

export const SOUP_OPTIONS: { value: SoupPreference; label: string }[] = [
  { value: 0, label: "국물 없이" },
  { value: 1, label: "상관없음" },
  { value: 2, label: "국물 있게" },
];

export const RAW_OPTIONS: { value: RawPreference; label: string }[] = [
  { value: "O", label: "날것도 좋아요" },
  { value: "X", label: "익힌 것으로" },
];

export const INGREDIENT_OPTIONS: IngredientPreference[] = [...CATEGORIES, "상관없음"];

// --------------------------------------------------------------------------
// 취향 일치도
//
// 이 절은 점수를 "계산"하는 동시에 "왜 그 점수인지"를 함께 돌려준다.
// 화면의 설명 패널이 별도 문구 테이블을 들고 있으면 배점을 고칠 때마다
// 설명이 조용히 어긋난다. 채점과 설명을 한 함수에서 만들어 두면 그럴 수 없다.
// --------------------------------------------------------------------------

/** 지표별 배점. 합이 100이 되게 두어 화면의 "취향 일치 87" 이 곧 백분율이다. */
export const AXIS_WEIGHTS = {
  spicy: 30,
  soup: 25,
  raw: 20,
  ingredient: 25,
} as const;

export type AxisKey = keyof typeof AXIS_WEIGHTS;

export const AXIS_LABELS: Record<AxisKey, string> = {
  spicy: "맵기",
  soup: "국물",
  raw: "날것",
  ingredient: "주재료",
};

/** 날것을 원했는데 익힌 메뉴일 때 남겨 주는 비율. */
export const RAW_PARTIAL = 0.4;

/** 근거 계수의 하한. confidence가 0이어도 점수를 이보다 더 깎지는 않는다. */
export const CREDIBILITY_FLOOR = 0.85;

/** 근거가 약하다고 화면에 밝히는 기준. */
export const LOW_CONFIDENCE = 0.6;

/** 배점을 얻은 정도. skipped는 "상관없음이라 채점에서 뺀 것"이다. */
export type AxisVerdict = "match" | "partial" | "miss" | "skipped";

export interface AxisScore {
  key: AxisKey;
  label: string;
  /** 이 지표의 배점. skipped면 0 — 만점에서도 함께 빠진다. */
  weight: number;
  earned: number;
  verdict: AxisVerdict;
  /** 사용자가 고른 값 */
  you: string;
  /** 이 음식의 값 */
  it: string;
  /** 왜 이만큼인지 한 줄 */
  note: string;
}

export interface MatchExplanation {
  axes: AxisScore[];
  /** 채점에 쓴 배점 합. "상관없음"을 고를수록 작아진다. */
  total: number;
  earned: number;
  /** earned/total. 반올림 전 백분율. */
  percent: number;
  confidence: number;
  /** 근거 계수 0.85~1.00 */
  credibility: number;
  /** 화면에 찍히는 최종 점수 */
  score: number;
}

/** 채점에 필요한 취향. month는 후보를 고르는 데만 쓰여 여기 들어오지 않는다. */
export type TastePreference = Omit<Preference, "month">;

/** 채점에 필요한 음식 정보. Food도 NearbyCandidate도 이 모양을 만족한다. */
export type ScorableFood = Pick<
  Food,
  "spicy" | "hasSoup" | "isRaw" | "mainIngredients" | "confidence"
>;

export function spicyLabel(level: number): string {
  return SPICY_LEVELS.find((l) => l.value === level)?.label ?? `${level}`;
}

/**
 * 지표 네 가지를 각각 채점하고, 그 과정을 그대로 돌려준다.
 *
 * "상관없음"을 고른 지표는 배점 자체를 빼서, 신경 안 쓴 항목이 점수를
 * 끌어내리지도 올리지도 않게 한다. 그래야 모두 "상관없음"으로 두었을 때
 * 남는 지표만으로 순위가 갈린다.
 */
export function explainMatch(pref: TastePreference, food: ScorableFood): MatchExplanation {
  const axes: AxisScore[] = [];

  // 맵기 — 0~3에서 얼마나 어긋났는지. 3칸 차이면 0점.
  const gap = Math.abs(pref.spicy - food.spicy);
  const spicyRatio = 1 - gap / 3;
  axes.push({
    key: "spicy",
    label: AXIS_LABELS.spicy,
    weight: AXIS_WEIGHTS.spicy,
    earned: AXIS_WEIGHTS.spicy * spicyRatio,
    verdict: gap === 0 ? "match" : gap === 1 ? "partial" : "miss",
    you: spicyLabel(pref.spicy),
    it: spicyLabel(food.spicy),
    note:
      gap === 0
        ? "고른 단계와 정확히 같습니다."
        : `${gap}단계 차이라 배점의 ${Math.round(spicyRatio * 100)}%만 얻었습니다.`,
  });

  // 국물 — 상관없음(1)이면 채점하지 않는다.
  const soupIs = food.hasSoup ? "국물 있음" : "국물 없음";
  if (pref.soup === 1) {
    axes.push({
      key: "soup",
      label: AXIS_LABELS.soup,
      weight: 0,
      earned: 0,
      verdict: "skipped",
      you: "상관없음",
      it: soupIs,
      note: `‘상관없음’이라 채점에서 뺐습니다. 배점 ${AXIS_WEIGHTS.soup}점이 만점에서도 함께 빠집니다.`,
    });
  } else {
    const wantsSoup = pref.soup === 2;
    const hit = wantsSoup === food.hasSoup;
    axes.push({
      key: "soup",
      label: AXIS_LABELS.soup,
      weight: AXIS_WEIGHTS.soup,
      earned: hit ? AXIS_WEIGHTS.soup : 0,
      verdict: hit ? "match" : "miss",
      you: wantsSoup ? "국물 있게" : "국물 없이",
      it: soupIs,
      note: hit ? "고른 것과 같습니다." : "고른 것과 반대라 점수를 얻지 못했습니다.",
    });
  }

  // 날것 — O는 날것을 원하고 X는 익힌 것을 원한다.
  const wantsRaw = pref.raw === "O";
  const rawIs = food.isRaw ? "날것" : "익힘";
  if (wantsRaw === food.isRaw) {
    axes.push({
      key: "raw",
      label: AXIS_LABELS.raw,
      weight: AXIS_WEIGHTS.raw,
      earned: AXIS_WEIGHTS.raw,
      verdict: "match",
      you: wantsRaw ? "날것도 좋아요" : "익힌 것으로",
      it: rawIs,
      note: "고른 것과 같습니다.",
    });
  } else if (wantsRaw) {
    // 날것을 원했는데 익힌 것이면 아깝다. 반대(익힌 걸 원했는데 날것)보다는
    // 덜 치명적이라 절반만 깎는다 — 날것 메뉴 자체가 적기 때문이다.
    axes.push({
      key: "raw",
      label: AXIS_LABELS.raw,
      weight: AXIS_WEIGHTS.raw,
      earned: AXIS_WEIGHTS.raw * RAW_PARTIAL,
      verdict: "partial",
      you: "날것도 좋아요",
      it: rawIs,
      note: `날것 메뉴 자체가 드물어, 익힌 메뉴라도 배점의 ${Math.round(RAW_PARTIAL * 100)}%는 남깁니다.`,
    });
  } else {
    axes.push({
      key: "raw",
      label: AXIS_LABELS.raw,
      weight: AXIS_WEIGHTS.raw,
      earned: 0,
      verdict: "miss",
      you: "익힌 것으로",
      it: rawIs,
      note: "익힌 것을 골랐는데 날것으로 먹는 메뉴라 점수를 얻지 못했습니다.",
    });
  }

  // 주재료 — 상관없음이면 채점하지 않는다.
  const ingredientIs = food.mainIngredients.join("·") || "분류 없음";
  if (pref.ingredient === "상관없음") {
    axes.push({
      key: "ingredient",
      label: AXIS_LABELS.ingredient,
      weight: 0,
      earned: 0,
      verdict: "skipped",
      you: "상관없음",
      it: ingredientIs,
      note: `‘상관없음’이라 채점에서 뺐습니다. 배점 ${AXIS_WEIGHTS.ingredient}점이 만점에서도 함께 빠집니다.`,
    });
  } else {
    const hit = food.mainIngredients.includes(pref.ingredient);
    axes.push({
      key: "ingredient",
      label: AXIS_LABELS.ingredient,
      weight: AXIS_WEIGHTS.ingredient,
      earned: hit ? AXIS_WEIGHTS.ingredient : 0,
      verdict: hit ? "match" : "miss",
      you: pref.ingredient,
      it: ingredientIs,
      note: hit
        ? "고른 주재료가 들어갑니다."
        : "고른 주재료가 이 메뉴의 대표 재료가 아닙니다.",
    });
  }

  const total = axes.reduce((sum, a) => sum + a.weight, 0);
  const earned = axes.reduce((sum, a) => sum + a.earned, 0);
  const percent = total === 0 ? 0 : (earned / total) * 100;

  // 근거가 약한 지표가 근거 있는 지표를 이기고 1위에 오르면 납득할 수 없다.
  const credibility = CREDIBILITY_FLOOR + (1 - CREDIBILITY_FLOOR) * food.confidence;

  return {
    axes,
    total,
    earned,
    percent,
    confidence: food.confidence,
    credibility,
    score: Math.round(percent * credibility),
  };
}

/** 근거 계수를 빼고 본 순수 취향 일치도(0~100). */
export function preferenceMatch(pref: TastePreference, food: ScorableFood): number {
  return explainMatch(pref, food).percent;
}

export interface ScoredFood {
  food: Food;
  /** 0~100. 취향 일치도. */
  match: number;
  /** 이번 달 제철이면 true. 인접 월로 넓혀 잡은 경우 false. */
  inSeason: boolean;
  /** 사용자 선택과 어긋난 지표들 — 카드에 "다만 …" 문구로 쓴다. */
  mismatches: string[];
  /** 같은 재료 상한에 걸려 점수보다 뒤로 밀렸으면 true. */
  demoted: boolean;
}

function describeMismatches(pref: Preference, food: Food): string[] {
  const notes: string[] = [];

  const gap = Math.abs(pref.spicy - food.spicy);
  if (gap >= 2) {
    notes.push(food.spicy > pref.spicy ? "고른 것보다 맵습니다" : "고른 것보다 덜 맵습니다");
  }
  if (pref.soup === 2 && !food.hasSoup) notes.push("국물 요리는 아닙니다");
  if (pref.soup === 0 && food.hasSoup) notes.push("국물이 있는 요리입니다");
  if (pref.raw === "O" && !food.isRaw) notes.push("날것은 아닙니다");
  if (pref.raw === "X" && food.isRaw) notes.push("날것으로 먹습니다");
  if (pref.ingredient !== "상관없음" && !food.mainIngredients.includes(pref.ingredient)) {
    notes.push(`주재료가 ${food.mainIngredients.join("·") || "분류 없음"}입니다`);
  }
  return notes;
}

/**
 * 제철(월)로 후보를 고른다. 해당 월 결과가 너무 적으면 앞뒤 한 달까지
 * 넓힌다. 제철이 아닌 것을 억지로 끼워 넣기보다 "이번 달은 아니지만"이라고
 * 밝히는 편이 정직하다.
 */
/** 이번 달만으로 후보를 세우기에 충분한 최소 개수. */
export const STRICT_POOL_MIN = 8;

function seasonalPool(foods: Food[], month: number): Food[] {
  const neighbours = [((month + 10) % 12) + 1, month, (month % 12) + 1];
  // 데이터에 식사만 남아 있어 코스로 거를 것이 없다.
  const strict = foods.filter((f) => f.months.includes(month));
  if (strict.length >= STRICT_POOL_MIN) return strict;
  return foods.filter((f) => f.months.some((m) => neighbours.includes(m)));
}

/** 후보를 어떻게 골랐는지. 설명 패널의 "제철 후보 N가지 중 X위"에 쓴다. */
export function seasonalPoolInfo(
  foods: Food[],
  month: number,
): { strict: number; widened: boolean } {
  const strict = foods.filter((f) => f.months.includes(month)).length;
  return { strict, widened: strict < STRICT_POOL_MIN };
}

/**
 * 제철 후보 전부를 취향 일치도순으로 돌려준다.
 *
 * 거리순 추천이 이 목록을 그대로 쓴다 — 사용자 위치는 서버가 알 수 없어서
 * 브라우저에서 다시 정렬해야 하는데, 후보를 상위 몇 개로 잘라 넘기면 "가까운
 * 집"이 취향 점수에 걸러진 뒤의 가까운 집이 되어 거리순이 거짓말이 된다.
 */
export function rankCandidates(foods: Food[], pref: Preference): ScoredFood[] {
  const scored = seasonalPool(foods, pref.month).map<ScoredFood>((food) => ({
    food,
    match: explainMatch(pref, food).score,
    inSeason: food.months.includes(pref.month),
    mismatches: describeMismatches(pref, food),
    demoted: false,
  }));

  scored.sort((a, b) => {
    if (b.match !== a.match) return b.match - a.match;
    if (a.inSeason !== b.inSeason) return a.inSeason ? -1 : 1;
    // 같은 점수면 실제로 갈 수 있는 집이 많은 쪽을 앞에 둔다.
    return b.food.restaurantCount - a.food.restaurantCount;
  });

  return diversify(scored, scored.length);
}

/** 취향 일치도순 상위 몇 가지. */
export function recommendFoods(foods: Food[], pref: Preference, limit = 4): ScoredFood[] {
  return rankCandidates(foods, pref).slice(0, limit);
}

/** 한 식재료가 결과를 독점하지 못하게 하는 상한. */
export const MAX_PER_INGREDIENT = 2;

/**
 * 점수순 정렬만 하면 "전복문어탕·전복연포탕·전복해신탕"처럼 같은 재료의
 * 변주가 목록을 통째로 차지한다. 점수는 정직하지만 답으로는 쓸모가 없다 —
 * 사용자는 오늘 뭘 먹을지 고르려는 것이지 전복 요리 목록을 보려는 게 아니다.
 */
function diversify(scored: ScoredFood[], limit: number): ScoredFood[] {
  // 같은 메뉴가 재료만 다르게 두 번 들어와 있는 경우가 있다. 원본에서
  // "우렁이 쌈밥 정식, 전복들깨탕"이 들깨 행과 전복 행으로 각각 잡히는 식이다.
  const seenNames = new Set<string>();
  const deduped = scored.filter((item) => {
    if (seenNames.has(item.food.name)) return false;
    seenNames.add(item.food.name);
    return true;
  });

  const taken: ScoredFood[] = [];
  const overflow: ScoredFood[] = [];
  const seen = new Map<string, number>();

  for (const item of deduped) {
    const key = item.food.ingredient || item.food.name;
    const count = seen.get(key) ?? 0;
    if (count < MAX_PER_INGREDIENT && taken.length < limit) {
      taken.push(item);
      seen.set(key, count + 1);
    } else {
      // 점수만 보면 더 앞이었는데 상한에 걸려 밀린 것. 화면에서 그 사실을
      // 밝혀야 "점수가 높은데 왜 아래 있지?"가 생기지 않는다.
      overflow.push({ ...item, demoted: true });
    }
  }

  return taken.concat(overflow).slice(0, limit);
}

// --------------------------------------------------------------------------
// 음식 → 특화거리 매칭
// --------------------------------------------------------------------------

const EARTH_RADIUS_KM = 6371;

export function haversineKm(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

export interface StreetMatch {
  street: Street;
  score: number;
  reasons: string[];
  distanceKm: number | null;
}

/**
 * 하나의 추천 음식에 어울리는 특화거리를 점수순으로 돌려준다.
 *
 * 키워드 일치가 가장 강한 신호다. "낙지"를 추천받은 사람에게 무안뻘낙지거리를
 * 보여 주는 것이, 단지 가깝다는 이유로 다른 거리를 보여 주는 것보다 쓸모 있다.
 */
export function matchStreets(food: Food, streets: Street[], limit = 3): StreetMatch[] {
  const foodStreets = streets.filter((s) => s.category === "음식");
  const coords = food.restaurants
    .filter((r) => r.lat !== null && r.lon !== null)
    .map((r) => ({ lat: r.lat as number, lon: r.lon as number }));

  const matches = foodStreets.map<StreetMatch>((street) => {
    const reasons: string[] = [];
    let score = 0;

    const hitKeyword = street.foodKeywords.find(
      (kw) =>
        food.ingredient.includes(kw) || kw.includes(food.ingredient) || food.name.includes(kw),
    );
    if (hitKeyword) {
      score += 50;
      reasons.push(`${hitKeyword} 전문 거리`);
    }

    const sameSigungu = food.regions.some((r) => street.sigungu && r.includes(street.sigungu));
    const sameSido = food.regions.some((r) => r.startsWith(street.sido));
    if (sameSigungu) {
      score += 30;
      reasons.push(`${street.sigungu} 안에 있음`);
    } else if (sameSido) {
      score += 10;
    }

    let distanceKm: number | null = null;
    if (street.lat !== null && street.lon !== null && coords.length > 0) {
      distanceKm = Math.min(
        ...coords.map((c) =>
          haversineKm(c, { lat: street.lat as number, lon: street.lon as number }),
        ),
      );
      if (distanceKm < 5) {
        score += 20;
        reasons.push(`파는 집에서 ${distanceKm.toFixed(1)}km`);
      } else if (distanceKm < 20) {
        score += 10;
        reasons.push(`파는 집에서 ${Math.round(distanceKm)}km`);
      } else if (distanceKm < 50) {
        score += 4;
      }
    }

    score += Math.min(6, Math.log10(Math.max(1, street.shopCount)) * 3);
    return { street, score, reasons, distanceKm };
  });

  return matches
    .filter((m) => m.score >= 15)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export interface StreetAggregate {
  street: Street;
  score: number;
  foods: { name: string; match: number }[];
}

/** 추천 음식 목록 전체를 훑어 거리별 득표를 합산한다. */
export function aggregateStreets(
  scored: ScoredFood[],
  streets: Street[],
  limit = 4,
): StreetAggregate[] {
  const bucket = new Map<string, StreetAggregate>();

  for (const item of scored) {
    for (const match of matchStreets(item.food, streets, 2)) {
      const existing = bucket.get(match.street.id);
      const contribution = match.score * (item.match / 100);
      if (existing) {
        existing.score += contribution;
        existing.foods.push({ name: item.food.name, match: item.match });
      } else {
        bucket.set(match.street.id, {
          street: match.street,
          score: contribution,
          foods: [{ name: item.food.name, match: item.match }],
        });
      }
    }
  }

  return [...bucket.values()]
    .map((a) => ({ ...a, foods: a.foods.sort((x, y) => y.match - x.match).slice(0, 4) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// --------------------------------------------------------------------------
// 위치 기반 — 내 자리에서 가까운 순
// --------------------------------------------------------------------------

/** 그 음식을 실제로 파는 집 중 좌표가 있는 곳. */
export interface FoodSpot {
  name: string;
  area: string;
  lat: number;
  lon: number;
}

/**
 * 거리 계산을 브라우저에서 하려고 클라이언트로 넘기는 최소 정보.
 *
 * Food를 통째로 넘기지 않는다. 제철 후보는 많은 달에 150건까지 가는데
 * Food에는 화면에 안 쓰는 주소 문자열과 지역 목록이 통으로 들어 있어서,
 * 그대로 넘기면 RSC payload가 몇 배로 부푼다. 카드에 그리는 것과 거리
 * 계산에 필요한 것만 남긴다.
 */
export interface NearbyCandidate {
  id: string;
  name: string;
  ingredient: string;
  /** 화면에 두 개만 쓰므로 잘라서 넘긴다. */
  regions: string[];
  spicy: number;
  hasSoup: boolean;
  isRaw: boolean;
  mainIngredients: Category[];
  confidence: number;
  restaurantCount: number;
  match: number;
  inSeason: boolean;
  mismatches: string[];
  /** 같은 재료 상한에 걸려 점수보다 뒤로 밀렸으면 true. */
  demoted: boolean;
  /** 취향순 카드에 거는 특화거리 링크. 서버에서 미리 골라 둔다. */
  bestStreet: { id: string; name: string } | null;
  spots: FoodSpot[];
}

/**
 * 취향순으로 정렬된 후보를 클라이언트가 쓸 형태로 줄인다.
 *
 * `linkLimit`은 특화거리 링크를 붙일 개수다. 이 링크는 취향순 카드에만
 * 나오고 취향순은 언제나 앞에서부터 자르므로, 뒤쪽 후보까지 거리를
 * 매칭해 봐야 payload만 늘고 화면에는 안 나온다.
 */
export function toNearbyCandidates(
  scored: ScoredFood[],
  streets: Street[],
  linkLimit = 4,
): NearbyCandidate[] {
  return scored.map((item, index) => {
    const best = index < linkLimit ? matchStreets(item.food, streets, 1)[0] : undefined;
    return {
      id: item.food.id,
      name: item.food.name,
      ingredient: item.food.ingredient,
      regions: item.food.regions.slice(0, 2),
      spicy: item.food.spicy,
      hasSoup: item.food.hasSoup,
      isRaw: item.food.isRaw,
      mainIngredients: item.food.mainIngredients,
      confidence: item.food.confidence,
      restaurantCount: item.food.restaurantCount,
      match: item.match,
      inSeason: item.inSeason,
      mismatches: item.mismatches,
      demoted: item.demoted,
      bestStreet: best
        ? { id: best.street.id, name: streetDisplayName(best.street) }
        : null,
      spots: item.food.restaurants
        .filter((r) => r.lat !== null && r.lon !== null)
        .map((r) => ({
          name: r.name,
          area: r.area,
          lat: r.lat as number,
          lon: r.lon as number,
        })),
    };
  });
}

export interface NearbyFood {
  candidate: NearbyCandidate;
  /** 내 위치에서 가장 가까운 집까지의 거리(km). */
  distanceKm: number;
  nearest: FoodSpot;
  /** 거리순에서도 같은 재료 상한에 걸려 밀렸으면 true. */
  demotedByIngredient: boolean;
}

/**
 * 내 위치에서 가까운 순으로 다시 세운다.
 *
 * 좌표가 있는 집이 하나도 없는 음식은 뺀다. 거리를 모르는 것을 목록 끝에
 * 붙이면 "가까운 순"이라는 약속이 흐려진다.
 */
export function rankByDistance(
  candidates: NearbyCandidate[],
  origin: { lat: number; lon: number },
  limit = 4,
): NearbyFood[] {
  const measured: NearbyFood[] = [];

  for (const candidate of candidates) {
    let nearest: FoodSpot | null = null;
    let shortest = Infinity;
    for (const spot of candidate.spots) {
      const km = haversineKm(origin, spot);
      if (km < shortest) {
        shortest = km;
        nearest = spot;
      }
    }
    if (nearest)
      measured.push({ candidate, distanceKm: shortest, nearest, demotedByIngredient: false });
  }

  measured.sort((a, b) => a.distanceKm - b.distanceKm);

  // 같은 이름이 재료만 다르게 두 번 들어온 것을 먼저 걷어낸다.
  const seenNames = new Set<string>();
  const deduped = measured.filter((item) => {
    if (seenNames.has(item.candidate.name)) return false;
    seenNames.add(item.candidate.name);
    return true;
  });

  // 취향순과 같은 재료별 상한을 건다. 목포역에서 순수 거리순을 그대로 내면
  // 네 칸이 "갈치찜 백반 / 먹갈치 구이 백반 / 갈치찜 / 갈치찜·갈치구이"로
  // 채워진다 — 거리는 정직하지만 고를 것이 없는 목록이다. 대신 이 규칙을
  // 화면에 밝혀서, 더 가까운 것이 밀려난 이유를 사용자가 알 수 있게 한다.
  const taken: NearbyFood[] = [];
  const overflow: NearbyFood[] = [];
  const perIngredient = new Map<string, number>();

  for (const item of deduped) {
    const key = item.candidate.ingredient || item.candidate.name;
    const count = perIngredient.get(key) ?? 0;
    if (count < MAX_PER_INGREDIENT && taken.length < limit) {
      taken.push(item);
      perIngredient.set(key, count + 1);
    } else {
      overflow.push({ ...item, demotedByIngredient: true });
    }
  }

  return taken.concat(overflow).slice(0, limit);
}

/** 화면에 쓸 거리 표기. 1km 밑은 m로 끊어야 "0.3km"보다 읽힌다. */
export function formatDistance(km: number): string {
  // 10m 단위로 끊는다. 좌표 정밀도를 생각하면 1m 자리는 없는 정확도다.
  // 바로 앞에 서 있어도 "0m"라고 쓰지는 않는다 — 고장 난 것처럼 보인다.
  const metres = Math.max(10, Math.round((km * 1000) / 10) * 10);
  if (metres < 1000) return `${metres}m`;
  if (km < 10) return `${km.toFixed(1)}km`;
  return `${Math.round(km)}km`;
}

// --------------------------------------------------------------------------
// URL 쿼리 <-> 취향 (결과 링크를 그대로 공유할 수 있게 한다)
// --------------------------------------------------------------------------

export function preferenceToQuery(pref: Preference): string {
  const params = new URLSearchParams();
  params.set("spicy", String(pref.spicy));
  params.set("soup", String(pref.soup));
  params.set("raw", pref.raw);
  params.set("ing", pref.ingredient);
  params.set("month", String(pref.month));
  return params.toString();
}

export function preferenceFromQuery(
  query: Record<string, string | string[] | undefined>,
): Preference {
  const read = (key: string): string | undefined => {
    const raw = query[key];
    return Array.isArray(raw) ? raw[0] : raw;
  };

  const spicyRaw = Number(read("spicy"));
  const spicy = Number.isFinite(spicyRaw) ? Math.min(3, Math.max(0, Math.round(spicyRaw))) : 1;

  const soupRaw = Number(read("soup"));
  const soup = ([0, 1, 2] as const).includes(soupRaw as SoupPreference)
    ? (soupRaw as SoupPreference)
    : 1;

  const rawValue = read("raw");
  const raw: RawPreference = rawValue === "O" ? "O" : "X";

  const ingValue = read("ing");
  const ingredient: IngredientPreference = INGREDIENT_OPTIONS.includes(
    ingValue as IngredientPreference,
  )
    ? (ingValue as IngredientPreference)
    : "상관없음";

  const monthRaw = Number(read("month"));
  const month =
    Number.isFinite(monthRaw) && monthRaw >= 1 && monthRaw <= 12
      ? Math.round(monthRaw)
      : getKstMonth();

  return { spicy, soup, raw, ingredient, month };
}
