import { NextResponse } from "next/server";

import { foods } from "@/lib/data";
import { getKstMonth } from "@/lib/kst";
import { parseTasteText } from "@/lib/parse-taste";
import {
  DEFAULT_PREFERENCE,
  recommendFoods,
  type Preference,
} from "@/lib/recommend";
import type { Food } from "@/lib/types";

type ChatTurn = { role: "user" | "assistant"; content: string };
type LlmResult = { reply: string; foodIds: string[]; understood?: string[] };

function compactFood(food: Food) {
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
    restaurantCount: food.restaurantCount,
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

function buildLocalCandidates(message: string, excludeFoodIds: string[] = []) {
  const parsed = parseTasteText(message);
  const pref: Preference = {
    ...DEFAULT_PREFERENCE,
    month: getKstMonth(),
    ...parsed.pref,
  };

  const tasteRanked = recommendFoods(foods, pref, 30);
  const tasteMap = new Map(tasteRanked.map((item, index) => [item.food.id, 30 - index]));

  const excluded = new Set(excludeFoodIds);

  return [...foods]
    .filter((food) => !excluded.has(food.id))
    .map((food) => ({
      food,
      score: (tasteMap.get(food.id) ?? 0) + lexicalScore(food, message),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 50)
    .map((item) => item.food);
}

function fallbackRecommend(message: string, excludeFoodIds: string[] = []): LlmResult {
  const parsed = parseTasteText(message);
  const pref: Preference = {
    ...DEFAULT_PREFERENCE,
    month: getKstMonth(),
    ...parsed.pref,
  };

  const excluded = new Set(excludeFoodIds);

  const exact = foods
    .filter((food) => !excluded.has(food.id))
    .map((food) => ({ food, score: lexicalScore(food, message) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((item) => item.food);

  const taste = recommendFoods(foods, pref, 30)
    .map((item) => item.food)
    .filter((food) => !excluded.has(food.id));
  const picked: Food[] = [];
  const seen = new Set<string>();

  for (const food of [...exact, ...taste]) {
    if (seen.has(food.id)) continue;
    seen.add(food.id);
    picked.push(food);
    if (picked.length >= 5) break;
  }

  const understood = parsed.hits.map((hit) => `${hit.label}: ${hit.reading}`);
  const summary = understood.length
    ? `말씀하신 취향을 ${understood.join(", ")}로 이해했어요.`
    : "구체적인 취향 표현은 적었지만 현재 제철과 음식 데이터 기준으로 후보를 골랐어요.";

  return {
    reply: `${summary} ${picked.map((food) => food.displayName || food.name).join(", ")} 순으로 추천해요.`,
    foodIds: picked.map((food) => food.id),
    understood,
  };
}

function extractJson(text: string): LlmResult | null {
  try {
    const direct = JSON.parse(text) as LlmResult;
    if (direct && typeof direct.reply === "string" && Array.isArray(direct.foodIds)) return direct;
  } catch {}

  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as LlmResult;
    if (parsed && typeof parsed.reply === "string" && Array.isArray(parsed.foodIds)) return parsed;
  } catch {}
  return null;
}

async function callSchoolLlm(
  url: string,
  apiKey: string,
  model: string,
  message: string,
  history: ChatTurn[],
  catalog: ReturnType<typeof compactFood>[],
) {
  const endpoint = `${url.replace(/\/$/, "")}/v1/chat/completions`;
  const system = `너는 광주·전남 미식 추천 AI다. 사용자의 자연어 취향을 이해하고 반드시 제공된 음식 데이터 안에서만 최대 5개를 추천한다.\n\n중요 규칙:\n1) 맵기(spicy 0~3), 국물(hasSoup), 날것(isRaw), 주재료(mainIngredients), 제철(months), 사용자가 직접 언급한 음식·재료를 함께 고려한다.\n2) 사용자가 말하지 않은 취향을 과하게 지어내지 않는다.\n3) foodIds에는 아래 데이터에 있는 id만 넣는다.\n4) 비슷한 음식만 반복하지 말고 가능하면 다양한 메뉴를 고른다.\n5) 한국어로 짧게 추천 이유를 설명한다.\n6) 오직 JSON만 반환한다. 형식: {"reply":"...","foodIds":["음식ID"],"understood":["매움","국물"]}\n\n현재 ${getKstMonth()}월 음식 후보:\n${JSON.stringify(catalog)}`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 700,
      messages: [
        { role: "system", content: system },
        ...history.slice(-8),
        { role: "user", content: message },
      ],
    }),
  });

  if (!response.ok) throw new Error(`School LLM error ${response.status}: ${await response.text()}`);
  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return extractJson(data.choices?.[0]?.message?.content ?? "");
}

async function callAnthropic(
  apiKey: string,
  model: string,
  message: string,
  history: ChatTurn[],
  catalog: ReturnType<typeof compactFood>[],
) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 700,
      temperature: 0.2,
      system: `너는 광주·전남 미식 추천 AI다. 사용자의 자연어 취향을 이해하고 반드시 제공된 음식 데이터 안에서만 최대 5개를 추천한다. 맵기(spicy 0~3), 국물(hasSoup), 날것(isRaw), 주재료(mainIngredients), 제철(months), 직접 언급한 음식·재료를 고려한다. 비슷한 음식만 반복하지 않는다. 오직 JSON만 반환한다. 형식: {"reply":"...","foodIds":["음식ID"],"understood":["..."]}\n\n현재 ${getKstMonth()}월 음식 후보:\n${JSON.stringify(catalog)}`,
      messages: [...history.slice(-8), { role: "user", content: message }],
    }),
  });

  if (!response.ok) throw new Error(`Anthropic error ${response.status}: ${await response.text()}`);
  const data = (await response.json()) as { content?: Array<{ type: string; text?: string }> };
  return extractJson(data.content?.find((item) => item.type === "text")?.text ?? "");
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    message?: string;
    history?: ChatTurn[];
    excludeFoodIds?: string[];
  };
  const message = body.message?.trim();
  if (!message) return NextResponse.json({ error: "message is required" }, { status: 400 });

  const excludeFoodIds = Array.isArray(body.excludeFoodIds)
    ? body.excludeFoodIds.filter((id): id is string => typeof id === "string").slice(0, 20)
    : [];
  const fallback = fallbackRecommend(message, excludeFoodIds);
  const candidates = buildLocalCandidates(message, excludeFoodIds).map(compactFood);
  const validIds = new Set(foods.map((food) => food.id));
  const history = (body.history ?? []).filter(
    (turn) =>
      turn &&
      (turn.role === "user" || turn.role === "assistant") &&
      typeof turn.content === "string",
  );

  try {
    let parsed: LlmResult | null = null;
    let mode = "local";

    const schoolUrl = process.env.SCHOOL_LLM_URL;
    if (schoolUrl) {
      parsed = await callSchoolLlm(
        schoolUrl,
        process.env.SCHOOL_LLM_API_KEY || "aix-key",
        process.env.SCHOOL_LLM_MODEL || "Qwen/Qwen3-8B",
        message,
        history,
        candidates,
      );
      mode = "school-llm";
    } else if (process.env.ANTHROPIC_API_KEY) {
      parsed = await callAnthropic(
        process.env.ANTHROPIC_API_KEY,
        process.env.ANTHROPIC_MODEL || "claude-sonnet-5",
        message,
        history,
        candidates,
      );
      mode = "anthropic";
    }

    if (!parsed) return NextResponse.json({ ...fallback, mode: "local" });

    const excluded = new Set(excludeFoodIds);
    const foodIds = parsed.foodIds
      .filter((id) => validIds.has(id) && !excluded.has(id))
      .slice(0, 5);
    if (foodIds.length === 0) return NextResponse.json({ ...fallback, mode: "local" });

    return NextResponse.json({
      reply: parsed.reply,
      foodIds,
      understood: parsed.understood ?? [],
      mode,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ ...fallback, mode: "local" });
  }
}
