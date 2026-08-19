"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { OptionGroup } from "@/components/OptionGroup";
import { SpicyPicker } from "@/components/SpicyPicker";
import {
  DEFAULT_PREFERENCE,
  INGREDIENT_OPTIONS,
  RAW_OPTIONS,
  SOUP_OPTIONS,
  preferenceToQuery,
  type IngredientPreference,
  type Preference,
  type RawPreference,
  type SoupPreference,
} from "@/lib/recommend";
import { CATEGORY_META, RAW_COLOR, SOUP_COLOR, type Category } from "@/lib/types";

export function TasteForm({
  defaultMonth,
  monthNames,
}: {
  defaultMonth: number;
  monthNames: string[];
}) {
  const router = useRouter();
  const [pref, setPref] = useState<Preference>({
    ...DEFAULT_PREFERENCE,
    month: defaultMonth,
  });
  const [pending, setPending] = useState(false);

  const submit = () => {
    setPending(true);
    router.push(`/result?${preferenceToQuery(pref)}`);
  };

  return (
    <div className="px-6 py-5">
      <div className="space-y-5 rounded-2xl border border-line bg-surface px-4 py-5">
        <SpicyPicker
          value={pref.spicy}
          onChange={(spicy) => setPref((p) => ({ ...p, spicy }))}
        />

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

      <div className="mt-4 rounded-2xl border border-line bg-surface-alt px-4 py-5">
        <OptionGroup<string>
          legend="언제 드실 건가요"
          columns={6}
          value={monthNames[pref.month - 1]}
          onChange={(name) =>
            setPref((p) => ({ ...p, month: monthNames.indexOf(name) + 1 }))
          }
          options={monthNames.map((name) => ({ value: name, label: name }))}
        />
      </div>

      <button
        type="button"
        onClick={submit}
        disabled={pending}
        className="mt-5 w-full cursor-pointer rounded-2xl bg-brand py-4 text-[17px] font-bold text-fg-inverse transition-all duration-150 hover:-translate-y-0.5 hover:opacity-90 hover:shadow-lg active:translate-y-0 disabled:opacity-60"
      >
        {pending ? "찾는 중…" : "내 취향에 맞는 남도 음식 찾기"}
      </button>
    </div>
  );
}
