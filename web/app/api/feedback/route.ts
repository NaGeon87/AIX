import { NOTE_MAX, type AccuracyVerdict, type FeedbackPayload } from "@/lib/feedback";
import { storeFeedback } from "@/lib/feedback-store";
import { AXIS_LABELS, type AxisKey } from "@/lib/recommend";

/**
 * "이 정보가 실제와 다른가요?" 답을 받는다.
 *
 * 받은 것을 어디에 넣을지는 lib/feedback-store.ts가 정한다. 여기서 하는 일은
 * 들어온 몸통을 우리가 아는 모양으로 깎는 것과, 넣지 못했을 때 그렇다고
 * 말해 주는 것뿐이다. 화면은 실패를 들으면 답을 기기에 남겨 두었다가 다음
 * 방문에 다시 보낸다.
 */

/** 몸통이 커 봐야 이 정도다. 그보다 크면 읽지 않고 자른다. */
const MAX_BODY_BYTES = 4_000;

const AXIS_KEYS = Object.keys(AXIS_LABELS) as AxisKey[];

function isAxisKey(value: unknown): value is AxisKey {
  return typeof value === "string" && AXIS_KEYS.includes(value as AxisKey);
}

function isVerdict(value: unknown): value is AccuracyVerdict {
  return value === "same" || value === "different";
}

function str(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

/**
 * 클라이언트가 보낸 것을 그대로 믿지 않는다. 공개 엔드포인트라 아무나
 * 아무 모양이나 넣을 수 있고, 로그에 넣을 값은 우리가 아는 모양이어야 한다.
 */
function parse(body: unknown): FeedbackPayload | null {
  if (!body || typeof body !== "object") return null;
  const raw = body as Record<string, unknown>;

  const foodId = str(raw.foodId, 80);
  if (!foodId || !isVerdict(raw.verdict)) return null;

  const shownRaw =
    raw.shown && typeof raw.shown === "object" ? (raw.shown as Record<string, unknown>) : {};

  return {
    foodId,
    foodName: str(raw.foodName, 120),
    verdict: raw.verdict,
    // 중복을 걷어 낸다. 같은 지표를 여러 번 넣어 건수를 부풀리지 못하게.
    axes: Array.isArray(raw.axes) ? [...new Set(raw.axes.filter(isAxisKey))] : [],
    note: str(raw.note, NOTE_MAX).trim(),
    shown: {
      spicy: typeof shownRaw.spicy === "number" ? shownRaw.spicy : -1,
      hasSoup: shownRaw.hasSoup === true,
      isRaw: shownRaw.isRaw === true,
      mainIngredients: Array.isArray(shownRaw.mainIngredients)
        ? shownRaw.mainIngredients.filter((v): v is string => typeof v === "string").slice(0, 4)
        : [],
      confidence: typeof shownRaw.confidence === "number" ? shownRaw.confidence : -1,
    },
  };
}

export async function POST(request: Request): Promise<Response> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return new Response(null, { status: 413 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(null, { status: 400 });
  }

  const payload = parse(body);
  if (!payload) return new Response(null, { status: 400 });

  const result = await storeFeedback(payload);
  // 넣지 못했으면 넣은 척하지 않는다. 화면이 "지금은 보내지 못했다"고 말하고
  // 다음 방문에 다시 보낼 수 있게, 실패를 실패로 돌려준다.
  if (!result.ok) return new Response(null, { status: 503 });

  // 돌려줄 것이 없다. 화면은 닿았는지 여부만 알면 된다.
  return new Response(null, { status: 204 });
}
