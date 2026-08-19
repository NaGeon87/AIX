"use client";

import Link from "next/link";
import { useId, useState } from "react";

import { AccuracyFeedback } from "@/components/AccuracyFeedback";
import {
  MAX_PER_INGREDIENT,
  explainMatch,
  formatDistance,
  type AxisScore,
  type NearbyCandidate,
  type NearbyFood,
  type Preference,
} from "@/lib/recommend";
import { CATEGORY_META, RAW_COLOR, SOUP_COLOR, SPICY_COLOR } from "@/lib/types";

/**
 * "왜 이 음식인가"를 카드 안에서 펼쳐 보여 준다.
 *
 * 점수를 다시 계산하지 않는다 — 서버 랭킹이 쓴 explainMatch를 그대로 부른다.
 * 채점에 필요한 값(맵기·국물·날것·주재료·근거)은 이미 카드 데이터에 들어
 * 있어서, 설명을 위해 payload를 늘릴 필요가 없다.
 */
export function WhyThisFood({
  candidate,
  pref,
  rank,
  poolSize,
  nearby,
}: {
  candidate: NearbyCandidate;
  pref: Preference;
  /** 목록에서의 순위. */
  rank: number;
  /** 이번 달 제철 후보 전체 개수. */
  poolSize: number;
  /** 거리순일 때만 넘어온다. */
  nearby?: NearbyFood;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const explanation = explainMatch(pref, candidate);

  return (
    <div className="mt-3 border-t border-line pt-2.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg py-1 text-left text-[13px] font-bold text-accent transition-colors hover:text-brand"
      >
        <span>왜 이 음식인가요?</span>
        <span
          className="text-[11px] transition-transform duration-150"
          style={{ transform: open ? "rotate(180deg)" : undefined }}
          aria-hidden="true"
        >
          ▼
        </span>
      </button>

      {open && (
        <div id={panelId} className="mt-2 rounded-xl bg-surface-alt px-3.5 py-3.5">
          <p className="text-[12.5px] leading-relaxed text-fg">
            {nearby ? (
              <>
                <b>{pref.month}월 제철 후보 {poolSize}가지</b> 중 내 위치에서 가까운 순으로{" "}
                <b>{rank}번째</b>입니다. 거리순에서는 취향 점수를 순서에 넣지 않습니다.
              </>
            ) : (
              <>
                <b>{pref.month}월 제철 후보 {poolSize}가지</b>를 취향 네 가지로 채점해{" "}
                <b>{rank}위</b>입니다.
              </>
            )}
          </p>

          {nearby && (
            <div className="mt-2.5 rounded-lg border border-line bg-surface px-3 py-2.5 text-[12px] leading-relaxed text-fg">
              <span className="font-bold text-accent">거리 계산</span> · 이 음식을 파는 집{" "}
              {candidate.spots.length}곳의 좌표를 내 위치와 재어, 가장 가까운{" "}
              <b>{nearby.nearest.name}</b>까지 {formatDistance(nearby.distanceKm)}였습니다.
            </div>
          )}

          <h4 className="mt-3.5 text-[11px] font-bold tracking-wide text-fg-muted">
            취향 점수가 만들어진 과정
          </h4>

          <ScoreBar axes={explanation.axes} pref={pref} />

          <ul className="mt-2.5 space-y-2.5">
            {explanation.axes.map((axis) => (
              <AxisRow key={axis.key} axis={axis} color={axisColor(axis, pref)} />
            ))}
          </ul>

          <dl className="mt-3 space-y-1 border-t border-line-strong/60 pt-2.5 text-[12px]">
            <Line
              term="얻은 점수"
              detail={`${fmt(explanation.earned)} / ${explanation.total}점`}
              value={`${Math.round(explanation.percent)}점`}
            />
            <Line
              term="근거 계수"
              detail={
                explanation.confidence >= 1
                  ? "사람이 확인한 지표"
                  : "메뉴명으로 추정한 지표가 섞임"
              }
              value={`× ${explanation.credibility.toFixed(2)}`}
            />
            <div className="flex items-baseline justify-between gap-2 border-t border-line pt-1.5">
              <dt className="text-[13px] font-bold text-fg">최종 취향 일치</dt>
              <dd className="font-display text-[18px] text-brand">{explanation.score}</dd>
            </div>
          </dl>

          <ul className="mt-2.5 space-y-1 text-[11.5px] leading-relaxed text-fg-muted">
            {!candidate.inSeason && (
              <li>
                · 이번 달 제철 목록이 짧아 앞뒤 한 달까지 넓혀 잡은 후보입니다.
              </li>
            )}
            {(candidate.demoted || nearby?.demotedByIngredient) && (
              <li>
                · 같은 재료는 {MAX_PER_INGREDIENT}가지까지만 보여 주는 규칙에 걸려, 점수만
                보면 더 앞이었지만 뒤로 밀렸습니다.
              </li>
            )}
            <li>
              · 순위가 같으면 이번 달 제철인 쪽을 앞에 둡니다. 그래도 같으면 볼 때마다 다시
              섞어, 같은 취향에도 다른 음식이 오릅니다. 이 음식은{" "}
              {candidate.restaurantCount}곳에서 팝니다.
            </li>
          </ul>

          <Link
            href="/how"
            className="mt-3 inline-block text-[12px] font-bold text-accent hover:text-brand hover:underline"
          >
            채점 규칙 전체 보기 →
          </Link>

          <AccuracyFeedback candidate={candidate} axes={explanation.axes} />
        </div>
      )}
    </div>
  );
}

/**
 * 배점 100점이 아니라 "이 사람에게 적용된 만점"을 폭으로 삼는다.
 * 상관없음으로 뺀 지표는 애초에 만점에서 빠지므로 막대에도 자리가 없다.
 */
function ScoreBar({ axes, pref }: { axes: AxisScore[]; pref: Preference }) {
  const scored = axes.filter((a) => a.verdict !== "skipped");

  return (
    <div className="mt-2 flex h-3 gap-0.5 overflow-hidden rounded-full">
      {scored.map((axis) => {
        const color = axisColor(axis, pref);
        const filled = axis.weight === 0 ? 0 : (axis.earned / axis.weight) * 100;
        return (
          <div
            key={axis.key}
            className="relative h-full overflow-hidden rounded-full bg-line"
            style={{ flexGrow: axis.weight, flexBasis: 0 }}
            title={`${axis.label} ${fmt(axis.earned)}/${axis.weight}`}
          >
            <div
              className="h-full rounded-full"
              style={{ width: `${filled}%`, background: color }}
            />
          </div>
        );
      })}
    </div>
  );
}

function AxisRow({ axis, color }: { axis: AxisScore; color: string }) {
  const skipped = axis.verdict === "skipped";

  return (
    <li className={skipped ? "opacity-60" : undefined}>
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex min-w-0 items-baseline gap-1.5">
          <span
            className="inline-block h-2 w-2 shrink-0 rounded-full"
            style={{ background: skipped ? "var(--color-line-strong)" : color }}
            aria-hidden="true"
          />
          <span className="text-[12.5px] font-bold text-fg">{axis.label}</span>
          <span className="truncate text-[11.5px] text-fg-muted">
            내 선택 {axis.you} · 이 음식 {axis.it}
          </span>
        </div>
        <span className="shrink-0 text-[11.5px] font-bold text-fg-muted">
          {skipped ? "채점 제외" : `${fmt(axis.earned)}/${axis.weight}`}
        </span>
      </div>
      <p className="mt-0.5 pl-3.5 text-[11.5px] leading-relaxed text-fg-muted">{axis.note}</p>
    </li>
  );
}

function Line({ term, detail, value }: { term: string; detail: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="min-w-0 text-fg-muted">
        <span className="font-bold text-fg">{term}</span> · {detail}
      </dt>
      <dd className="shrink-0 font-bold text-fg">{value}</dd>
    </div>
  );
}

function axisColor(axis: AxisScore, pref: Preference): string {
  switch (axis.key) {
    case "spicy":
      return SPICY_COLOR;
    case "soup":
      return SOUP_COLOR;
    case "raw":
      return RAW_COLOR;
    case "ingredient":
      return pref.ingredient === "상관없음"
        ? "var(--color-fg-muted)"
        : CATEGORY_META[pref.ingredient].color;
  }
}

/** 20.0 같은 꼬리를 남기지 않는다. 8, 20, 13.3처럼만 읽히게. */
function fmt(value: number): string {
  return String(Math.round(value * 10) / 10);
}
