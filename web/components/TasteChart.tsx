import {
  CATEGORY_META,
  RAW_COLOR,
  SOUP_COLOR,
  SPICY_COLOR,
  SPICY_LEVELS,
  type Food,
} from "@/lib/types";

/** 배지를 그리는 데 실제로 필요한 것만. Food도 이 모양을 만족한다. */
type Tasted = Pick<Food, "spicy" | "hasSoup" | "isRaw" | "mainIngredients">;

/**
 * 음식의 지표 네 가지를 배지로 늘어놓는다.
 *
 * 예전 5축 막대 차트를 대신한다. 지표가 연속값이 아니라 단계·참거짓이라
 * 막대보다 "맵기 약간 / 국물 있음 / 익힘 / 해산물"처럼 말로 읽히는 편이
 * 정확하다.
 */
export function TasteBadges({ food, compact = false }: { food: Tasted; compact?: boolean }) {
  const size = compact ? "text-[11px] px-1.5 py-0.5" : "text-[12px] px-2 py-1";

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge
        color={SPICY_COLOR}
        size={size}
        muted={food.spicy === 0}
        label={food.spicy === 0 ? "안 매움" : `맵기 ${spicyLabel(food.spicy)}`}
      />
      <Badge
        color={SOUP_COLOR}
        size={size}
        muted={!food.hasSoup}
        label={food.hasSoup ? "국물 있음" : "국물 없음"}
      />
      <Badge
        color={RAW_COLOR}
        size={size}
        muted={!food.isRaw}
        label={food.isRaw ? "날것" : "익힘"}
      />
      {food.mainIngredients.map((category) => (
        <Badge
          key={category}
          color={CATEGORY_META[category].color}
          size={size}
          label={`${CATEGORY_META[category].icon} ${category}`}
        />
      ))}
    </div>
  );
}

function spicyLabel(level: number): string {
  return SPICY_LEVELS.find((l) => l.value === level)?.label ?? "";
}

function Badge({
  label,
  color,
  size,
  muted = false,
}: {
  label: string;
  color: string;
  size: string;
  /** 해당 없음(안 매움·국물 없음·익힘)은 옅게 두어 있는 쪽이 눈에 띄게 한다. */
  muted?: boolean;
}) {
  return (
    <span
      className={`rounded-full font-medium ${size}`}
      style={
        muted
          ? { background: "var(--color-surface-alt)", color: "var(--color-fg-muted)" }
          : { background: `${color}1a`, color }
      }
    >
      {label}
    </span>
  );
}
