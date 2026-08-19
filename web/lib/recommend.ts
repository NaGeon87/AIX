import { streetDisplayName } from "./korean";
import { getKstMonth } from "./kst";
import {
  CATEGORIES,
  SPICY_LEVELS,
  type Category,
  type Food,
  type Restaurant,
  type Street,
} from "./types";

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
  // 우선순위: 날것/익힘 > 주재료 > 국물 > 맵기.
  // 맵기는 오직 감점 요소로만 쓰며 대체 추천 판정에는 사용하지 않는다.
  raw: 40,
  ingredient: 30,
  soup: 20,
  spicy: 10,
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
  /** 0~100. 날것/주재료/국물/맵기로 계산한 취향 점수. */
  match: number;
  /** 선택한 달이 음식의 제철 월에 정확히 포함되는가. */
  inSeason: boolean;
  /** 사용자 선택과 어긋난 핵심 지표. 맵기는 대체 추천 사유로 세지 않는다. */
  mismatches: string[];
  /** 다양성 규칙 때문에 점수순 원래 위치보다 뒤로 밀렸는가. */
  demoted: boolean;
  /** 선택 월과의 근접도 보너스. 취향 100점과 별도로 최대 12점. */
  seasonBonus?: number;
  /** 취향 점수 + 제철 보너스 - 다양성 패널티. */
  rankingScore?: number;
  /** 핵심 조건(날것/익힘·주재료·국물)을 하나 이상 놓친 보충 추천인가. */
  substitute?: boolean;
  /** 대체 추천으로 분류된 이유. */
  substitutionReasons?: string[];
  /** 같은 식재료가 같은 결과 묶음에서 반복될 때 적용한 감점. */
  diversityPenalty?: number;
}

/**
 * 지표 하나가 고른 조건을 만족하는가.
 *
 * describeMismatches와 같은 기준을 쓴다. 여기서 갈리면 카드에는 "다만 국물
 * 요리는 아닙니다"라고 적히는데 상단에는 조건을 맞췄다고 나오는 일이 생긴다.
 */
function axisSatisfied(pref: Preference, food: Food, axis: AxisKey): boolean {
  switch (axis) {
    case "spicy":
      // 맵기는 정확/대체 판정 조건이 아니다. 순위에서 감점만 한다.
      return true;
    case "soup":
      return pref.soup === 1 || (pref.soup === 2) === food.hasSoup;
    case "raw":
      return (pref.raw === "O") === food.isRaw;
    case "ingredient":
      return (
        pref.ingredient === "상관없음" || food.mainIngredients.includes(pref.ingredient)
      );
  }
}

/** 고른 조건을 어긋남 없이 전부 만족하는가. */
function satisfiesAll(pref: Preference, food: Food): boolean {
  return (["spicy", "soup", "raw", "ingredient"] as AxisKey[]).every((axis) =>
    axisSatisfied(pref, food, axis),
  );
}

export interface SubstitutionNotice {
  /** 고른 조건을 그대로 만족하는 음식이 후보에 하나도 없다. */
  substituted: boolean;
  /** 조건은 맞지만 이번 달 제철이 아닌 것뿐이다. */
  outOfSeasonOnly: boolean;
  /** 후보 전체에서 한 번도 충족되지 않은 조건 이름. 예: ["국물", "주재료"] */
  unmet: string[];
}

/**
 * 상단에 "조건에 맞는 음식이 없어 대체로 추천한다"를 띄울지 판단한다.
 *
 * 지금까지 이 사실은 카드마다 "다만 국물 요리는 아닙니다"로만 흘렸다. 네 장을
 * 다 펼쳐 봐야 조건이 하나도 안 맞았다는 것을 알 수 있었고, 그래서 점수 98이
 * 조건 충족으로 읽혔다 — 점수는 "상관없음"을 뺀 나머지 배점의 비율이라 조건이
 * 어긋나도 높게 나올 수 있다. 그 판단을 목록 위로 올린다.
 *
 * 사용자가 "상관없음"으로 둔 지표는 조건이 아니므로 세지 않는다.
 */
