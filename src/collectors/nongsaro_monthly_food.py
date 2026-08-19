"""
농촌진흥청 농사로 '이달의 음식 정보'(monthFd) 수집기 - 제철 데이터의 계절 축.

data.go.kr 데이터셋: https://www.data.go.kr/data/15033496/openapi.do (API 유형 LINK)
실제 API는 농사로가 제공하며, 인증키도 농사로에서 별도 발급받아야 한다
(휴대폰 본인인증 필요).

아래 오퍼레이션/필드명은 농사로가 배포하는 샘플코드(monthFd.zip의 rest/php/*.php)에서
확인한 것이다. 응답은 XML이며 구조는 <response><body><items><item>...</item></items>.

오퍼레이션:
  monthFdYearLst  조회 가능 연도 목록      params: thisYear, thisMonth
  monthFdmtLst    이달의 '식재료' 목록      params: thisYear, thisMonth
  monthNewFdLst   이달의 '음식(레시피)' 목록 params: thisYear, thisMonth
  monthFdmtDtl    식재료 상세               params: cntntsNo
  monthNewFdDtl   음식(레시피) 상세         params: cntntsNo
"""
import json
import time
import xml.etree.ElementTree as ET
from datetime import date

import requests

from src.config import DATA_RAW_DIR, NONGSARO_API_KEY

BASE_URL = "http://api.nongsaro.go.kr/service/monthFd"

# 목록 응답 필드
FDMT_LIST_FIELDS = ["cntntsNo", "fdmtNm", "rtnImgSeCode", "rtnFileCours", "rtnStreFileNm"]
FOOD_LIST_FIELDS = ["cntntsNo", "fdNm", "fdSeCode", "rtnImgSeCode", "rtnFileCours", "rtnStreFileNm"]

# 식재료 상세 필드 (효능/구입요령/보관법 등 - 추천 근거로 쓸 만한 것들)
FDMT_DETAIL_FIELDS = [
    "cntntsNo", "fdmtNm",
    "ctvtIndcDtl",      # 재배 지표
    "prchCheatDtl",     # 구입 요령
    "cstdyMthDtl",      # 보관 방법
    "ntkMthDtl",        # 섭취 방법
    "ntrIrdntEfcyDtl",  # 영양성분 및 효능
    "rltRsrchInfoDtl",  # 관련 연구 정보
    "cnsmpqyDtl",       # 소비량
    "etcInfoDtl",
]

# 음식(레시피) 상세 필드 - 재료/조리법 + 영양성분
FOOD_DETAIL_FIELDS = [
    "fdNm",             # 음식명
    "matrlInfo",        # 재료 정보
    "ckngMthInfo",      # 조리 방법
    "grpMlsvApplcInfo", # 집단급식 적용
    "ckngmhrlsUntInfo", # 조리 단위
    "rmInfo",           # 비고
    "phphmntNm",
    "energyQy", "crbQy", "ntrfsQy", "protQy", "edblfibrQy",
    "vtmaQy", "vteQy", "vtcQy", "thiaQy", "niboplaQy",
    "clciQy", "naQy", "ptssQy", "irnQy",
]


# 상세 조회는 항목당 1회씩 수백 번 호출된다. 커넥션을 재사용하지 않고 연타하면
# 농사로 서버가 연결을 끊는다(ConnectTimeout). 세션 + 페이싱 + 재시도로 완화한다.
_SESSION = requests.Session()
REQUEST_PAUSE = 0.15
MAX_RETRIES = 4


def _get(operation: str, **params) -> ET.Element:
    params = {"apiKey": NONGSARO_API_KEY, **params}
    url = f"{BASE_URL}/{operation}"

    last_exc: Exception | None = None
    for attempt in range(MAX_RETRIES):
        try:
            resp = _SESSION.get(url, params=params, timeout=30)
            resp.raise_for_status()
            break
        except (requests.ConnectionError, requests.Timeout) as exc:
            last_exc = exc
            wait = 2 ** attempt          # 1s, 2s, 4s, 8s
            print(f"  재시도 {attempt + 1}/{MAX_RETRIES} ({operation}): {type(exc).__name__}, {wait}초 대기")
            time.sleep(wait)
    else:
        raise RuntimeError(f"{operation} 연결 실패 ({MAX_RETRIES}회 재시도)") from last_exc

    time.sleep(REQUEST_PAUSE)
    root = ET.fromstring(resp.content)

    code = root.findtext(".//resultCode")
    if code not in (None, "", "00"):
        raise RuntimeError(f"{operation} 실패: resultCode={code} {root.findtext('.//resultMsg')}")
    return root


def _items(root: ET.Element, fields: list[str]) -> list[dict]:
    out = []
    for item in root.findall(".//item"):
        out.append({f: (item.findtext(f) or "").strip() for f in fields})
    return out


def fetch_ingredients(year: int, month: int) -> list[dict]:
    """해당 연·월의 제철 식재료 목록."""
    root = _get("monthFdmtLst", thisYear=str(year), thisMonth=f"{month:02d}")
    return _items(root, FDMT_LIST_FIELDS)


def fetch_foods(year: int, month: int) -> list[dict]:
    """해당 연·월의 이달의 음식(레시피) 목록."""
    root = _get("monthNewFdLst", thisYear=str(year), thisMonth=f"{month:02d}")
    return _items(root, FOOD_LIST_FIELDS)


