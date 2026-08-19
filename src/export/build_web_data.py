"""웹앱이 읽을 JSON 번들을 만든다.

Next.js 앱은 서버 없이 동작하므로, 추천에 필요한 모든 데이터를 빌드 시점에
정적 JSON으로 굳혀 둔다. 2천 행 수준이라 통째로 내려도 문제가 없다.

산출물 (web/public/data/):
  foods.json    제철 음식 + 5축 맛 점수 + 월/지역 + 대표 식당
  streets.json  정제된 특화거리 32건
  meta.json     빌드 시각, 행 수, 데이터 출처 — 화면 하단 출처 표기에 쓴다

실행: python -m src.export.build_web_data
"""

from __future__ import annotations

import csv
import json
from collections import Counter, defaultdict
from datetime import datetime, timezone

from src.config import DATA_PROCESSED_DIR, ROOT_DIR
from src.taste.rules import CATEGORIES, normalize_menu

MAPPING = DATA_PROCESSED_DIR / "seasonal_region_mapping.csv"
PROFILE = DATA_PROCESSED_DIR / "menu_taste_profile.csv"
STREETS = DATA_PROCESSED_DIR / "streets.csv"

WEB_DATA_DIR = ROOT_DIR / "web" / "public" / "data"

# 한 음식 카드에 붙일 식당 수. 다 내리면 JSON이 커지고 화면도 못 쓴다.
MAX_RESTAURANTS_PER_FOOD = 5


def _read(path):
    with path.open(encoding="utf-8-sig", newline="") as fh:
        return list(csv.DictReader(fh))


def _to_float(value: str):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def build_foods() -> list[dict]:
    profiles = {row["menu_key"]: row for row in _read(PROFILE)}

    # 같은 메뉴가 여러 식당에 걸쳐 있으므로 menu_key로 다시 모은다.
    restaurants: dict[str, list[dict]] = defaultdict(list)
    seen_rstr: dict[str, set] = defaultdict(set)

    for row in _read(MAPPING):
        raw_name = (row.get("menu_name") or "").strip()
        ingredient = (row.get("match_term") or "").strip()
        if not raw_name:
            continue
        key = f"{normalize_menu(raw_name)}|{ingredient}"
        if key not in profiles:
            continue

        rstr_id = row.get("rstr_id") or ""
        if rstr_id and rstr_id in seen_rstr[key]:
            continue
        seen_rstr[key].add(rstr_id)

        lat, lon = _to_float(row.get("lat")), _to_float(row.get("lon"))
        restaurants[key].append({
            "id": rstr_id,
            "name": (row.get("restaurant_name") or "").strip(),
            "region": (row.get("region") or "").strip(),
            "area": (row.get("area_nm") or "").strip(),
            "address": (row.get("road_addr") or "").strip(),
            "lat": lat,
            "lon": lon,
            "isLocalSpecialty": (row.get("is_local_specialty") or "N") == "Y",
        })

    foods = []
    skipped = Counter()
    for key, profile in profiles.items():
        # 디저트·음료는 서비스 대상이 아니다. 취향 지표(맵기·국물·날것·주재료)로
        # 대추차와 낙지연포탕을 한 줄에 세우는 건 의미가 없다. 식사만 남긴다.
        if profile["course"] != "식사":
            skipped[profile["course"]] += 1
            continue
        rows = restaurants.get(key, [])
        # 지역 특산 표시가 붙은 곳을 먼저 보여 준다.
        rows.sort(key=lambda r: (not r["isLocalSpecialty"], r["name"]))

        months = [int(m) for m in (profile["months"] or "").split(";") if m]
        regions = [r for r in (profile["regions"] or "").split(";") if r]

        foods.append({
            "id": key,
            "name": profile["menu_norm"],
            "displayName": profile["menu_name"],
            "ingredient": profile["ingredient"],
            "spicy": int(profile["spicy"]),
            "hasSoup": profile["has_soup"] == "Y",
            "isRaw": profile["is_raw"] == "Y",
            "mainIngredients": [
                c for c in (profile["main_ingredients"] or "").split(";") if c
            ],
            "course": profile["course"],
            "confidence": float(profile["confidence"]),
            "source": profile.get("source", "rule"),
            "months": months,
            "regions": regions,
            "restaurantCount": int(profile["restaurant_count"] or 0),
            "restaurants": rows[:MAX_RESTAURANTS_PER_FOOD],
        })

    foods.sort(key=lambda f: (-f["restaurantCount"], f["name"]))
    for course, count in skipped.items():
        print(f"  {course} {count}건 제외")
    return foods


def build_streets() -> list[dict]:
    out = []
    for row in _read(STREETS):
        lat, lon = _to_float(row.get("lat")), _to_float(row.get("lon"))
        out.append({
            "id": row["street_id"],
            "name": row["name"],
            "description": row["description"],
            "category": row["category"],
            "foodKeywords": [k for k in (row["food_keywords"] or "").split(";") if k],
            "sido": row["sido"],
            "sigungu": row["sigungu"],
            "address": row["road_addr"] or row["jibun_addr"],
            "lat": lat,
            "lon": lon,
            "coordSource": row["coord_source"],
            "lengthM": int(row["length_m"] or 0),
            "shopCount": int(row["shop_count"] or 0),
            "designatedYear": int(row["designated_year"]) if row["designated_year"] else None,
            "orgName": row["org_name"],
            "orgTel": row["org_tel"],
            "dataDate": row["data_date"],
        })
    return out


def main() -> None:
    foods = build_foods()
    streets = build_streets()

    meta = {
        "builtAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "foodCount": len(foods),
        "streetCount": len(streets),
        "categories": list(CATEGORIES),
        "sources": [
            "농촌진흥청 농사로 월별 제철 식재료",
            "전남관광플랫폼(J-TaaS)·광주 대표음식 DB",
            "한국관광공사 TourAPI",
            "공공데이터포털 광주·전남 지역특화거리",
        ],
    }

    WEB_DATA_DIR.mkdir(parents=True, exist_ok=True)
    for name, payload in (("foods", foods), ("streets", streets), ("meta", meta)):
        path = WEB_DATA_DIR / f"{name}.json"
        with path.open("w", encoding="utf-8") as fh:
            json.dump(payload, fh, ensure_ascii=False, separators=(",", ":"))
        size_kb = path.stat().st_size / 1024
        print(f"  {path.name:14s} {size_kb:8.1f} KB")

    print(f"\n음식 {len(foods)}건, 거리 {len(streets)}건 → {WEB_DATA_DIR}")

    with_coords = sum(1 for f in foods for r in f["restaurants"] if r["lat"])
    print(f"좌표 있는 식당 레코드: {with_coords}")
    food_streets = [s for s in streets if s["category"] == "음식"]
    print(f"음식 카테고리 거리: {len(food_streets)}건 "
          f"(키워드 보유 {sum(1 for s in food_streets if s['foodKeywords'])}건)")


if __name__ == "__main__":
    main()
