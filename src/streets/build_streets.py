"""검증 완료된 광주·전남 음식특화거리 데이터를 서비스 스키마로 변환한다.

입력 : data/raw/광주전남_음식특화거리_위치검증_최종.csv
출력 : data/processed/streets.csv
실행 : python -m src.streets.build_streets
"""
from __future__ import annotations

import csv
from pathlib import Path
from src.config import DATA_RAW_DIR, DATA_PROCESSED_DIR

RAW = DATA_RAW_DIR / "광주전남_음식특화거리_위치검증_최종.csv"
OUTPUT = DATA_PROCESSED_DIR / "streets.csv"

FIELDS = [
    "street_id","name","description","category","food_keywords","sido","sigungu",
    "road_addr","jibun_addr","lat","lon","coord_source","length_m","length_source",
    "shop_count","designated_year","org_name","org_tel","data_date"
]

def _num(v: str) -> str:
    v=(v or "").strip()
    return v

def main() -> None:
    if not RAW.exists():
        raise SystemExit(f"원본을 찾을 수 없습니다: {RAW}")
    with RAW.open(encoding="utf-8-sig", newline="") as f:
        rows=list(csv.DictReader(f))

    out=[]
    for i,row in enumerate(rows,1):
        name=(row.get("거리명") or "").strip()
        if not name:
            continue
        kws=[k.strip() for k in (row.get("매칭키워드") or "").replace(";",",").split(",") if k.strip()]
        if not kws:
            rep=(row.get("추천입력_대표음식") or "").strip()
            if rep: kws=[rep]
        lat=_num(row.get("위도","")); lon=_num(row.get("경도",""))
        coord_source=(row.get("위치검증등급") or row.get("위치검증출처") or "").strip()
        out.append({
            "street_id": f"ST{i:03d}",
            "name": name,
            "description": (row.get("거리소개") or "").strip(),
            "category": "음식",
            "food_keywords": ";".join(dict.fromkeys(kws)),
            "sido": (row.get("광역") or "").strip(),
            "sigungu": (row.get("시군구") or "").strip(),
            "road_addr": (row.get("주소") or "").strip(),
            "jibun_addr": "",
            "lat": lat,
            "lon": lon,
            "coord_source": f"위치검증:{coord_source}" if coord_source else ("원본" if lat and lon else "결측"),
            "length_m": 0,
            "length_source": "없음",
            "shop_count": _num(row.get("점포수","")) or 0,
            "designated_year": _num(row.get("지정연도","")),
            "org_name": (row.get("출처기관") or "").strip(),
            "org_tel": "",
            "data_date": "2026-06-18",
        })

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT.open("w", encoding="utf-8-sig", newline="") as f:
        w=csv.DictWriter(f, fieldnames=FIELDS); w.writeheader(); w.writerows(out)
    print(f"음식특화거리 {len(out)}건 저장 -> {OUTPUT}")

if __name__ == "__main__":
    main()
