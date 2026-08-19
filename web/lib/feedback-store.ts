import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { FeedbackPayload } from "./feedback";

/**
 * 지표 정확도 피드백이 실제로 쌓이는 자리.
 *
 * 서버에서만 부른다 — app/api/feedback/route.ts 하나가 유일한 호출자다.
 * 클라이언트 번들에 들여오지 말 것.
 *
 * Supabase가 설정되어 있으면 테이블에 넣고, 없으면 로그로 흘린다. 키가
 * 없다고 화면이 막히지는 않게 한다 — 로컬에서 UI만 만질 때 Supabase까지
 * 띄우게 하면 아무도 안 띄운다. 대신 어디에 넣었는지는 정직하게 돌려준다.
 *
 * 테이블 정의는 supabase/migrations/0001_accuracy_feedback.sql에 있다.
 */

const TABLE = "accuracy_feedback";

function env(...keys: string[]): string {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return "";
}

// undefined는 "아직 안 봤다", null은 "보니 설정이 없다". 매 요청마다
// createClient를 새로 부르지 않으려고 결과를 잡아 둔다.
let client: SupabaseClient | null | undefined;

function getClient(): SupabaseClient | null {
  if (client !== undefined) return client;

  const url = env("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL");
  // anon 키를 쓴다. 이 테이블은 RLS로 insert만 열려 있어서 이 키로 할 수 있는
  // 일이 "피드백 한 줄 넣기"뿐이다. service_role 키는 RLS를 통째로 지나치므로
  // 새어 나가면 프로젝트 전체가 열린다 — 넣기만 하는 데 쓸 이유가 없다.
  const key = env("SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY");

  client =
    url && key
      ? createClient(url, key, {
          // 서버에는 로그인한 사람이 없다. 세션을 붙들면 요청끼리 섞인다.
          auth: { persistSession: false, autoRefreshToken: false },
        })
      : null;

  return client;
}

export type FeedbackSink = "supabase" | "log";

export interface StoreResult {
  ok: boolean;
  sink: FeedbackSink;
}

export async function storeFeedback(payload: FeedbackPayload): Promise<StoreResult> {
  const supabase = getClient();

  if (!supabase) {
    // 설정이 없을 때의 자리. 배포 런타임 로그에 한 줄로 남는다.
    console.log(
      `[accuracy-feedback] ${JSON.stringify({ at: new Date().toISOString(), ...payload })}`,
    );
    return { ok: true, sink: "log" };
  }

  const { error } = await supabase.from(TABLE).insert({
    food_id: payload.foodId,
    food_name: payload.foodName,
    verdict: payload.verdict,
    axes: payload.axes,
    note: payload.note,
    shown: payload.shown,
  });

  if (error) {
    // 답 자체는 화면이 기기에 들고 있다가 다음 방문에 다시 보낸다. 여기서는
    // 왜 실패했는지만 남긴다 — 답까지 로그로 흘리면 나중에 테이블과 로그
    // 양쪽을 훑어야 하고, 재전송이 성공하면 같은 답이 두 군데 남는다.
    console.error(`[accuracy-feedback] insert 실패: ${error.message}`);
    return { ok: false, sink: "supabase" };
  }

  return { ok: true, sink: "supabase" };
}
