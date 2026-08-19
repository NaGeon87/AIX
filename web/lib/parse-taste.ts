/**
 * 자연어로 받은 한 줄에서 취향 네 가지와 달을 읽어 낸다.
 *
 * LLM을 부르지 않는다. 가려낼 값이 맵기 4단계 · 국물 3 · 날것 2 · 주재료 4 ·
 * 달 12로 닫혀 있어서, 말투를 몇 갈래로 모으면 규칙으로 거의 덮인다. 키도
 * 비용도 서버도 필요 없고, 무엇을 보고 그렇게 읽었는지 사용자에게 그대로
 * 되돌려 줄 수 있다 — LLM이면 "왜 이렇게 읽었나"를 설명하지 못한다.
 *
 * 한국어 부정이 이 파서의 전부다. '안 매운'은 '매운'을 품고 '회 말고'는
 * '회'를 품는다. 그래서 축마다 규칙을 순서대로 놓고 **먼저 걸리는 것이
 * 이긴다**. 부정형을 반드시 긍정형보다 앞에 둔다.
 */

import type {
  IngredientPreference,
  Preference,
  RawPreference,
  SoupPreference,
} from "./recommend";

export type ParsedAxis = "spicy" | "soup" | "raw" | "ingredient" | "month";

export interface ParsedHit {
  axis: ParsedAxis;
  /** 화면에 보일 축 이름 */
  label: string;
  /** 사용자가 쓴 말 중 근거가 된 조각 */
  phrase: string;
  /** 그렇게 읽은 결과 */
  reading: string;
}

export interface ParseResult {
  /** 읽어 낸 값만 담는다. 못 읽은 축은 없다. */
  pref: Partial<Preference>;
  hits: ParsedHit[];
  /** “해산물 말고”, “고기 빼고”처럼 명시적으로 제외한 주재료 범주. */
  excludedIngredients: Array<Exclude<IngredientPreference, "상관없음">>;
}

type Rule<T> = [RegExp, T, string];

/**
 * 맵기는 '정도 부사 + 매운 말'로 읽는다.
 *
 * 매운 말이 맵/매운/매콤/얼큰/칼칼로 갈리는데, 부사만 보고 어간을 하나로
 * 못 박으면 '아주 매운'이 '아주 맵'에 안 걸려 그냥 '매움'으로 떨어진다.
 * 그래서 어간을 묶어 두고 부사를 앞에 붙인다. 부정이 가장 먼저다 —
 * '안 매운'은 '매운'을 품고 있어서 순서가 곧 정확도다.
 */
const HOT = "맵|매운|매워|매콤|얼큰|칼칼|맵게";
const SPICY_RULES: Rule<number>[] = [
  [
    new RegExp(`안\\s*(${HOT})|(${HOT})지\\s*않|하나도\\s*안\\s*매|순한|순하게|담백|자극\\s*없|아이|애기|어린이|안맵`),
    0,
    "안 매움",
  ],
  [new RegExp(`(덜|약간|살짝|조금|적당히|은근|적당)\\s*(${HOT})`), 1, "약간"],
  [
    new RegExp(`(아주|엄청|많이|매우|겁나|무지|되게)\\s*(${HOT})|화끈|불닭|캡사이신|불맛|땀\\s*날|(${HOT})\\s*거\\s*좋`),
    3,
    "아주 매움",
  ],
  [new RegExp(`(${HOT})|맵싸`), 2, "매움"],
];

const SOUP_RULES: Rule<SoupPreference>[] = [
  [/국물\s*없|국물\s*말고|국물\s*빼|마른|건더기만|국물\s*싫/, 0, "국물 없이"],
  [/국물|탕|찌개|전골|국\b|뜨끈|따끈|따뜻|시원한\s*국|해장|속\s*풀|훌훌/, 2, "국물 있게"],
  [/국물\s*상관|아무거나/, 1, "상관없음"],
];

// 자바스크립트의 \b는 한글에 안 먹는다(한글이 \w가 아니라 경계가 안 잡힌다).
// 그래서 '회'는 뒤에 올 수 있는 다른 낱말을 부정 전방탐색으로 걷어낸다 —
// 회사·회식·회의·회전·회계·회원·회복이 '회 요리'로 읽히면 안 된다.
const HOE = "회(?![사식의전계원복장복])";
const RAW_RULES: Rule<RawPreference>[] = [
  [/회\s*말고|날것\s*말고|생것\s*말고|익힌|익혀|날\s*건\s*싫|회는\s*싫|비린\s*거\s*싫/, "X", "익힌 것으로"],
  [
    new RegExp(`${HOE}|날것|날거|생선회|사시미|육회|물회|탕탕이|산낙지|초밥|숙성`),
    "O",
    "날것도 좋아요",
  ],
];

