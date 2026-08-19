"""
redtable.global 기반 지자체 음식/음식점 DB 수집기 - 지역 축(광주·전남).

대상:
- 전남관광플랫폼(J-TaaS) 음식점 DB: https://jeonnam.openapi.redtable.global
  (데이터셋: https://www.data.go.kr/data/15111780/openapi.do)
- 광주 대표 음식 정보 및 이미지 DB: https://gwangju.openapi.redtable.global
  (데이터셋: https://www.data.go.kr/data/15096577/openapi.do)

아래 경로/파라미터/응답 필드는 각 사이트가 배포하는 'OPEN API 정의서' PDF에서 확인했다.
  전남: /front/docs/openAPI_docs_jeonnam.pdf
  광주: /front/docs/openAPI_docs_gwangju.pdf

공통 규약:
  - REST(GET), 응답 JSON, SSL
  - 요청 파라미터: serviceKey(필수, URL Encode), pageNo(옵션)
  - 응답 봉투: {"header": {resultCode, resultMsg, numOfRows, pageNo, totalCount}, "body": [...]}
  - resultCode "00" = NORMAL_SERVICE

주의: 두 기관이 같은 플랫폼을 쓰지만 **응답 필드명이 서로 다르다**
(예: 메뉴가격이 전남은 MENU_PRC, 광주는 MENU_PRICE / 지역명이 전남은 RGN_NM, 광주는 AREA_NM).
그래서 각 지역 설정에 필드 매핑표를 두고 공통 스키마로 정규화한 뒤 저장한다.
"""
import json
import time
from dataclasses import dataclass, field

import requests

from src.config import (
    DATA_RAW_DIR,
    GWANGJU_REDTABLE_API_KEY,
    JEONNAM_REDTABLE_API_KEY,
)


@dataclass
class RegionSpec:
    """지역별 엔드포인트 경로와 원본→공통 스키마 필드 매핑."""

    label: str
    base_url: str
    api_key: str

    restaurant_path: str
    menu_path: str
    menu_expln_path: str

    # 공통 스키마 키 -> 해당 지역 API의 원본 필드명
    restaurant_fields: dict[str, str] = field(default_factory=dict)
    menu_fields: dict[str, str] = field(default_factory=dict)
    menu_expln_fields: dict[str, str] = field(default_factory=dict)


JEONNAM = RegionSpec(
    label="전남",
    base_url="https://jeonnam.openapi.redtable.global",
    api_key=JEONNAM_REDTABLE_API_KEY,
    restaurant_path="/api/rstr/korean",
    menu_path="/api/menu/korean",
    menu_expln_path="/api/menu-expln/korean",
    restaurant_fields={
        "rstr_id": "RSTR_ID",
        "rstr_nm": "RSTR_NM",
        "branch_nm": "BRNCH_NM",
        "road_addr": "ROAD_NM_ADDR",
        "lotno_addr": "LOTNO_ADDR",
        "lat": "RSTR_LAT",
        "lon": "RSTR_LOT",
        "tel": "RSTR_RPRS_TELNO",
        "bzcnd_nm": "BIZ_CRTFCT_BZSTAT_NM",
        "lcnc_nm": "BIZ_LCPMT_NM",
        "intrcn": "RSTR_EXPLN_CN",
    },
    menu_fields={
        "menu_id": "MENU_ID",
        "menu_nm": "MENU_NM",
        "menu_price": "MENU_PRC",
        "spclt_yn": "SPCLT_MENU_YN",
        "spclt_nm": "SPCLT_MENU_NM",
        "area_nm": "RGN_NM",
        "rstr_id": "RSTR_ID",
        "rstr_nm": "RSTR_NM",
        "branch_nm": "BRNCH_NM",
    },
    menu_expln_fields={
        "menu_id": "MENU_ID",
        "menu_nm": "MENU_NM",
        "menu_expln": "MENU_EXPLN",
        "ctgry_lclas": "MENU_CTGRY_LCLSF_NM",
        "ctgry_sclas": "MENU_CTGRY_SCLSF_NM",
        "rstr_id": "RSTR_ID",
        "rstr_nm": "RSTR_NM",
        "branch_nm": "BRNCH_NM",
        "area_nm": "RGN_NM",
    },
)

