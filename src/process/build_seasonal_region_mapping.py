"""
계절(농사로 '이달의 음식') x 지역(광주·전남 음식점 메뉴) 매핑 생성.

공공데이터에 두 축을 직접 연결하는 조인 키가 없으므로 텍스트 매칭으로 후보를 만든다.
다만 단순 substring 매칭은 오탐이 심하므로(예: 식재료 '무'가 상호명 '무등산'에 매칭)
아래 규칙을 적용한다.

  1. 상호명에는 매칭하지 않는다. 메뉴명과 메뉴설명(주재료)에만 매칭한다.
  2. 메뉴설명은 광주가 "야채,쌀"처럼 주재료를 콤마로 나열한다. 이 토큰과 정확히
     일치하면 신뢰도가 가장 높다(high).
  3. 1글자 식재료(무, 파, 배, 감...)는 substring 매칭을 금지한다. 콤마 토큰
     정확일치일 때만 인정한다. 오탐의 대부분이 여기서 나온다.
  4. 2글자 이상은 메뉴명 포함(high) / 메뉴설명 본문 포함(medium)으로 나눈다.
  5. 농사로 '이달의 음식'명(fdNm)이 메뉴명과 겹치는 경우는 별도 match_type='food'로
     기록한다. 식재료 매칭보다 직접적인 근거다.

여전히 자동 생성 후보이므로 실서비스 전 사람 검수가 필요하다.
확정 필드명 근거: 농사로 샘플코드(fdmtNm/fdNm/matrlInfo), redtable OPEN API 정의서.

입력:
  data/raw/nongsaro_month_food_{year}.json   <- collectors.nongsaro_monthly_food
  data/raw/redtable_gwangju_raw.json         <- collectors.redtable_region_food
  data/raw/redtable_jeonnam_raw.json
출력:
  data/processed/seasonal_region_mapping.csv
"""
import csv
import json
import re
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

from src.config import DATA_PROCESSED_DIR, DATA_RAW_DIR
from src.data.seasonal_seafood import iter_seafood

# 주재료 나열 구분자 (광주 MENU_DSCRN 예: "야채,쌀")
_SPLIT_RE = re.compile(r"[,;/·・、|]+")
# 식재료명 뒤에 붙는 괄호 주석 제거: "고구마(밤고구마)" -> "고구마"
_PAREN_RE = re.compile(r"[（(\[].*?[)）\]]")

# 1글자 식재료는 substring 매칭 시 오탐률이 압도적으로 높다.
MIN_SUBSTRING_LEN = 2


@dataclass(frozen=True)
class SeasonalItem:
    month: int
    ingredient: str          # 식재료명 — match_type='ingredient' | 'seafood'
    food_name: str           # 이달의 음식명 (fdNm) — match_type='food'
    match_type: str
    # 출처 구분. 'nongsaro'는 API 수집분, 'seafood_curated'는 수동 큐레이션 표.
    # 큐레이션분은 검수 대상이므로 결과 CSV에서 걸러낼 수 있어야 한다.
    source: str = "nongsaro"
    # 광주·전남 특산으로 알려진 품목인지 (수산물에만 의미 있음)
    is_specialty: bool = False


@dataclass
class RegionalMenu:
    region: str
    area_nm: str
    rstr_id: str
    restaurant_name: str
    road_addr: str
    lat: str
    lon: str
    menu_id: str
    menu_name: str
    menu_price: str
    menu_expln: str
    ctgry_lclas: str
    ctgry_sclas: str
    spclt_yn: str

    @property
    def expln_tokens(self) -> set[str]:
        return {t.strip() for t in _SPLIT_RE.split(self.menu_expln) if t.strip()}


def _clean(name: str) -> str:
    return _PAREN_RE.sub("", name or "").strip()


