"""룰 엔진이 자신 없어 한 메뉴만 Claude로 재평가한다.

전체를 LLM에 태우지 않는 이유는 비용이 아니라 재현성이다. 룰이 조리법과
재료를 모두 짚은 행(신뢰도 0.85)은 근거가 분명하고 설명 가능하므로 그대로 둔다.
근거가 부족한 행만 LLM 판단으로 덮어쓰고, 그 사실을 source 컬럼에 남긴다.

입력 : data/processed/review/taste_low_confidence.csv (build_taste_profile.py 산출)
출력 : data/processed/review/taste_llm_override.csv
        → build_taste_profile.py를 다시 돌리면 이 파일이 최종 결과에 반영된다.

API 키가 없으면 아무것도 하지 않고 종료한다. 파이프라인은 룰 결과만으로도
끝까지 동작해야 하기 때문이다.

실행: python -m src.taste.llm_refine [--limit N] [--dry-run]
"""

from __future__ import annotations

import argparse
import csv
import json
import sys

from src.config import ANTHROPIC_API_KEY, DATA_REVIEW_DIR
from src.taste.rules import AXES

LOW_CONF = DATA_REVIEW_DIR / "taste_low_confidence.csv"
OVERRIDE = DATA_REVIEW_DIR / "taste_llm_override.csv"

MODEL = "claude-opus-5"
BATCH_SIZE = 20

FIELDS = ["menu_key", "menu_name", "ingredient", *AXES, "course", "llm_reason"]

# 축 정의는 rules.py와 한 글자도 어긋나면 안 된다. 룰 점수와 LLM 점수가 같은
# 표에 섞여 들어가므로, 두 채점자가 다른 자를 쓰면 그 표는 못 쓴다.
SYSTEM_PROMPT = """당신은 한국 남도 음식(광주·전남)에 정통한 미식 평가자입니다.
메뉴명과 주재료를 보고 다섯 가지 맛 특성을 1~5점으로 평가합니다.

축 정의 (반드시 이 기준만 사용):
- spicy(맵기): 1 전혀 안 매움 / 3 살짝 칼칼함 / 5 아주 매움
- salty(짠맛): 1 심심함 / 3 보통 간 / 5 아주 짬 (젓갈·장류 수준)
- soup(국물): 1 국물 없음 / 3 자작함 / 5 국물이 주인공(탕·전골)
- texture(식감): 1 아주 부드러움(순두부·죽) / 3 보통 / 5 아주 쫄깃·단단함(산낙지·전복)
- aroma(향신료·향): 1 향이 순함(우유·쌀밥) / 3 보통 / 5 향이 아주 강함(홍어·청국장)

판단 원칙:
- 조리법이 국물감과 짠맛을 지배하고, 주재료가 식감과 향을 지배합니다.
- 음료·디저트는 spicy=1, salty=1, soup=1로 고정하고 texture와 aroma만 판단합니다.
- 지역 특성을 반영하세요. 남도 음식은 간이 세고 젓갈·삭힌 재료를 자주 씁니다.
- 애매하면 중앙값 3이 아니라, 그 음식을 처음 먹는 사람이 받을 인상을 택하세요.

course는 "식사", "디저트", "음료" 중 하나입니다.
reason은 한 문장으로, 점수를 가른 결정적 근거만 적습니다."""

RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "menu_key": {"type": "string"},
                    "spicy": {"type": "integer", "enum": [1, 2, 3, 4, 5]},
                    "salty": {"type": "integer", "enum": [1, 2, 3, 4, 5]},
                    "soup": {"type": "integer", "enum": [1, 2, 3, 4, 5]},
                    "texture": {"type": "integer", "enum": [1, 2, 3, 4, 5]},
                    "aroma": {"type": "integer", "enum": [1, 2, 3, 4, 5]},
                    "course": {"type": "string", "enum": ["식사", "디저트", "음료"]},
                    "reason": {"type": "string"},
                },
                "required": ["menu_key", *AXES, "course", "reason"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["items"],
    "additionalProperties": False,
}