/** “~ 말고/빼고/제외”는 반대 범주를 임의로 추측하지 않고 제외 조건으로 보관한다. */
const INGREDIENT_EXCLUSION_RULES: Rule<Exclude<IngredientPreference, "상관없음">>[] = [
  [/해산물\s*(말고|빼|제외)|해물\s*(말고|빼|제외)|생선\s*(말고|빼|제외|싫)|비린\s*거\s*(말고|싫)/, "해산물", "해산물 제외"],
  [/고기\s*(말고|빼|제외|싫)|육류\s*(말고|빼|제외)|소고기\s*(말고|빼|제외)|돼지고기\s*(말고|빼|제외)/, "육류", "육류 제외"],
  [/채소\s*(말고|빼|제외|싫)|야채\s*(말고|빼|제외)|나물\s*(말고|빼|제외)/, "채소", "채소 제외"],
];

const INGREDIENT_RULES: Rule<IngredientPreference>[] = [
  [
    new RegExp(`해산물|해물|생선|바다|조개|수산|물고기|${HOE}|낙지|전복|꼬막|꽃게|갈치|홍어|새우|굴(?![비])`),
    "해산물",
    "해산물",
  ],
  [/육류|고기|소고기|한우|돼지|삼겹|닭|오리|육회|갈비|불고기|보쌈|수육/, "육류", "육류"],
  [/채소|야채|나물|산채|두부|버섯|비빔|채소류/, "채소", "채소"],
  [/상관\s*없|아무거나|다\s*좋/, "상관없음", "주재료 상관없음"],
];

const SEASON_MONTH: Rule<number>[] = [
  [/봄철|봄에|봄\b/, 4, "봄"],
  [/여름철|여름에|여름|무더위|복날|삼복/, 7, "여름"],
  [/가을철|가을에|가을|선선/, 10, "가을"],
  [/겨울철|겨울에|겨울|추울\s*때|한겨울/, 1, "겨울"],
];

const AXIS_LABEL: Record<ParsedAxis, string> = {
  spicy: "맵기",
  soup: "국물",
  raw: "날것",
  ingredient: "주재료",
  month: "달",
};

function firstMatch<T>(text: string, rules: Rule<T>[]): { value: T; phrase: string; reading: string } | null {
  for (const [pattern, value, reading] of rules) {
    const m = text.match(pattern);
    if (m) return { value, phrase: m[0].trim(), reading };
  }
  return null;
}

/**
 * 한 줄을 읽는다. 못 알아들은 축은 그냥 비워 둔다 — 지어내지 않는다.
 *
 * 달은 'N월'을 계절어보다 먼저 본다. "12월에 따뜻한 거"에서 계절어 '따뜻'이
 * 겨울을 부르면 사용자가 적은 12월을 덮어써 버린다.
 */
export function parseTasteText(input: string): ParseResult {
  const text = (input || "").trim();
  const pref: Partial<Preference> = {};
  const hits: ParsedHit[] = [];
  const excludedIngredients: Array<Exclude<IngredientPreference, "상관없음">> = [];

  if (!text) return { pref, hits, excludedIngredients };

  const push = (axis: ParsedAxis, phrase: string, reading: string) =>
    hits.push({ axis, label: AXIS_LABEL[axis], phrase, reading });

  const spicy = firstMatch(text, SPICY_RULES);
  if (spicy) {
    pref.spicy = spicy.value;
    push("spicy", spicy.phrase, spicy.reading);
  }

  const soup = firstMatch(text, SOUP_RULES);
  if (soup) {
    pref.soup = soup.value;
    push("soup", soup.phrase, soup.reading);
  }

  const raw = firstMatch(text, RAW_RULES);
  if (raw) {
    pref.raw = raw.value;
    push("raw", raw.phrase, raw.reading);
  }

  // “해산물 말고”를 곧바로 “육류”로 바꾸면 채소라는 또 다른 가능성을 잃는다.
  // 그래서 부정은 제외 목록으로 따로 보관하고, 남은 문장에서 긍정 선호만 읽는다.
  for (const [pattern, value, reading] of INGREDIENT_EXCLUSION_RULES) {
    const match = text.match(pattern);
    if (!match || excludedIngredients.includes(value)) continue;
    excludedIngredients.push(value);
    push("ingredient", match[0].trim(), reading);
  }
  const ingredientText = text.replace(/\S{1,10}?\s*(말고|빼고|빼|제외하고|제외|싫어|싫)/g, " ");
  const ingredient = firstMatch(ingredientText, INGREDIENT_RULES);
  if (ingredient) {
    pref.ingredient = ingredient.value;
    push("ingredient", ingredient.phrase, ingredient.reading);
  }

  const explicit = text.match(/(\d{1,2})\s*월/);
  if (explicit) {
    const month = Number(explicit[1]);
    if (month >= 1 && month <= 12) {
      pref.month = month;
      push("month", explicit[0].trim(), `${month}월`);
    }
  } else {
    const season = firstMatch(text, SEASON_MONTH);
    if (season) {
      pref.month = season.value;
      push("month", season.phrase, `${season.reading} (${season.value}월 기준)`);
    }
  }

  return { pref, hits, excludedIngredients };
}

/** 아무것도 못 읽었을 때 보여 줄 말투 예시. 실제로 파서가 잡는 문장들이다. */
export const EXAMPLE_PHRASES = [
  "매콤한 국물 요리",
  "안 매운 해산물",
  "회 같은 거 먹고 싶어",
  "따뜻한 국물에 고기",
  "겨울에 먹을 안 매운 음식",
  "국물 없이 담백한 채소",
] as const;