def _split_ingredient(name: str) -> list[str]:
    """농사로 식재료명은 '닭가슴살/닭안심'처럼 한 필드에 여러 개가 들어오기도 한다.

    괄호 주석을 떼고('인삼(수삼)' -> '인삼') 슬래시·쉼표로 나눠 각각을 매칭어로 쓴다.
    나누지 않으면 '닭가슴살/닭안심' 통짜로는 어떤 메뉴에도 매칭되지 않는다.
    """
    cleaned = _clean(name)
    if not cleaned:
        return []
    parts = [p.strip() for p in _SPLIT_RE.split(cleaned) if p.strip()]
    return parts or [cleaned]


# --------------------------------------------------------------------------
# 계절 축: 농사로
# --------------------------------------------------------------------------
def parse_nongsaro_raw(raw_path: Path) -> list[SeasonalItem]:
    """collect_year()가 저장한 구조를 읽는다.

    {"year": ..., "months": [{"month": m,
                              "ingredients": [{"fdmtNm": ..., "detail": {...}}],
                              "foods":       [{"fdNm": ...,   "detail": {...}}]}]}
    """
    raw = json.loads(raw_path.read_text(encoding="utf-8"))
    items: list[SeasonalItem] = []

    for month_block in raw.get("months", []):
        month = int(month_block["month"])

        for row in month_block.get("ingredients", []):
            for name in _split_ingredient(row.get("fdmtNm", "")):
                items.append(SeasonalItem(month, name, "", "ingredient"))

        for row in month_block.get("foods", []):
            name = _clean(row.get("fdNm", ""))
            if name:
                items.append(SeasonalItem(month, "", name, "food"))

    # 같은 식재료가 여러 달에 걸치면 달별로 각각 남긴다. 중복만 제거.
    return list(dict.fromkeys(items))


# --------------------------------------------------------------------------
# 지역 축: redtable (광주 · 전남)
# --------------------------------------------------------------------------
def parse_redtable_raw(raw_path: Path) -> list[RegionalMenu]:
    """redtable 수집기가 정규화해 저장한 raw를 메뉴 단위로 펼친다."""
    raw = json.loads(raw_path.read_text(encoding="utf-8"))
    region = raw.get("region", "")

    restaurants = {r.get("rstr_id"): r for r in raw.get("restaurants", [])}
    explns = {e.get("menu_id"): e for e in raw.get("menu_explanations", [])}

    menus: list[RegionalMenu] = []
    for m in raw.get("menus", []):
        rstr = restaurants.get(m.get("rstr_id"), {})
        exp = explns.get(m.get("menu_id"), {})
        menus.append(
            RegionalMenu(
                # 행정구역 통합으로 TourAPI는 한 파일에 광주·전남이 섞여 온다.
                # 행별 region이 있으면 그것이 파일 단위 라벨보다 정확하다.
                region=m.get("region") or region,
                area_nm=m.get("area_nm", ""),
                rstr_id=m.get("rstr_id", ""),
                restaurant_name=m.get("rstr_nm", ""),
                road_addr=rstr.get("road_addr", ""),
                lat=rstr.get("lat", ""),
                lon=rstr.get("lon", ""),
                menu_id=m.get("menu_id", ""),
                menu_name=m.get("menu_nm", ""),
                menu_price=m.get("menu_price", ""),
                menu_expln=exp.get("menu_expln", ""),
                ctgry_lclas=exp.get("ctgry_lclas", ""),
                ctgry_sclas=exp.get("ctgry_sclas", ""),
                spclt_yn=m.get("spclt_yn", ""),
            )
        )
    return menus


