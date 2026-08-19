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


def _match_restaurants(profiles: dict[str, dict]) -> dict[str, list[dict]]:
    """메뉴마다 실제로 파는 식당을 찾는다.

    프로파일은 사람이 검수하며 비슷한 메뉴를 하나로 합친다. 그러면 합쳐져
    사라진 옛 메뉴명이 매핑표에는 그대로 남아, 이름이 똑같은 것만 찾는
    방식으로는 그 식당들이 통째로 빠진다. '갈치조림 정식'을 '갈치조림'에
    합치면 그 집이 어디에도 안 붙는 식이다. 그래서 세 단계로 찾는다.

      1) 정확 일치  정규화한 메뉴명과 제철재료가 그대로 같은 것
      2) 이름 포함  합쳐져 사라진 이름이 살아남은 이름을 품고 있는 것
      3) 지역 보충  검수자가 적어 둔 시군구인데 아직 식당이 없으면, 같은
                    **주재료 분류**(해산물·육류·채소)로 그 시군구에서 하나 채운다

    3단계를 제철재료가 아니라 주재료 분류로 여는 이유: '용봉탕'의 자라처럼
    제철 어휘에 없는 재료, '육낙'처럼 매핑에 없는 줄임말이 있다. 제철재료로만
    찾으면 이런 메뉴는 파는 집이 한 곳도 안 붙어 화면에서 막다른 길이 된다.
    시군구는 검수자가 직접 확인한 값이라, 그 안에서 같은 계열을 잇는 것이
    아무것도 못 보여 주는 것보다 낫다.

    식당수는 이 결과로 다시 센다. 프로파일에 적힌 숫자를 그대로 쓰면 화면이
    "파는 곳 2곳"이라 해 놓고 한 곳만 보여 주는 일이 생긴다.
    """
    rows = []
    for row in _read(MAPPING):
        raw_name = (row.get("menu_name") or "").strip()
        rstr_id = (row.get("rstr_id") or "").strip()
        if not raw_name or not rstr_id:
            continue
        lat, lon = _to_float(row.get("lat")), _to_float(row.get("lon"))
        rows.append({
            "norm": normalize_menu(raw_name),
            "ingredient": (row.get("match_term") or "").strip(),
            "shop": {
                "id": rstr_id,
                "name": (row.get("restaurant_name") or "").strip(),
                "region": (row.get("region") or "").strip(),
                "area": (row.get("area_nm") or "").strip(),
                "address": (row.get("road_addr") or "").strip(),
                "lat": lat,
                "lon": lon,
                "isLocalSpecialty": (row.get("is_local_specialty") or "N") == "Y",
            },
        })

    out: dict[str, list[dict]] = defaultdict(list)
    used: set[tuple] = set()
    alive = {p["menu_norm"] for p in profiles.values()}
    stages: Counter = Counter()

    def take(key: str, row: dict, stage: str) -> bool:
        ident = (row["norm"], row["ingredient"], row["shop"]["id"])
        if ident in used:
            return False
        if any(s["id"] == row["shop"]["id"] for s in out[key]):
            return False
        used.add(ident)
        out[key].append(row["shop"])
        stages[stage] += 1
        return True

    by_key: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        by_key[f'{r["norm"]}|{r["ingredient"]}'].append(r)

    for key in profiles:
        for r in by_key.get(key, []):
            take(key, r, "정확 일치")

    for key, p in profiles.items():
        norm, ing = p["menu_norm"], p["ingredient"]
        # 재료명 그대로인 메뉴('꽃게', '낙지')는 건너뛴다. 이름이 짧아 같은
        # 재료의 모든 요리에 들어 있어서 꽃게탕·꽃게찜까지 빨아들인다.
        if norm == ing or len(norm) < 3:
            continue
        for r in rows:
            # 방향은 한쪽만. 반대로 열면 '장어전복죽'이 일반명 '전복죽'을 끌어온다.
            if r["ingredient"] == ing and r["norm"] not in alive and norm in r["norm"]:
                take(key, r, "이름 포함")

    # 제철재료 -> 주재료 분류. 매핑표에는 분류 열이 없어 프로파일에서 끌어온다.
    category_of: dict[str, set] = defaultdict(set)
    for p in profiles.values():
        cats = {c for c in (p["main_ingredients"] or "").split(";") if c}
        if p["ingredient"] and cats:
            category_of[p["ingredient"]] |= cats

    for key, p in profiles.items():
        wanted = [x.strip() for x in (p["regions"] or "").split(";") if x.strip()]
        cats = {c for c in (p["main_ingredients"] or "").split(";") if c}
        for region in wanted:
            if any(f'{s["region"]} {s["area"]}' == region for s in out[key]):
                continue
            for r in rows:
                if r["norm"] in alive:
                    continue
                if f'{r["shop"]["region"]} {r["shop"]["area"]}' != region:
                    continue
                if not (category_of.get(r["ingredient"], set()) & cats):
                    continue
                if take(key, r, "지역 보충"):
                    break

    print("  식당 매칭:", ", ".join(f"{k} {v}건" for k, v in stages.most_common()))
    return out


def build_foods() -> list[dict]:
    profiles = {row["menu_key"]: row for row in _read(PROFILE)}
    restaurants = _match_restaurants(profiles)

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
            # 프로파일에 적힌 숫자가 아니라 실제로 찾은 수를 쓴다. 화면이
            # "파는 곳 2곳"이라 해 놓고 한 곳만 보여 주면 그게 곧 거짓말이다.
            "restaurantCount": len(rows),
            "restaurants": rows[:MAX_RESTAURANTS_PER_FOOD],
        })

    foods.sort(key=lambda f: (-f["restaurantCount"], f["name"]))
    for course, count in skipped.items():
        print(f"  {course} {count}건 제외")
    return foods


NEARBY_TOURISM = DATA_PROCESSED_DIR / "nearby_tourism.json"


def _load_nearby() -> dict:
    """거리별 주변 관광지. 파일이 없으면(수집 전) 빈 채로 둔다 — 화면은 그때
    '주변 관광 정보 탐색' 절을 아예 감춘다."""
    if not NEARBY_TOURISM.exists():
        print("  주변 관광 데이터 없음(nearby_tourism.json). 관광지 없이 빌드합니다.")
        return {}
    data = json.loads(NEARBY_TOURISM.read_text(encoding="utf-8"))
    # TourAPI 이미지는 http로 온다. https 배포에서 혼합콘텐츠로 막히므로 올린다.
    for spots in data.values():
        for s in spots:
            if s.get("image", "").startswith("http://"):
                s["image"] = "https://" + s["image"][len("http://"):]
    return data


def build_streets() -> list[dict]:
    nearby = _load_nearby()
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
            # 반경 5km 안의 관광지·문화시설. 좌표 없는 거리는 빈 목록.
            "nearby": nearby.get(row["street_id"], []),
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