export function substitutionNotice(
  ranked: ScoredFood[],
  pref: Preference,
): SubstitutionNotice {
  if (ranked.length === 0) {
    return { substituted: false, outOfSeasonOnly: false, unmet: [] };
  }

  const fits = ranked.filter((item) => satisfiesAll(pref, item.food));
  const unmet: string[] = [];
  for (const axis of ["spicy", "soup", "raw", "ingredient"] as AxisKey[]) {
    if (axis === "soup" && pref.soup === 1) continue;
    if (axis === "ingredient" && pref.ingredient === "상관없음") continue;
    if (!ranked.some((item) => axisSatisfied(pref, item.food, axis))) {
      unmet.push(AXIS_LABELS[axis]);
    }
  }

  return {
    substituted: fits.length === 0,
    // 조건은 맞는데 전부 제철이 아닌 경우. 이때는 "조건이 안 맞는다"가 아니라
    // "이번 달이 아니다"가 진짜 이유라 문구를 갈라 준다.
    outOfSeasonOnly: fits.length > 0 && !fits.some((item) => item.inSeason),
    unmet,
  };
}

function describeMismatches(pref: Preference, food: Food): string[] {
  const notes: string[] = [];

  // 맵기는 점수 감점만 적용한다. 카드의 "대체 추천 차이" 사유에는 넣지 않는다.
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
 * 매번 다른 씨앗. 같은 취향으로 다시 들어와도 다른 상을 받게 한다.
 *
 * 서버 컴포넌트에서 요청마다 한 번 만들어 넘긴다. 클라이언트가 다시 계산하는
 * 값이 아니라서 하이드레이션이 어긋나지 않는다.
 */
export function randomSeed(): string {
  return `${Date.now().toString(36)}.${Math.random().toString(36).slice(2)}`;
}

/**
 * 제철 후보 전부를 취향 일치도순으로 돌려준다.
 *
 * `seed`를 주면 동점자 순서가 그 씨앗으로 갈린다. 결과 화면은 요청마다 새
 * 씨앗을 넘겨 같은 취향에도 다른 음식이 나오게 하고, 거리 상세처럼 같은
 * 화면을 다시 그려야 하는 곳은 씨앗을 생략해 취향값으로 고정한다.
 *
 * 거리순 추천이 이 목록을 그대로 쓴다 — 사용자 위치는 서버가 알 수 없어서
 * 브라우저에서 다시 정렬해야 하는데, 후보를 상위 몇 개로 잘라 넘기면 "가까운
 * 집"이 취향 점수에 걸러진 뒤의 가까운 집이 되어 거리순이 거짓말이 된다.
 */
export function rankCandidates(
  foods: Food[],
  pref: Preference,
  seed: string = preferenceSeed(pref),
): ScoredFood[] {
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
    // 동점은 입력을 씨앗으로 섞는다. 식당 수로 줄을 세우면 달과 취향이 달라져도
    // 늘 같은 음식이 이겨서, 화면에 나오는 음식이 절반에 그친다.
    return tieHash(a.food.id, seed) - tieHash(b.food.id, seed);
  });

  return diversify(scored, scored.length);
}

/** 취향 일치도순 상위 몇 가지. */
export function recommendFoods(foods: Food[], pref: Preference, limit = 4): ScoredFood[] {
  return rankCandidates(foods, pref).slice(0, limit);
}

/** 한 식재료가 결과를 독점하지 못하게 하는 상한. */
export const MAX_PER_INGREDIENT = 1;

/** 같은 핵심 식재료가 이미 뽑힌 뒤 다시 등장할 때 주는 감점.
 * 점수 범위가 0~100이므로 100점 감점이면 서로 다른 재료 후보가 있는 한
 * 상위 5개에 같은 재료가 두 번 들어오지 않는다.
 */