# --------------------------------------------------------------------------
# 매칭
# --------------------------------------------------------------------------
# 식재료명이 '다른 음식 이름의 일부'로 들어가 생기는 오탐.
# 1글자 가드(MIN_SUBSTRING_LEN)로도 안 걸러지는 2글자 이상 사례를 여기에 모은다.
# 판정 방식: 아래 문자열을 메뉴명에서 지운 뒤에도 term이 남아 있어야 매칭으로 인정한다.
# 그래서 '보리굴비정식'은 걸러지고 '칠게장보리비빔밥'은 그대로 매칭된다.
TERM_EXCLUSIONS: dict[str, tuple[str, ...]] = {
    # 보리굴비는 보리로 만든 음식이 아니라 말린 조기다. 보리 항아리에 저장해서 붙은 이름.
    # 실측: 보리 매칭 54행 중 34행이 보리굴비였다.
    "보리": ("보리굴비",),
    # 산딸기는 딸기(2월)와 다른 품목이고, 농사로에 6월 항목으로 따로 있다.
    "딸기": ("산딸기",),
}


@dataclass(frozen=True)
class OneCharRuling:
    """1글자 매칭어 하나에 대한 판정과 그 근거.

    허용뿐 아니라 **차단 결정도 여기에 기록한다.** 허용 목록만 두면
    "무를 검토했고 107건 전부 오탐이라 막기로 했다"는 판단이 코드에서 사라져,
    다음 사람이 같은 조사를 반복하거나 근거 없이 열게 된다.
    """
    allow: bool
    exclusions: tuple[str, ...] = ()
    hits: int = 0       # 수집 메뉴에서 이 글자를 포함한 건수 (실측)
    genuine: int = 0    # 그중 진짜 그 품목 요리인 건수 (실측)
    note: str = ""


# 계절 축 1글자 매칭어 **전수 13종**의 판정.
# 기준 데이터: TourAPI 수집 메뉴 3,894건 (2026-08-04 실측).
#
# ⚠️ 검수 없이 allow=True로 바꾸지 말 것. 판정은 `--audit-one-char`로 재확인할 수 있다.
ONE_CHAR_RULINGS: dict[str, OneCharRuling] = {
    # ---- 허용: 오탐이 없거나, 예외 몇 개로 깨끗하게 걷어낼 수 있다 ----
    "쑥": OneCharRuling(True, (), 11, 11,
                        "전부 진짜. 도다리쑥국·거문도 해풍쑥 라떼/티·쑥차. 예외 불필요"),
    "팥": OneCharRuling(True, (), 17, 17,
                        "전부 진짜. 팥칼국수·팥빙수·단팥빵·팥죽. 예외 불필요"),
    "쌀": OneCharRuling(True, ("쌀국수",), 12, 9,
                        "쌀국수는 베트남 음식이라 제외. 나머지는 쌀밥·쌀백숙과 "
                        "쌀가루 제빵(쌀베이글·쌀식빵)이며 사용자 판단으로 전부 인정"),
    "배": OneCharRuling(True, ("뚝배기", "곰보배추", "알배기", "가배"), 20, 5,
                        "진짜는 나주배 계열 4건 + 배도라지차. 뚝배기·곰보배추(약초)·"
                        "알배기(알 밴 꽃게)·가배(커피)가 전부 오탐이었다"),
    "밤": OneCharRuling(True, ("밤부", "비빕밤"), 4, 2,
                        "밤부에이드는 대나무(bamboo), 해초비빕밤은 비빔밥 오타. "
                        "진짜는 밤 젤라또·달밑밤샐러드 2건"),
    "굴": OneCharRuling(True, ("굴비", "굴소스"), 70, 11,
                        "70건 중 59건이 굴비·보리굴비(굴비는 조기다). 진짜 11건은 "
                        "굴구이·굴찜·굴죽·굴전·굴파전·굴떡국·굴라면·생굴. "
                        "굴소스는 현재 수집분에 없지만 조미료라 미리 막아 둔다"),
    "톳": OneCharRuling(True, (), 2, 2,
                        "2건 전부 진짜 (톳밥 코스, 전복톳된장 뚝배기)"),

    # ---- 차단 유지: 검토했고, 열면 손해라는 결론 ----
    "무": OneCharRuling(False, (), 107, 0,
                        "107건 전수 확인 결과 진짜 무 요리 0건. 무침·스무디·무화과·"
                        "대나무·열무·무청·무등산·충무공뿐이다. 절대 열지 말 것"),
    "조": OneCharRuling(False, (), 103, 0,
                        "103건 전수 확인 결과 진짜 조(좁쌀) 요리 0건. 조림(갈치조림 등)·"
                        "새조개·조기·원조·리조또뿐이다. 절대 열지 말 것"),
    "김": OneCharRuling(False, ("김치", "김칫", "김밥", "튀김", "김말이", "묵은지", "김연수"),
                        49, 1,
                        "49건이 김치·김밥·튀김·'김연수'(상호)뿐. 남은 1건 김전복해물뚝배기는 "
                        "김 요리인지 상호인지 모호하다. 가드가 옳게 동작한 사례라 유지"),
    "감": OneCharRuling(False, (), 16, 2,
                        "진짜는 감잎차·장성감빵 2건뿐인데 감자·감태·곶감·감성돔·대감·보감·"
                        "오감 7개를 막아야 한다. 유지비 대비 이득이 없어 차단"),

    # ---- 수집 메뉴에 아예 없음 ----
    "귤": OneCharRuling(False, (), 0, 0, "수집 메뉴에 히트 0건. 판단할 근거 자체가 없다"),
    "잣": OneCharRuling(False, (), 0, 0, "수집 메뉴에 히트 0건. 판단할 근거 자체가 없다"),
}