def fetch_ingredient_detail(cntnts_no: str) -> dict:
    root = _get("monthFdmtDtl", cntntsNo=cntnts_no)
    rows = _items(root, FDMT_DETAIL_FIELDS)
    return rows[0] if rows else {}


def fetch_food_detail(cntnts_no: str) -> dict:
    root = _get("monthNewFdDtl", cntntsNo=cntnts_no)
    rows = _items(root, FOOD_DETAIL_FIELDS)
    return rows[0] if rows else {}


def fetch_available_years() -> list[int]:
    """monthFdYearLst가 알려주는 조회 가능 연도 목록.

    ⚠️ 이 목록은 '데이터가 실제로 있는' 연도와 다르다. 2023은 목록에 있지만
    10월에 식재료 1건뿐이다. 실측 커버리지는 COMPLETE_YEARS 주석 참고.
    """
    today = date.today()
    root = _get("monthFdYearLst", thisYear=str(today.year), thisMonth=f"{today.month:02d}")
    years = []
    for item in root.findall(".//item"):
        text = (item.findtext("year") or "").strip()
        if text.isdigit():
            years.append(int(text))
    return sorted(years)


# 2026-07-30 실측: 12개월이 모두 채워진 연도. 2015는 5~12월만, 2020은 1~2월만,
# 2023은 10월 1건뿐이고, 현재 연도(2026)는 데이터가 아예 없다.
# 그래서 date.today().year로 조회하면 항상 0건이 나온다.
COMPLETE_YEARS = [2016, 2017, 2018, 2019]


def collect_year(year: int, with_details: bool = True) -> dict:
    """특정 연도의 1~12월 식재료/음식 목록(+상세)을 모아 raw JSON으로 저장한다."""
    result = {"year": year, "months": []}

    for month in range(1, 13):
        ingredients = fetch_ingredients(year, month)
        foods = fetch_foods(year, month)

        if with_details:
            for ing in ingredients:
                ing["detail"] = fetch_ingredient_detail(ing["cntntsNo"])
            for fd in foods:
                fd["detail"] = fetch_food_detail(fd["cntntsNo"])

        result["months"].append({"month": month, "ingredients": ingredients, "foods": foods})
        print(f"{year}-{month:02d}: 식재료 {len(ingredients)}건, 음식 {len(foods)}건")

    out_path = DATA_RAW_DIR / f"nongsaro_month_food_{year}.json"
    out_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"저장 완료: {out_path}")
    return result


def _safe_detail(fetcher, cntnts_no: str) -> dict:
    try:
        return fetcher(cntnts_no)
    except RuntimeError as exc:
        print(f"  상세 조회 실패 (cntntsNo={cntnts_no}): {exc}")
        return {}


def _dedup(rows: list[dict], name_key: str) -> list[dict]:
    """cntntsNo 기준으로 중복 제거하되, 같은 이름이 다른 번호로 들어온 경우도 합친다."""
    seen_no: set[str] = set()
    seen_nm: set[str] = set()
    out = []
    for row in rows:
        no = row.get("cntntsNo", "")
        nm = row.get(name_key, "")
        if (no and no in seen_no) or (nm and nm in seen_nm):
            continue
        seen_no.add(no)
        seen_nm.add(nm)
        out.append(row)
    return out


def collect_merged(years: list[int] | None = None, with_details: bool = True) -> dict:
    """여러 연도를 '월' 기준으로 합쳐 저장한다.

    제철 식재료는 해마다 크게 바뀌지 않으므로, 연도별로 따로 두기보다 월별로 합치는 편이
    커버리지가 훨씬 좋다. 같은 항목이 여러 해에 반복 등장하므로 cntntsNo·이름으로 중복 제거한다.
    """
    years = years or COMPLETE_YEARS
    result = {"source_years": years, "months": []}

    for month in range(1, 13):
        ingredients: list[dict] = []
        foods: list[dict] = []
        for year in years:
            ingredients.extend(fetch_ingredients(year, month))
            foods.extend(fetch_foods(year, month))

        ingredients = _dedup(ingredients, "fdmtNm")
        foods = _dedup(foods, "fdNm")

        if with_details:
            # 상세 한 건이 실패해도 수집 전체를 버리지 않는다. 실패분은 detail={}로 남긴다.
            for ing in ingredients:
                ing["detail"] = _safe_detail(fetch_ingredient_detail, ing["cntntsNo"])
            for fd in foods:
                fd["detail"] = _safe_detail(fetch_food_detail, fd["cntntsNo"])

        result["months"].append({"month": month, "ingredients": ingredients, "foods": foods})
        print(f"{month:02d}월: 식재료 {len(ingredients)}건, 음식 {len(foods)}건 "
              f"(중복 제거 후, {len(years)}개 연도 병합)")

    out_path = DATA_RAW_DIR / "nongsaro_month_food_merged.json"
    out_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"저장 완료: {out_path}")
    return result


if __name__ == "__main__":
    if not NONGSARO_API_KEY:
        raise SystemExit(
            "NONGSARO_API_KEY가 .env에 없습니다. "
            "https://www.nongsaro.go.kr/portal/ps/psn/psnj/openApiLst.ps?menuId=PS65428 "
            "에서 '공공데이터 신청' 후 발급받으세요."
        )
    collect_merged()