export const INGREDIENT_DUPLICATE_PENALTY = 100;

/** 조리법도 겹치지 않게 한다. 넷 다 조림이면 재료가 달라도 같은 상이다. */
export const MAX_PER_METHOD = 1;

/**
 * 조리법 상한을 위해 양보할 수 있는 점수 폭.
 *
 * 재료와 이름은 점수와 무관하게 지킨다 — 목록에 같은 음식이 두 번 있는 것은
 * 어떤 점수로도 정당화되지 않는다. 반면 조리법은 값이 비싸면 포기한다.
 * 이 한도를 두면 조리법 중복이 0%로 유지되면서 낙차 중앙값이 20점에 머문다.
 */
export const DIVERSITY_MAX_DROP = 35;

/**
 * 이름만 보고 같은 음식으로 읽히는가.
 *
 * 재료 상한만으로는 '한우낙지 탕탕이'와 '낙지육회탕탕이'가 나란히 오르는 것을
 * 못 막는다. 두 행은 매칭된 제철 재료가 각각 육류·낙지로 갈려 서로 다른
 * 항목처럼 보이지만, 상에 오르면 같은 음식이다.
 */
function looksSameDish(a: Food, b: Food): boolean {
  if (a.name.includes(b.name) || b.name.includes(a.name)) return true;
  if (a.ingredient && b.name.includes(a.ingredient)) return true;
  if (b.ingredient && a.name.includes(b.ingredient)) return true;
  return false;
}

/**
 * 메뉴 이름에서 조리법을 뽑는다. 긴 것부터 봐야 '회무침'이 '회'에,
 * '칼국수'가 '국수'에 먹히지 않는다.
 */
const METHODS = [
  "샤브샤브", "회무침", "초무침", "물회", "칼국수", "수제비", "비빔밥", "덮밥", "솥밥",
  "쌈밥", "전골", "짬뽕", "라면", "만두", "탕수육", "떡국", "게장", "젓갈", "삼합",
  "보쌈", "수육", "국밥", "국수", "무침", "볶음", "튀김", "조림", "구이", "숙회",
  "회", "찜", "탕", "찌개", "죽", "전", "국",
] as const;

export function cookingMethod(name: string): string {
  let best = "";
  for (const m of METHODS) {
    if (name.includes(m) && m.length > best.length) best = m;
  }
  return best || "기타";
}

/**
 * FNV-1a. 동점자 순서를 입력마다 다르게 섞되, 같은 입력에는 같은 순서를 준다.
 *
 * 제철 후보는 같은 점수(98점)에 수십 개가 몰린다. 여기서 '식당 수 → 이름순'으로
 * 줄을 세우면 달이 바뀌어도 늘 같은 음식이 이겨서, 전체 458가지 중 251가지만
 * 화면에 나왔다. 입력을 씨앗으로 섞으면 노출이 394가지로 늘어난다. 난수가
 * 아니라 해시라서 같은 취향을 고른 사람은 언제나 같은 결과를 본다.
 */