def _exclusions_for(term: str) -> tuple[str, ...]:
    """2글자 이상은 TERM_EXCLUSIONS, 1글자는 판정 테이블에서 가져온다.

    한 품목의 근거가 한 곳에만 있도록 출처를 나눠 뒀다.
    """
    ruling = ONE_CHAR_RULINGS.get(term)
    if ruling is not None:
        return ruling.exclusions
    return TERM_EXCLUSIONS.get(term, ())


def _strip_exclusions(term: str, text: str) -> str:
    for bad in _exclusions_for(term):
        text = text.replace(bad, "")
    return text


def match_confidence(term: str, menu: RegionalMenu) -> str | None:
    """term(식재료명 또는 음식명)이 메뉴에 매칭되는지와 그 신뢰도를 판정한다.

    반환: "high" | "medium" | None
    """
    if not term:
        return None

    # 주재료 목록에 정확히 들어있으면 가장 확실하다. 1글자도 이때만 인정.
    if term in menu.expln_tokens:
        return "high"

    if len(term) < MIN_SUBSTRING_LEN:
        ruling = ONE_CHAR_RULINGS.get(term)
        if not (ruling and ruling.allow):
            return None

    if term in _strip_exclusions(term, menu.menu_name):
        return "high"

    if term in _strip_exclusions(term, menu.menu_expln):
        return "medium"

    return None


COLUMNS = [
    "month", "match_type", "match_term", "confidence", "term_source", "term_is_specialty",
    "region", "area_nm", "restaurant_name", "rstr_id", "road_addr", "lat", "lon",
    "menu_id", "menu_name", "menu_price", "menu_category", "menu_subcategory",
    "is_local_specialty", "menu_expln",
]

# 신뢰도 정렬 우선순위
_CONFIDENCE_RANK = {"high": 0, "medium": 1}


def build_mapping(seasonal: list[SeasonalItem],
                  regional: list[RegionalMenu]) -> list[dict]:
    rows: list[dict] = []
    for s in seasonal:
        term = s.ingredient or s.food_name
        for menu in regional:
            confidence = match_confidence(term, menu)
            if confidence is None:
                continue
            rows.append(
                {
                    "month": s.month,
                    "match_type": s.match_type,
                    "match_term": term,
                    "confidence": confidence,
                    "term_source": s.source,
                    "term_is_specialty": "Y" if s.is_specialty else "N",
                    "region": menu.region,
                    "area_nm": menu.area_nm,
                    "restaurant_name": menu.restaurant_name,
                    "rstr_id": menu.rstr_id,
                    "road_addr": menu.road_addr,
                    "lat": menu.lat,
                    "lon": menu.lon,
                    "menu_id": menu.menu_id,
                    "menu_name": menu.menu_name,
                    "menu_price": menu.menu_price,
                    "menu_category": menu.ctgry_lclas,
                    "menu_subcategory": menu.ctgry_sclas,
                    "is_local_specialty": menu.spclt_yn,
                    "menu_expln": menu.menu_expln,
                }
            )

    # 같은 월·지역 안에서는 신뢰도 높은 후보가 위로 오게 정렬한다.
    rows.sort(key=lambda r: (
        r["month"],
        r["region"],
        _CONFIDENCE_RANK.get(r["confidence"], 9),
        r["match_term"],
    ))
    return rows


