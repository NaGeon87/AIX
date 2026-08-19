"use client";

import { useEffect, useId, useState, useSyncExternalStore } from "react";

import {
  NOTE_MAX,
  clearFeedback,
  feedbackSnapshot,
  saveFeedback,
  sendFeedback,
  serverFeedbackSnapshot,
  subscribeFeedback,
  toPayload,
  type AccuracyFeedback as Saved,
  type AccuracyVerdict,
} from "@/lib/feedback";
import type { AxisKey, AxisScore, NearbyCandidate } from "@/lib/recommend";

/**
 * 이번 세션에 재전송을 이미 시도한 음식. 개발 모드의 이펙트 두 번 실행과
 * 카드가 다시 마운트될 때의 중복 전송을 막는다.
 */
const retried = new Set<string>();

/**
 * "이 정보가 실제와 다른가요?" — 설명 패널 맨 아래에서 지표의 진위를 묻는다.
 *
 * 맵기·국물·날것·주재료는 메뉴명에서 추정한 값이 섞여 있다. 화면은 근거가
 * 약하다는 것까지만 말할 수 있고, 어느 지표가 틀렸는지는 그 음식을 아는
 * 사람만 안다. 그래서 "틀렸다"는 답만 받지 않고 어느 지표인지까지 받는다 —
 * 지표를 모르면 고칠 곳도 모른다.
 *
 * 지표 목록은 explainMatch가 만든 축을 그대로 쓴다. 여기서 따로 네 가지를
 * 나열해 두면 배점이나 지표가 바뀔 때 이 화면만 조용히 옛것으로 남는다.
 */