function tieHash(id: string, seed: string): number {
  let h = 0x811c9dc5;
  const text = `${id}|${seed}`;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

function preferenceSeed(pref: Preference): string {
  return `${pref.month}|${pref.spicy}|${pref.soup}|${pref.raw}|${pref.ingredient}`;
}

/**
 * 점수순 정렬만 하면 "전복문어탕·전복연포탕·전복해신탕"처럼 같은 재료의
 * 변주가 목록을 통째로 차지한다. 점수는 정직하지만 답으로는 쓸모가 없다 —
 * 사용자는 오늘 뭘 먹을지 고르려는 것이지 전복 요리 목록을 보려는 게 아니다.
 *
 * 자리마다 "남은 것 중 가장 점수 높은 것"과 "재료·조리법이 겹치지 않는 것 중
 * 가장 점수 높은 것"을 나란히 놓고 고른다. 둘의 점수 차가 DIVERSITY_MAX_DROP
 * 안이면 겹치지 않는 쪽을, 그보다 벌어지면 점수 쪽을 택한다. 다양성은 쌀 때만
 * 사는 것이지, 엉뚱한 음식을 올릴 이유는 되지 못한다.
 */
function diversify(scored: ScoredFood[], limit: number): ScoredFood[] {
  // 동일 메뉴 중복은 먼저 제거한다.
  const seenNames = new Set<string>();
  const pending = scored.filter((item) => {
    if (seenNames.has(item.food.name)) return false;
    seenNames.add(item.food.name);
    return true;
  });

  const picked: ScoredFood[] = [];
  const ingredientCount = new Map<string, number>();

  while (picked.length < limit && pending.length > 0) {
    let bestIndex = 0;
    let bestAdjusted = -Infinity;

    for (let index = 0; index < pending.length; index += 1) {
      const item = pending[index];
      const ingredient = item.food.ingredient || item.food.name;
      const duplicateCount = ingredientCount.get(ingredient) ?? 0;
      const sameDishPenalty = picked.some((taken) => looksSameDish(taken.food, item.food)) ? 200 : 0;
      const adjusted =
        item.match -
        duplicateCount * INGREDIENT_DUPLICATE_PENALTY -
        sameDishPenalty;

      if (adjusted > bestAdjusted) {
        bestAdjusted = adjusted;
        bestIndex = index;
      }
    }

    const [item] = pending.splice(bestIndex, 1);
    const ingredient = item.food.ingredient || item.food.name;
    const duplicateCount = ingredientCount.get(ingredient) ?? 0;
    ingredientCount.set(ingredient, duplicateCount + 1);
    picked.push(duplicateCount > 0 ? { ...item, demoted: true } : item);
  }

  return picked;
}



export interface CategoryRecommendationResult {
  /** 화면에 실제로 보여 줄 5개. 정상 추천과 대체 추천이 섞일 수 있다. */
  results: ScoredFood[];
  /** results 중 핵심 조건을 만족하는 일반 추천. */
  exact: ScoredFood[];
  /** results 중 핵심 조건을 놓친 대체 추천. */
  alternatives: ScoredFood[];
  /** 전체 데이터에서 핵심 취향 조건을 만족하는 음식 수(월과 무관). */
  exactTotal: number;
  /** 하위 호환용. exactTotal과 같다. */
  exactTasteAnySeason: number;
  /** 0이면 첫 추천, 1 이상이면 ‘다른 추천 보기’ 결과. */
  round: number;
}

/**
 * 카테고리 추천에서 ‘대체 추천’ 여부를 정하는 핵심 조건.
 *
 * 맵기는 사용자가 요청한 대로 오직 감점만 한다. 제철 월 역시 대체 추천
 * 판정에는 쓰지 않고, 점수순을 움직이는 보너스로만 사용한다. 그래서 3월에
 * 완전 일치 육류가 없다고 해서 취향 점수 100점짜리 메뉴가 빨간 대체 추천으로
 * 보이는 모순이 생기지 않는다.
 */
export function categoryMismatchReasons(pref: Preference, food: Food): string[] {
  const reasons: string[] = [];
  if (food.isRaw !== (pref.raw === "O")) reasons.push("날것/익힘 조건 불일치");
  if (
    pref.ingredient !== "상관없음" &&
    !food.mainIngredients.includes(pref.ingredient)
  ) {
    reasons.push("주재료 조건 불일치");
  }
  if (pref.soup !== 1 && food.hasSoup !== (pref.soup === 2)) {
    reasons.push("국물 조건 불일치");
  }
  return reasons;
}

/** 맵기는 정확/대체를 가르는 조건이 아니라 점수 감점만 한다. */
export function satisfiesCategoryTasteExactly(pref: Preference, food: Food): boolean {
  return categoryMismatchReasons(pref, food).length === 0;
}

function monthGap(months: number[], target: number): number {
  if (months.length === 0) return 6;
  return Math.min(
    ...months.map((month) => {
      const direct = Math.abs(month - target);
      return Math.min(direct, 12 - direct);
    }),
  );
}

/**
 * 제철은 취향 4축보다 아래 단계의 보너스로 둔다.
 * - 해당 월: +12
 * - 앞뒤 1개월: +6
 * - 앞뒤 2개월: +3
 * - 그 외: +0
 *
 * 최대 12점이라 날것(40)·주재료(30)·국물(20)을 뒤집지는 못하지만, 같은 취향
 * 점수라면 선택 월에 맞는 음식이 확실히 앞선다. 기존에는 제철이 후보 필터와
 * 동점자 정렬에만 들어가 5~8월 결과가 지나치게 비슷해지는 문제가 있었다.
 */
export function seasonPreferenceBonus(food: Pick<Food, "months">, month: number): number {
  const gap = monthGap(food.months, month);
  if (gap === 0) return 12;
  if (gap === 1) return 6;
  if (gap === 2) return 3;
  return 0;
}

/** 같은 화면에서 두 번째 동일 식재료부터 주는 완만한 다양성 감점. */
export const CATEGORY_DUPLICATE_PENALTY = 15;

function rankedCategoryCandidates(
  foods: Food[],
  pref: Preference,
  seed: string,
): ScoredFood[] {
  const raw = foods.map<ScoredFood>((food) => {
    const mismatches = categoryMismatchReasons(pref, food);
    const match = explainMatch(pref, food).score;
    const seasonBonus = seasonPreferenceBonus(food, pref.month);
    return {
      food,
      match,
      inSeason: food.months.includes(pref.month),
      mismatches,
      demoted: false,
      seasonBonus,
      rankingScore: match + seasonBonus,
      substitute: mismatches.length > 0,
      substitutionReasons: mismatches,
      diversityPenalty: 0,
    };
  });

  raw.sort((a, b) => {
    const scoreDiff = (b.rankingScore ?? b.match) - (a.rankingScore ?? a.match);
    if (scoreDiff !== 0) return scoreDiff;
    if (b.match !== a.match) return b.match - a.match;
    if (a.inSeason !== b.inSeason) return a.inSeason ? -1 : 1;
    const gapDiff = monthGap(a.food.months, pref.month) - monthGap(b.food.months, pref.month);
    if (gapDiff !== 0) return gapDiff;
    return tieHash(a.food.id, seed) - tieHash(b.food.id, seed);
  });

  // 같은 메뉴명이 서로 다른 제철 식재료 행으로 중복된 13개 메뉴가 있다.
  // 한 추천 화면에서 동일 메뉴가 두 번 나오지 않도록 가장 높은 점수 행만 남긴다.
  const seenNames = new Set<string>();
  return raw.filter((item) => {
    const key = item.food.displayName || item.food.name;
    if (seenNames.has(key)) return false;
    seenNames.add(key);
    return true;
  });
}

function ingredientKey(item: ScoredFood): string {
  return item.food.ingredient || item.food.name;
}

/**
 * 한 페이지를 점수순으로 고르되 첫 화면과 새로고침의 다양성 규칙을 다르게 한다.
 *
 * 첫 화면(round=0): 같은 핵심 식재료는 가능한 한 1개만 보여 준다.
 * 다음 화면(round>=1): 이전에 안 보인 메뉴를 우선하고, 같은 식재료를 화면당
 * 최대 2개까지 허용한다. 이때 두 번째 동일 재료에는 -15점만 적용해 전복회처럼
 * 첫 화면에서 숨겨진 고득점 변형 메뉴도 1~2개 정도 다시 등장할 수 있다.
 */
function selectCategoryPage(
  ranked: ScoredFood[],
  limit: number,
  round: number,
  seenFoodIds: string[],
): ScoredFood[] {
  const seen = new Set(seenFoodIds);
  const unseen = ranked.filter((item) => !seen.has(item.food.id));
  const source = unseen.length >= limit ? unseen : [
    ...unseen,
    ...ranked.filter((item) => seen.has(item.food.id)),
  ];

  const normal = source.filter((item) => !item.substitute);
  const alternatives = source.filter((item) => item.substitute);
  const picked: ScoredFood[] = [];
  const ingredientCounts = new Map<string, number>();
  const maxPerIngredient = round === 0 ? 1 : 2;

  const take = (pool: ScoredFood[], enforceCap: boolean) => {
    const pending = [...pool];
    while (picked.length < limit && pending.length > 0) {
      let bestIndex = -1;
      let bestAdjusted = -Infinity;
      let bestPenalty = 0;

      for (let index = 0; index < pending.length; index += 1) {
        const item = pending[index];
        if (picked.some((taken) => taken.food.id === item.food.id)) continue;
        const key = ingredientKey(item);
        const duplicateCount = ingredientCounts.get(key) ?? 0;
        if (enforceCap && duplicateCount >= maxPerIngredient) continue;
        const penalty = duplicateCount * CATEGORY_DUPLICATE_PENALTY;
        const adjusted = (item.rankingScore ?? item.match) - penalty;
        if (adjusted > bestAdjusted) {
          bestAdjusted = adjusted;
          bestIndex = index;
          bestPenalty = penalty;
        }
      }

      if (bestIndex < 0) break;
      const [chosen] = pending.splice(bestIndex, 1);
      const key = ingredientKey(chosen);
      ingredientCounts.set(key, (ingredientCounts.get(key) ?? 0) + 1);
      picked.push({
        ...chosen,
        demoted: bestPenalty > 0,
        diversityPenalty: bestPenalty,
        rankingScore: (chosen.rankingScore ?? chosen.match) - bestPenalty,
      });
    }
  };

  // 정상 추천을 먼저 채운 뒤 부족한 자리만 대체 추천으로 채운다.
  take(normal, true);
  if (picked.length < limit) take(alternatives, true);

  // ‘항상 5개’ 규칙. 첫 화면에 서로 다른 재료가 5개보다 적은 극단적 조건이면
  // 고득점 정상 메뉴 중 중복 재료를 허용하고, 그래도 모자라면 대체 메뉴를 넣는다.
  if (picked.length < limit) take(normal, false);
  if (picked.length < limit) take(alternatives, false);

  // 다양성 때문에 선택 순서가 달라져도 화면 표시는 최종 추천 점수 내림차순이다.
  return picked
    .slice(0, limit)
    .sort((a, b) => {
      const diff = (b.rankingScore ?? b.match) - (a.rankingScore ?? a.match);
      if (diff !== 0) return diff;
      return b.match - a.match;
    });
}

/**
 * 카테고리 입력 전용 추천.
 *
 * - 결과는 항상 5개를 목표로 한다.
 * - 정상 추천은 날것/익힘·주재료·국물 조건을 만족한다.
 * - 맵기와 제철은 대체 추천 판정이 아니라 점수/보너스에만 영향을 준다.
 * - 정상 추천이 5개보다 적으면 가장 점수가 가까운 메뉴를 대체 추천으로 섞는다.
 * - 첫 화면은 동일 식재료 1개, ‘다른 추천 보기’는 최대 2개까지 허용한다.
 */
export function recommendByExactCategory(
  foods: Food[],
  pref: Preference,
  limit = 5,
  seed: string = randomSeed(),
  round = 0,
  seenFoodIds: string[] = [],
): CategoryRecommendationResult {
  const ranked = rankedCategoryCandidates(foods, pref, seed);
  const results = selectCategoryPage(ranked, limit, round, seenFoodIds);
  const exact = results.filter((item) => !item.substitute);
  const alternatives = results.filter((item) => item.substitute);
  const exactTotal = ranked.filter((item) => !item.substitute).length;

  return {
    results,
    exact,
    alternatives,
    exactTotal,
    exactTasteAnySeason: exactTotal,
    round,
  };
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

/** 일반 명사에 가까운 한 글자 키워드('회')는 근거로 치되 약하게 본다. */
const WEAK_KEYWORD_SCORE = 20;
const STRONG_KEYWORD_SCORE = 50;

/**
 * 거리의 대표 먹거리가 이 음식과 실제로 겹치는지 본다.
 *
 * 겹치는 방향은 "거리 키워드 ⊂ 음식"만 인정한다. 반대 방향(재료 ⊂ 키워드)까지
 * 열어 두면 법성포 굴비거리가 '굴'을, 보리굴비가 '보리'를 물어 온다 — 글자만
 * 겹칠 뿐 다른 음식이다. 실제 데이터에서 그 방향으로 잡힌 14건이 전부 오탐이었다.
 */
function keywordHit(food: Food, street: Street): { keyword: string; score: number } | null {
  for (const kw of street.foodKeywords) {
    // 재료가 키워드를 품는다: 장어거리 ↔ 붕장어. 가장 곧은 근거다.
    if (food.ingredient && food.ingredient.includes(kw)) {
      return { keyword: kw, score: STRONG_KEYWORD_SCORE };
    }
    // 메뉴 이름이 키워드를 품는다: 게장백반거리 ↔ 갈치조림+돌게장정식.
    // 매칭된 제철 재료가 달라도 그 거리에서 파는 음식인 것은 맞다.
    if (food.name.includes(kw)) {
      return { keyword: kw, score: kw.length >= 2 ? STRONG_KEYWORD_SCORE : WEAK_KEYWORD_SCORE };
    }
  }
  return null;
}

/**
 * 하나의 추천 음식에 어울리는 특화거리를 점수순으로 돌려준다.
 *
 * **대표 먹거리가 겹치는 거리만 후보로 둔다.** 예전에는 키워드가 하나도 안
 * 맞아도 같은 시·군·구(30점)나 시·도(10점)+점포수 가산만으로 문턱을 넘어서,
 * 홍어찜에 장성읍 먹거리타운(애호박·돼지고기)이, 갈치찜에 무안뻘낙지거리가
 * 붙었다. 추천 465건 중 178건이 그런 식이었다. 가깝다는 것은 이미 맞는 거리
 * 여럿을 줄 세울 때 쓸 근거이지, 상관없는 거리를 끌어올 근거가 아니다.
 *
 * 그래서 여기서 아무것도 안 나오는 것이 정상이다. 부르는 쪽은 거리 대신
 * 그 음식을 실제로 파는 집을 보여 준다.
 */
export function matchStreets(food: Food, streets: Street[], limit = 3): StreetMatch[] {
  const foodStreets = streets.filter((s) => s.category === "음식");
  const coords = food.restaurants
    .filter((r) => r.lat !== null && r.lon !== null)
    .map((r) => ({ lat: r.lat as number, lon: r.lon as number }));

  const matches: StreetMatch[] = [];

  for (const street of foodStreets) {
    const hit = keywordHit(food, street);
    if (!hit) continue;

    // 같은 시·군·구에 있는 거리만 붙인다. 키워드만 보면 순천에서 파는 표고
    // 골동면이 '표고' 때문에 여수 거리에, 여수 전복순두부가 '전복' 때문에
    // 완도 거리에 붙는다. 카드에 뜬 지역과 거리가 어긋나면, 그건 갈 수 없는
    // 안내다. 재료가 겹쳐도 그 동네 거리가 아니면 소용없다.
    const sameSigungu = food.regions.some((r) => street.sigungu && r.includes(street.sigungu));
    if (!sameSigungu) continue;

    const reasons: string[] = [`${hit.keyword} 전문 거리`, `${street.sigungu} 안에 있음`];
    let score = hit.score + 30;

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
    matches.push({ street, score, reasons, distanceKm });
  }

  return matches.sort((a, b) => b.score - a.score).slice(0, limit);
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

/** 대표 먹거리가 겹치는 거리가 없어, 파는 집으로 안내해야 하는 추천 음식. */
export interface FoodShops {
  food: Food;
  match: number;
  shops: Restaurant[];
}

/**
 * 추천 음식 중 연결되는 특화거리가 없는 것만 골라, 그 음식을 파는 집을 붙인다.
 *
 * 특화거리는 광주·전남을 통틀어 20곳뿐이라 대부분의 제철 음식에는 짝이 없다.
 * 짝이 없을 때 억지로 거리를 붙이는 대신 이 목록으로 넘긴다. 향토음식점으로
 * 등록된 곳을 앞세운다 — 같은 음식이면 그쪽이 찾아갈 이유가 분명하다.
 */
export function foodsWithoutStreet(
  scored: ScoredFood[],
  streets: Street[],
  shopLimit = 3,
): FoodShops[] {
  const out: FoodShops[] = [];
  for (const item of scored) {
    if (matchStreets(item.food, streets, 1).length > 0) continue;
    const shops = [...item.food.restaurants]
      .sort((a, b) => Number(b.isLocalSpecialty) - Number(a.isLocalSpecialty))
      .slice(0, shopLimit);
    if (shops.length > 0) out.push({ food: item.food, match: item.match, shops });
  }
  return out;
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
 * 카드 하단에 걸 목적지.
 *
 * 그 음식을 대표하는 특화거리가 있으면 거리로, 없으면 실제로 파는 집으로
 * 보낸다. 거리가 없다고 아무 거리나 붙이지 않는다 — 그게 이 서비스가
 * 홍어찜에 애호박 거리를 추천하던 이유였다.
 */
export type BestPlace =
  | { kind: "street"; id: string; name: string }
  | { kind: "restaurant"; name: string; area: string; count: number };

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
  /** 취향순 카드에 거는 목적지. 서버에서 미리 골라 둔다. */
  bestPlace: BestPlace | null;
  spots: FoodSpot[];
}

/**
 * 그 음식을 대표할 집 하나를 고른다. 향토음식점으로 등록된 곳을 앞세우고,
 * 없으면 첫 집을 쓴다. 어느 쪽이든 카드에는 총 몇 곳인지를 함께 적는다.
 */
function pickRestaurant(food: Food): BestPlace | null {
  const shops = food.restaurants;
  if (shops.length === 0) return null;
  const pick = shops.find((r) => r.isLocalSpecialty) ?? shops[0];
  return { kind: "restaurant", name: pick.name, area: pick.area, count: shops.length };
}

/**
 * 취향순으로 정렬된 후보를 클라이언트가 쓸 형태로 줄인다.
 *
 * `linkLimit`은 목적지를 붙일 개수다. 이 링크는 취향순 카드에만 나오고
 * 취향순은 언제나 앞에서부터 자르므로, 뒤쪽 후보까지 거리를 매칭해 봐야
 * payload만 늘고 화면에는 안 나온다.
 */
export function toNearbyCandidates(
  scored: ScoredFood[],
  streets: Street[],
  linkLimit = 4,
): NearbyCandidate[] {
  return scored.map((item, index) => {
    // 대표 먹거리가 겹치는 거리가 있을 때만 거리로 보낸다. 없으면 그 음식을
    // 실제로 파는 집을 가리킨다 — 상관없는 거리로 보내는 것보다 쓸모 있다.
    const street = index < linkLimit ? matchStreets(item.food, streets, 1)[0] : undefined;
    const bestPlace: BestPlace | null =
      index >= linkLimit
        ? null
        : street
          ? { kind: "street", id: street.street.id, name: streetDisplayName(street.street) }
          : pickRestaurant(item.food);
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
      bestPlace,
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
