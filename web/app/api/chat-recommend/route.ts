import { NextResponse } from "next/server";

import { foods } from "@/lib/data";
import { getKstMonth } from "@/lib/kst";
import { parseTasteText } from "@/lib/parse-taste";
import {
  DEFAULT_PREFERENCE,
  recommendFoods,
  type Preference,
} from "@/lib/recommend";
import type { Food, Restaurant } from "@/lib/types";

type ChatTurn = { role: "user" | "assistant"; content: string };
type LocationIntent = { region?: string; area?: string; label?: string };
type LlmResult = {
  reply: string;
  foodIds: string[];
  understood?: string[];
  reasons?: Record<string, string>;
};

function locationMatches(restaurant: Restaurant, intent: LocationIntent | null) {
  if (!intent) return true;
  if (intent.region && restaurant.region !== intent.region) return false;
  if (intent.area) {
    const area = restaurant.area.replace(/\s+/g, "");
    const wanted = intent.area.replace(/\s+/g, "");
    if (!(area.includes(wanted) || wanted.includes(area))) return false;
  }
  return true;
}

function detectLocationIntent(message: string): LocationIntent | null {
  const normalized = message.replace(/\s+/g, "");
  if (!normalized) return null;

  const allAreas = Array.from(
    new Set(foods.flatMap((food) => food.restaurants.map((r) => r.area).filter(Boolean))),
  ).sort((a, b) => b.length - a.length);

  for (const area of allAreas) {
    const compact = area.replace(/\s+/g, "");
    const short = compact.replace(/(특별자치도|광역시|특별시|시|군|구)$/u, "");
    if ((compact.length >= 2 && normalized.includes(compact)) || (short.length >= 2 && normalized.includes(short))) {
      const sample = foods.flatMap((food) => food.restaurants).find((r) => r.area === area);
      return { region: sample?.region, area, label: `${sample?.region ?? ""} ${area}`.trim() };
    }
  }

  if (normalized.includes("광주")) return { region: "광주", label: "광주" };
  if (normalized.includes("전남") || normalized.includes("전라남도")) {
    return { region: "전남", label: "전남" };
  }
  return null;
}

function compactFood(food: Food, location: LocationIntent | null) {
  const restaurants = food.restaurants.filter((r) => locationMatches(r, location));
  return {
    id: food.id,
    name: food.name,
    displayName: food.displayName,
    ingredient: food.ingredient,
    spicy: food.spicy,
    hasSoup: food.hasSoup,
    isRaw: food.isRaw,
    mainIngredients: food.mainIngredients,
    months: food.months,
    restaurantCount: restaurants.length,
    restaurantLocations: Array.from(new Set(restaurants.map((r) => `${r.region} ${r.area}`))).slice(0, 8),
  };
}

function lexicalScore(food: Food, message: string) {
  const text = message.replace(/\s+/g, "").toLowerCase();
  if (!text) return 0;
  const fields = [food.name, food.displayName, food.ingredient]
    .filter(Boolean)
    .map((value) => String(value).replace(/\s+/g, "").toLowerCase());
  let score = 0;
  for (const field of fields) {
    if (!field) continue;
    if (text.includes(field)) score += 30;
    if (field.includes(text) && text.length >= 2) score += 15;
  }
  return score;
}

function satisfiesExplicitTaste(food: Food, parsed: ReturnType<typeof parseTasteText>) {
  const p = parsed.pref;
  // 맵기는 명시적으로 말했더라도 후보를 잘라내지 않는다.
  // 추천 점수에서만 감점해 완전히 다른 맵기도 대체 추천으로 취급하지 않는다.
  if (p.soup !== undefined && p.soup !== 1 && food.hasSoup !== (p.soup === 2)) return false;
  if (p.raw !== undefined && food.isRaw !== (p.raw === "O")) return false;
  if (p.ingredient !== undefined && p.ingredient !== "상관없음" && !food.mainIngredients.includes(p.ingredient)) return false;
  if (p.month !== undefined && food.months.length > 0 && !food.months.includes(p.month)) return false;
  return true;
}

