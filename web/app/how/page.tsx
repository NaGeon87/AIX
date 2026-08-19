import Link from "next/link";

import { foods, meta } from "@/lib/data";
import { getKstMonth } from "@/lib/kst";
import {
  AXIS_WEIGHTS,
  CREDIBILITY_FLOOR,
  CATEGORY_DUPLICATE_PENALTY,
  MAX_PER_INGREDIENT,
  MAX_PER_METHOD,
  RAW_PARTIAL,
  explainMatch,
  rankCandidates,
  spicyLabel,
  type Preference,
} from "@/lib/recommend";
import { CATEGORY_META, RAW_COLOR, SOUP_COLOR, SPICY_COLOR } from "@/lib/types";

export const metadata = {
  title: "추천은 이렇게 만들어집니다 · 전라맛도",
  description: "전라맛도가 음식을 고르는 규칙 — 배점, 근거 계수, 다양성 규칙까지 전부.",
};

/** 예시로 따라가 볼 취향. 네 지표가 모두 살아 있는 조합이라야 표가 다 보인다. */
const SAMPLE_PREF: Omit<Preference, "month"> = {
  spicy: 2,
  soup: 2,
  raw: "X",
  ingredient: "해산물",
};

const AXIS_COLOR = {
  spicy: SPICY_COLOR,
  soup: SOUP_COLOR,
  raw: RAW_COLOR,
  ingredient: CATEGORY_META["해산물"].color,
} as const;

