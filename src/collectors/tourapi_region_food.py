"""
한국관광공사 TourAPI(KorService2) 음식점 수집기 - 지역 축 대체·보강 소스.

redtable(광주·전남)이 플랫폼 전면 장애라 지역 축이 비어 있어서 찾은 대체 소스다.
redtable과 달리 **data.go.kr REST 유형**이므로 기관 사이트 별도 가입이 필요 없고,
개발단계는 자동승인이다.

데이터셋: https://www.data.go.kr/data/15101578/openapi.do
공식 문서: https://api.visitkorea.or.kr/#/useKoreaGuide

아래 오퍼레이션·파라미터·응답 필드는 위 공식 문서에서 직접 확인했다 (2026-07-30).

  ldongCode2      법정동 코드 조회   lDongRegnCd 생략 시 전체 시도 목록
  areaBasedList2  지역기반 관광정보  contentTypeId + lDongRegnCd 로 필터
  detailIntro2    소개 정보 조회     타입별 필드가 다름. 39(음식점)에 메뉴 필드가 있다
  detailCommon2   공통 정보 조회     overview(개요) 등

핵심: **contentTypeId=39 가 음식점**이고, detailIntro2가 이 타입에 대해
  firstmenu  대표메뉴
  treatmenu  취급메뉴   <- 메뉴 목록. 매칭의 핵심 근거
  opentimefood/restdatefood/parkingfood/seat/lcnsno ...
를 준다. redtable의 MENU_NM / MENU_EXPLN 역할을 대신할 수 있다.

⚠️ 지역코드를 하드코딩하지 않는다. 데이터포털에 제공기관이 '전남광주통합특별시'로
   등록돼 있어 행정구역 통합으로 법정동 시도 코드가 바뀌었을 가능성이 있다.
   그래서 ldongCode2로 시도 목록을 받아 **이름으로 매칭**해 코드를 찾는다.
"""
import json
import re
import time
from collections import Counter
from pathlib import Path

import requests

from src.config import DATA_RAW_DIR, TOURAPI_SERVICE_KEY as TOURAPI_KEY

BASE_URL = "https://apis.data.go.kr/B551011/KorService2"
CONTENT_TYPE_RESTAURANT = 39

# MobileOS/MobileApp은 필수 파라미터다. 값 자체는 임의 문자열이어도 통과한다.
COMMON_PARAMS = {"MobileOS": "ETC", "MobileApp": "HonamSeasonalFood", "_type": "json"}

# 시도명에 이 문자열이 들어가면 우리 대상 지역으로 본다.
# '전남광주통합특별시'처럼 통합 명칭이 와도 걸리도록 넉넉하게 잡는다.
TARGET_REGION_KEYWORDS = ("광주", "전남", "전라남")

REQUEST_PAUSE = 0.12
MAX_RETRIES = 4


class TourApiError(RuntimeError):
    pass


def _get(operation: str, **params) -> dict:
    if not TOURAPI_KEY:
        raise TourApiError(
            "TOURAPI_SERVICE_KEY가 .env에 없습니다.\n"
            "  https://www.data.go.kr/data/15101578/openapi.do 에서 활용신청(개발단계 자동승인) 후\n"
            "  발급된 일반 인증키를 .env의 TOURAPI_SERVICE_KEY에 넣으세요."
        )

    url = f"{BASE_URL}/{operation}"
    query = {"serviceKey": TOURAPI_KEY, **COMMON_PARAMS, **params}

    last: Exception | None = None
    for attempt in range(MAX_RETRIES):
        try:
            resp = requests.get(url, params=query, timeout=30)
            resp.raise_for_status()
            break
        except (requests.ConnectionError, requests.Timeout) as exc:
            last = exc
            wait = 2 ** attempt
            print(f"  재시도 {attempt + 1}/{MAX_RETRIES} ({operation}): {type(exc).__name__}, {wait}초 대기")
            time.sleep(wait)
    else:
        raise TourApiError(f"{operation} 연결 실패 ({MAX_RETRIES}회 재시도)") from last

    time.sleep(REQUEST_PAUSE)

    try:
        payload = resp.json()
    except ValueError:
        # 키가 미승인이거나 트래픽 초과면 XML 에러 문서가 온다.
        raise TourApiError(f"{operation}: JSON이 아닌 응답 — {resp.text[:300]}")

    header = (payload.get("response") or {}).get("header") or {}
    code = str(header.get("resultCode", ""))
    if code and code != "0000":
        raise TourApiError(f"{operation} 실패: resultCode={code} {header.get('resultMsg')}")

    return (payload.get("response") or {}).get("body") or {}