def parse_seasonal_seafood() -> list[SeasonalItem]:
    """월별 제철 수산물 큐레이션 표를 계절 축 항목으로 변환한다.

    농사로에는 수산물이 없고(농촌진흥청 소관), 월별 제철 수산물 공공데이터 API도
    존재하지 않는다. 자세한 근거는 src/data/seasonal_seafood.py 문서화 참고.
    """
    return [
        SeasonalItem(
            month=month,
            ingredient=item.name,
            food_name="",
            match_type="seafood",
            source="seafood_curated",
            is_specialty=item.is_specialty,
        )
        for month, item in iter_seafood()
    ]


def _find_nongsaro_raw() -> Path | None:
    """여러 연도를 병합한 merged 파일을 우선 쓰고, 없으면 연도별 파일 중 최신을 쓴다."""
    merged = DATA_RAW_DIR / "nongsaro_month_food_merged.json"
    if merged.exists():
        return merged
    candidates = sorted(DATA_RAW_DIR.glob("nongsaro_month_food_*.json"))
    return candidates[-1] if candidates else None


def audit_one_char() -> int:
    """판정 테이블에 적힌 실측치가 현재 수집분과 맞는지 대조한다.

    기록된 근거는 데이터가 바뀌면 조용히 낡는다. 판정을 자동으로 바꾸지는 않고
    **어긋난 곳만 알려준다** — 다시 사람이 보라는 신호다.
    """
    menu_names: list[str] = []
    for pattern in ("tourapi_*_raw.json", "redtable_*_raw.json"):
        for path in sorted(DATA_RAW_DIR.glob(pattern)):
            raw = json.loads(path.read_text(encoding="utf-8"))
            menu_names += [m.get("menu_nm", "") for m in raw.get("menus", [])]

    if not menu_names:
        print("지역 축 수집분이 없어 대조할 수 없습니다.")
        return 1

    print(f"대조 기준: 수집 메뉴 {len(menu_names)}건 · 1글자 매칭어 {len(ONE_CHAR_RULINGS)}종\n")
    drift = 0
    for term, ruling in ONE_CHAR_RULINGS.items():
        hits = [n for n in menu_names if term in n]
        state = "허용" if ruling.allow else "차단"

        # `genuine`을 기계로 다시 셀 수 있는 건 예외 목록이 오탐을 전부 걷어내는 경우뿐이다.
        # 예외 없이 차단된 품목(무·조·감)의 `genuine`은 사람이 전수 열거해 판단한 값이라
        # 자동 대조 대상이 아니다. 이걸 대조하면 항상 불일치로 뜬다.
        checkable = ruling.allow or bool(ruling.exclusions)
        if checkable:
            genuine = [n for n in hits if not any(b in n for b in ruling.exclusions)]
            ok = len(hits) == ruling.hits and len(genuine) == ruling.genuine
            shown = f"진짜 {len(genuine):>3}(기록 {ruling.genuine:>3})"
        else:
            genuine = []
            ok = len(hits) == ruling.hits
            shown = f"진짜 {ruling.genuine:>3}(수동 판정, 자동 대조 불가)"

        mark = "OK " if ok else "!! "
        print(f"{mark}{term} [{state}] 히트 {len(hits):>3}(기록 {ruling.hits:>3}) · {shown}")
        if not ok:
            drift += 1
            if len(hits) != ruling.hits:
                print(f"     ↳ 히트 수가 달라졌습니다. 수집분이 바뀌었다면 전수 재확인이 필요합니다.")
            else:
                sample = sorted(set(genuine))[:6]
                print(f"     ↳ 예외 목록이 걸러내는 범위가 달라졌습니다. "
                      f"예: {', '.join(sample) if sample else '(없음)'}")

    print()
    if drift:
        print(f"⚠️ {drift}종이 기록과 어긋납니다. 판정 근거를 다시 확인하세요 "
              f"(ONE_CHAR_RULINGS의 hits/genuine).")
    else:
        print("전 종목이 기록과 일치합니다.")
    return 1 if drift else 0