export function AccuracyFeedback({
  candidate,
  axes,
}: {
  candidate: NearbyCandidate;
  /** 설명 패널이 이미 만든 축. 라벨과 "이 음식의 값"을 여기서 가져온다. */
  axes: AxisScore[];
}) {
  const [picking, setPicking] = useState(false);
  const [checked, setChecked] = useState<AxisKey[]>([]);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const formId = useId();

  // 저장된 답은 리액트 상태가 아니라 localStorage에 있다. useSyncExternalStore로
  // 읽으면 서버가 그린 "아직 안 물어봄" 화면과 어긋나지 않으면서, 다른 탭에서
  // 답한 것까지 그대로 비친다.
  const saved = useSyncExternalStore(
    subscribeFeedback,
    () => feedbackSnapshot(candidate.id),
    serverFeedbackSnapshot,
  );

  // 지난번에 서버까지 닿지 못한 답을 조용히 한 번 더 보낸다. 성공하면
  // saveFeedback이 저장소를 갱신하고, 그 알림으로 화면이 다시 그려진다.
  useEffect(() => {
    const previous = feedbackSnapshot(candidate.id);
    if (!previous || previous.delivered || retried.has(candidate.id)) return;
    retried.add(candidate.id);

    void sendFeedback(
      toPayload(candidate, previous.verdict, previous.axes, previous.note),
    ).then((ok) => {
      if (ok) saveFeedback(candidate.id, { ...previous, delivered: true });
    });
    // 부모가 후보 배열을 새로 만들 때마다 재전송이 돌지 않도록 id만 본다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidate.id]);

  async function submit(verdict: AccuracyVerdict, picked: AxisKey[], text: string) {
    setSending(true);
    const delivered = await sendFeedback(toPayload(candidate, verdict, picked, text));
    const record: Saved = {
      verdict,
      axes: picked,
      note: text.trim().slice(0, NOTE_MAX),
      at: new Date().toISOString(),
      delivered,
    };
    if (!delivered) retried.add(candidate.id); // 방금 실패했다. 이 화면에서 또 시도하지 않는다.
    saveFeedback(candidate.id, record);
    setPicking(false);
    setSending(false);
  }

  function reset() {
    retried.delete(candidate.id);
    clearFeedback(candidate.id);
    setPicking(false);
    setChecked([]);
    setNote("");
  }

  if (saved) {
    return (
      <div className="mt-3 border-t border-line pt-2.5">
        <p className="text-[12px] leading-relaxed text-fg-muted" role="status">
          <span className="font-bold text-accent">
            {saved.verdict === "same" ? "맞다고 알려 주셨습니다." : "다르다고 알려 주셨습니다."}
          </span>{" "}
          {saved.delivered
            ? "지표를 손볼 때 함께 봅니다."
            : "지금은 보내지 못해 이 기기에만 남겨 두었습니다. 다음에 다시 보내 볼게요."}
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-1 cursor-pointer text-[11.5px] font-bold text-fg-muted underline hover:text-brand"
        >
          다시 답하기
        </button>
      </div>
    );
  }

  return (
    <div className="mt-3 border-t border-line pt-2.5">
      <p className="text-[12px] font-bold text-fg">이 정보가 실제와 다른가요?</p>
      <p className="mt-0.5 text-[11.5px] leading-relaxed text-fg-muted">
        맵기·국물·날것·주재료는 메뉴명에서 추정한 값이 섞여 있습니다. 드셔 보셨다면 알려
        주세요.
      </p>

      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={() => setPicking((v) => !v)}
          aria-expanded={picking}
          aria-controls={formId}
          disabled={sending}
          className={`cursor-pointer rounded-full border px-3.5 py-1.5 text-[12.5px] font-bold transition-colors disabled:cursor-wait disabled:opacity-60 ${
            picking
              ? "border-brand bg-brand-soft text-brand"
              : "border-line-strong bg-surface text-fg hover:border-brand hover:text-brand"
          }`}
        >
          예, 달라요
        </button>
        <button
          type="button"
          onClick={() => void submit("same", [], "")}
          disabled={sending}
          className="cursor-pointer rounded-full border border-line-strong bg-surface px-3.5 py-1.5 text-[12.5px] font-bold text-fg transition-colors hover:border-accent hover:text-accent disabled:cursor-wait disabled:opacity-60"
        >
          아니요, 맞아요
        </button>
      </div>

      {picking && (
        <div id={formId} className="mt-2.5 rounded-xl border border-line bg-surface px-3 py-3">
          <fieldset>
            <legend className="text-[11.5px] font-bold text-fg-muted">
              어느 지표가 다른가요? (여러 개 고를 수 있습니다)
            </legend>
            <ul className="mt-1.5 space-y-1.5">
              {axes.map((axis) => (
                <li key={axis.key}>
                  <label className="flex cursor-pointer items-baseline gap-2 text-[12.5px] text-fg">
                    <input
                      type="checkbox"
                      checked={checked.includes(axis.key)}
                      onChange={(event) =>
                        setChecked((prev) =>
                          event.target.checked
                            ? [...prev, axis.key]
                            : prev.filter((k) => k !== axis.key),
                        )
                      }
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 cursor-pointer accent-[var(--color-brand)]"
                    />
                    <span>
                      <b className="font-bold">{axis.label}</b>{" "}
                      <span className="text-fg-muted">— 지금은 “{axis.it}”로 보고 있습니다</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>

          <label className="mt-2.5 block">
            <span className="text-[11.5px] font-bold text-fg-muted">
              맞는 값을 아시면 적어 주세요 (선택)
            </span>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value.slice(0, NOTE_MAX))}
              rows={2}
              maxLength={NOTE_MAX}
              placeholder="예: 국물 없이 무침으로 나옵니다"
              className="mt-1 w-full resize-y rounded-lg border border-line bg-surface-alt px-2.5 py-2 text-[12.5px] text-fg outline-none placeholder:text-fg-muted/70 focus:border-accent"
            />
            <span className="mt-0.5 block text-right text-[10.5px] text-fg-muted">
              {note.length}/{NOTE_MAX}
            </span>
          </label>

          <div className="mt-1.5 flex items-center gap-2">
            <button
              type="button"
              onClick={() => void submit("different", checked, note)}
              // 어느 지표인지도 무엇이 맞는지도 없으면 받아도 고칠 수가 없다.
              disabled={sending || (checked.length === 0 && note.trim() === "")}
              className="cursor-pointer rounded-full bg-brand px-4 py-1.5 text-[12.5px] font-bold text-fg-inverse transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {sending ? "보내는 중…" : "보내기"}
            </button>
            <button
              type="button"
              onClick={() => setPicking(false)}
              disabled={sending}
              className="cursor-pointer text-[12px] text-fg-muted hover:text-fg disabled:opacity-60"
            >
              취소
            </button>
          </div>

          {checked.length === 0 && note.trim() === "" && (
            <p className="mt-1.5 text-[11px] text-fg-muted">
              지표를 고르거나 맞는 값을 적어 주셔야 보낼 수 있습니다.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
