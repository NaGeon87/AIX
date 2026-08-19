"""새 기준으로 매긴 주재료·맵기 라벨을 사람이 검수할 자료로 뽑는다.

판정 자체는 하지 않는다. rules.py의 resolve_ingredients / resolve_spicy를
그대로 불러 쓰고, 여기서는 "어느 건을 사람이 다시 봐야 하는가"만 정한다.
기준을 고칠 일이 있으면 rules.py를 고쳐야 한다.

맵기 기준
    0 전혀 안 매움
    1 양념이 들어가긴 하나 매운맛이 주요맛이 아님
    2 매운 양념이 음식의 주요맛
    3 강한 매운맛을 특징으로 하는 음식

판정 근거는 메뉴명(menu_norm)뿐이다. 이름에 없는 사실은 확신하지 않고
confidence를 낮춘 뒤 needs_review로 넘긴다.

실행: python -m src.taste.relabel_review
"""

from __future__ import annotations

import csv
import json
from collections import Counter

from src.config import DATA_PROCESSED_DIR, DATA_REVIEW_DIR
from src.taste.rules import SET_TOKENS, SPICY_EXCEPTIONS, resolve_ingredients, resolve_spicy

PROFILE = DATA_PROCESSED_DIR / "menu_taste_profile.csv"
OUTPUT = DATA_REVIEW_DIR / "taste_relabel_review.json"


# --------------------------------------------------------------------------
# 검수 대상 — 이름이 잘렸거나, 구성을 이름만으로 알 수 없는 것들
# --------------------------------------------------------------------------

TRUNCATED = {
    "갈치)|갈치": "이름이 '갈치)'에서 잘렸다",
    "조림|병어": "원본이 '조림(병어'에서 잘렸다",
    "추가메뉴|소고기": "원본이 '추가메뉴(소고기샤브'에서 잘렸다",
    "해양치유밥상|전복": "원본이 '해양치유밥상(전복해조류떡갈비'에서 잘렸다",
}

COMPOSITION_UNKNOWN = {
    "상추 튀김|상추": "무엇을 튀겼는지 이름에 없다. 광주 상추튀김은 통상 오징어튀김이지만 이름만으로는 단정할 수 없다",
    "홍어일품상|홍어": "'일품상'의 구성이 이름에 없다. 삼합 여부를 단정할 수 없다",
    "우리밀 초계국수|우리밀": "초계는 닭 육수를 뜻하나 재료가 이름에 없다",
    "고추장구이|고추": "무엇을 구웠는지 이름에 없다. 고추장은 양념이라 재료 근거가 아니다",
    "오징어육개장|오징어": "소고기가 함께 들어가는지 이름만으로 알 수 없다",
    "죽순게장 한우정식|죽순": "죽순·게장·한우 세 계열이 한 상에 나온다. 대표를 하나로 정하기 어렵다",
    "리코타치즈샐러드|리코타치즈": "유제품이 주재료인데 허용 라벨(해산물·육류·채소)에 해당이 없다",
    "죽순바삭만두|죽순": "만두소 구성이 이름에 없다",
    "주꾸미대하|주꾸미": "조리법이 이름에 없다",
    "주꾸미대하|대하": "조리법이 이름에 없다",
    "아귀대창|아귀": "조리법이 이름에 없다",
}

# 조리법이 이름에 없어도 0이 확실한 것들 — 검수 대상에서 뺀다.
ZERO_IS_OBVIOUS = (
    "삶은", "생두부", "모두부", "색동두부", "도토리묵", "쌀밥", "바질토마토",
    "참꼬막", "통꼬막", "해삼멍게", "꽃게살", "매생이", "톳밥", "기절낙지",
    "산낙지", "세발낙지", "생굴", "대방어", "삼합",
)


# --------------------------------------------------------------------------
# 신뢰도와 검수 대상
# --------------------------------------------------------------------------

ING_CONFIDENCE = {
    "대표 1개": 0.85,
    "복수 유지": 0.80,
    "곁재료 승격": 0.70,
    "예외": 0.70,
    "근거 없음": 0.30,
}

_SEPARATORS = (",", "/", "+", "&")


def collect_review_notes(row: dict, menu_norm: str, ing: dict, spicy: dict) -> list[str]:
    """왜 사람이 다시 봐야 하는지를 모은다. 비어 있으면 검수 대상이 아니다."""
    notes = []
    key = row["menu_key"]
    if key in TRUNCATED:
        notes.append(TRUNCATED[key])
    if key in COMPOSITION_UNKNOWN:
        notes.append(COMPOSITION_UNKNOWN[key])
    if any(sep in menu_norm for sep in _SEPARATORS):
        notes.append("한 항목에 여러 메뉴가 묶여 있어 대표 메뉴를 고를 수 없다")
    if not ing["labels"]:
        notes.append("주재료 라벨을 붙일 근거가 없다")
    if spicy["matched"] is None and not any(k in menu_norm for k in ZERO_IS_OBVIOUS):
        notes.append("조리법이 이름에 없어 맵기를 기본값 0으로 두었다")
    return notes


