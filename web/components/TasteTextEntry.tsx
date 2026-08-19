"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { EXAMPLE_PHRASES, parseTasteText } from "@/lib/parse-taste";
import { DEFAULT_PREFERENCE, preferenceToQuery } from "@/lib/recommend";

/**
 * 한 줄로 적어 바로 결과로 간다.
 *
 * 읽어 낸 값을 여기서 되짚어 주지 않는다. 결과 화면 머리에 이미 고른 조건이
 * 칩으로 붙어 있어서, 같은 말을 두 번 하는 셈이 된다. 잘못 읽었으면 거기서
 * '취향 다시 고르기'로 넘어가면 된다.
 *
 * 못 읽은 축은 기본값으로 둔다. 한 줄에 다섯 가지를 다 적는 사람은 없고,
 * 안 적은 것을 물어보려고 화면을 한 단계 더 세우면 '한 줄로 끝'이 아니게 된다.
 */
export function TasteTextEntry({ defaultMonth }: { defaultMonth: number }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(false);

  const submit = (raw?: string) => {
    const source = (raw ?? text).trim();
    if (!source) return;

    const { pref } = parseTasteText(source);
    // 한 축도 못 읽으면 넘기지 않는다. 기본값만으로 결과를 내면 사용자가 적은
    // 문장과 상관없는 상이 나오는데, 그건 알아들은 척하는 것이다.
    if (Object.keys(pref).length === 0) {
      setFailed(true);
      return;
    }

    setPending(true);
    router.push(
      `/result?${preferenceToQuery({ ...DEFAULT_PREFERENCE, month: defaultMonth, ...pref })}`,
    );
  };

  return (
    <div className="px-6 py-6">
      <label htmlFor="taste-text" className="font-display block text-[20px] text-fg">
        뭐가 드시고 싶으세요?
      </label>
      <p className="mt-1.5 text-[13px] leading-relaxed text-fg-muted">
        한 줄로 적어 주시면 남도에서 지금 제철인 것 중에 골라 드립니다.
      </p>

      <textarea
        id="taste-text"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setFailed(false);
        }}
        onKeyDown={(e) => {
          // 줄바꿈이 필요한 입력이 아니라서 Enter를 보내기로 쓴다.
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        rows={2}
        placeholder="예: 겨울에 먹을 안 매운 해산물 국물 요리"
        className="mt-3 w-full resize-none rounded-2xl border border-line bg-surface px-4 py-3.5 text-[16px] leading-relaxed text-fg outline-none placeholder:text-fg-muted focus:border-accent"
      />

      {failed && (
        <p role="alert" className="mt-2 text-[13px] leading-relaxed text-brand">
          이 문장에서는 알아들은 게 없습니다. 맵기·국물·날것·주재료·달만 알아듣습니다.
        </p>
      )}

      <button
        type="button"
        onClick={() => submit()}
        disabled={!text.trim() || pending}
        className="mt-3 w-full cursor-pointer rounded-2xl bg-brand py-4 text-[17px] font-bold text-fg-inverse transition-all duration-150 hover:-translate-y-0.5 hover:opacity-90 hover:shadow-lg active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0 disabled:hover:shadow-none"
      >
        {pending ? "찾는 중…" : "남도 음식 찾기"}
      </button>

      <div className="mt-5">
        <p className="text-[12px] font-bold text-fg-muted">이렇게 적어 보세요</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {EXAMPLE_PHRASES.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => {
                setText(example);
                setFailed(false);
              }}
              className="cursor-pointer rounded-full border border-line-strong bg-surface px-3 py-1.5 text-[13px] text-fg transition-colors hover:border-accent hover:text-accent"
            >
              {example}
            </button>
          ))}
        </div>
      </div>

      <Link
        href="/taste/conditions"
        className="mt-6 flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface-alt px-4 py-3.5 transition-colors hover:border-line-strong"
      >
        <span className="min-w-0">
          <span className="block text-[14px] font-bold text-fg">
            직접 고르고 싶으신가요
          </span>
          <span className="mt-0.5 block text-[12px] text-fg-muted">
            맵기·국물·날것·주재료·달을 하나씩 짚어 고릅니다
          </span>
        </span>
        <span aria-hidden="true" className="shrink-0 text-[18px] text-fg-muted">
          →
        </span>
      </Link>
    </div>
  );
}
