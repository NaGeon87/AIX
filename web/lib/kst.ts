/**
 * 서버 실행 환경의 타임존과 무관하게 한국 표준시(KST, UTC+9)를 계산한다.
 *
 * Vercel 서버는 UTC로 돈다. `new Date().getMonth()`를 그대로 쓰면 한국
 * 시각 자정~오전 9시 사이에는 실제로는 다음 날인데 전날로 계산된다 —
 * 월말에는 월까지 하루 밀려서 "이번 달 제철"이 완전히 틀어진다.
 *
 * `Date.now()`는 실행 환경과 무관하게 항상 절대 UTC epoch ms를 준다.
 * 여기에 9시간을 더한 뒤 **UTC 게터**(getUTCMonth 등)로 읽으면, 그 값이
 * 곧 KST 기준 값이 된다. 로컬 게터(getMonth 등)를 쓰면 실행 환경의
 * 타임존 오프셋이 다시 얹혀서 이중 보정이 되므로 반드시 UTC 게터를 써야
 * 한다.
 */
function kstShiftedDate(): Date {
  return new Date(Date.now() + 9 * 60 * 60 * 1000);
}

export interface KstNow {
  year: number;
  /** 1~12 */
  month: number;
  day: number;
  hour: number;
}

export function getKstNow(): KstNow {
  const d = kstShiftedDate();
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
  };
}

export function getKstMonth(): number {
  return getKstNow().month;
}
