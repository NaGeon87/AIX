"""전라맛도 음식 데이터(외부 엑셀) x 보유 공공데이터 대조 후 통합 목록 생성.

프로젝트는 그동안 **지역 축이 비어 있었다**(redtable 플랫폼 장애, TourAPI 활용신청 대기).
`음식데이터_1.xlsx`(전라맛도_음식데이터_최종완성본)는 지역-식재료-메뉴 273행을 주므로
그 공백을 메울 후보다. 다만 출처가 공공데이터 API가 아니므로 **그대로 신뢰하지 않고**
보유 공공데이터와 대조해 등급을 매긴 뒤 통합한다.

대조 기준 (2026-07-30 시점에 살아 있는 공공데이터는 농사로뿐이다):

  public   = 농사로 '이달의 음식' 식재료명(fdmtNm) / 음식명(fdNm)과 일치. 공공데이터 확인.
  curated  = src/data/seasonal_seafood.py 큐레이션 수산물표와 일치. **공공데이터 아님.**
  none     = 어느 쪽에도 없음.

`included` 컬럼이 사용자 요청("공공데이터에 있는 것만 추가")을 그대로 구현한다.
`Y`는 public 등급만이고, 나머지는 `N`으로 보류 파일에 따로 나간다. 삭제하지 않는 이유는
농사로가 농촌진흥청 소관이라 **농산물만 다루기 때문**이다. 전남 음식의 핵심인 수산물은
공공데이터에 계절 축이 아예 없어서(README '제철 수산물' 참고) 미대조가 데이터 오류라는
근거가 되지 못한다. 2026-08-02 이후 TourAPI가 열리면 보류분을 재대조해 승격시킨다.

입력:
  data/raw/jeollamatdo_food.xlsx             <- 외부 제공 엑셀 (원본 사본)
  data/raw/nongsaro_month_food_merged.json   <- collectors.nongsaro_monthly_food
  src/data/seasonal_seafood.py               <- 큐레이션 수산물표
출력:
  data/processed/food_master.csv             <- 통합 목록 (273행 전체 + 등급)
  data/processed/food_master_pending.csv     <- included=N 보류분
  data/processed/public_only_terms.csv       <- 공공데이터에 있으나 엑셀에 없는 항목
  data/processed/merge_summary.json          <- 시각자료용 집계
"""
import csv
import json
import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path

from src.config import DATA_RAW_DIR, DATA_REVIEW_DIR
from src.data.seasonal_seafood import SEASONAL_SEAFOOD, SOURCE_LABEL

EXCEL_PATH = DATA_RAW_DIR / "jeollamatdo_food.xlsx"
NONGSARO_PATH = DATA_RAW_DIR / "nongsaro_month_food_merged.json"

_SPLIT_RE = re.compile(r"[,;/·・、|]+")
_PAREN_RE = re.compile(r"[（(\[].*?[)）\]]")

# 엑셀 표기 -> 공공데이터/큐레이션 표기.
# 엑셀은 지역 화법을 그대로 쓰고(한우, 세발낙지, 물김) 농사로·수산물표는 표준 품목명을
# 쓰기 때문에, 정규화하지 않으면 같은 품목이 미대조로 떨어진다.
# 부위·산지·크기 수식어를 떼서 상위 품목으로 올리는 방향만 허용한다.
ALIAS: dict[str, str] = {
    "쇠고기": "소고기", "한우": "소고기", "숯불고기": "소고기",
    "흑돼지": "돼지고기",
    "닭": "닭고기", "오골계": "닭고기",
    "오리": "오리고기",
    "세발낙지": "낙지",          # 세발낙지는 낙지의 산지·크기 구분
    "물김": "김", "파래": "김",
    "민물장어": "장어", "갯장어": "장어", "참장어": "장어",
    "보리굴비": "조기", "굴비": "조기",   # 굴비는 말린 조기
    "덕자": "병어",                        # 덕자는 큰 병어의 지역명
    "잡어": "도다리",
}

# 대조에서 제외할 토큰. 품목명이 아니라 상위 범주·부재료라서 어떤 표와 맞춰도
# 의미가 없다(맞아도 근거가 못 되고, 안 맞아도 데이터 오류가 아니다).
SKIP_TOKENS = {"생선", "지초", "잡어(도다리 등)"}