def _items(body: dict) -> list[dict]:
    """items가 빈 문자열이거나 item이 단일 객체로 오는 경우를 모두 흡수한다."""
    items = body.get("items")
    if not items:
        return []
    item = items.get("item") if isinstance(items, dict) else None
    if item is None:
        return []
    return item if isinstance(item, list) else [item]


# --------------------------------------------------------------------------
# 1) 지역코드 탐색 - 하드코딩하지 않는다
# --------------------------------------------------------------------------
def fetch_region_codes() -> list[dict]:
    """전체 시도 목록에서 광주·전남에 해당하는 코드를 찾아낸다."""
    body = _get("ldongCode2", numOfRows=100, pageNo=1, lDongListYn="N")
    rows = _items(body)

    found = []
    for row in rows:
        name = (row.get("name") or "").strip()
        code = (row.get("code") or "").strip()
        if any(k in name for k in TARGET_REGION_KEYWORDS):
            found.append({"code": code, "name": name})

    if not found:
        names = ", ".join((r.get("name") or "") for r in rows)
        raise TourApiError(
            f"광주·전남에 해당하는 시도 코드를 찾지 못했습니다. 조회된 시도: {names}"
        )
    return found


# --------------------------------------------------------------------------
# 2) 음식점 목록
# --------------------------------------------------------------------------
LIST_FIELDS = ["contentid", "title", "addr1", "addr2", "tel", "mapx", "mapy",
               "firstimage", "lDongRegnCd", "lDongSignguCd", "modifiedtime"]


def fetch_restaurants(region_code: str, page_size: int = 100,
                      max_pages: int = 200) -> list[dict]:
    """한 시도의 음식점(contentTypeId=39) 목록 전체."""
    rows: list[dict] = []
    total = None

    for page_no in range(1, max_pages + 1):
        body = _get("areaBasedList2",
                    numOfRows=page_size, pageNo=page_no, arrange="C",
                    contentTypeId=CONTENT_TYPE_RESTAURANT, lDongRegnCd=region_code)
        items = _items(body)
        if not items:
            break

        for it in items:
            rows.append({f: str(it.get(f) or "").strip() for f in LIST_FIELDS})

        if total is None:
            try:
                total = int(body.get("totalCount") or 0)
            except (TypeError, ValueError):
                total = 0
        if total and len(rows) >= total:
            break
    else:
        print(f"  경고: max_pages({max_pages}) 도달, 데이터가 더 남았을 수 있습니다.")

    return rows


# --------------------------------------------------------------------------
# 3) 음식점 소개정보 - 메뉴가 여기 있다
# --------------------------------------------------------------------------
INTRO_FIELDS = ["firstmenu", "treatmenu", "opentimefood", "restdatefood",
                "parkingfood", "seat", "packing", "reservationfood",
                "infocenterfood", "scalefood", "lcnsno"]


def fetch_intro(content_id: str) -> dict:
    body = _get("detailIntro2", contentId=content_id,
                contentTypeId=CONTENT_TYPE_RESTAURANT, numOfRows=10, pageNo=1)
    rows = _items(body)
    if not rows:
        return {}
    it = rows[0]
    return {f: str(it.get(f) or "").strip() for f in INTRO_FIELDS}


def _safe_intro(content_id: str) -> dict:
    try:
        return fetch_intro(content_id)
    except TourApiError as exc:
        print(f"  소개정보 실패 (contentid={content_id}): {exc}")
        return {}


# --------------------------------------------------------------------------
# 4) redtable과 같은 스키마로 정규화
# --------------------------------------------------------------------------
def _region_label(name: str) -> str:
    """매핑 결과에 쓸 짧은 지역 라벨."""
    if "광주" in name and "전남" not in name and "전라남" not in name:
        return "광주"
    if "전남" in name or "전라남" in name:
        return "전남"
    return name


# 광주광역시의 자치구 5개. 행정구역이 '전남광주통합특별시'로 통합되면서 시도명만으로는
# 광주와 전남을 가를 수 없게 됐고, 주소의 시·군·구 토큰이 유일한 근거가 됐다.
GWANGJU_DISTRICTS = ("동구", "서구", "남구", "북구", "광산구")
_SIGUNGU_SUFFIX = ("시", "군", "구")


