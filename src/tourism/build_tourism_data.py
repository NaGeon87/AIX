"""업로드된 지정관광지·인기관광명소를 웹용 JSON으로 정리한다.

xlsx 원본은 보존하고, 빌드에서는 함께 저장한 CSV 스냅샷을 사용한다.
출력: web/public/data/tourism.json
"""
from __future__ import annotations
import csv, json
from pathlib import Path
from src.config import DATA_RAW_DIR, ROOT_DIR

DESIGNATED = DATA_RAW_DIR / "전남광주통합특별시_지정관광지_20260618.csv"
POPULAR = DATA_RAW_DIR / "전남인기관광명소.csv"
OUT = ROOT_DIR / "web" / "public" / "data" / "tourism.json"

def main() -> None:
    with DESIGNATED.open(encoding="cp949", newline="") as f:
        designated=list(csv.DictReader(f))
    with POPULAR.open(encoding="utf-8-sig", newline="") as f:
        popular=list(csv.DictReader(f))
    payload={
        "designated":[{
            "sigungu":r.get("시군","").strip(),"name":r.get("관광지명","").strip(),
            "location":r.get("위치","").strip(),"designatedDate":r.get("관광지 지정일","").strip(),
            "areaM2":r.get("관광지 지정 면적_제곱미터","").strip(),"note":r.get("비고","").strip()
        } for r in designated if r.get("관광지명")],
        "popular":[{
            "id":r.get("관광지ID","").strip(),"name":r.get("관심지점명","").strip(),
            "type":r.get("구분","").strip(),"ageGroup":r.get("연령대","").strip(),
            "share":float(r.get("비율") or 0)
        } for r in popular if r.get("관심지점명")],
        "sourceDate":"2026-06-18"
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload,ensure_ascii=False,separators=(",",":")),encoding="utf-8")
    print(f"관광 데이터 지정 {len(payload['designated'])}건 / 인기 {len(payload['popular'])}건 -> {OUT}")

if __name__ == "__main__":
    main()
