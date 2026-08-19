"""제철 수산물 큐레이션 표 검수 시트 생성.

`src/data/seasonal_seafood.py`는 API 수집분이 아니라 수동 큐레이션 표인데,
**매핑 결과 1,996행 중 1,606행(80%)이 이 표에 걸려 있다.** 표가 틀리면 결과 대부분이 틀린다.
그런데 37종을 전부 같은 무게로 검수하면 시간이 낭비된다 — 매핑 영향도가 품목별로
408행(낙지)부터 0행까지 벌어지기 때문이다.

그래서 **영향도 순으로 정렬한 검수 시트**를 만든다. 검수자는 위에서부터 보면 된다.

시트가 답을 주지는 않는다. 판정에 필요한 것을 한 화면에 모아줄 뿐이다:
  - 현재 표가 주장하는 제철 월
  - 그 주장이 실제로 만들어낸 매핑 행수와 지역
  - 실제로 걸린 메뉴 예시 (주장이 현실과 맞는지 보는 근거)
  - 검수자가 채울 빈 칸 (판정 / 수정 월 / 근거)

⚠️ `참고_통용시기`는 **정답이 아니라 대조용 단서**다. 공개자료에서 흔히 이야기되는 시기를
적어 둔 것이라, 표와 다르면 "둘 중 하나가 틀렸다"가 아니라 "확인해 볼 지점"이라는 뜻이다.
빈 칸은 대조값을 두지 않았다는 뜻이지 문제없다는 뜻이 아니다.

출력:
  data/processed/seafood_review_sheet.csv   품목별 검수 시트 (영향도 순)
  data/processed/seafood_review_grid.csv    품목 × 월 격자 (한눈에 보기)
"""
import csv
from collections import Counter, defaultdict
from pathlib import Path

from src.config import DATA_PROCESSED_DIR, DATA_RAW_DIR, DATA_REVIEW_DIR
from src.data.seasonal_seafood import SEASONAL_SEAFOOD, SOURCE_LABEL
from src.process.build_seasonal_region_mapping import ONE_CHAR_RULINGS

MAPPING_CSV = DATA_PROCESSED_DIR / "seasonal_region_mapping.csv"

# 공개자료에서 흔히 통용되는 시기. **검수자가 표와 대조해 보라고 넣은 단서일 뿐
# 정답이 아니다.** 표와 어긋나면 어느 쪽이 맞는지 확인해야 한다는 신호로만 쓴다.
# 근거를 확인하지 못한 품목은 비워 둔다 (추측으로 채우면 검수를 오염시킨다).
REFERENCE_HINT: dict[str, str] = {
    "굴": "11~2월 (산란기인 여름은 피함)",
    "매생이": "12~2월",
    "김": "11~3월",
    "꼬막": "11~3월 (벌교 참꼬막)",
    "홍어": "겨울철이 살이 오른다고 알려짐",
    "낙지": "가을~초겨울. '봄 주꾸미 가을 낙지'",
    "주꾸미": "3~5월 (산란 전 봄)",
    "도다리": "봄. '봄 도다리 가을 전어'",
    "전어": "9~11월",
    "대하": "9~11월",
    "꽃게": "봄(4~6월 암게)과 가을(9~11월 수게) 두 철",
    "민어": "6~8월 복달임",
    "전복": "여름철 보양식으로 알려짐",
    "병어": "5~7월",
    "갈치": "가을~초겨울이 기름지다는 설명이 흔함",
    "고등어": "가을~겨울",
    "방어": "12~2월 한겨울",
    "대구": "12~2월",
    "아귀": "겨울",
    "삼치": "가을~겨울",
    "멸치": "봄(4~6월) 생멸치",
    "바지락": "3~5월",
    "키조개": "봄",
    "미역": "2~4월",
    "다시마": "5~7월",
    "톳": "봄",
    "붕장어": "여름",
    "성게": "여름",
    "우럭": "봄~여름",
    "농어": "여름",
    "오징어": "가을 성수기로 보는 자료가 많음",
    "갑오징어": "봄",
    "조기": "3~5월 (영광 굴비철)",
    "소라": "봄",
    "멍게": "봄~초여름",
    "홍합": "겨울~봄",
    "가리비": "겨울~봄",
}

COLUMNS = [
    "우선순위", "품목", "특산", "산지메모",
    "현재_제철월", "월수",
    "매핑행수", "매핑지역수", "실제_매칭메뉴_예시",
    "미매칭_사유",
    "참고_통용시기",
    "검수_판정", "검수_수정월", "검수_근거", "검수_메모",
]

def one_char_noise(name: str) -> tuple[str, ...]:
    """1글자 품목의 오탐 패턴. 근거는 매핑 규칙의 판정 테이블 한 곳에만 둔다.

    예전에는 이 파일이 `굴`·`김` 예외를 따로 들고 있어서 규칙 쪽과 두 벌로 갈렸다.
    한쪽만 고치면 진단과 실제 매칭이 어긋나므로 `ONE_CHAR_RULINGS`를 그대로 쓴다.
    """
    ruling = ONE_CHAR_RULINGS.get(name)
    return ruling.exclusions if ruling else ()


