"""룰 엔진이 자신 없어 한 메뉴를 사람이 직접 매긴 표.

build_taste_profile.py는 이 표가 만든 override 파일이 있으면 자동으로 반영한다.

왜 코드로 두는가: CSV만 남기면 어떤 기준으로 매겼는지 6개월 뒤에 알 수 없다.
근거를 reason에 붙여 두면 나중에 누구든 틀린 곳을 짚어 고칠 수 있다.

지표 기준은 rules.py와 동일하다.
  spicy 0 안 매움 / 1 약간 / 2 매움 / 3 아주 매움
  soup  국물 요리인가        raw 날것으로 먹는가
  cats  해산물 | 육류 | 채소 — 대표 하나, 맞부딪히면 둘

실행: python -m src.taste.manual_labels
"""

from __future__ import annotations

import csv

from src.config import DATA_PROCESSED_DIR, DATA_REVIEW_DIR
from src.taste.rules import CATEGORIES, SEAFOOD, MEAT, VEGGIE

# 저신뢰 목록이 아니라 전체 프로파일을 기준으로 삼는다. 저신뢰 목록은 보정이
# 반영되면 비어 버려서, 그걸 입력으로 쓰면 두 번째 실행에 라벨이 통째로 날아간다.
PROFILE = DATA_PROCESSED_DIR / "menu_taste_profile.csv"
OVERRIDE = DATA_REVIEW_DIR / "taste_llm_override.csv"

FIELDS = [
    "menu_key", "menu_name", "ingredient",
    "spicy", "has_soup", "is_raw", "main_ingredients",
    "course", "source", "reason",
]

S, M, V = SEAFOOD, MEAT, VEGGIE

