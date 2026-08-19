"""광주·전남 지역특화거리 원본을 웹서비스가 쓸 수 있는 형태로 정제한다.

원본은 32행뿐이라 자동 태깅보다 큐레이션이 정확하고 검증도 쉽다. 거리별
업종 분류와 음식 키워드는 아래 STREET_TAGS에 직접 적어 두고, 좌표 결측·
길이 이상치만 코드로 보정한다.

산출물: data/processed/streets.csv
실행: python -m src.streets.build_streets
"""

from __future__ import annotations

import csv
import shutil
from pathlib import Path

from src.config import DATA_RAW_DIR, DATA_PROCESSED_DIR

RAW_NAME = "광주전남_지역특화거리_통합데이터.csv"
RAW = DATA_RAW_DIR / RAW_NAME
OUTPUT = DATA_PROCESSED_DIR / "streets.csv"

# 카카오톡으로 받은 원본이 프로젝트 밖에 있으면 여기서 끌어온다.
EXTERNAL_SOURCE = Path.home() / "OneDrive" / "문서" / "카카오톡 받은 파일" / RAW_NAME


# --------------------------------------------------------------------------
# 큐레이션 태그
# --------------------------------------------------------------------------
# category      : 음식 | 쇼핑 | 문화  — 음식 거리만 추천 대상에 오른다.
# food_keywords : 이 거리가 대표하는 식재료·요리. 추천 음식과 직접 매칭된다.
#                 seasonal_region_mapping.csv의 match_term 표기와 맞춰 적었다.
STREET_TAGS: dict[str, dict] = {
    "녹동 음식특화거리":            {"category": "음식", "food_keywords": ["장어", "회", "전복", "굴"]},
    "순천시 문화의 거리":           {"category": "문화", "food_keywords": []},
    "담빛길":                      {"category": "문화", "food_keywords": ["죽순", "대통밥"]},
    "국동 장어탕 횟집거리":         {"category": "음식", "food_keywords": ["장어", "붕장어", "회", "삼치"]},
    "봉산동 게장백반거리":          {"category": "음식", "food_keywords": ["꽃게", "게장"]},
    "좌수영 음식문화거리":          {"category": "음식", "food_keywords": ["장어", "붕장어", "서대", "회"]},
    "덕양 곱창거리":               {"category": "음식", "food_keywords": ["곱창", "소고기"]},
    "학동 선소 퓨전 음식거리":      {"category": "음식", "food_keywords": []},
    "해양공원 해물삼합거리":        {"category": "음식", "food_keywords": ["키조개", "소고기", "표고", "삼합"]},
    "함평천지 한우비빔밥 음식테마거리": {"category": "음식", "food_keywords": ["소고기", "한우", "비빔밥"]},
    "나비특화거리":                {"category": "문화", "food_keywords": []},
    "영광 법성포 굴비거리":         {"category": "음식", "food_keywords": ["조기", "굴비", "보리굴비"]},
    "백양사 먹거리타운":            {"category": "음식", "food_keywords": ["두부", "산채", "쌈밥", "연잎밥"]},
    "장성호 미락단지":              {"category": "음식", "food_keywords": ["메기", "빠가사리", "민물고기", "다슬기"]},
    "장성읍 먹거리타운":            {"category": "음식", "food_keywords": ["애호박", "돼지고기"]},
    "소설 태백산맥 문학기행길":     {"category": "문화", "food_keywords": ["꼬막"]},
    "월곡동세계음식문화거리":       {"category": "음식", "food_keywords": []},
    "무안뻘낙지거리":              {"category": "음식", "food_keywords": ["낙지", "세발낙지"]},
    "광양불고기 특화거리":          {"category": "음식", "food_keywords": ["소고기", "한우", "불고기"]},
    "이순신대교 먹거리타운":        {"category": "음식", "food_keywords": []},
    "진월망덕포구 먹거리타운":      {"category": "음식", "food_keywords": ["전어", "회"]},
    "사후면세점 특화거리":          {"category": "쇼핑", "food_keywords": []},
    "음식특화거리":                {"category": "음식", "food_keywords": ["전복", "회", "매생이", "톳"]},
    "나무전거리":                  {"category": "쇼핑", "food_keywords": []},
    "전자의거리":                  {"category": "쇼핑", "food_keywords": []},
    "아시아음식문화거리":           {"category": "음식", "food_keywords": []},
    "예술의거리":                  {"category": "문화", "food_keywords": []},
    "공구의거리":                  {"category": "쇼핑", "food_keywords": []},
    "자동차의거리":                {"category": "쇼핑", "food_keywords": []},
    "건축자재의거리":              {"category": "쇼핑", "food_keywords": []},
    "패션의거리":                  {"category": "쇼핑", "food_keywords": []},
    "오리요리의거리":              {"category": "음식", "food_keywords": ["오리", "오리탕"]},
}

