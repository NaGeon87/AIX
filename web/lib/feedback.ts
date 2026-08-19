import type { AxisKey, NearbyCandidate } from "./recommend";

/**
 * "이 정보가 실제와 다른가요?" 답을 받아 두는 자리.
 *
 * 지표 네 가지(맵기·국물·날것·주재료)는 상당수가 메뉴명에서 룰과 LLM으로
 * 추정한 값이다. 화면은 confidence로 "근거가 약하다"까지는 밝히지만, 어느
 * 지표가 실제로 틀렸는지는 그 음식을 먹어 본 사람만 안다. 그 한 마디를
 * 받는 통로가 이 모듈이다.
 *
 * 받은 답은 두 군데로 간다.
 *   - 이 브라우저의 localStorage — 같은 사람에게 같은 음식을 두 번 묻지 않는다.
 *   - POST /api/feedback — 배포 런타임 로그로 나간다.
 *
 * 로그는 최종 저장소가 아니다. 모인 답을 실제 데이터에 반영하려면 사람이
 * 읽고 src/taste/manual_labels.py의 표에 근거와 함께 옮겨야 한다. 그 표가
 * build_taste_profile.py를 거쳐 web/public/data로 돌아온다.
 */

/** 사용자가 지표를 보고 내린 판정. */
export type AccuracyVerdict = "same" | "different";

export interface AccuracyFeedback {
  verdict: AccuracyVerdict;
  /** verdict가 "different"일 때 사용자가 짚은 지표. */
  axes: AxisKey[];
  note: string;
  /** 답한 시각(ISO). 같은 음식에 다시 답하면 덮어쓴다. */
  at: string;
  /** 서버까지 닿았는가. false면 다음 방문에 한 번 더 보내 본다. */
  delivered: boolean;
}

/** 자유 입력 길이 상한. 서버도 같은 값으로 자른다. */
export const NOTE_MAX = 200;

// 키에 버전을 박아 둔다. 나중에 모양이 바뀌면 파싱을 시도하다 터지는 대신
// 새 키로 옮겨 가고, 옛 답은 그냥 잊는 편이 낫다.
const STORAGE_KEY = "namdo:accuracy-feedback:v1";

type Store = Record<string, AccuracyFeedback>;

/**
 * localStorage는 없을 수도(SSR), 막혀 있을 수도(사파리 시크릿, 정책) 있다.
 * 피드백은 서비스의 본체가 아니므로 어떤 경우에도 화면을 깨뜨리지 않는다.
 */
function loadStore(): Store {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Store;
  } catch {
    return {};
  }
}

// --------------------------------------------------------------------------
// 외부 저장소로서의 localStorage
//
// 화면은 이 값을 useSyncExternalStore로 읽는다. 그래서 두 가지가 필요하다.
//   - 스냅샷의 참조가 안 변할 것: 매번 JSON.parse를 하면 같은 내용이어도
//     새 객체가 나와 리액트가 영원히 다시 그린다. 파싱 결과를 캐시에 잡아 둔다.
//   - 바뀌면 알릴 것: 저장·삭제와 다른 탭의 변경 둘 다 구독자에게 알린다.
// --------------------------------------------------------------------------

let cache: Store | null = null;
const listeners = new Set<() => void>();

function store(): Store {
  if (cache === null) cache = loadStore();
  return cache;
}

function emit(): void {
  for (const listener of listeners) listener();
}

/** 다른 탭에서 답한 것도 이 탭에 비친다. */
function onStorageEvent(event: StorageEvent): void {
  if (event.key !== null && event.key !== STORAGE_KEY) return;
  cache = null;
  emit();
}

export function subscribeFeedback(listener: () => void): () => void {
  if (listeners.size === 0 && typeof window !== "undefined") {
    window.addEventListener("storage", onStorageEvent);
  }
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== "undefined") {
      window.removeEventListener("storage", onStorageEvent);
    }
  };
}

export function feedbackSnapshot(foodId: string): AccuracyFeedback | null {
  const saved = store()[foodId];
  return saved && (saved.verdict === "same" || saved.verdict === "different") ? saved : null;
}

/** 서버에는 답이 없다. 서버가 그린 화면은 언제나 "아직 안 물어봄" 상태다. */
export function serverFeedbackSnapshot(): null {
  return null;
}

function commit(next: Store): void {
  cache = next;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // 용량이 찼거나 저장이 막힌 경우. 이번 세션에서만 기억하고 넘어간다.
    }
  }
  emit();
}

export function saveFeedback(foodId: string, feedback: AccuracyFeedback): void {
  commit({ ...store(), [foodId]: feedback });
}

export function clearFeedback(foodId: string): void {
  const next = { ...store() };
  delete next[foodId];
  commit(next);
}

/** 서버로 보내는 몸통. 취향은 넣지 않는다 — 틀린 것은 음식 쪽 정보다. */
export interface FeedbackPayload {
  foodId: string;
  foodName: string;
  verdict: AccuracyVerdict;
  axes: AxisKey[];
  note: string;
  /** 사용자가 화면에서 본 지표 값. 그 사이 데이터가 바뀌어도 무엇을 보고 답한 건지 남는다. */
  shown: {
    spicy: number;
    hasSoup: boolean;
    isRaw: boolean;
    mainIngredients: string[];
    confidence: number;
  };
}

export function toPayload(
  candidate: NearbyCandidate,
  verdict: AccuracyVerdict,
  axes: AxisKey[],
  note: string,
): FeedbackPayload {
  return {
    foodId: candidate.id,
    foodName: candidate.name,
    verdict,
    axes,
    note: note.trim().slice(0, NOTE_MAX),
    shown: {
      spicy: candidate.spicy,
      hasSoup: candidate.hasSoup,
      isRaw: candidate.isRaw,
      mainIngredients: candidate.mainIngredients,
      confidence: candidate.confidence,
    },
  };
}

/**
 * 서버로 보낸다. 성공 여부를 그대로 돌려주고 예외는 삼킨다 —
 * 화면이 "고맙습니다"라고 말할지 "지금은 못 보냈다"고 말할지 정해야 하므로
 * 실패를 조용히 성공으로 바꾸지는 않는다.
 */
export async function sendFeedback(payload: FeedbackPayload): Promise<boolean> {
  try {
    const res = await fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      // 답한 직후 페이지를 떠나도 요청이 끊기지 않게 한다.
      keepalive: true,
    });
    return res.ok;
  } catch {
    return false;
  }
}
