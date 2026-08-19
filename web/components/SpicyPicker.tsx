"use client";

import { SPICY_COLOR, SPICY_LEVELS } from "@/lib/types";

/**
 * 맵기 0~3 선택. 고추 아이콘 개수로 단계를 보여 준다.
 *
 * 숫자 슬라이더 대신 단계 버튼으로 둔 이유: 0~3은 네 칸뿐이라 슬라이더로는
 * 어느 칸에 서 있는지 읽기 어렵고, 각 단계에 이름("아주 매움")을 붙여야
 * 사용자가 자기 기준과 맞출 수 있다.
 */
export function SpicyPicker({
  value,
  onChange,
}: {
  value: number;
  onChange: (next: number) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-[13px] font-bold text-fg">맵기</legend>
      <div role="radiogroup" aria-label="맵기" className="grid grid-cols-4 gap-2">
        {SPICY_LEVELS.map((level) => {
          const selected = level.value === value;
          return (
            <button
              key={level.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(level.value)}
              style={
                {
                  "--accent": SPICY_COLOR,
                  ...(selected ? { background: SPICY_COLOR, borderColor: SPICY_COLOR } : {}),
                } as React.CSSProperties
              }
              className={[
                "option-chip relative flex cursor-pointer select-none flex-col items-center gap-1.5",
                "rounded-xl border px-2 py-2.5 transition-all duration-150",
                selected ? "text-fg-inverse shadow-sm" : "border-line bg-surface text-fg-muted",
              ].join(" ")}
            >
              {/* 고추 이모지는 기기에 따라 흑백 글리프로 깨진다. 점 세 칸이
                  어디까지 찼는지가 단계를 더 확실히 보여 준다. */}
              <span aria-hidden="true" className="flex gap-1">
                {[1, 2, 3].map((step) => (
                  <span
                    key={step}
                    className="block h-1.5 w-1.5 rounded-full"
                    style={{
                      background:
                        step <= level.value
                          ? selected
                            ? "var(--color-fg-inverse)"
                            : SPICY_COLOR
                          : selected
                            ? "rgb(255 255 255 / 0.35)"
                            : "var(--color-line)",
                    }}
                  />
                ))}
              </span>
              <span className={selected ? "text-[12px] font-bold" : "text-[12px]"}>
                {level.label}
              </span>
              {selected && (
                <span
                  aria-hidden="true"
                  className="absolute right-1.5 top-1.5 text-[10px] leading-none"
                >
                  ✓
                </span>
              )}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
