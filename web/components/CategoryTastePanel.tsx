"use client";

import { useState } from "react";

import { OptionGroup } from "@/components/OptionGroup";
import { SpicyPicker } from "@/components/SpicyPicker";
import {
  DEFAULT_PREFERENCE,
  INGREDIENT_OPTIONS,
  RAW_OPTIONS,
  SOUP_OPTIONS,
  type IngredientPreference,
  type Preference,
  type RawPreference,
  type SoupPreference,
} from "@/lib/recommend";
import { CATEGORY_META, RAW_COLOR, SOUP_COLOR, type Category } from "@/lib/types";

const MONTH_NAMES = [
  "1월", "2월", "3월", "4월", "5월", "6월",
  "7월", "8월", "9월", "10월", "11월", "12월",
];

export function CategoryTastePanel({
  defaultMonth,
  pending,
  onRecommend,
}: {
  defaultMonth: number;
  pending: boolean;
  onRecommend: (pref: Preference) => void;
}) {
  const [pref, setPref] = useState<Preference>({
    ...DEFAULT_PREFERENCE,
    month: defaultMonth,
  });

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-line bg-canvas px-4 py-5">
        <SpicyPicker
          value={pref.spicy}
          onChange={(spicy) => setPref((p) => ({ ...p, spicy }))}
        />

        <div className="mt-5">
          <OptionGroup<SoupPreference>
            legend="국물"
            columns={3}
            value={pref.soup}
            onChange={(soup) => setPref((p) => ({ ...p, soup }))}
            options={SOUP_OPTIONS.map((o) => ({
              value: o.value,
              label: o.label,
              color: SOUP_COLOR,
            }))}
          />
        </div>

        <div className="mt-5">
          <OptionGroup<RawPreference>
            legend="날것"
            columns={2}
            value={pref.raw}
            onChange={(raw) => setPref((p) => ({ ...p, raw }))}
            options={RAW_OPTIONS.map((o) => ({
              value: o.value,
              label: o.label,
              color: RAW_COLOR,
            }))}
          />
        </div>

        <div className="mt-5">
          <OptionGroup<IngredientPreference>
            legend="주재료"
            columns={2}
            value={pref.ingredient}
            onChange={(ingredient) => setPref((p) => ({ ...p, ingredient }))}
            options={INGREDIENT_OPTIONS.map((option) => ({
              value: option,
              label: option,
              icon: option === "상관없음" ? undefined : CATEGORY_META[option as Category].icon,
              color:
                option === "상관없음" ? undefined : CATEGORY_META[option as Category].color,
            }))}
          />
        </div>
      </div>

      <div className="rounded-2xl border border-line bg-surface-alt px-4 py-5">
        <OptionGroup<string>
          legend="언제 드실 건가요"
          columns={6}
          value={MONTH_NAMES[pref.month - 1]}
          onChange={(name) =>
            setPref((p) => ({ ...p, month: MONTH_NAMES.indexOf(name) + 1 }))
          }
          options={MONTH_NAMES.map((name) => ({ value: name, label: name }))}
        />
      </div>

      <button
        type="button"
        onClick={() => onRecommend(pref)}
        disabled={pending}
        className="w-full rounded-2xl bg-brand py-4 text-[16px] font-bold text-fg-inverse transition hover:opacity-90 disabled:opacity-50"
      >
        {pending ? "찾는 중…" : "이 조건으로 추천받기"}
      </button>
    </div>
  );
}
