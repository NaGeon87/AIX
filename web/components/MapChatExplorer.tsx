"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { CategoryTastePanel } from "@/components/CategoryTastePanel";
import { RegionMap, type MapMarker } from "@/components/RegionMap";
import { randomSeed, rankCandidates, type Preference } from "@/lib/recommend";
import type { Food, Street } from "@/lib/types";

type Message = { role: "user" | "assistant"; content: string };

function spicyText(level: number) {
  return ["안 매움", "약간 매움", "매움", "아주 매움"][level] ?? `${level}`;
}


export function MapChatExplorer({
  streets,
  foods,
  defaultMonth,
}: {
  streets: Street[];
  foods: Food[];
  defaultMonth: number;
}) {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content:
        "취향을 자연스럽게 말해 주세요. 예: ‘매콤한 국물 해산물이 먹고 싶어’, ‘날것 말고 담백한 고기 요리 추천해줘’. 음식 데이터에서 잘 맞는 메뉴를 골라드릴게요.",
    },
  ]);
  const [input, setInput] = useState("");
  const [recommendedFoodIds, setRecommendedFoodIds] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [pending, setPending] = useState(false);
  const [lastTaste, setLastTaste] = useState("");
  const [inputMode, setInputMode] = useState<"ai" | "category">("ai");
  const [lastCategoryPreference, setLastCategoryPreference] = useState<Preference | null>(null);

  const selectedStreet = useMemo(
    () => streets.find((street) => street.id === selectedId),
    [selectedId, streets],
  );

  const recommendedFoods = useMemo(
    () =>
      recommendedFoodIds
        .map((id) => foods.find((food) => food.id === id))
        .filter(Boolean) as Food[],
    [recommendedFoodIds, foods],
  );

  // 첫 화면에는 광주를 제외하고 전라남도 음식특화거리만 표시한다.
  // LLM이 음식을 추천하면 해당 음식을 실제로 취급하는 광주·전남 식당 좌표를
  // 음식 핀으로 최대 2곳씩 추가한다.
  const { markers, firstFoodMarkerByFoodId, foodMarkerCount } = useMemo(() => {
    const streetMarkers: MapMarker[] = streets
      .filter(
        (street) =>
          street.sido === "전남" && street.lat !== null && street.lon !== null,
      )
      .map((street) => ({
        id: street.id,
        lat: street.lat as number,
        lon: street.lon as number,
        label: street.name,
        kind: "street" as const,
        highlight: street.id === selectedId,
        iconCode: street.iconCode,
        iconFallback: street.iconFallback,
        iconLabel: street.iconLabel,
      }));

    const foodMarkers: MapMarker[] = [];
    const firstByFood = new Map<string, string>();
    for (const food of recommendedFoods) {
      const restaurants = food.restaurants
        .filter(
          (restaurant) =>
            restaurant.lat !== null && restaurant.lon !== null,
        )
        .sort(
          (a, b) =>
            Number(b.isLocalSpecialty) - Number(a.isLocalSpecialty),
        );

      let added = 0;
      for (const restaurant of restaurants) {
        const id = `food:${food.id}:${restaurant.id}`;
        if (!firstByFood.has(food.id)) firstByFood.set(food.id, id);
        foodMarkers.push({
          id,
          lat: restaurant.lat as number,
          lon: restaurant.lon as number,
          label: `${food.displayName || food.name} · ${restaurant.name}`,
          kind: "food",
          highlight: id === selectedId,
        });
        added += 1;
        if (added >= 2) break;
      }
    }

    return {
      markers: recommendedFoods.length > 0 ? foodMarkers : streetMarkers,
      firstFoodMarkerByFoodId: firstByFood,
      foodMarkerCount: foodMarkers.length,
    };
  }, [streets, recommendedFoods, selectedId]);


  const selectFirstMappedFood = (ids: string[]) => {
    for (const foodId of ids) {
      const food = foods.find((item) => item.id === foodId);
      const restaurant = food?.restaurants
        .filter(
          (item) =>
            item.lat !== null && item.lon !== null,
        )
        .sort(
          (a, b) =>
            Number(b.isLocalSpecialty) - Number(a.isLocalSpecialty),
        )[0];
      if (food && restaurant) {
        setSelectedId(`food:${food.id}:${restaurant.id}`);
        return;
      }
    }
    setSelectedId(undefined);
  };

  const recommendByCategory = (pref: Preference) => {
    setLastCategoryPreference(pref);
    const ids = rankCandidates(foods, pref, randomSeed())
      .slice(0, 5)
      .map((item) => item.food.id);
    setRecommendedFoodIds(ids);
    selectFirstMappedFood(ids);
  };

  const submit = async (preset?: string, excludeFoodIds: string[] = []) => {
    const text = (preset ?? input).trim();
    if (!text || pending) return;

    const previous = messages;
    setMessages([...previous, { role: "user", content: text }]);
    setInput("");
    setLastTaste(text);
    setPending(true);

    try {
      const response = await fetch("/api/chat-recommend", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text, history: previous, excludeFoodIds }),
      });
      const data = (await response.json()) as { reply?: string; foodIds?: string[] };
      const ids = data.foodIds ?? [];
      setRecommendedFoodIds(ids);

      // 지도에 표시할 수 있는 첫 추천 음식의 광주·전남 식당으로 이동한다.
      selectFirstMappedFood(ids);

      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content:
            data.reply ?? "추천 결과를 만들지 못했어요. 취향을 조금 다르게 말씀해 주세요.",
        },
      ]);
    } catch {
      setMessages((current) => [
        ...current,
        { role: "assistant", content: "연결 중 문제가 생겼어요. 잠시 후 다시 입력해 주세요." },
      ]);
    } finally {
      setPending(false);
    }
  };

  const refreshRecommendations = () => {
    if (pending) return;
    if (inputMode === "category" && lastCategoryPreference) {
      recommendByCategory(lastCategoryPreference);
      return;
    }
    if (!lastTaste) return;
    submit(lastTaste, recommendedFoodIds);
  };

  const switchInputMode = () => {
    setInputMode((mode) => (mode === "ai" ? "category" : "ai"));
    setRecommendedFoodIds([]);
    setSelectedId(undefined);
  };

  const mapUnavailableReason = (food: Food) => {
    if (food.restaurants.length === 0) {
      return "지도 위치 정보 없음 · 등록된 식당 데이터가 없어요";
    }
    return "지도 위치 정보 없음 · 등록된 식당의 좌표가 없어요";
  };

  return (
    <main className="min-h-dvh bg-canvas lg:h-dvh lg:overflow-hidden">
      <div className="grid min-h-dvh lg:h-dvh lg:grid-cols-[minmax(0,1.35fr)_minmax(400px,0.65fr)]">
        <section className="relative min-h-[52vh] border-b border-line bg-surface lg:min-h-0 lg:border-b-0 lg:border-r">
          <div className="absolute left-5 top-5 z-[800] rounded-2xl border border-line bg-surface/95 px-4 py-3 shadow-sm backdrop-blur">
            <Link href="/" className="text-[12px] font-bold text-brand">
              ← 전라맛도
            </Link>
            <p className="mt-1 font-display text-[20px] text-fg">전라남도 음식거리 지도</p>
            <p className="mt-0.5 text-[12px] text-fg-muted">
              전남 음식거리를 보고, AI 추천 음식 위치도 확인하세요
            </p>
            <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-fg-muted">
              {foodMarkerCount === 0 ? (
                <span className="rounded-full border border-line bg-surface px-2 py-1">음식특화거리</span>
              ) : (
                <span className="rounded-full border border-line bg-surface px-2 py-1">● 추천 음식점 위치</span>
              )}
            </div>
          </div>

          <RegionMap
            markers={markers}
            height="100%"
            selectedId={selectedId}
            onSelect={(id) => setSelectedId(id)}
            lockToJeonnam
          />

          {selectedStreet && (
            <div className="absolute bottom-4 left-4 right-4 z-[850] rounded-2xl border border-line bg-surface/95 p-4 shadow-lg backdrop-blur lg:right-auto lg:w-[430px]">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-bold text-brand">
                    {selectedStreet.sido} {selectedStreet.sigungu}
                  </p>
                  <h2 className="mt-0.5 font-display text-[20px] text-fg">
                    {selectedStreet.name}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedId(undefined)}
                  className="shrink-0 rounded-full border border-line px-2.5 py-1 text-[12px] text-fg-muted"
                >
                  닫기
                </button>
              </div>

              <p className="mt-2 text-[13px] leading-relaxed text-fg-muted">
                {selectedStreet.description || "지역 대표 음식점이 모여 있는 음식특화거리입니다."}
              </p>

              {selectedStreet.foodKeywords.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {selectedStreet.foodKeywords.slice(0, 5).map((keyword) => (
                    <span
                      key={keyword}
                      className="rounded-full bg-accent-soft px-2.5 py-1 text-[11px] font-medium text-fg"
                    >
                      {keyword}
                    </span>
                  ))}
                </div>
              )}

              <p className="mt-3 truncate text-[11px] text-fg-muted">{selectedStreet.address}</p>

              <Link
                href={`/street/${selectedStreet.id}`}
                className="mt-3 flex w-full items-center justify-center rounded-xl bg-brand px-4 py-3 text-[14px] font-bold text-fg-inverse transition hover:opacity-90"
              >
                거리 자세히 보기 · 근처 식당 추천 →
              </Link>
            </div>
          )}
        </section>

        <section className="flex min-h-[48vh] flex-col bg-surface lg:min-h-0">
          <header className="border-b border-line px-5 py-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-display text-[21px] text-fg">
                  {inputMode === "ai" ? "취향 음식 추천 AI" : "취향 카테고리 선택"}
                </p>
                <p className="mt-0.5 text-[12px] text-fg-muted">
                  {inputMode === "ai"
                    ? "자연어 취향을 분석해 음식 데이터에서 메뉴를 추천해요"
                    : "맵기·국물·날것·주재료·시기를 직접 골라 추천받아요"}
                </p>
              </div>
              <button
                type="button"
                onClick={switchInputMode}
                className="shrink-0 rounded-xl border border-brand px-3 py-2 text-[12px] font-bold text-brand transition hover:bg-accent-soft"
              >
                {inputMode === "ai" ? "카테고리 선택" : "AI로 입력"}
              </button>
            </div>
            {foodMarkerCount > 0 && (
              <p className="mt-1 text-[11px] font-medium text-brand">
                추천 음식을 먹을 수 있는 전남 위치 {foodMarkerCount}곳을 지도에 표시했어요
              </p>
            )}
          </header>

          <div className="flex-1 overflow-y-auto px-5 py-5">
            {inputMode === "ai" ? (
              <div className="space-y-3">
              {messages.map((message, index) => (
                <div
                  key={index}
                  className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[88%] rounded-2xl px-4 py-3 text-[14px] leading-relaxed ${
                      message.role === "user"
                        ? "rounded-br-md bg-brand text-fg-inverse"
                        : "rounded-bl-md border border-line bg-surface-alt text-fg"
                    }`}
                  >
                    {message.content}
                  </div>
                </div>
              ))}
              {pending && (
                <div className="flex justify-start">
                  <div className="rounded-2xl rounded-bl-md border border-line bg-surface-alt px-4 py-3 text-[13px] text-fg-muted">
                    음식 데이터에서 취향에 맞는 메뉴를 고르는 중…
                  </div>
                </div>
              )}
              </div>
            ) : (
              <CategoryTastePanel
                defaultMonth={defaultMonth}
                pending={pending}
                onRecommend={recommendByCategory}
              />
            )}

            {recommendedFoods.length > 0 && (
              <section className="mt-5 border-t border-line pt-4">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <p className="text-[12px] font-bold text-fg-muted">추천 음식</p>
                  <button
                    type="button"
                    onClick={refreshRecommendations}
                    disabled={pending}
                    className="rounded-lg border border-brand px-3 py-1.5 text-[11px] font-bold text-brand transition hover:bg-accent-soft disabled:opacity-40"
                  >
                    ↻ 다른 추천 보기
                  </button>
                </div>
                <div className="space-y-2.5">
                  {recommendedFoods.map((food, index) => (
                    <article key={food.id} className="rounded-2xl border border-line bg-canvas p-3.5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[10px] font-bold text-brand">추천 {index + 1}</p>
                          <h3 className="mt-0.5 font-display text-[18px] text-fg">
                            {food.displayName || food.name}
                          </h3>
                          <p className="mt-0.5 text-[11px] text-fg-muted">
                            주재료 {food.ingredient} · 등록 식당 {food.restaurantCount}곳
                          </p>
                        </div>
                        <span className="shrink-0 rounded-full border border-line bg-surface px-2.5 py-1 text-[10px] text-fg-muted">
                          {food.months.length ? `${food.months.join("·")}월 제철` : "계절 정보 없음"}
                        </span>
                      </div>
                      {firstFoodMarkerByFoodId.get(food.id) ? (
                        <button
                          type="button"
                          onClick={() => setSelectedId(firstFoodMarkerByFoodId.get(food.id))}
                          className="mt-2.5 rounded-lg border border-brand px-3 py-1.5 text-[11px] font-bold text-brand transition hover:bg-accent-soft"
                        >
                          지도에서 이 음식 보기
                        </button>
                      ) : (
                        <p className="mt-2.5 text-[11px] font-medium text-fg-muted">
                          {mapUnavailableReason(food)}
                        </p>
                      )}
                      <div className="mt-2.5 flex flex-wrap gap-1.5 text-[10px]">
                        <span className="rounded-full bg-surface px-2 py-1 text-fg-muted">
                          🌶 {spicyText(food.spicy)}
                        </span>
                        <span className="rounded-full bg-surface px-2 py-1 text-fg-muted">
                          {food.hasSoup ? "🥣 국물 있음" : "🍽 국물 없음"}
                        </span>
                        <span className="rounded-full bg-surface px-2 py-1 text-fg-muted">
                          {food.isRaw ? "🐟 날것" : "🔥 익힌 음식"}
                        </span>
                        {food.mainIngredients.map((category) => (
                          <span
                            key={category}
                            className="rounded-full bg-surface px-2 py-1 text-fg-muted"
                          >
                            {category}
                          </span>
                        ))}
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            )}
          </div>

          {inputMode === "ai" && (
          <div className="border-t border-line p-4">
            {messages.length === 1 && (
              <div className="mb-3 flex flex-wrap gap-1.5">
                {["매콤한 국물 해산물", "안 매운 고기 요리", "회 말고 담백한 음식"].map(
                  (example) => (
                    <button
                      key={example}
                      type="button"
                      onClick={() => submit(example)}
                      className="rounded-full border border-line-strong bg-surface px-3 py-1.5 text-[12px] text-fg hover:border-brand hover:text-brand"
                    >
                      {example}
                    </button>
                  ),
                )}
              </div>
            )}
            <div className="flex items-end gap-2">
              <label htmlFor="chat-input" className="sr-only">
                음식 취향 입력
              </label>
              <textarea
                id="chat-input"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    submit();
                  }
                }}
                rows={2}
                placeholder="예: 매콤하고 따뜻한 국물 해산물이 먹고 싶어"
                className="min-h-[52px] flex-1 resize-none rounded-2xl border border-line bg-canvas px-4 py-3 text-[14px] text-fg outline-none placeholder:text-fg-muted focus:border-brand"
              />
              <button
                type="button"
                disabled={!input.trim() || pending}
                onClick={() => submit()}
                className="h-[52px] shrink-0 rounded-2xl bg-brand px-5 text-[14px] font-bold text-fg-inverse disabled:opacity-40"
              >
                보내기
              </button>
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-fg-muted">
              지도는 전라남도 권역 안에서만 탐색됩니다. 처음에는 음식특화거리를 보여주고, 추천 후에는 거리 핀을 숨긴 뒤 해당 메뉴를 취급하는 전남 식당을 점으로 표시합니다.
            </p>
          </div>
          )}
        </section>
      </div>
    </main>
  );
}
