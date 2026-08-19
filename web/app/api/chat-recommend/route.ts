import { NextResponse } from "next/server";

import { streets } from "@/lib/data";
import type { Street } from "@/lib/types";

type ChatTurn = { role: "user" | "assistant"; content: string };
type LlmResult = { reply: string; streetIds: string[]; keywords?: string[] };

const foodStreets = streets.filter((s) => s.category === "음식");

function searchableText(s: Street) {
  return [s.name, s.description, s.sido, s.sigungu, s.address, ...s.foodKeywords]
    .join(" ")
    .toLowerCase();
}

function fallbackRecommend(message: string): LlmResult {
  const q = message.trim().toLowerCase();
  const tokens = q
    .replace(/[^0-9a-zA-Z가-힣\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2)
    .filter((t) => !["먹고", "싶어", "싶어요", "추천", "해줘", "해주세요", "거리", "음식", "오늘", "근처"].includes(t));

  const scored = foodStreets
    .map((street) => {
      const hay = searchableText(street);
      let score = 0;
      for (const token of tokens) {
        if (street.foodKeywords.some((k) => k.toLowerCase().includes(token) || token.includes(k.toLowerCase()))) score += 8;
        if (street.name.toLowerCase().includes(token)) score += 5;
        if (hay.includes(token)) score += 2;
      }
      return { street, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  if (scored.length === 0) {
    return {
      reply: "말씀하신 음식과 직접 연결되는 특화거리를 데이터에서 바로 찾지는 못했어요. 먹고 싶은 재료나 메뉴를 조금 더 구체적으로 말씀해 주세요. 예: ‘전복 먹고 싶어’, ‘낙지 요리 추천해줘’.",
      streetIds: [],
      keywords: tokens,
    };
  }

  const names = scored.map((x) => x.street.name);
  return {
    reply: `좋아요. 관련성이 높은 특화거리로 ${names.join(", ")}를 찾았어요. 왼쪽 지도에 바로 표시했습니다. 가장 먼저 ${names[0]}부터 보시면 좋아요.`,
    streetIds: scored.map((x) => x.street.id),
    keywords: tokens,
  };
}

function extractJson(text: string): LlmResult | null {
  try {
    const direct = JSON.parse(text) as LlmResult;
    if (direct && typeof direct.reply === "string" && Array.isArray(direct.streetIds)) return direct;
  } catch {}
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as LlmResult;
    if (parsed && typeof parsed.reply === "string" && Array.isArray(parsed.streetIds)) return parsed;
  } catch {}
  return null;
}

export async function POST(request: Request) {
  const body = (await request.json()) as { message?: string; history?: ChatTurn[] };
  const message = body.message?.trim();
  if (!message) return NextResponse.json({ error: "message is required" }, { status: 400 });

  const fallback = fallbackRecommend(message);
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ ...fallback, mode: "local" });

  const catalog = foodStreets.map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    foodKeywords: s.foodKeywords,
    region: `${s.sido} ${s.sigungu}`.trim(),
    hasCoordinates: s.lat !== null && s.lon !== null,
  }));
  const history = (body.history ?? [])
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-8);

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5",
        max_tokens: 700,
        temperature: 0.2,
        system: `너는 광주·전남 음식 특화거리 추천 도우미다. 사용자의 자연어 대화를 이해하고 제공된 거리 데이터 안에서만 추천한다.\n\n규칙:\n1) 특정 음식/재료는 foodKeywords, 거리명, 설명의 관련성을 최우선으로 본다.\n2) 관련성이 약한 거리를 억지로 추천하지 않는다.\n3) 최대 5개만 추천한다.\n4) 아래 거리 id만 streetIds에 넣는다.\n5) 좌표가 있는 거리를 우선하되 음식 관련성이 더 중요하다.\n6) 답변은 친근한 한국어 2~4문장. 추가 조건은 이전 대화 맥락을 반영한다.\n7) 오직 JSON만 반환한다. 형식: {"reply":"...","streetIds":["ST001"],"keywords":["전복"]}\n\n거리 데이터:\n${JSON.stringify(catalog)}`,
        messages: [...history, { role: "user", content: message }],
      }),
    });

    if (!res.ok) {
      console.error("Anthropic error", res.status, await res.text());
      return NextResponse.json({ ...fallback, mode: "local" });
    }
    const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    const text = data.content?.find((c) => c.type === "text")?.text ?? "";
    const parsed = extractJson(text);
    if (!parsed) return NextResponse.json({ ...fallback, mode: "local" });

    const validIds = new Set(foodStreets.map((s) => s.id));
    return NextResponse.json({
      reply: parsed.reply,
      streetIds: parsed.streetIds.filter((id) => validIds.has(id)).slice(0, 5),
      keywords: parsed.keywords ?? [],
      mode: "llm",
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ ...fallback, mode: "local" });
  }
}