# --------------------------------------------------------------------------
# 공공데이터에 없는 거리
# --------------------------------------------------------------------------
# 원본 32행은 '지역특화거리'로 지정·고시된 곳만 담고 있어, 실제로 형성돼 있어도
# 빠진 거리가 있다. 여기에 적어 두면 원본 뒤에 이어 붙는다. streets.csv는
# 통째로 다시 만들어지는 파일이라, 산출물을 직접 고치면 다음 빌드에 지워진다.
#
# 원본에서 온 값과 섞이지 않게 출처를 남긴다 — 좌표는 coord_source, 나머지는
# 모르는 값을 지어내지 않고 비워 둔다(점포수 0, 지정연도 없음).
EXTRA_STREETS: list[dict] = [
    {
        "name": "무등산 보리밥 거리",
        "description": "",
        "category": "음식",
        # '보리'가 아니라 '보리밥'으로 적는다. '보리'로 두면 메뉴명 매칭이
        # '보리굴비 / 전복 / 산낙지'까지 물어 와 굴비 요리가 보리밥 거리에 붙는다.
        "food_keywords": ["보리밥"],
        "road_addr": "광주광역시 동구 지호로",
        "jibun_addr": "",
        "shop_count": 0,
        "designated_year": "",
        "org_name": "",
        "org_tel": "",
        "data_date": "",
    },
]

# 원본 위도·경도 결측 보정. 소재지 주소를 지도에서 확인해 채운 값이라
# 출처를 남겨 둔다(coord_source 컬럼).
COORD_FALLBACK: dict[str, tuple[float, float]] = {
    # 전라남도 함평군 함평읍 기각리 998-11 (함평5일시장)
    "함평천지 한우비빔밥 음식테마거리": (35.0656, 126.5165),
    # 전라남도 목포시 명륜동 6-16 (목포역 인근)
    "사후면세점 특화거리": (34.7912, 126.3886),
}

# 총길이 이상치. 나머지 거리가 82~8,000m인데 47,700m는 단위 오류로 보인다.
LENGTH_OVERRIDE: dict[str, int] = {
    "사후면세점 특화거리": 477,
}

FIELDS = [
    "street_id", "name", "description", "category", "food_keywords",
    "sido", "sigungu", "road_addr", "jibun_addr",
    "lat", "lon", "coord_source",
    "length_m", "length_source", "shop_count", "designated_year",
    "org_name", "org_tel", "data_date",
]


def _split_region(addr: str) -> tuple[str, str]:
    """'전라남도 여수시 ...' → ('전남', '여수시'). 매핑 데이터의 region 표기에 맞춘다."""
    parts = (addr or "").split()
    if not parts:
        return "", ""
    sido_raw = parts[0]
    sido = "광주" if sido_raw.startswith("광주") else "전남" if sido_raw.startswith("전라남") else sido_raw
    sigungu = parts[1] if len(parts) > 1 else ""
    return sido, sigungu