def split_area(addr: str) -> tuple[str, str]:
    """주소에서 (지역, 시·군·구)를 뽑는다.

    시도가 통합돼 `lDongRegnCd` 하나에 광주와 전남이 다 들어온다. 그래서 수집 단위
    라벨을 그대로 쓰면 광주 음식점까지 '전남'이 되고, 시·군 단위 추천이 불가능해진다.
    주소 두 번째 토큰(`전남광주통합특별시 여수시 ...`)이 실제 시·군·구다.
    """
    parts = (addr or "").split()
    sigungu = ""
    for tok in parts[1:]:                      # parts[0]은 시도명
        if tok.endswith(_SIGUNGU_SUFFIX):
            sigungu = tok
            break
    if not sigungu:
        return "", ""
    return ("광주" if sigungu in GWANGJU_DISTRICTS else "전남"), sigungu


_MENU_SEP = "[,/·・、|\n]"
_OPEN, _CLOSE = "(（[", ")）]"


def split_menu_list(treat: str) -> list[str]:
    """취급메뉴 문자열을 개별 메뉴로 쪼갠다.

    괄호 안의 쉼표에서는 자르지 않는다. '조림(병어, 갈치)'를 그냥 쉼표로
    자르면 '조림(병어'와 '갈치)'라는 없는 메뉴 둘이 생기고, 뒷조각은 재료명만
    남아 조리법을 알 수 없게 된다. 닫는 괄호가 없이 끝나는 원문도 있어
    깊이는 0 아래로 내려가지 않게 막는다.
    """
    parts, buf, depth = [], [], 0
    for ch in treat:
        if ch in _OPEN:
            depth += 1
        elif ch in _CLOSE:
            depth = max(0, depth - 1)
        if depth == 0 and re.match(_MENU_SEP, ch):
            parts.append("".join(buf))
            buf = []
            continue
        buf.append(ch)
    parts.append("".join(buf))
    return [p.strip() for p in parts if p.strip()]


def build_normalized(region_label: str, restaurants: list[dict],
                     intros: dict[str, dict]) -> dict:
    """redtable_region_food가 저장하는 구조와 같은 모양으로 만든다.

    redtable은 식당 1건에 메뉴 N건이지만 TourAPI는 식당 1건에
    대표메뉴 1개 + 취급메뉴 문자열 1개다. 취급메뉴를 개별 메뉴로 쪼개
    메뉴명 단위 매칭(신뢰도 high)이 가능하게 만든다.
    """
    rstr_rows, menu_rows, expln_rows = [], [], []

    for r in restaurants:
        cid = r["contentid"]
        intro = intros.get(cid, {})
        addr = " ".join(x for x in (r.get("addr1", ""), r.get("addr2", "")) if x).strip()
        # 통합 시도라 수집 단위 라벨(region_label)로는 광주/전남이 갈리지 않는다.
        # 주소에서 뽑은 값을 우선하고, 못 뽑으면 수집 라벨로 떨어진다.
        row_region, sigungu = split_area(addr)
        row_region = row_region or region_label
        area_nm = sigungu or region_label

        rstr_rows.append({
            "region": row_region,
            "rstr_id": cid,
            "rstr_nm": r.get("title", ""),
            "road_addr": addr,
            "lotno_addr": "",
            "lat": r.get("mapy", ""),      # TourAPI는 mapy=위도, mapx=경도
            "lon": r.get("mapx", ""),
            "tel": r.get("tel", ""),
            "bzcnd_nm": "",
            "lcnc_nm": intro.get("lcnsno", ""),
            "intrcn": "",
        })

        first = intro.get("firstmenu", "")
        treat = intro.get("treatmenu", "")

        names = []
        if first:
            names.append(first)
        for part in split_menu_list(treat):
            if part not in names:
                names.append(part)

        for idx, name in enumerate(names):
            menu_id = f"{cid}-{idx}"
            menu_rows.append({
                "region": row_region,
                "menu_id": menu_id,
                "menu_nm": name,
                "menu_price": "",
                "spclt_yn": "Y" if (first and name == first) else "N",
                "spclt_nm": first if (first and name == first) else "",
                "area_nm": area_nm,
                "rstr_id": cid,
                "rstr_nm": r.get("title", ""),
            })
            expln_rows.append({
                "region": row_region,
                "menu_id": menu_id,
                "menu_nm": name,
                # ⚠️ 비워 둔다. redtable의 MENU_EXPLN은 '주재료' 목록이라 토큰 매칭에
                # 의미가 있지만, TourAPI의 treatmenu는 '메뉴명' 목록이다. 이미 개별
                # 메뉴로 쪼갠 뒤에 전체 문자열을 설명으로 넣으면 같은 식당의 메뉴끼리
                # 서로 오염된다 (예: '매생이'가 같은 집 '전복죽'에 medium으로 걸림).
                "menu_expln": "",
                "ctgry_lclas": "음식점",
                "ctgry_sclas": "",
                "rstr_id": cid,
                "rstr_nm": r.get("title", ""),
                "area_nm": area_nm,
            })

    return {
        "region": region_label,
        "source": f"{BASE_URL} (TourAPI KorService2, contentTypeId=39)",
        "restaurants": rstr_rows,
        "menus": menu_rows,
        "menu_explanations": expln_rows,
    }