# (menu_key, 맵기, 국물, 날것, 주재료, 코스, 근거)
MANUAL_LABELS: list[tuple[str, int, bool, bool, list[str], str, str]] = [
    # --- 재료명뿐이라 조리법을 알 수 없는 항목 ---
    # '갈치)|갈치'와 '추가메뉴|소고기'가 여기 있었다. 둘 다 수집기가 취급메뉴를
    # 쉼표로 자를 때 괄호를 무시해 생긴 조각이었고, 원본을 되붙여 없앴다.
    ("소고기|소고기", 0, False, False, [M], "식사", "조리법 정보 없음. 구이 기준"),

    # --- 낙지: 남도에서 생물로 먹는 것과 익혀 먹는 것이 갈린다 ---
    ("낙지|낙지", 0, False, False, [S], "식사", "조리법 미상. 익혀 먹는 쪽을 기본으로 둔다"),
    ("산낙지|낙지", 0, False, True, [S], "식사", "살아있는 채로 먹는다"),
    ("산낙지다짐|낙지", 0, False, True, [S], "식사", "생낙지를 다져 낸 것"),
    ("세발낙지|낙지", 0, False, True, [S], "식사", "무안 세발낙지는 통째로 생으로 먹는다"),
    ("기절낙지|낙지", 0, False, True, [S], "식사", "살짝 데쳐 기절시킨 생물"),
    ("낙지호롱|낙지", 1, False, False, [S], "식사", "짚에 말아 구운 것. 익힌 요리"),
    ("낙지 호롱이|낙지", 1, False, False, [S], "식사", "짚에 말아 구운 것. 익힌 요리"),
    ("낙지코스|낙지", 1, True, True, [S], "식사", "산낙지·연포탕이 함께 나오는 코스"),

    # --- 조개·갑각류 ---
    ("꽃게|꽃게", 0, False, False, [S], "식사", "찐 꽃게 기준"),
    ("꽃게살|꽃게", 0, False, False, [S], "식사", "발라낸 살"),
    ("삶은 꼬막|꼬막", 0, False, False, [S], "식사", "데친 꼬막"),
    ("참꼬막|꼬막", 0, False, False, [S], "식사", "삶아서 낸다"),
    ("통꼬막|꼬막", 0, False, False, [S], "식사", "껍질째 삶아 낸다"),
    ("양념꼬막|꼬막", 2, False, False, [S], "식사", "고춧가루 양념장을 얹는다"),
    ("주꾸미대하|주꾸미", 2, False, False, [S], "식사", "매콤한 볶음·구이로 낸다"),
    ("주꾸미대하|대하", 2, False, False, [S], "식사", "매콤한 볶음·구이로 낸다"),
    ("생굴|굴", 0, False, True, [S], "식사", "날굴"),
    ("해삼멍게|멍게", 0, False, True, [S], "식사", "둘 다 날것"),

    # --- 생선 ---
    ("농어|농어", 0, False, True, [S], "식사", "남도에서는 농어회로 먹는 쪽이 대표적"),
    ("도다리|도다리", 0, True, False, [S], "식사", "봄 도다리쑥국이 대표. 국물 요리로 본다"),
    ("병어|병어", 1, False, False, [S], "식사", "병어조림·찜이 대표"),
    ("민어|민어", 0, True, False, [S], "식사", "여름 민어탕이 대표"),
    ("민어코스요리|민어", 0, True, True, [S], "식사", "회와 탕이 함께 나오는 코스"),
    ("삼치|삼치", 0, False, True, [S], "식사", "남도 삼치회가 명물"),
    ("삼치코스|삼치", 0, False, True, [S], "식사", "삼치회 중심 코스"),
    ("대방어|방어", 0, False, True, [S], "식사", "겨울 방어회"),
    ("마른우럭|우럭", 0, False, False, [S], "식사", "말려서 찌거나 국으로 낸다"),
    ("묵은지고등어|고등어", 2, False, False, [S, V], "식사", "묵은지와 함께 조린다"),
    ("홍어|홍어", 0, False, True, [S], "식사", "삭힌 생물"),
    ("흑산홍어|홍어", 0, False, True, [S], "식사", "삭힌 생물"),
    ("홍어삼합|홍어", 0, False, True, [S, M], "식사", "홍어에 돼지수육이 함께 난다"),
    ("홍어일품상|홍어", 1, False, True, [S, M], "식사", "홍어 한상. 삼합·무침이 함께"),
    ("아귀대창|아귀", 2, False, False, [S, M], "식사", "아귀와 대창을 함께 매콤하게"),

    # --- 두부·순두부: 순두부는 전부 국물 요리다 ---
    ("생두부|두부", 0, False, False, [V], "식사", "간을 하지 않은 두부"),
    ("미니모두부|두부", 0, False, False, [V], "식사", "모두부"),
    ("색동두부|두부", 0, False, False, [V], "식사", "색을 낸 두부. 맛은 순하다"),
    ("두부김치|두부", 1, False, False, [V], "식사", "볶은 김치를 곁들인다"),
    ("모듬순두부|두부", 1, True, False, [V], "식사", "순두부찌개. 국물이 있다"),
    ("목살 김치 순두부|두부", 2, True, False, [M, V], "식사", "김치 순두부찌개. 목살이 들어간다"),
    ("바지락순두부|두부", 1, True, False, [S, V], "식사", "바지락 육수 순두부찌개"),
    ("바지락순두부|바지락", 1, True, False, [S, V], "식사", "바지락 육수 순두부찌개"),
    ("버섯순두부|두부", 1, True, False, [V], "식사", "버섯 순두부찌개"),
    ("소고기순두부|두부", 2, True, False, [M, V], "식사", "소고기 순두부찌개. 보통 얼큰하다"),
    ("소고기순두부|소고기", 2, True, False, [M, V], "식사", "소고기 순두부찌개. 보통 얼큰하다"),
    ("차돌순두부|두부", 2, True, False, [M, V], "식사", "차돌 순두부찌개"),
    ("해물순두부|두부", 2, True, False, [S, V], "식사", "해물 순두부찌개. 얼큰하다"),
    ("하얀 해물순두부|두부", 0, True, False, [S, V], "식사", "고춧가루를 넣지 않은 맑은 순두부"),

    # --- 채소·산채 ---
    ("도토리묵|도토리", 0, False, False, [V], "식사", "양념 없는 묵"),
    ("도토리묵잡채|도토리", 1, False, False, [V], "식사", "채소와 함께 무친다"),
    ("고추잡채|고추", 2, False, False, [V], "식사", "고추·피망을 볶아 맵다"),
    ("능이버섯만두|버섯만두", 0, False, False, [V], "식사", "찐만두. 능이 향이 강하다"),
    ("바질토마토|토마토", 0, False, False, [V], "식사", "생채소 조합이지만 날생선류는 아니다"),
    ("표고버섯 메밀 골동면|메밀", 1, False, False, [V], "식사", "골동면은 비빔면이라 국물이 없다"),
    ("표고버섯 메밀 골동면|표고버섯", 1, False, False, [V], "식사", "골동면은 비빔면이라 국물이 없다"),
    ("메밀비빔면|메밀", 2, False, False, [V], "식사", "고추장 비빔"),
    ("상추 튀김|상추", 1, False, False, [S, V], "식사", "광주 상추튀김. 오징어튀김을 상추에 싸 먹는다"),
    ("쌀치즈떡 떡볶이|쌀", 2, False, False, [V], "식사", "떡볶이"),

    # --- 고기 ---
    ("닭떡갈비|닭떡갈비", 1, False, False, [M], "식사", "양념 떡갈비"),
    ("오리떡갈비|오리떡갈비", 1, False, False, [M], "식사", "양념 떡갈비"),
    ("유황오리떡갈비|오리떡갈비", 1, False, False, [M], "식사", "양념 떡갈비"),
    ("오리주물럭|오리주물럭", 2, False, False, [M], "식사", "매콤하게 볶아 낸다"),
    ("암돼지 돼지고기|돼지고기", 0, False, False, [M], "식사", "구이"),
    ("한우소고기불백|소고기", 1, False, False, [M], "식사", "간장 양념 불고기 백반"),
    ("유자골 버섯 생불고기|유자", 0, False, False, [M, V], "식사", "간장 불고기에 버섯"),
    ("오리엔탈 닭가슴살 스테이크|닭가슴살", 0, False, False, [M], "식사", "샐러드형 스테이크"),
    ("삼합|소고기", 0, False, False, [M, S], "식사", "장흥삼합(소고기·키조개·표고). 구워 먹는다"),
    ("삼합|키조개", 0, False, False, [M, S], "식사", "장흥삼합(소고기·키조개·표고). 구워 먹는다"),
    ("삼합|표고버섯", 0, False, False, [M, S], "식사", "장흥삼합(소고기·키조개·표고). 구워 먹는다"),

    # --- 2026-08-20 추천 QA 전수 검수 보정 ---
    ("마른우럭지리탕|우럭", 0, True, False, [S], "식사", "지리탕은 맑은 국물 요리"),
    ("전복들깨 순두부|전복", 2, False, False, [S, V], "식사", "전복과 순두부가 메뉴명에 함께 명시된 복합 주재료"),
    ("곰보배추 돼지고기수육|배추", 0, False, False, [M, V], "식사", "곰보배추와 돼지고기수육이 모두 메뉴 정체성에 포함"),
    ("육낙|낙지", 0, False, True, [S, M], "식사", "육회와 낙지를 함께 내는 육낙으로 날것·복합 주재료"),

    # --- 디저트·음료 ---
    ("쑥차|쑥", 0, False, False, [V], "음료", "쑥을 우린 차"),
    ("사과한그루|사과", 0, False, False, [V], "음료", "사과 음료"),
    ("딸기나무숲|딸기", 0, False, False, [V], "디저트", "딸기 디저트"),
    ("큐브치즈딸기|딸기", 0, False, False, [V], "디저트", "딸기와 치즈"),
    ("만대재 쑥크림|쑥", 0, False, False, [V], "디저트", "쑥 크림 디저트"),
    ("복숭아요거트크레페|복숭아", 0, False, False, [V], "디저트", "크레페"),
    ("산딸기바게트|산딸기", 0, False, False, [V], "디저트", "빵"),
]


