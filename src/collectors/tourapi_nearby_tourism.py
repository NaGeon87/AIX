"""특화거리마다 반경 안의 관광지를 TourAPI로 받아 둔다.

거리 상세 화면의 '주변 관광 정보 탐색'이 쓸 데이터다. 거리는 33개뿐이라
빌드 시점에 한 번 받아 streets.csv 옆에 굳혀 둔다 — 웹 런타임에서 키나
서버 없이, 이 프로젝트의 다른 데이터와 같은 방식으로 쓴다.

좌표가 없는 거리(무등산 보리밥 거리처럼 결측)는 건너뛴다. 위치기반
조회라 좌표가 있어야 한다.

TourAPI locationBasedList2:
  mapX(경도) mapY(위도) radius(m) contentTypeId arrange numOfRows
  contentTypeId 12=관광지 14=문화시설 15=축제공연행사 25=여행코스 28=레포츠
  arrange E=거리순(이미지 무관) S=거리순(이미지 있는 것 우선)

입력 : data/processed/streets.csv
출력 : data/processed/nearby_tourism.json  { street_id: [ {...}, ... ] }

실행: python -m src.collectors.tourapi_nearby_tourism [--radius 5000] [--limit 6]
"""

from __future__ import annotations

import argparse
import csv
import json

from src.collectors.tourapi_region_food import TourApiError, _get, _items
from src.config import DATA_PROCESSED_DIR

STREETS = DATA_PROCESSED_DIR / "streets.csv"
OUTPUT = DATA_PROCESSED_DIR / "nearby_tourism.json"

# 관광지 + 문화시설. 축제는 기간이 지나면 죽은 정보라 뺀다.
CONTENT_TYPES = {"12": "관광지", "14": "문화시설"}


def fetch_nearby(lat: float, lon: float, radius: int, limit: int) -> list[dict]:
    seen: set[str] = set()
    out: list[dict] = []
    for type_id, type_label in CONTENT_TYPES.items():
        try:
            body = _get(
                "locationBasedList2",
                mapX=str(lon),
                mapY=str(lat),
                radius=str(radius),
                contentTypeId=type_id,
                arrange="S",  # 거리순이되 사진 있는 곳을 앞에
                numOfRows=str(limit + 4),
                pageNo="1",
            )
        except TourApiError as exc:
            print(f"    {type_label} 조회 실패: {exc}")
            continue

        for r in _items(body):
            cid = str(r.get("contentid") or "")
            if not cid or cid in seen:
                continue
            seen.add(cid)
            try:
                dist = int(float(r.get("dist") or 0))
            except (TypeError, ValueError):
                dist = 0
            image = (r.get("firstimage2") or r.get("firstimage") or "").strip()
            out.append({
                "id": cid,
                "title": (r.get("title") or "").strip(),
                "type": type_label,
                "addr": (r.get("addr1") or "").strip(),
                "dist": dist,  # 거리 지점에서 몇 m
                "lat": float(r["mapy"]) if r.get("mapy") else None,
                "lon": float(r["mapx"]) if r.get("mapx") else None,
                "image": image,  # 없을 수 있다
                "tel": (r.get("tel") or "").strip(),
            })

    out.sort(key=lambda x: x["dist"])
    return out[:limit]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--radius", type=int, default=5000, help="반경(m)")
    parser.add_argument("--limit", type=int, default=6, help="거리당 관광지 수")
    args = parser.parse_args()

    with STREETS.open(encoding="utf-8-sig", newline="") as fh:
        streets = list(csv.DictReader(fh))

    result: dict[str, list[dict]] = {}
    skipped = 0
    for s in streets:
        sid = s["street_id"]
        lat, lon = s.get("lat", ""), s.get("lon", "")
        if not lat or not lon:
            skipped += 1
            continue
        spots = fetch_nearby(float(lat), float(lon), args.radius, args.limit)
        result[sid] = spots
        print(f"  {sid} {s['name']}: 관광지 {len(spots)}곳")

    OUTPUT.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    total = sum(len(v) for v in result.values())
    print(f"\n{len(result)}개 거리 / 관광지 {total}곳 저장 -> {OUTPUT}")
    if skipped:
        print(f"  좌표 없어 건너뜀: {skipped}개")


if __name__ == "__main__":
    main()