GWANGJU = RegionSpec(
    label="광주",
    base_url="https://gwangju.openapi.redtable.global",
    api_key=GWANGJU_REDTABLE_API_KEY,
    restaurant_path="/api/rstr",
    menu_path="/api/menu/korean",
    menu_expln_path="/api/menu-dscrn/korean",
    restaurant_fields={
        "rstr_id": "RSTR_ID",
        "rstr_nm": "RSTR_NM",
        "road_addr": "RSTR_RDNMADR",
        "lotno_addr": "RSTR_LNNO_ADRES",
        "lat": "RSTR_LA",
        "lon": "RSTR_LO",
        "tel": "RSTR_TELNO",
        "bzcnd_nm": "BSNS_STATM_BZCND_NM",
        "lcnc_nm": "BSNS_LCNC_NM",
        "intrcn": "RSTR_INTRCN_CONT",
    },
    menu_fields={
        "menu_id": "MENU_ID",
        "menu_nm": "MENU_NM",
        "menu_price": "MENU_PRICE",
        "spclt_yn": "SPCLT_MENU_YN",
        "spclt_nm": "SPCLT_MENU_NM",
        "area_nm": "AREA_NM",
        "rstr_id": "RSTR_ID",
        "rstr_nm": "RSTR_NM",
    },
    menu_expln_fields={
        "menu_id": "MENU_ID",
        "menu_nm": "MENU_NM",
        "menu_expln": "MENU_DSCRN",
        "ctgry_lclas": "MENU_CTGRY_LCLAS_NM",
        "ctgry_sclas": "MENU_CTGRY_SCLAS_NM",
        "rstr_id": "RSTR_ID",
        "rstr_nm": "RSTR_NM",
        "area_nm": "AREA_NM",
    },
)

REGIONS = {"jeonnam": JEONNAM, "gwangju": GWANGJU}


class RedtableError(RuntimeError):
    """수집을 계속할 수 없는 오류."""


class RedtableAuthError(RedtableError):
    """인증키가 등록되지 않음 (resultCode=30, HTTP 401)."""


class RedtableServerError(RedtableError):
    """제공기관 서버 측 장애 (resultCode=2 DB_ERROR, HTTP 400). 우리 쪽 문제가 아니다."""


# 2026-07-30 실측으로 확인한 코드. 정의서에는 에러코드 표가 없다.
#   00 NORMAL_SERVICE                     정상
#   2  DB_ERROR                    (400)  서버 DB 오류 - 키는 통과했고 그 뒤에서 깨진다
#   30 SERVICE_KEY_IS_NOT_REGISTERED_ERROR(401) 키 누락/오류
SERVER_ERROR_CODES = {"2"}
AUTH_ERROR_CODES = {"30"}


def _request_page(spec: RegionSpec, path: str, page_no: int) -> tuple[list[dict], dict]:
    """한 페이지를 조회해 (body 레코드 목록, header)를 돌려준다."""
    resp = requests.get(
        f"{spec.base_url}{path}",
        params={"serviceKey": spec.api_key, "pageNo": page_no},
        timeout=30,
    )
    try:
        payload = resp.json()
    except ValueError:
        resp.raise_for_status()
        raise RedtableError(f"{spec.label} {path}: JSON이 아닌 응답 ({resp.text[:200]})")

    header = payload.get("header", {})
    code = str(header.get("resultCode", ""))
    msg = header.get("resultMsg")

    if code in AUTH_ERROR_CODES:
        raise RedtableAuthError(
            f"{spec.label} 인증키가 등록되어 있지 않습니다 (resultCode={code} {msg}). "
            f"{spec.base_url}/login 에서 토큰을 다시 확인하세요."
        )
    if code in SERVER_ERROR_CODES:
        raise RedtableServerError(
            f"{spec.label} 제공기관 서버 오류 (resultCode={code} {msg}). "
            f"인증키는 정상이며 서버 측 DB 장애입니다. 시간을 두고 재시도하세요."
        )
    if code and code != "00":
        raise RedtableError(f"{spec.label} {path} 실패: resultCode={code} {msg}")

    body = payload.get("body", [])
    # 정의서 예제는 body가 배열이지만, 일부 엔드포인트가 객체로 감싸는 경우를 대비한다.
    if isinstance(body, dict):
        body = body.get("items", []) or []
    return body, header


