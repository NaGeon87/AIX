"use client";

import { useId } from "react";

export interface Option<T> {
  value: T;
  label: string;
  /** 왼쪽에 붙일 아이콘. 없으면 라벨만 보인다. */
  icon?: string;
  /** 선택·호버 시 강조에 쓰는 색. 없으면 잉크색을 쓴다. */
  color?: string;
}

/**
 * 취향 선택 버튼 묶음.
 *
 * 호버와 선택을 같은 언어로 보여 준다: 커서를 올리면 그 색이 옅게 미리 깔리고,
 * 고르면 같은 색이 꽉 찬다. 그래서 "지금 뭘 고르려 하는지"와 "무엇을 골랐는지"가
 * 한눈에 구분된다. 키보드 포커스도 호버와 같은 표시를 받는다.
 */
export function OptionGroup<T extends string | number>({
  legend,
  options,
  value,
  onChange,
  columns,
}: {
  legend: string;
  options: Option<T>[];
  value: T;
  onChange: (next: T) => void;
  /** 지정하면 그리드로, 없으면 가로로 늘어놓는다. */
  columns?: number;
}) {
  const groupId = useId();

  return (
    <fieldset>
      <legend className="mb-2 text-[13px] font-bold text-fg">{legend}</legend>
      <div
        role="radiogroup"
        aria-label={legend}
        className={columns ? "grid gap-2" : "flex flex-wrap gap-2"}
        style={columns ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined}
      >
        {options.map((option) => {
          const selected = option.value === value;
          const accent = option.color ?? "var(--color-ink)";
          return (
            <button
              key={String(option.value)}
              id={`${groupId}-${option.value}`}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(option.value)}
              style={
                {
                  "--accent": accent,
                  ...(selected ? { background: accent, borderColor: accent } : {}),
                } as React.CSSProperties
              }
              className={[
                "option-chip group relative flex items-center justify-center gap-1.5",
                "rounded-xl border px-3 py-2.5 text-[14px] transition-all duration-150",
                "cursor-pointer select-none",
                selected
                  ? "font-bold text-fg-inverse shadow-sm"
                  : "border-line bg-surface text-fg-muted",
              ].join(" ")}
            >
              {option.icon && <span aria-hidden="true">{option.icon}</span>}
              <span>{option.label}</span>
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