if __name__ == "__main__":
    import sys

    if "--audit-one-char" in sys.argv:
        raise SystemExit(audit_one_char())

    nongsaro_path = _find_nongsaro_raw()
    if nongsaro_path is None:
        raise SystemExit(
            f"{DATA_RAW_DIR}에 nongsaro_month_food_*.json이 없습니다. "
            "먼저 `python -m src.collectors.nongsaro_monthly_food`를 실행하세요."
        )

    seasonal = parse_nongsaro_raw(nongsaro_path)
    print(f"계절 축(농산물): {nongsaro_path.name}에서 {len(seasonal)}건")

    seafood = parse_seasonal_seafood()
    seasonal.extend(seafood)
    print(f"계절 축(수산물): 큐레이션 표에서 {len(seafood)}건 (검수 대상)")

    # 지역 축은 소스가 여러 개다. redtable(광주·전남 음식점 DB)과
    # TourAPI(한국관광공사)는 정규화 스키마가 같으므로 같은 파서로 읽는다.
    REGION_SOURCES = [
        ("redtable_gwangju_raw.json", "redtable_region_food"),
        ("redtable_jeonnam_raw.json", "redtable_region_food"),
        ("tourapi_gwangju_raw.json", "tourapi_region_food"),
        ("tourapi_jeonnam_raw.json", "tourapi_region_food"),
    ]

    regional: list[RegionalMenu] = []
    for name, collector in REGION_SOURCES:
        path = DATA_RAW_DIR / name
        if not path.exists():
            print(f"건너뜀: {name} 없음 - `python -m src.collectors.{collector}` 먼저 실행")
            continue
        menus = parse_redtable_raw(path)
        print(f"지역 축: {name}에서 메뉴 {len(menus)}건")
        regional.extend(menus)

    if not regional:
        raise SystemExit("지역 축 데이터가 하나도 없습니다.")

    rows = build_mapping(seasonal, regional)
    out_path = DATA_PROCESSED_DIR / "seasonal_region_mapping.csv"

    # utf-8-sig: 엑셀에서 한글이 깨지지 않게 BOM을 붙인다.
    with out_path.open("w", encoding="utf-8-sig", newline="") as fp:
        writer = csv.DictWriter(fp, fieldnames=COLUMNS)
        writer.writeheader()
        writer.writerows(rows)

    print(f"저장 완료: {out_path} ({len(rows)}행)")
    if not rows:
        print("  매칭 결과가 없습니다.")
    else:
        summary = Counter((r["region"], r["confidence"]) for r in rows)
        for (region, confidence), count in sorted(summary.items()):
            print(f"  {region} / {confidence}: {count}건")

        by_type = Counter(r["match_type"] for r in rows)
        print("  유형별: " + ", ".join(f"{k} {v}건" for k, v in sorted(by_type.items())))

        curated = sum(1 for r in rows if r["term_source"] == "seafood_curated")
        if curated:
            print(f"  ⚠️ 이 중 {curated}행은 수산물 큐레이션 표 기반입니다 "
                  f"(term_source=seafood_curated). 검수 후 사용하세요.")