def _load_targets(limit: int | None) -> list[dict]:
    if not LOW_CONF.exists():
        raise SystemExit(
            f"{LOW_CONF} 가 없습니다. 먼저 python -m src.taste.build_taste_profile 을 실행하세요."
        )
    with LOW_CONF.open(encoding="utf-8-sig", newline="") as fh:
        rows = list(csv.DictReader(fh))
    return rows[:limit] if limit else rows


def _batch_prompt(batch: list[dict]) -> str:
    lines = ["다음 메뉴들을 평가하세요. menu_key는 그대로 돌려주세요.\n"]
    for row in batch:
        ingredient = row.get("ingredient") or "미상"
        lines.append(
            f"- menu_key: {row['menu_key']}\n"
            f"  메뉴명: {row['menu_name']}\n"
            f"  제철 재료: {ingredient}"
        )
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=None, help="앞에서 N건만 처리")
    parser.add_argument("--dry-run", action="store_true", help="호출 없이 대상만 출력")
    args = parser.parse_args()

    targets = _load_targets(args.limit)
    print(f"재평가 대상: {len(targets)}건")

    if args.dry_run:
        for row in targets[:10]:
            print(f"  {row['menu_name']}  (재료: {row['ingredient'] or '-'})")
        if len(targets) > 10:
            print(f"  ... 외 {len(targets) - 10}건")
        return

    if not ANTHROPIC_API_KEY:
        print(
            "ANTHROPIC_API_KEY가 없어 LLM 보정을 건너뜁니다.\n"
            "룰 엔진 결과만으로도 파이프라인은 정상 동작합니다.\n"
            ".env에 ANTHROPIC_API_KEY를 넣고 다시 실행하면 저신뢰 행이 보정됩니다."
        )
        return

    try:
        import anthropic
    except ImportError:
        raise SystemExit("pip install anthropic 이 필요합니다.")

    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    results: list[dict] = []

    for start in range(0, len(targets), BATCH_SIZE):
        batch = targets[start : start + BATCH_SIZE]
        print(f"  배치 {start // BATCH_SIZE + 1}: {len(batch)}건 평가 중...")

        try:
            response = client.messages.create(
                model=MODEL,
                max_tokens=8000,
                # 축 정의는 배치마다 동일하므로 캐시해 두면 두 번째 배치부터 값이 싸다.
                system=[{
                    "type": "text",
                    "text": SYSTEM_PROMPT,
                    "cache_control": {"type": "ephemeral"},
                }],
                output_config={
                    "effort": "medium",
                    "format": {"type": "json_schema", "schema": RESPONSE_SCHEMA},
                },
                messages=[{"role": "user", "content": _batch_prompt(batch)}],
            )
        except anthropic.RateLimitError:
            print("    레이트 리밋 — 이 배치를 건너뜁니다. 나중에 다시 실행하세요.")
            continue
        except anthropic.APIStatusError as exc:
            print(f"    API 오류({exc.status_code}) — 이 배치를 건너뜁니다.")
            continue

        if response.stop_reason == "refusal":
            print("    모델이 응답을 거부했습니다. 이 배치를 건너뜁니다.")
            continue

        text = next((b.text for b in response.content if b.type == "text"), "")
        if not text:
            print("    빈 응답 — 건너뜁니다.")
            continue

        payload = json.loads(text)
        by_key = {row["menu_key"]: row for row in batch}
        for item in payload["items"]:
            source = by_key.get(item["menu_key"])
            if source is None:
                # 모델이 menu_key를 지어냈다면 매칭할 원본이 없으므로 버린다.
                continue
            results.append({
                "menu_key": item["menu_key"],
                "menu_name": source["menu_name"],
                "ingredient": source["ingredient"],
                **{axis: item[axis] for axis in AXES},
                "course": item["course"],
                "llm_reason": item["reason"],
            })

    if not results:
        print("보정된 행이 없습니다.")
        return

    OVERRIDE.parent.mkdir(parents=True, exist_ok=True)
    with OVERRIDE.open("w", encoding="utf-8-sig", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(results)

    print(f"\n{len(results)}건 보정 완료 → {OVERRIDE}")
    print("이제 python -m src.taste.build_taste_profile 을 다시 실행하면 최종 표에 반영됩니다.")


if __name__ == "__main__":
    main()