def _normalize(row: dict, mapping: dict[str, str], region: str) -> dict:
    out = {"region": region}
    for common_key, src_key in mapping.items():
        value = row.get(src_key)
        out[common_key] = "" if value is None else str(value).strip()
    return out


def fetch_all(spec: RegionSpec, path: str, mapping: dict[str, str],
              max_pages: int = 500, pause: float = 0.2) -> list[dict]:
    """totalCount에 도달할 때까지 pageNo를 늘려가며 전체를 수집한다."""
    if not spec.api_key:
        raise RedtableError(
            f"{spec.label} 인증키가 없습니다. {spec.base_url}/register 에서 발급 후 "
            f".env에 넣으세요."
        )

    rows: list[dict] = []
    total = None

    for page_no in range(1, max_pages + 1):
        body, header = _request_page(spec, path, page_no)
        if not body:
            break

        rows.extend(_normalize(r, mapping, spec.label) for r in body)

        if total is None:
            try:
                total = int(header.get("totalCount", 0))
            except (TypeError, ValueError):
                total = 0
        if total and len(rows) >= total:
            break

        time.sleep(pause)
    else:
        print(f"  경고: {path} max_pages({max_pages}) 도달, 데이터가 더 남았을 수 있습니다.")

    return rows


def collect_region(spec: RegionSpec) -> dict:
    """한 지역의 식당/메뉴/메뉴설명을 모아 raw JSON으로 저장한다."""
    print(f"[{spec.label}] 수집 시작 - {spec.base_url}")

    restaurants = fetch_all(spec, spec.restaurant_path, spec.restaurant_fields)
    print(f"  식당기본정보 {len(restaurants)}건")

    menus = fetch_all(spec, spec.menu_path, spec.menu_fields)
    print(f"  메뉴정보 {len(menus)}건")

    menu_explns = fetch_all(spec, spec.menu_expln_path, spec.menu_expln_fields)
    print(f"  메뉴설명정보 {len(menu_explns)}건")

    result = {
        "region": spec.label,
        "source": spec.base_url,
        "restaurants": restaurants,
        "menus": menus,
        "menu_explanations": menu_explns,
    }

    key = "jeonnam" if spec is JEONNAM else "gwangju"
    out_path = DATA_RAW_DIR / f"redtable_{key}_raw.json"
    out_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  저장 완료: {out_path}")
    return result


def health_check(spec: RegionSpec) -> bool:
    """엔드포인트 1건만 찔러 서비스가 살아있는지 본다. 장애 복구 확인용."""
    if not spec.api_key:
        print(f"[{spec.label}] 인증키 없음")
        return False
    try:
        body, header = _request_page(spec, spec.restaurant_path, 1)
    except RedtableError as exc:
        print(f"[{spec.label}] 장애: {exc}")
        return False
    print(f"[{spec.label}] 정상 - totalCount={header.get('totalCount')} (첫 페이지 {len(body)}건)")
    return True


if __name__ == "__main__":
    import sys

    if "--check" in sys.argv:
        for spec in (GWANGJU, JEONNAM):
            health_check(spec)
        raise SystemExit(0)

    for spec in (GWANGJU, JEONNAM):
        try:
            collect_region(spec)
        except RedtableError as exc:
            print(f"건너뜀: {exc}")