COLUMNS = [
    "region", "ingredient_raw", "ingredient_norm", "menu_name", "note",
    "verify_level", "verify_source", "verify_term", "verify_months",
    "is_specialty", "included", "exclude_reason",
]


def _clean(name: str) -> str:
    return _PAREN_RE.sub("", name or "").strip()


def _tokens(raw: str) -> list[str]:
    """엑셀 식재료 칸은 '소고기, 돼지고기', '문어, 전복, 닭'처럼 복수 품목이 온다."""
    out = []
    for part in _SPLIT_RE.split(raw or ""):
        tok = _clean(part)
        if not tok or tok in SKIP_TOKENS:
            continue
        tok = ALIAS.get(tok, tok)
        if tok and tok not in SKIP_TOKENS and tok not in out:
            out.append(tok)
    return out


# --------------------------------------------------------------------------
# 입력 파싱
# --------------------------------------------------------------------------
@dataclass
class ExcelRow:
    region: str
    ingredient_raw: str
    menu_name: str
    note: str = ""
    tokens: list[str] = field(default_factory=list)


def parse_excel(path: Path) -> list[ExcelRow]:
    import openpyxl

    ws = openpyxl.load_workbook(path, data_only=True).worksheets[0]
    rows: list[ExcelRow] = []
    for values in ws.iter_rows(min_row=2, values_only=True):
        def cell(i):
            return str(values[i]).strip() if i < len(values) and values[i] else ""

        region, ingredient, menu = cell(0), cell(1), cell(2)
        if not region and not menu:
            continue
        row = ExcelRow(region, ingredient, menu, cell(8))
        row.tokens = _tokens(ingredient)
        rows.append(row)
    return rows


def parse_public_terms(path: Path) -> tuple[dict[str, set[int]], dict[str, set[int]]]:
    """농사로 병합 수집분에서 식재료명 -> 월, 음식명 -> 월 을 만든다."""
    raw = json.loads(path.read_text(encoding="utf-8"))
    ingredients: dict[str, set[int]] = defaultdict(set)
    foods: dict[str, set[int]] = defaultdict(set)
    for month_blk in raw["months"]:
        month = month_blk["month"]
        for item in month_blk.get("ingredients", []):
            for tok in _SPLIT_RE.split(_clean(item.get("fdmtNm", ""))):
                if tok.strip():
                    ingredients[tok.strip()].add(month)
        for item in month_blk.get("foods", []):
            name = (item.get("fdNm") or "").strip()
            if name:
                foods[name].add(month)
    return dict(ingredients), dict(foods)


def parse_curated_terms() -> tuple[dict[str, set[int]], dict[str, bool]]:
    months: dict[str, set[int]] = defaultdict(set)
    specialty: dict[str, bool] = {}
    for month, items in SEASONAL_SEAFOOD.items():
        for item in items:
            months[item.name].add(month)
            specialty[item.name] = specialty.get(item.name, False) or item.is_specialty
    return dict(months), specialty


# --------------------------------------------------------------------------
# 대조
# --------------------------------------------------------------------------
def verify(rows: list[ExcelRow],
           pub_ing: dict[str, set[int]],
           pub_food: dict[str, set[int]],
           cur: dict[str, set[int]],
           specialty: dict[str, bool]) -> list[dict]:
    out = []
    for row in rows:
        pub_terms = [(t, sorted(pub_ing[t])) for t in row.tokens if t in pub_ing]
        cur_terms = [(t, sorted(cur[t])) for t in row.tokens if t in cur]
        food_hit = sorted(pub_food[row.menu_name]) if row.menu_name in pub_food else []

        if food_hit:
            level, source = "public", "nongsaro:food"
            term, months = row.menu_name, food_hit
        elif pub_terms:
            level, source = "public", "nongsaro:ingredient"
            term, months = pub_terms[0]
        elif cur_terms:
            level, source = "curated", "seafood_curated"
            term, months = cur_terms[0]
        else:
            level, source, term, months = "none", "", "", []

        included = level == "public"
        if included:
            reason = ""
        elif level == "curated":
            reason = "큐레이션 수산물표만 일치 (공공데이터 API 아님)"
        else:
            reason = "보유 공공데이터에 대조 항목 없음"

        out.append({
            "region": row.region,
            "ingredient_raw": row.ingredient_raw,
            "ingredient_norm": "|".join(row.tokens),
            "menu_name": row.menu_name,
            "note": row.note,
            "verify_level": level,
            "verify_source": source,
            "verify_term": term,
            "verify_months": ";".join(str(m) for m in months),
            "is_specialty": "Y" if specialty.get(term) else "",
            "included": "Y" if included else "N",
            "exclude_reason": reason,
        })
    return out