def main() -> None:
    if not RAW.exists():
        if not EXTERNAL_SOURCE.exists():
            raise SystemExit(f"원본을 찾을 수 없습니다: {RAW} / {EXTERNAL_SOURCE}")
        RAW.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(EXTERNAL_SOURCE, RAW)
        print(f"원본 복사: {EXTERNAL_SOURCE} → {RAW}")

    with RAW.open(encoding="utf-8-sig", newline="") as fh:
        rows = list(csv.DictReader(fh))

    out_rows = []
    untagged = []
    for idx, row in enumerate(rows, start=1):
        name = (row.get("거리명") or "").strip()
        if not name:
            continue
        tags = STREET_TAGS.get(name)
        if tags is None:
            untagged.append(name)
            tags = {"category": "기타", "food_keywords": []}

        road = (row.get("소재지도로명") or "").strip()
        jibun = (row.get("소재지지번주소") or "").strip()
        sido, sigungu = _split_region(road or jibun)

        lat_raw = (row.get("위도") or "").strip()
        lon_raw = (row.get("경도") or "").strip()
        if lat_raw and lon_raw:
            lat, lon, coord_source = float(lat_raw), float(lon_raw), "원본"
        elif name in COORD_FALLBACK:
            lat, lon = COORD_FALLBACK[name]
            coord_source = "주소기반보정"
        else:
            lat, lon, coord_source = "", "", "결측"

        length_raw = (row.get("총길이") or "").strip()
        length = int(float(length_raw)) if length_raw else 0
        if name in LENGTH_OVERRIDE:
            length, length_source = LENGTH_OVERRIDE[name], "이상치보정"
        else:
            length_source = "원본"

        shop_raw = (row.get("점포수") or "").strip()
        year_raw = (row.get("지정연도") or "").strip()

        out_rows.append({
            "street_id": f"ST{idx:03d}",
            "name": name,
            "description": (row.get("거리소개") or "").strip(),
            "category": tags["category"],
            "food_keywords": ";".join(tags["food_keywords"]),
            "sido": sido,
            "sigungu": sigungu,
            "road_addr": road,
            "jibun_addr": jibun,
            "lat": lat,
            "lon": lon,
            "coord_source": coord_source,
            "length_m": length,
            "length_source": length_source,
            "shop_count": int(float(shop_raw)) if shop_raw else 0,
            "designated_year": int(float(year_raw)) if year_raw else "",
            "org_name": (row.get("관리기관명") or "").strip(),
            "org_tel": (row.get("관리기관전화번호") or "").strip(),
            "data_date": (row.get("데이터기준일자") or "").strip(),
        })

    # 공공데이터에 없는 거리를 뒤에 잇는다. 번호는 원본 행수 다음부터 매겨
    # 원본이 늘어나도 id가 겹치지 않는다.
    for offset, extra in enumerate(EXTRA_STREETS, start=1):
        sido, sigungu = _split_region(extra["road_addr"] or extra["jibun_addr"])
        lat, lon = COORD_FALLBACK.get(extra["name"], ("", ""))
        out_rows.append({
            "street_id": f"ST{len(rows) + offset:03d}",
            "name": extra["name"],
            "description": extra["description"],
            "category": extra["category"],
            "food_keywords": ";".join(extra["food_keywords"]),
            "sido": sido,
            "sigungu": sigungu,
            "road_addr": extra["road_addr"],
            "jibun_addr": extra["jibun_addr"],
            "lat": lat,
            "lon": lon,
            "coord_source": "주소기반보정" if lat != "" else "결측",
            "length_m": 0,
            "length_source": "없음",
            "shop_count": extra["shop_count"],
            "designated_year": extra["designated_year"],
            "org_name": extra["org_name"],
            "org_tel": extra["org_tel"],
            "data_date": extra["data_date"],
        })

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT.open("w", encoding="utf-8-sig", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(out_rows)

    print(f"거리 {len(out_rows)}건 저장 → {OUTPUT} "
          f"(원본 {len(rows)}건 + 추가 {len(EXTRA_STREETS)}건)")
    from collections import Counter
    print("업종 분포:", dict(Counter(r["category"] for r in out_rows)))
    print("좌표 출처:", dict(Counter(r["coord_source"] for r in out_rows)))
    food = [r for r in out_rows if r["category"] == "음식"]
    print(f"음식 거리 {len(food)}건, 그중 키워드 보유 "
          f"{sum(1 for r in food if r['food_keywords'])}건")
    if untagged:
        print("태그 없는 거리(STREET_TAGS에 추가 필요):", untagged)


if __name__ == "__main__":
    main()