def collect_region(code: str, name: str, with_intro: bool = True) -> dict:
    label = _region_label(name)
    print(f"[{label}] {name} (lDongRegnCd={code}) 수집 시작")

    restaurants = fetch_restaurants(code)
    print(f"  음식점 {len(restaurants)}건")

    intros: dict[str, dict] = {}
    if with_intro:
        for i, r in enumerate(restaurants, 1):
            intros[r["contentid"]] = _safe_intro(r["contentid"])
            if i % 50 == 0:
                print(f"  소개정보 {i}/{len(restaurants)}")

    result = build_normalized(label, restaurants, intros)
    print(f"  메뉴 {len(result['menus'])}건으로 정규화")

    key = "gwangju" if label == "광주" else "jeonnam"
    out_path = DATA_RAW_DIR / f"tourapi_{key}_raw.json"
    out_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  저장 완료: {out_path}")
    return result


def relabel_saved(path: Path) -> dict:
    """이미 저장된 raw의 region/area_nm을 주소 기준으로 다시 매긴다.

    개발계정은 오퍼레이션당 일일 1000건이라 재수집이 비싸다(음식점 974건 = 소개정보 974콜).
    라벨링은 저장된 `road_addr`만으로 재계산되므로 API를 다시 부르지 않는다.
    """
    raw = json.loads(path.read_text(encoding="utf-8"))
    fallback = raw.get("region", "")

    by_rstr: dict[str, tuple[str, str]] = {}
    for r in raw.get("restaurants", []):
        region, sigungu = split_area(r.get("road_addr", ""))
        region, sigungu = region or fallback, sigungu or fallback
        by_rstr[r.get("rstr_id")] = (region, sigungu)
        r["region"] = region

    for key in ("menus", "menu_explanations"):
        for row in raw.get(key, []):
            region, sigungu = by_rstr.get(row.get("rstr_id"), (fallback, fallback))
            row["region"] = region
            row["area_nm"] = sigungu

    path.write_text(json.dumps(raw, ensure_ascii=False, indent=2), encoding="utf-8")
    return raw


def health_check() -> bool:
    """키가 살아있는지, 대상 지역코드가 잡히는지 확인한다."""
    try:
        codes = fetch_region_codes()
    except TourApiError as exc:
        print(f"[TourAPI] 사용 불가: {exc}")
        return False
    print("[TourAPI] 정상 - 대상 시도: " +
          ", ".join(f"{c['name']}({c['code']})" for c in codes))
    return True


if __name__ == "__main__":
    import sys

    if "--check" in sys.argv:
        raise SystemExit(0 if health_check() else 1)

    if "--relabel" in sys.argv:
        # 재수집 없이 저장된 raw의 지역 라벨만 고친다 (일일 트래픽 절약).
        for p in sorted(DATA_RAW_DIR.glob("tourapi_*_raw.json")):
            raw = relabel_saved(p)
            counts = Counter(m["area_nm"] for m in raw.get("menus", []))
            print(f"{p.name}: 메뉴 {sum(counts.values())}건 / 시·군구 {len(counts)}개")
        raise SystemExit(0)

    try:
        regions = fetch_region_codes()
    except TourApiError as exc:
        raise SystemExit(str(exc))

    print("대상 시도: " + ", ".join(f"{c['name']}({c['code']})" for c in regions))
    for c in regions:
        collect_region(c["code"], c["name"])