def public_only_terms(rows: list[ExcelRow],
                      pub_ing: dict[str, set[int]],
                      cur: dict[str, set[int]],
                      specialty: dict[str, bool]) -> list[dict]:
    """공공데이터·큐레이션에는 있으나 엑셀 목록에 없는 항목."""
    seen = {t for row in rows for t in row.tokens}
    out = []
    for term, months in sorted(pub_ing.items()):
        if term not in seen:
            out.append({"term": term, "source": "nongsaro:ingredient",
                        "months": ";".join(str(m) for m in sorted(months)),
                        "is_specialty": "", "is_public_data": "Y"})
    for term, months in sorted(cur.items()):
        if term not in seen:
            out.append({"term": term, "source": "seafood_curated",
                        "months": ";".join(str(m) for m in sorted(months)),
                        "is_specialty": "Y" if specialty.get(term) else "",
                        "is_public_data": "N"})
    return out


def _write_csv(path: Path, columns: list[str], records: list[dict]) -> None:
    with path.open("w", encoding="utf-8-sig", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=columns)
        writer.writeheader()
        writer.writerows(records)


def main() -> None:
    if not EXCEL_PATH.exists():
        raise SystemExit(f"엑셀 원본이 없다: {EXCEL_PATH}")
    if not NONGSARO_PATH.exists():
        raise SystemExit("농사로 수집분이 없다. python -m src.collectors.nongsaro_monthly_food 먼저 실행")

    rows = parse_excel(EXCEL_PATH)
    pub_ing, pub_food = parse_public_terms(NONGSARO_PATH)
    cur, specialty = parse_curated_terms()

    records = verify(rows, pub_ing, pub_food, cur, specialty)
    pending = [r for r in records if r["included"] == "N"]
    extras = public_only_terms(rows, pub_ing, cur, specialty)

    _write_csv(DATA_REVIEW_DIR / "food_master.csv", COLUMNS, records)
    _write_csv(DATA_REVIEW_DIR / "food_master_pending.csv", COLUMNS, pending)
    _write_csv(DATA_REVIEW_DIR / "public_only_terms.csv",
               ["term", "source", "months", "is_specialty", "is_public_data"], extras)

    levels = Counter(r["verify_level"] for r in records)
    by_region: dict[str, dict] = {}
    for r in records:
        blk = by_region.setdefault(r["region"], {"rows": 0, "public": 0, "curated": 0, "none": 0})
        blk["rows"] += 1
        blk[r["verify_level"]] += 1

    summary = {
        "generated_for": "광주·전남 제철 음식 데이터 통합",
        "excel_source": EXCEL_PATH.name,
        "curated_source_label": SOURCE_LABEL,
        "total_rows": len(records),
        "regions": len(by_region),
        "unique_ingredients": len({t for row in rows for t in row.tokens}),
        "unique_menus": len({row.menu_name for row in rows if row.menu_name}),
        "levels": dict(levels),
        "included": sum(1 for r in records if r["included"] == "Y"),
        "pending": len(pending),
        "public_terms_total": len(pub_ing),
        "public_food_names": len(pub_food),
        "curated_terms_total": len(cur),
        "public_only_terms": sum(1 for e in extras if e["is_public_data"] == "Y"),
        "curated_only_terms": sum(1 for e in extras if e["is_public_data"] == "N"),
        "by_region": by_region,
        "unmatched_ingredients": Counter(
            t for row in rows for t in row.tokens
            if t not in pub_ing and t not in cur
        ).most_common(),
    }
    (DATA_REVIEW_DIR / "merge_summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"엑셀 {len(records)}행 / {len(by_region)}개 지역")
    print(f"  public  {levels['public']:>3}  (included=Y)")
    print(f"  curated {levels['curated']:>3}")
    print(f"  none    {levels['none']:>3}")
    print(f"공공데이터에만 있는 항목 {summary['public_only_terms']}종, "
          f"큐레이션에만 있는 항목 {summary['curated_only_terms']}종")
    print(f"-> {DATA_REVIEW_DIR}")


if __name__ == "__main__":
    main()