def diagnose_zero(name: str, menu_names: list[str]) -> str:
    """매핑 0행인 품목이 '제철이 아니라서'인지 '규칙에 막혀서'인지 가른다.

    이 구분이 없으면 검수자가 0행을 보고 표가 틀렸다고 오판한다.
    실제로는 굴·톳처럼 **1글자 가드에 막힌 것**과 미역·홍합처럼 **메뉴에 아예 없는 것**이
    섞여 있다. 전자는 규칙 문제고 후자만 데이터 문제다.
    """
    hits = [n for n in menu_names if name in n]
    if not hits:
        return "수집한 메뉴에 이 품목이 아예 없음 (표 문제 아님)"
    real = [n for n in hits if not any(b in n for b in one_char_noise(name))]
    if len(name) < 2:
        ruling = ONE_CHAR_RULINGS.get(name)
        if ruling and ruling.allow:
            # 허용된 1글자인데 0행이면 가드가 아니라 다른 이유다 (예: 제철 월과 안 겹침).
            return f"1글자 허용 품목인데 0행 — 확인 필요 (메뉴 {len(hits)}건, 후보 {len(real)}건)"
        if real:
            return (f"1글자 가드로 차단 — 메뉴 {len(hits)}건 중 실제 후보 {len(real)}건 "
                    f"({', '.join(sorted(set(real))[:4])}). 규칙 문제, 표 문제 아님")
        return f"1글자 가드로 차단 — 메뉴 {len(hits)}건이 전부 다른 음식 (가드가 옳게 동작)"
    return f"메뉴 {len(hits)}건 존재하나 매칭 안 됨 — 확인 필요"


def load_table() -> tuple[dict[str, set[int]], dict[str, bool], dict[str, str]]:
    months: dict[str, set[int]] = defaultdict(set)
    specialty: dict[str, bool] = {}
    note: dict[str, str] = {}
    for month, items in SEASONAL_SEAFOOD.items():
        for it in items:
            months[it.name].add(month)
            specialty[it.name] = specialty.get(it.name, False) or it.is_specialty
            if it.note and not note.get(it.name):
                note[it.name] = it.note
    return dict(months), specialty, note


def load_impact() -> tuple[Counter, dict[str, set[str]], dict[str, Counter]]:
    """매핑 결과에서 품목별 영향도를 센다. 수산물(seafood) 행만 본다."""
    rows = Counter()
    areas: dict[str, set[str]] = defaultdict(set)
    menus: dict[str, Counter] = defaultdict(Counter)
    if not MAPPING_CSV.exists():
        return rows, areas, menus
    with MAPPING_CSV.open(encoding="utf-8-sig") as fh:
        for r in csv.DictReader(fh):
            if r.get("match_type") != "seafood":
                continue
            term = r["match_term"]
            rows[term] += 1
            areas[term].add(r["area_nm"])
            menus[term][r["menu_name"]] += 1
    return rows, areas, menus


def load_menu_names() -> list[str]:
    """진단용 원본 메뉴명. 수집분이 없으면 진단을 건너뛴다."""
    import json
    out = []
    for p in sorted(DATA_RAW_DIR.glob("tourapi_*_raw.json")) + \
             sorted(DATA_RAW_DIR.glob("redtable_*_raw.json")):
        raw = json.loads(p.read_text(encoding="utf-8"))
        out += [m.get("menu_nm", "") for m in raw.get("menus", [])]
    return out


def main() -> None:
    months, specialty, note = load_table()
    rows, areas, menus = load_impact()
    menu_names = load_menu_names()

    order = sorted(months, key=lambda n: (-rows.get(n, 0), n))

    records = []
    for i, name in enumerate(order, 1):
        ms = sorted(months[name])
        records.append({
            "우선순위": i,
            "품목": name,
            "특산": "Y" if specialty.get(name) else "",
            "산지메모": note.get(name, ""),
            "현재_제철월": ";".join(str(m) for m in ms),
            "월수": len(ms),
            "매핑행수": rows.get(name, 0),
            "매핑지역수": len(areas.get(name, ())),
            "실제_매칭메뉴_예시": " · ".join(m for m, _ in menus.get(name, Counter()).most_common(5)),
            "미매칭_사유": "" if rows.get(name) or not menu_names else diagnose_zero(name, menu_names),
            "참고_통용시기": REFERENCE_HINT.get(name, ""),
            "검수_판정": "", "검수_수정월": "", "검수_근거": "", "검수_메모": "",
        })

    sheet = DATA_REVIEW_DIR / "seafood_review_sheet.csv"
    with sheet.open("w", encoding="utf-8-sig", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=COLUMNS)
        w.writeheader()
        w.writerows(records)

    # 품목 x 월 격자
    grid = DATA_REVIEW_DIR / "seafood_review_grid.csv"
    with grid.open("w", encoding="utf-8-sig", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["품목", "매핑행수"] + [f"{m}월" for m in range(1, 13)] + ["참고_통용시기"])
        for name in order:
            w.writerow([name, rows.get(name, 0)] +
                       ["O" if m in months[name] else "" for m in range(1, 13)] +
                       [REFERENCE_HINT.get(name, "")])

    total = sum(rows.values())
    top10 = sum(rows.get(n, 0) for n in order[:10])
    print(f"큐레이션 품목 {len(order)}종 · 수산물 매핑 {total}행")
    print(f"상위 10종이 {top10}행 ({top10 / total * 100:.0f}%)을 좌우한다 — 여기부터 검수할 것")
    print(f"영향도 0행 품목 {sum(1 for n in order if not rows.get(n))}종 (매핑에 안 걸림 = 후순위)")
    print(f"참고 시기 미기재 {sum(1 for n in order if n not in REFERENCE_HINT)}종")
    print(f"-> {sheet}")
    print(f"-> {grid}")
    print(f"\n출처 라벨: {SOURCE_LABEL}")


if __name__ == "__main__":
    main()