export default function HowPage() {
  const month = getKstMonth();
  const ranked = rankCandidates(foods, { ...SAMPLE_PREF, month });

  // 네 지표가 다 맞아떨어진 1위는 예시로 시시하다. 어딘가 어긋난 음식이라야
  // 부분 점수와 감점이 어떻게 붙는지 보인다.
  const sampleIndex = Math.max(
    0,
    ranked.findIndex((item) =>
      explainMatch(SAMPLE_PREF, item.food).axes.some(
        (a) => a.verdict === "partial" || a.verdict === "miss",
      ),
    ),
  );
  const sample = ranked[sampleIndex];
  const explanation = sample ? explainMatch(SAMPLE_PREF, sample.food) : null;

  return (
    <main className="mx-auto min-h-dvh w-full max-w-[520px] bg-canvas pb-14">
      <header className="bg-ink px-6 pb-7 pt-11 text-fg-inverse">
        <Link
          href="/"
          className="block w-fit text-[13px] text-[#b8afa6] transition-colors hover:text-fg-inverse"
        >
          ← 전라맛도
        </Link>
        <h1 className="font-display mt-2 text-[27px] leading-tight">
          추천은 이렇게
          <br />
          만들어집니다
        </h1>
        <p className="mt-3 text-[13px] leading-relaxed text-[#b8afa6]">
          추천에 쓰는 규칙을 숨기지 않았습니다. 아래 배점과 계수가 곧 실제 코드의 값이고,
          결과 카드의 <b className="font-bold text-fg-inverse">‘왜 이 음식인가요?’</b>는 이
          과정을 그 음식에 대해 그대로 풀어 보여 줍니다.
        </p>
      </header>

      {/* 전체 흐름 --------------------------------------------------------- */}
      <section className="px-5 pt-7">
        <h2 className="font-display text-[20px]">다섯 단계로 좁힙니다</h2>
        <ol className="mt-3 space-y-2">
          {[
            { n: 1, t: "제철 후보 고르기", d: `음식 ${meta.foodCount}건 중 이번 달 것만` },
            { n: 2, t: "취향 네 가지 채점", d: "맵기·국물·날것·주재료를 100점으로" },
            { n: 3, t: "근거 계수 곱하기", d: "추정으로 매긴 지표는 조금 낮춰서" },
            {
              n: 4,
              t: "겹치는 추천 걷어내기",
              d: `한 재료당 ${MAX_PER_INGREDIENT}가지, 조리법도 ${MAX_PER_METHOD}가지`,
            },
            { n: 5, t: "정렬해서 4가지", d: "동점이면 제철 먼저, 그다음은 매번 새로 섞어서" },
          ].map((step) => (
            <li
              key={step.n}
              className="flex items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3"
            >
              <span className="font-display flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-soft text-[15px] text-brand">
                {step.n}
              </span>
              <div className="min-w-0">
                <p className="text-[14px] font-bold text-fg">{step.t}</p>
                <p className="text-[12px] text-fg-muted">{step.d}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* 1단계 -------------------------------------------------------------- */}
      <Step index={1} title="제철은 보너스로 반영">
        <p>
          월 선택은 음식을 강제로 탈락시키는 필터가 아닙니다. 선택한 달이 제철이면
          <b> +12점</b>, 앞뒤 1개월이면 <b>+6점</b>, 앞뒤 2개월이면 <b>+3점</b>,
          그보다 멀면 0점을 더합니다.
        </p>
        <p>
          취향 네 축은 최대 100점이고 제철은 최대 12점이라, <b>취향이 제철보다 우선</b>합니다.
          같은 취향 점수끼리는 선택한 달에 맞는 음식이 확실히 앞으로 옵니다. 제철이 아니라는
          이유만으로 대체 추천이 되지는 않습니다.
        </p>
      </Step>

      {/* 2단계 -------------------------------------------------------------- */}
      <Step index={2} title="취향 네 가지를 100점으로 나눠 채점">
        <p>
          지표마다 배점이 다릅니다. 우선순위는 <b>날것/익힘 → 주재료 → 국물 → 맵기</b>입니다.
          맵기는 완전히 달라도 대체 추천으로 분류하지 않고 점수만 깎습니다.
        </p>

        <div className="mt-3 overflow-hidden rounded-2xl border border-line bg-surface">
          <table className="w-full text-left text-[12.5px]">
            <thead className="bg-surface-alt text-[11px] text-fg-muted">
              <tr>
                <th className="px-3 py-2 font-bold">지표</th>
                <th className="px-2 py-2 text-right font-bold">배점</th>
                <th className="px-3 py-2 font-bold">점수를 매기는 방식</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              <Row
                color={AXIS_COLOR.raw}
                name="날것"
                weight={AXIS_WEIGHTS.raw}
                rule={`맞으면 전부. 날것을 원했는데 익힌 메뉴면 ${Math.round(
                  RAW_PARTIAL * 100,
                )}%인 ${AXIS_WEIGHTS.raw * RAW_PARTIAL}점을 남깁니다. 반대로 익힌 것을 원했는데 날것이면 0점입니다.`}
              />
              <Row
                color={AXIS_COLOR.ingredient}
                name="주재료"
                weight={AXIS_WEIGHTS.ingredient}
                rule="고른 계열이 대표 재료에 들어 있으면 전부, 아니면 0점. ‘상관없음’이면 채점에서 뺍니다."
              />
              <Row
                color={AXIS_COLOR.soup}
                name="국물"
                weight={AXIS_WEIGHTS.soup}
                rule="맞으면 전부, 반대면 0점. ‘상관없음’을 고르면 채점에서 뺍니다."
              />
              <Row
                color={AXIS_COLOR.spicy}
                name="맵기"
                weight={AXIS_WEIGHTS.spicy}
                rule={`0~3단계 중 한 단계 어긋날 때마다 배점의 ⅓씩 깎습니다. ${SPICY_STEPS}`}
              />
            </tbody>
          </table>
        </div>

        <Callout title="‘상관없음’은 감점이 아니라 제외입니다">
          신경 쓰지 않기로 한 지표는 얻을 점수에서도, 만점에서도 함께 빠집니다. 그래서 국물과
          주재료를 모두 ‘상관없음’으로 두면 만점은 100이 아니라{" "}
          {AXIS_WEIGHTS.spicy + AXIS_WEIGHTS.raw}점이 되고, 남은 맵기·날것만으로 순위가
          갈립니다. 안 고른 항목 때문에 모든 음식의 점수가 똑같이 낮아지는 일은 없습니다.
        </Callout>
      </Step>

      {/* 예시 --------------------------------------------------------------- */}
      {sample && explanation && (
        <section className="px-5 pt-7">
          <h2 className="font-display text-[20px]">실제로 한 번 따라가 봅시다</h2>
          <p className="mt-1.5 text-[13px] leading-relaxed text-fg-muted">
            <b className="text-fg">
              맵기 {spicyLabel(SAMPLE_PREF.spicy)} · 국물 있게 · 익힌 것으로 · 해산물
            </b>
            을 고른 사람에게 {month}월 결과 {sampleIndex + 1}번째로 나오는{" "}
            <b className="text-fg">{sample.food.name}</b>. 아래는 문서용으로 지어낸 숫자가
            아니라, 지금 이 화면을 그릴 때 실제로 돌린 채점 결과입니다.
          </p>

          <div className="mt-3 rounded-2xl border border-line bg-surface px-4 py-4">
            <ul className="space-y-2.5">
              {explanation.axes.map((axis) => (
                <li key={axis.key}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="flex min-w-0 items-baseline gap-1.5">
                      <span
                        className="inline-block h-2 w-2 shrink-0 rounded-full"
                        style={{
                          background:
                            axis.verdict === "skipped"
                              ? "var(--color-line-strong)"
                              : AXIS_COLOR[axis.key],
                        }}
                      />
                      <span className="text-[13px] font-bold text-fg">{axis.label}</span>
                      <span className="truncate text-[11.5px] text-fg-muted">
                        내 선택 {axis.you} · 이 음식 {axis.it}
                      </span>
                    </span>
                    <span className="shrink-0 text-[12px] font-bold text-fg-muted">
                      {axis.verdict === "skipped"
                        ? "채점 제외"
                        : `${round1(axis.earned)}/${axis.weight}`}
                    </span>
                  </div>
                  <p className="mt-0.5 pl-3.5 text-[11.5px] leading-relaxed text-fg-muted">
                    {axis.note}
                  </p>
                </li>
              ))}
            </ul>

            <div className="mt-3 space-y-1 border-t border-line pt-2.5 text-[12.5px]">
              <p className="flex justify-between">
                <span className="text-fg-muted">
                  얻은 점수 {round1(explanation.earned)} / 만점 {explanation.total}
                </span>
                <b>{Math.round(explanation.percent)}점</b>
              </p>
              <p className="flex justify-between">
                <span className="text-fg-muted">근거 계수</span>
                <b>× {explanation.credibility.toFixed(2)}</b>
              </p>
              <p className="flex items-baseline justify-between border-t border-line pt-1.5">
                <b className="text-[13px]">최종 취향 일치</b>
                <b className="font-display text-[19px] text-brand">{explanation.score}</b>
              </p>
            </div>
          </div>
        </section>
      )}

      {/* 3단계 -------------------------------------------------------------- */}
      <Step index={3} title="근거가 약한 지표는 조금 낮춰서">
        <p>
          맵기·국물·날것·주재료는 메뉴 이름과 설명에서 읽어 냅니다. &ldquo;낙지연포탕&rdquo;은
          국물 요리라고 자신 있게 말할 수 있지만, 이름만 짧게 남은 메뉴는 추정에 가깝습니다.
        </p>
        <p>
          그래서 지표마다 <b>근거 강도</b>를 두고, 최종 점수에{" "}
          <b>
            {CREDIBILITY_FLOOR.toFixed(2)} ~ 1.00
          </b>
          의 계수를 곱합니다. 근거가 확실하면 점수 그대로, 약하면 최대 {" "}
          {Math.round((1 - CREDIBILITY_FLOOR) * 100)}%까지 낮춥니다. 근거가 약한데 우연히
          취향과 맞은 음식이, 근거가 확실한 음식을 밀어내고 1위에 오르지 않게 하려는 장치입니다.
        </p>
        <p>
          많이 낮춘 항목은 카드에 <b>‘메뉴명 정보가 짧아 근거가 약합니다’</b>라고 적습니다.
          점수를 조용히 깎기만 하고 넘어가면, 그것대로 설명할 수 없는 순위가 됩니다.
        </p>
      </Step>

      {/* 4단계 -------------------------------------------------------------- */}
      <Step index={4} title="첫 화면은 식재료를 겹치지 않게">
        <p>
          점수순 그대로 자르면 전복찜·전복회·전복구이처럼 한 재료가 결과를 차지할 수 있습니다.
          첫 추천 5개에서는 <b>같은 핵심 식재료를 가능한 한 1개만</b> 보여 주고, 서로 다른
          식재료 중 점수가 높은 순으로 채웁니다. 같은 메뉴명이 제철 재료만 달리해 중복된 행도
          가장 높은 점수 하나만 남깁니다.
        </p>
        <p>
          <b>‘다른 추천 보기’</b>를 누르면 앞에서 보지 못한 메뉴를 우선하며 같은 식재료를
          화면당 최대 2개까지 허용합니다. 두 번째 동일 식재료에는 <b>-${CATEGORY_DUPLICATE_PENALTY}점</b>
          다양성 보정을 적용해, 숨겨졌던 고득점 변형 메뉴도 보되 다시 한 재료가 독점하지 않게 합니다.
        </p>
      </Step>

      {/* 5단계 -------------------------------------------------------------- */}
      <Step index={5} title="최종 추천 점수로 순서 결정">
        <p>
          화면의 순서는 <b>취향 점수 + 제철 보너스 - 다양성 보정</b>으로 계산한 최종 추천 점수
          내림차순입니다. 맵기 차이는 취향 점수 안에서만 감점되고, 날것/익힘·주재료·국물 중
          하나라도 어긋난 메뉴만 개별적으로 <b>대체 추천</b>이 됩니다.
        </p>
        <p>
          정상 추천만으로 5개를 채우지 못하면 나머지 자리에 점수가 가장 가까운 대체 메뉴를 넣습니다.
          대체 메뉴는 빨간 테두리와 불일치 사유를 표시합니다. 결과 수는 항상 5개를 목표로 합니다.
        </p>
      </Step>

      {/* 거리순 ------------------------------------------------------------- */}
      <section className="px-5 pt-7">
        <h2 className="font-display text-[20px]">‘거리순’은 무엇이 다른가</h2>
        <div className="mt-2 space-y-2 text-[13px] leading-relaxed text-fg">
          <p>
            위치를 허용하면 같은 제철 후보를 <b>거리로 다시 세웁니다.</b> 이때 취향 점수는
            순서에 넣지 않습니다. &ldquo;가까운 순&rdquo;이라 해 놓고 취향으로 한 번 거른
            목록을 보여 주면 거짓말이 되기 때문입니다.
          </p>
          <p>
            거리는 그 음식을 파는 집들의 좌표 중 <b>가장 가까운 한 곳</b>까지의 직선 거리입니다.
            좌표가 없는 음식은 목록에서 빠집니다. 같은 재료 {MAX_PER_INGREDIENT}가지 상한은
            거리순에도 그대로 겁니다.
          </p>
          <p className="rounded-2xl bg-accent-soft px-4 py-3 text-[12.5px]">
            <b>위치는 기기 밖으로 나가지 않습니다.</b> 좌표는 브라우저 안에서 거리 계산에만
            쓰고 서버로 보내지 않습니다. 그래서 후보 목록 전체를 미리 내려보내 브라우저에서
            정렬합니다.
          </p>
        </div>
      </section>

      {/* 특화거리 ----------------------------------------------------------- */}
      <section className="px-5 pt-7">
        <h2 className="font-display text-[20px]">특화거리는 어떻게 붙나</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-fg">
          <b>그 거리가 대표 먹거리로 내건 것과 음식이 겹칠 때만</b> 붙입니다. 무안뻘낙지거리는
          낙지 요리에, 봉산동 게장백반거리는 게장이 든 상차림에 붙는 식입니다. 같은 시·군·구인지,
          파는 집에서 몇 km인지, 점포가 몇이나 되는지는 <b>이미 겹치는 거리 여럿을 줄 세울 때만</b>{" "}
          씁니다. 가깝다는 것은 상관없는 거리를 끌어올 근거가 되지 못합니다.
        </p>
        <p className="mt-2 text-[13px] leading-relaxed text-fg">
          특화거리는 광주·전남을 통틀어 20곳뿐이라, 제철 음식 대부분은 짝이 되는 거리가 없습니다.
          그럴 때는 거리를 지어내지 않고 <b>‘파는 집으로 바로 가기’</b>에 그 음식을 실제로 파는
          가게를 보여 줍니다. 향토음식점으로 등록된 곳을 앞에 세웁니다.
        </p>
        <p className="mt-2 text-[13px] leading-relaxed text-fg">
          목록 아래 <b>‘가 볼 만한 특화거리’</b>는 그렇게 걸러진 거리들이 각자 얻은 점수를
          취향 일치도로 가중해 합산한 결과입니다. 여러 추천 음식이 함께 가리키는 거리가 위로
          올라옵니다.
        </p>
      </section>

      {/* 한계 --------------------------------------------------------------- */}
      <section className="px-5 pt-7">
        <h2 className="font-display text-[20px]">이 추천이 못 하는 것</h2>
        <ul className="mt-2 space-y-1.5 text-[13px] leading-relaxed text-fg">
          <li>· 가격·영업시간·휴무·리뷰는 보지 않습니다. 가시기 전에 확인이 필요합니다.</li>
          <li>· 맛 지표 일부는 메뉴 이름에서 추정한 값입니다. 근거가 약하면 표시합니다.</li>
          <li>· 공공데이터에 등록된 곳만 다룹니다. 지역별로 수록 밀도가 고르지 않습니다.</li>
          <li>
            · 개인 이력을 쌓지 않습니다. 누가 고르든 같은 취향이면 같은 기준으로 채점하고,
            동점자 중 누구를 보여 줄지만 매번 다시 섞습니다.
          </li>
        </ul>
      </section>

      <section className="px-5 pt-7">
        <Link
          href="/taste"
          className="block rounded-2xl bg-brand py-4 text-center text-[16px] font-bold text-fg-inverse transition-all hover:-translate-y-0.5 hover:shadow-lg"
        >
          취향 고르고 추천받기
        </Link>
      </section>

      <footer className="px-6 pt-7 text-[11px] leading-relaxed text-fg-muted">
        <p className="font-bold text-fg">데이터 출처</p>
        <ul className="mt-1.5 space-y-0.5">
          {meta.sources.map((s) => (
            <li key={s}>· {s}</li>
          ))}
        </ul>
        <p className="mt-2">
          음식 {meta.foodCount}건 · 특화거리 {meta.streetCount}건 · {meta.builtAt.slice(0, 10)}{" "}
          기준
        </p>
      </footer>
    </main>
  );
}

/** 맵기 배점이 단계마다 어떻게 떨어지는지 문장으로. 배점을 고치면 같이 바뀐다. */
const SPICY_STEPS = [0, 1, 2, 3]
  .map((gap) => `${gap}단계 차이 ${round1(AXIS_WEIGHTS.spicy * (1 - gap / 3))}점`)
  .join(" · ");

function Step({
  index,
  title,
  children,
}: {
  index: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="px-5 pt-7">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-ink px-2 py-0.5 text-[11px] font-bold text-fg-inverse">
          {index}단계
        </span>
        <h2 className="font-display text-[20px]">{title}</h2>
      </div>
      <div className="mt-2 space-y-2 text-[13px] leading-relaxed text-fg">{children}</div>
    </section>
  );
}

function Row({
  color,
  name,
  weight,
  rule,
}: {
  color: string;
  name: string;
  weight: number;
  rule: string;
}) {
  return (
    <tr className="align-top">
      <td className="whitespace-nowrap px-3 py-2.5">
        <span className="flex items-center gap-1.5 font-bold text-fg">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: color }}
            aria-hidden="true"
          />
          {name}
        </span>
      </td>
      <td className="whitespace-nowrap px-2 py-2.5 text-right font-bold" style={{ color }}>
        {weight}
      </td>
      <td className="px-3 py-2.5 leading-relaxed text-fg-muted">{rule}</td>
    </tr>
  );
}

function Callout({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-3 rounded-2xl border-l-4 border-brand bg-brand-soft/60 px-4 py-3">
      <p className="text-[13px] font-bold text-brand">{title}</p>
      <p className="mt-1 text-[12.5px] leading-relaxed text-fg">{children}</p>
    </div>
  );
}

function round1(value: number): string {
  return String(Math.round(value * 10) / 10);
}