def spicy_confidence(matched: str | None) -> float:
    if matched is None:
        return 0.40
    if matched in SET_TOKENS:
        return 0.60
    if matched in ("디저트", "음료"):
        return 0.90
    if matched in SPICY_EXCEPTIONS:
        return 0.70
    return 0.85


def main() -> None:
    with PROFILE.open(encoding="utf-8-sig", newline="") as fh:
        rows = list(csv.DictReader(fh))

    items = []
    before = []   # (주재료 라벨, 맵기) — 분포 비교에만 쓴다
    changed = []  # (주재료 바뀜, 맵기 바뀜)
    for row in rows:
        menu_norm = row["menu_norm"]
        course = row["course"]
        before_ing = [c for c in row["main_ingredients"].split(";") if c]
        before_spicy = int(row["spicy"])
        before.append((before_ing, before_spicy))

        ing = resolve_ingredients(row["menu_key"], menu_norm, row["ingredient"])
        spicy = resolve_spicy(menu_norm, course)
        notes = collect_review_notes(row, menu_norm, ing, spicy)
        needs_review = bool(notes)

        ing_conf = ING_CONFIDENCE[ing["basis"]]
        spicy_conf = spicy_confidence(spicy["matched"])
        if needs_review:
            ing_conf = min(ing_conf, 0.50)
            spicy_conf = min(spicy_conf, 0.60)

        # before는 항목마다 싣지 않는다. 원본은 menu_taste_profile.csv에 그대로
        # 있고, 검수자가 판단할 것은 '무엇에서 바뀌었나'가 아니라 '이 라벨이
        # 맞나'다. 바뀐 폭은 아래 summary의 분포로만 남긴다.
        changed.append((before_ing != ing["labels"], before_spicy != spicy["level"]))
        items.append({
            "menu_key": row["menu_key"],
            "menu_name": row["menu_name"],
            "course": course,
            "main_ingredients": {
                "labels": ing["labels"],
                "basis": ing["basis"],
                "confidence": round(ing_conf, 2),
                "reason": ing["reason"],
            },
            "spicy": {
                "level": spicy["level"],
                "matched": spicy["matched"],
                "confidence": round(spicy_conf, 2),
                "reason": spicy["reason"],
            },
            "needs_review": needs_review,
            "review_notes": notes,
        })

    def dist(values) -> dict:
        return dict(sorted(Counter(values).items(), key=lambda kv: str(kv[0])))

    def label_key(labels: list[str]) -> str:
        return ";".join(labels) or "(없음)"

    meals = [n for n, i in enumerate(items) if i["course"] == "식사"]
    payload = {
        "generated_from": PROFILE.name,
        "criteria": {
            "main_ingredients": [
                "허용 라벨은 해산물·육류·채소 세 가지뿐이다",
                "대표 주재료는 기본 1개만 고른다",
                "양념·곁재료·부재료는 음식 정체성의 핵심이 아니면 라벨로 세지 않는다",
                "두 재료군이 메뉴명과 실제 구성에서 모두 핵심일 때만 복수 라벨을 남긴다",
                "조리법 단어를 재료로 세지 않는다 (탕수육·수육의 '육', 죽순회의 '회')",
                "이름에 없는 사실은 확신하지 않는다. 불확실하면 confidence를 낮추고 needs_review로 넘긴다",
            ],
            "spicy": {
                "0": "전혀 안 매움",
                "1": "양념이 들어가긴 하나 매운맛이 주요맛이 아님",
                "2": "매운 양념이 음식의 주요맛",
                "3": "강한 매운맛을 특징으로 하는 음식",
            },
        },
        "summary": {
            "menu_count": len(items),
            "meal_count": len(meals),
            "needs_review": sum(1 for i in items if i["needs_review"]),
            "main_ingredients": {
                "before": dist(label_key(b[0]) for b in before),
                "after": dist(label_key(i["main_ingredients"]["labels"]) for i in items),
                "multi_before": sum(1 for b in before if len(b[0]) > 1),
                "multi_after": sum(1 for i in items if len(i["main_ingredients"]["labels"]) > 1),
                "changed": sum(1 for c in changed if c[0]),
            },
            "spicy": {
                "before": dist(b[1] for b in before),
                "after": dist(i["spicy"]["level"] for i in items),
                "meal_before": dist(before[n][1] for n in meals),
                "meal_after": dist(items[n]["spicy"]["level"] for n in meals),
                "changed": sum(1 for c in changed if c[1]),
            },
        },
        "items": items,
    }

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    s = payload["summary"]
    print(f"메뉴 {s['menu_count']}건 (식사 {s['meal_count']}건), 검수 필요 {s['needs_review']}건")
    print("주재료 복수 라벨:", s["main_ingredients"]["multi_before"], "->", s["main_ingredients"]["multi_after"])
    print("주재료 분포 after:", s["main_ingredients"]["after"])
    print("맵기 전체 before:", s["spicy"]["before"])
    print("맵기 전체 after :", s["spicy"]["after"])
    print("맵기 식사 before:", s["spicy"]["meal_before"])
    print("맵기 식사 after :", s["spicy"]["meal_after"])
    print("저장:", OUTPUT)


if __name__ == "__main__":
    main()
