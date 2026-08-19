/** 한글 음절의 받침 유무. 유니코드 한글 블록은 (초성*21 + 중성)*28 + 종성 구조다. */
function hasBatchim(word: string): boolean {
  const last = word.trim().slice(-1);
  const code = last.charCodeAt(0);
  if (Number.isNaN(code) || code < 0xac00 || code > 0xd7a3) return false;
  return (code - 0xac00) % 28 !== 0;
}

/**
 * 받침에 맞는 조사를 붙인다. "맵기은"처럼 어긋나면 화면이 곧바로 어설퍼 보인다.
 * withParticle("맵기", "은/는") → "맵기는"
 */
export function withParticle(word: string, pair: "은/는" | "이/가" | "을/를" | "과/와"): string {
  const [withBatchim, withoutBatchim] = pair.split("/");
  return word + (hasBatchim(word) ? withBatchim : withoutBatchim);
}

/**
 * 거리 이름이 소재지를 담고 있지 않으면 시군구를 앞에 붙인다.
 * 완도군의 "음식특화거리"처럼 이름만으로는 어디인지 알 수 없는 항목이 있다.
 */
export function streetDisplayName(street: { name: string; sigungu: string }): string {
  if (!street.sigungu) return street.name;

  // 접미사를 떼되, 한 글자만 남으면(동구 → "동") 이름이 깨지므로 원형을 쓴다.
  const stem = street.sigungu.replace(/(시|군|구)$/, "");
  const prefix = stem.length >= 2 ? stem : street.sigungu;

  if (street.name.includes(prefix) || street.name.includes(street.sigungu)) {
    return street.name;
  }
  return `${prefix} ${street.name}`;
}
