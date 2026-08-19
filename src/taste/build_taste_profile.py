"""seasonal_region_mapping.csv에 룰 엔진을 적용해 메뉴별 취향 지표를 만든다.

산출물
------
- data/processed/menu_taste_profile.csv : 고유 메뉴 단위 지표
- data/processed/review/taste_low_confidence.csv : 사람이 직접 매길 대상

같은 메뉴명이 여러 식당에 반복되므로 (메뉴명, 식재료) 조합 단위로 한 번만
매긴다. manual_labels.py가 만든 override가 있으면 자동으로 덮어쓴다.

실행: python -m src.taste.build_taste_profile
"""

from __future__ import annotations

import csv
from collections import Counter

from src.config import DATA_PROCESSED_DIR, DATA_REVIEW_DIR
from src.taste.rules import score_menu, normalize_menu, is_menu_like

SOURCE = DATA_PROCESSED_DIR / "seasonal_region_mapping.csv"
OUTPUT = DATA_PROCESSED_DIR / "menu_taste_profile.csv"
LOW_CONF = DATA_REVIEW_DIR / "taste_low_confidence.csv"
OVERRIDE = DATA_REVIEW_DIR / "taste_llm_override.csv"

LOW_CONFIDENCE_CUTOFF = 0.60

FIELDS = [
    "menu_key", "menu_name", "menu_norm", "ingredient",
    "spicy", "has_soup", "is_raw", "main_ingredients",
    "course", "confidence", "source",
    "months", "regions", "restaurant_count",
]


def _load_overrides() -> dict[str, dict]:
    if not OVERRIDE.exists():
        return {}
    with OVERRIDE.open(encoding="utf-8-sig", newline="") as fh:
        return {row["menu_key"]: row for row in csv.DictReader(fh)}


def _as_bool(value: str) -> bool:
    return str(value).strip().lower() in {"1", "true", "y", "yes", "o"}


def main() -> None:
    with SOURCE.open(encoding="utf-8-sig", newline="") as fh:
        rows = list(csv.DictReader(fh))

    groups: dict[tuple[str, str], dict] = {}
    for row in rows:
        raw_name = (row.get("menu_name") or "").strip()
        ingredient = (row.get("match_term") or "").strip()
        if not raw_name or not is_menu_like(raw_name):
            continue
        norm = normalize_menu(raw_name)
        bucket = groups.setdefault((norm, ingredient), {
            "menu_name": raw_name,
            "menu_norm": norm,
            "ingredient": ingredient,
            "months": set(),
            "regions": set(),
            "restaurants": set(),
        })
        if row.get("month"):
            bucket["months"].add(int(row["month"]))
        area = (row.get("area_nm") or "").strip()
        region = (row.get("region") or "").strip()
        if region:
            bucket["regions"].add(f"{region} {area}".strip())
        if row.get("rstr_id"):
            bucket["restaurants"].add(row["rstr_id"])

    overrides = _load_overrides()
    override_hits = 0
    out_rows = []

    for (norm, ingredient), bucket in sorted(groups.items()):
        profile = score_menu(bucket["menu_name"], ingredient)
        menu_key = f"{norm}|{ingredient}"

        spicy = profile.spicy
        has_soup = profile.has_soup
        is_raw = profile.is_raw
        main_ingredients = profile.main_ingredients
        course = profile.course
        confidence = profile.confidence
        source = "rule"

        override = overrides.get(menu_key)
        if override:
            spicy = int(override["spicy"])
            has_soup = _as_bool(override["has_soup"])
            is_raw = _as_bool(override["is_raw"])
            main_ingredients = [
                c for c in (override["main_ingredients"] or "").split(";") if c
            ]
            course = override["course"]
            confidence = 0.85
            source = override.get("source") or "llm"
            override_hits += 1

        out_rows.append({
            "menu_key": menu_key,
            "menu_name": bucket["menu_name"],
            "menu_norm": norm,
            "ingredient": ingredient,
            "spicy": spicy,
            "has_soup": "Y" if has_soup else "N",
            "is_raw": "Y" if is_raw else "N",
            "main_ingredients": ";".join(main_ingredients),
            "course": course,
            "confidence": confidence,
            "source": source,
            "months": ";".join(str(m) for m in sorted(bucket["months"])),
            "regions": ";".join(sorted(bucket["regions"])),
            "restaurant_count": len(bucket["restaurants"]),
        })

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT.open("w", encoding="utf-8-sig", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(out_rows)

    low = [
        r for r in out_rows
        if r["source"] == "rule" and float(r["confidence"]) < LOW_CONFIDENCE_CUTOFF
    ]
    LOW_CONF.parent.mkdir(parents=True, exist_ok=True)
    with LOW_CONF.open("w", encoding="utf-8-sig", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(low)

    print(f"원본 행       : {len(rows)}")
    print(f"고유 메뉴 조합 : {len(out_rows)}")
    print(f"수동 보정 적용 : {override_hits}건")
    print(f"저신뢰(<{LOW_CONFIDENCE_CUTOFF}) : {len(low)}  → {LOW_CONF.name}")
    print(f"저장          : {OUTPUT}")

    print("\n코스 :", dict(Counter(r["course"] for r in out_rows)))
    print("맵기 :", dict(sorted(Counter(r["spicy"] for r in out_rows).items())))
    print("국물 :", dict(Counter(r["has_soup"] for r in out_rows)))
    print("날것 :", dict(Counter(r["is_raw"] for r in out_rows)))
    cats: Counter = Counter()
    for r in out_rows:
        labels = [c for c in r["main_ingredients"].split(";") if c]
        cats[";".join(labels) if labels else "(없음)"] += 1
    print("주재료:", dict(cats.most_common()))


if __name__ == "__main__":
    main()
