"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { RegionMap, type MapMarker } from "@/components/RegionMap";
import type { Street } from "@/lib/types";

type Message = { role: "user" | "assistant"; content: string };

export function MapChatExplorer({ streets }: { streets: Street[] }) {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content:
        "먹고 싶은 음식이나 재료를 편하게 말씀해 주세요. 예를 들어 ‘전복을 먹고 싶어’라고 하면 관련 특화거리를 지도에 바로 표시해드릴게요.",
    },
  ]);
  const [input, setInput] = useState("");
  const [recommendedIds, setRecommendedIds] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [pending, setPending] = useState(false);

  const recommended = useMemo(
    () => recommendedIds.map((id) => streets.find((s) => s.id === id)).filter(Boolean) as Street[],
    [recommendedIds, streets],
  );

  const markers = useMemo<MapMarker[]>(
    () =>
      recommended
        .filter((s) => s.lat !== null && s.lon !== null)
        .map((s, index) => ({
          id: s.id,
          lat: s.lat as number,
          lon: s.lon as number,
          label: `${index + 1}. ${s.name}`,
          kind: "street" as const,
          highlight: s.id === selectedId || (!selectedId && index === 0),
        })),
    [recommended, selectedId],
  );

  const submit = async (preset?: string) => {
    const text = (preset ?? input).trim();
    if (!text || pending) return;

    const previous = messages;
    setMessages([...previous, { role: "user", content: text }]);
    setInput("");
    setPending(true);

    try {
      const response = await fetch("/api/chat-recommend", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text, history: previous }),
      });
      const data = (await response.json()) as { reply?: string; streetIds?: string[] };
      const ids = data.streetIds ?? [];
      setRecommendedIds(ids);
      setSelectedId(ids[0]);
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: data.reply ?? "추천 결과를 만들지 못했어요. 다른 음식이나 재료로 다시 말씀해 주세요.",
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

  return (
    <main className="min-h-dvh bg-canvas lg:h-dvh lg:overflow-hidden">
      <div className="grid min-h-dvh lg:h-dvh lg:grid-cols-[minmax(0,1.35fr)_minmax(400px,0.65fr)]">
        <section className="relative min-h-[52vh] border-b border-line bg-surface lg:min-h-0 lg:border-b-0 lg:border-r">
          <div className="absolute left-5 top-5 z-[800] rounded-2xl border border-line bg-surface/95 px-4 py-3 shadow-sm backdrop-blur">
            <Link href="/" className="text-[12px] font-bold text-brand">← 전라맛도</Link>
            <p className="mt-1 font-display text-[20px] text-fg">실시간 미식 지도</p>
            <p className="mt-0.5 text-[12px] text-fg-muted">대화에 따라 추천 핀이 바뀝니다</p>
          </div>

          {markers.length > 0 ? (
            <RegionMap markers={markers} height="100%" selectedId={selectedId} onSelect={setSelectedId} />
          ) : (
            <div className="flex h-full min-h-[52vh] items-center justify-center bg-accent-soft px-8 lg:min-h-0">
              <div className="max-w-sm text-center">
                <div className="text-4xl">🗺️</div>
                <h2 className="font-display mt-4 text-[24px] text-fg">먹고 싶은 걸 말해보세요</h2>
                <p className="mt-2 text-[14px] leading-relaxed text-fg-muted">
                  오른쪽 채팅에서 음식이나 재료를 말하면 관련 특화거리를 찾아 이 지도에 실시간으로 표시합니다.
                </p>
              </div>
            </div>
          )}

          {recommended.length > 0 && (
            <div className="absolute bottom-4 left-4 right-4 z-[800] flex gap-2 overflow-x-auto pb-1">
              {recommended.map((street, index) => (
                <button
                  key={street.id}
                  type="button"
                  onClick={() => setSelectedId(street.id)}
                  className={`min-w-[210px] rounded-2xl border px-4 py-3 text-left shadow-sm backdrop-blur transition ${
                    selectedId === street.id || (!selectedId && index === 0)
                      ? "border-brand bg-brand text-fg-inverse"
                      : "border-line bg-surface/95 text-fg"
                  }`}
                >
                  <span className="block text-[11px] opacity-70">추천 {index + 1}</span>
                  <span className="mt-0.5 block text-[14px] font-bold">{street.name}</span>
                  <span className="mt-1 block truncate text-[11px] opacity-75">{street.sido} {street.sigungu}</span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="flex min-h-[48vh] flex-col bg-surface lg:min-h-0">
          <header className="border-b border-line px-5 py-4">
            <p className="font-display text-[21px] text-fg">남도 미식 AI</p>
            <p className="mt-0.5 text-[12px] text-fg-muted">음식 · 재료 · 지역 · 분위기를 대화로 좁혀보세요</p>
          </header>

          <div className="flex-1 space-y-3 overflow-y-auto px-5 py-5">
            {messages.map((message, index) => (
              <div key={index} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
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
                  관련 거리를 찾는 중…
                </div>
              </div>
            )}
          </div>

          <div className="border-t border-line p-4">
            {messages.length === 1 && (
              <div className="mb-3 flex flex-wrap gap-1.5">
                {["전복을 먹고 싶어", "낙지 요리 추천해줘", "떡갈비 먹으러 가고 싶어"].map((example) => (
                  <button
                    key={example}
                    type="button"
                    onClick={() => submit(example)}
                    className="rounded-full border border-line-strong bg-surface px-3 py-1.5 text-[12px] text-fg hover:border-brand hover:text-brand"
                  >
                    {example}
                  </button>
                ))}
              </div>
            )}
            <div className="flex items-end gap-2">
              <label htmlFor="chat-input" className="sr-only">먹고 싶은 음식 입력</label>
              <textarea
                id="chat-input"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submit();
                  }
                }}
                rows={2}
                placeholder="예: 전복을 먹고 싶어"
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
              추천은 등록된 광주·전남 음식특화거리 데이터 안에서만 표시합니다.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