function buildLocalCandidates(message: string, excludeFoodIds: string[] = [], location: LocationIntent | null) {
  const parsed = parseTasteText(message);
  const pref: Preference = { ...DEFAULT_PREFERENCE, month: getKstMonth(), ...parsed.pref };
  const excluded = new Set(excludeFoodIds);
  const locationFoods = foods.filter(
    (food) => !excluded.has(food.id) && food.restaurants.some((r) => locationMatches(r, location)),
  );
  const exact = locationFoods.filter((food) => satisfiesExplicitTaste(food, parsed));
  const source = exact.length > 0 ? exact : locationFoods;

  const tasteRanked = recommendFoods(source, pref, 40);
  const tasteMap = new Map(tasteRanked.map((item, index) => [item.food.id, 40 - index]));
  return source
    .map((food) => ({ food, score: (tasteMap.get(food.id) ?? 0) + lexicalScore(food, message) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 60)
    .map((item) => item.food);
}

function localReason(food: Food, parsed: ReturnType<typeof parseTasteText>, location: LocationIntent | null) {
  const bits: string[] = [];
  if (parsed.pref.spicy !== undefined && food.spicy === parsed.pref.spicy) bits.push(`요청한 맵기 ${food.spicy}단계`);
  if (parsed.pref.ingredient && parsed.pref.ingredient !== "상관없음" && food.mainIngredients.includes(parsed.pref.ingredient)) bits.push(parsed.pref.ingredient);
  if (parsed.pref.soup === 2 && food.hasSoup) bits.push("국물 요리");
  if (parsed.pref.soup === 0 && !food.hasSoup) bits.push("국물 없는 요리");
  if (food.months.includes(getKstMonth())) bits.push(`${getKstMonth()}월 제철`);
  if (location?.label) bits.push(`${location.label} 식당 등록`);
  return bits.length ? `${bits.join(" · ")} 조건에 잘 맞습니다.` : "현재 제철과 음식 데이터에서 취향에 가까운 메뉴입니다.";
}

function diversifyFoodIds(
  primaryIds: string[],
  localFoods: Food[],
  limit = 5,
  allowTwoPerIngredient = false,
): string[] {
  // LLM 순위를 최대한 존중하되 첫 추천은 같은 실제 식재료를 1개만 노출한다.
  // ‘다른 추천 보기’에서는 이미 본 foodId가 제외되어 들어오므로 화면당 2개까지
  // 허용해, 첫 화면에서 숨긴 전복회/전복찜 같은 고득점 변형도 다시 볼 수 있다.
  const baseOrder = Array.from(new Set([...primaryIds, ...localFoods.map((food) => food.id)]));
  const foodById = new Map(localFoods.map((food) => [food.id, food]));
  const maxPerIngredient = allowTwoPerIngredient ? 2 : 1;
  const picked: string[] = [];
  const ingredientCount = new Map<string, number>();

  const take = (enforceCap: boolean) => {
    for (const id of baseOrder) {
      if (picked.length >= limit) break;
      if (picked.includes(id)) continue;
      const food = foodById.get(id);
      if (!food) continue;
      const ingredient = food.ingredient || food.name;
      const count = ingredientCount.get(ingredient) ?? 0;
      if (enforceCap && count >= maxPerIngredient) continue;
      ingredientCount.set(ingredient, count + 1);
      picked.push(id);
    }
  };

  take(true);
  // 후보 식재료 종류 자체가 5개보다 적은 경우에만 중복을 허용해 항상 5개를 채운다.
  if (picked.length < limit) take(false);
  return picked.slice(0, limit);
}

function fallbackRecommend(message: string, excludeFoodIds: string[] = [], location: LocationIntent | null): LlmResult {
  const parsed = parseTasteText(message);
  const localFoods = buildLocalCandidates(message, excludeFoodIds, location);
  const diversifiedIds = diversifyFoodIds(localFoods.map((food) => food.id), localFoods, 5, excludeFoodIds.length > 0);
  const byId = new Map(localFoods.map((food) => [food.id, food]));
  const candidates = diversifiedIds.map((id) => byId.get(id)).filter((food): food is Food => Boolean(food));
  const understood = parsed.hits.map((hit) => `${hit.label}: ${hit.reading}`);
  if (location?.label) understood.push(`지역: ${location.label}`);
  return {
    reply: candidates.length
      ? `${understood.length ? `${understood.join(", ")}로 이해했어요. ` : ""}${candidates.map((f) => f.displayName || f.name).join(", ")}을 추천해요.`
      : `${location?.label ?? "선택한 조건"}에서 맞는 음식점을 찾지 못했어요.`,
    foodIds: candidates.map((f) => f.id),
    understood,
    reasons: Object.fromEntries(candidates.map((f) => [f.id, localReason(f, parsed, location)])),
  };
}

function extractJson(text: string): LlmResult | null {
  const tryParse = (value: string) => {
    try {
      const parsed = JSON.parse(value) as LlmResult;
      return parsed && typeof parsed.reply === "string" && Array.isArray(parsed.foodIds) ? parsed : null;
    } catch { return null; }
  };
  const direct = tryParse(text);
  if (direct) return direct;
  const match = text.match(/\{[\s\S]*\}/);
  return match ? tryParse(match[0]) : null;
}

async function callSchoolLlm(url: string, apiKey: string, model: string, message: string, history: ChatTurn[], catalog: ReturnType<typeof compactFood>[], location: LocationIntent | null) {
  const endpoint = `${url.replace(/\/$/, "")}/v1/chat/completions`;
  const system = `너는 광주·전남 미식 추천 AI다. 자연어의 강도·지역·재료·조리방식 의도를 적극적으로 해석한다. 반드시 제공된 음식 후보 안에서 최대 5개만 추천한다.

해석 예시:
- '엄청 매운/아주 매운/불같이 매운' => spicy=3 선호로 이해하되 필터링하지 않고 감점에만 사용
- '매운' => spicy=2 선호
- '살짝 매운' => spicy=1 선호
- '안 매운' => spicy=0 선호
- '해산물 먹고 싶다' => mainIngredients에 해산물 우선
- '광주에서 먹고 싶다/광주 음식점 찾는다' => 아래 후보는 이미 광주 식당이 있는 음식으로 제한되어 있으므로 그 안에서 고른다.

규칙:
1) 추천 우선순위는 날것/익힘 여부 > 주재료 > 국물 여부 > 맵기 순이다.
2) 맵기는 후보 탈락 조건이 아니라 차이가 클수록 감점하는 요소다. 맵기가 완전히 달라도 그것만으로 대체 추천이라고 표현하지 않는다.
3) 상위 5개에 전복·홍어처럼 동일한 실제 ingredient가 반복되지 않도록 서로 다른 식재료를 우선 선택한다.
4) foodIds에는 아래 catalog의 id만 넣는다.
5) reasons는 각 foodId별 선정 이유를 1~2문장 한국어로 쓴다. 사용자의 표현과 음식 속성, 지역 식당 존재, 제철 여부를 구체적으로 연결한다.
6) 데이터에 없는 사실·효능·맛집 순위를 지어내지 않는다.
7) 비슷한 메뉴만 반복하지 않는다.
8) 오직 JSON만 반환한다. 형식: {"reply":"...","foodIds":["id"],"understood":["엄청 매움→맵기 3","광주"],"reasons":{"id":"선정 이유"}}

현재 월: ${getKstMonth()}월
지역 의도: ${location?.label ?? "지정 없음"}
후보 데이터:
${JSON.stringify(catalog)}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, temperature: 0.15, max_tokens: 1100, messages: [{ role: "system", content: system }, ...history.slice(-8), { role: "user", content: message }] }),
  });
  if (!response.ok) throw new Error(`School LLM error ${response.status}: ${await response.text()}`);
  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return extractJson(data.choices?.[0]?.message?.content ?? "");
}

export async function POST(request: Request) {
  const body = (await request.json()) as { message?: string; history?: ChatTurn[]; excludeFoodIds?: string[] };
  const message = body.message?.trim();
  if (!message) return NextResponse.json({ error: "message is required" }, { status: 400 });

  const excludeFoodIds = Array.isArray(body.excludeFoodIds) ? body.excludeFoodIds.filter((id): id is string => typeof id === "string").slice(0, 20) : [];
  const location = detectLocationIntent(message);
  const fallback = fallbackRecommend(message, excludeFoodIds, location);
  const localFoods = buildLocalCandidates(message, excludeFoodIds, location);
  const candidates = localFoods.map((food) => compactFood(food, location));
  const validIds = new Set(localFoods.map((food) => food.id));
  const history = (body.history ?? []).filter((turn) => turn && (turn.role === "user" || turn.role === "assistant") && typeof turn.content === "string");

  try {
    let parsed: LlmResult | null = null;
    let mode = "local";
    const schoolUrl = process.env.SCHOOL_LLM_URL;
    if (schoolUrl && candidates.length > 0) {
      parsed = await callSchoolLlm(schoolUrl, process.env.SCHOOL_LLM_API_KEY || "aix-key", process.env.SCHOOL_LLM_MODEL || "Qwen/Qwen3-8B", message, history, candidates, location);
      mode = "school-llm";
    }
    if (!parsed) return NextResponse.json({ ...fallback, mode: "local", location });

    const excluded = new Set(excludeFoodIds);
    const llmIds = parsed.foodIds.filter((id) => validIds.has(id) && !excluded.has(id));
    const foodIds = diversifyFoodIds(llmIds, localFoods, 5, excludeFoodIds.length > 0);
    if (foodIds.length === 0) return NextResponse.json({ ...fallback, mode: "local", location });
    const parsedTaste = parseTasteText(message);
    const localById = new Map(localFoods.map((food) => [food.id, food]));
    const reasons = Object.fromEntries(
      foodIds.map((id) => [
        id,
        parsed?.reasons?.[id] ||
          fallback.reasons?.[id] ||
          (localById.get(id) ? localReason(localById.get(id) as Food, parsedTaste, location) : "취향과 지역 조건에 맞아 추천했어요."),
      ]),
    );
    return NextResponse.json({ reply: parsed.reply, foodIds, understood: parsed.understood ?? fallback.understood ?? [], reasons, mode, location });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ ...fallback, mode: "local", location });
  }
}