def main() -> None:
    if not PROFILE.exists():
        raise SystemExit(
            f"{PROFILE} 가 없습니다. 먼저 python -m src.taste.build_taste_profile 을 실행하세요."
        )
    with PROFILE.open(encoding="utf-8-sig", newline="") as fh:
        targets = {row["menu_key"]: row for row in csv.DictReader(fh)}

    labelled = {key for key, *_ in MANUAL_LABELS}
    weak = {k for k, r in targets.items() if float(r["confidence"]) < 0.6}
    missing = sorted(weak - labelled)
    unknown = sorted(labelled - set(targets))

    rows = []
    for menu_key, spicy, has_soup, is_raw, cats, course, reason in MANUAL_LABELS:
        source = targets.get(menu_key)
        if source is None:
            continue
        rows.append({
            "menu_key": menu_key,
            "menu_name": source["menu_name"],
            "ingredient": source["ingredient"],
            "spicy": spicy,
            "has_soup": "Y" if has_soup else "N",
            "is_raw": "Y" if is_raw else "N",
            # 순서를 CATEGORIES 기준으로 고정해 룰 결과와 표기를 맞춘다.
            "main_ingredients": ";".join(c for c in CATEGORIES if c in cats),
            "course": course,
            "source": "manual",
            "reason": reason,
        })

    OVERRIDE.parent.mkdir(parents=True, exist_ok=True)
    with OVERRIDE.open("w", encoding="utf-8-sig", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(rows)

    print(f"전체 메뉴   : {len(targets)}건")
    print(f"라벨링 완료 : {len(rows)}건 → {OVERRIDE}")
    if missing:
        print(f"\n룰 신뢰도가 낮은데 아직 안 매긴 것 {len(missing)}건:")
        for key in missing:
            print(f"  - {key}")
    if unknown:
        print(f"\n대상 목록에 없는 키 {len(unknown)}건(오타 의심):")
        for key in unknown:
            print(f"  - {key}")


if __name__ == "__main__":
    main()
