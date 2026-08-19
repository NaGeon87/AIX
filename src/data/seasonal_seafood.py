"""
월별 제철 수산물 표 - 계절 축의 수산물 보완.

⚠️ 이 파일은 **API에서 받아온 데이터가 아니라 수동 큐레이션 표**다.
농사로 '이달의 음식'은 농촌진흥청 소관이라 농산물만 다루고 수산물이 아예 없다.
그런데 광주·전남은 해안권이고, 특히 전남은 수산물이 음식 정체성의 핵심이다.

2026-07-30 조사 결과 **월별 제철 수산물을 제공하는 공공데이터 API는 존재하지 않는다.**
  - data.go.kr `제철` 키워드 오픈API 3건: 농사로 이달의 음식 / 농사로 추천식단 /
    국가유산청 제철유적 목록(제철소 유적, 무관)
  - `금어기`·`포획금지기간` 데이터셋 없음
  - 해양수산부_연도별 총괄 어업생산통계(15043939)는 REST지만 **연도별 총괄**이라
    어종별·월별 분해가 없음
  - KAMIS 오픈API는 부류별 가격만 제공, 제철 플래그 없음
  - `수산물` 오픈API 114건은 수출입·방사능·품질인증·재고 등 계절성과 무관

그래서 해양수산부 '이달의 수산물'과 지자체 특산물 공개자료에서 통용되는 제철 시기를
정리해 표로 넣었다. **자동 수집된 값이 아니므로 실서비스 전 수산 전문가 검수가 필요하다.**
API가 개설되면 이 모듈을 수집기로 대체할 것.

`is_specialty`는 광주·전남 특산으로 널리 알려진 품목 표시용이다
(예: 벌교 꼬막, 완도 전복, 영광 굴비, 목포 홍어·민어, 신안 김·낙지, 장흥 키조개).
"""
from dataclasses import dataclass

SOURCE_LABEL = "curated:해양수산부·지자체 공개 제철 수산물 자료 종합 (API 아님, 검수 필요)"


@dataclass(frozen=True)
class SeafoodItem:
    name: str
    is_specialty: bool = False   # 광주·전남 특산으로 널리 알려진 품목
    note: str = ""               # 특산지 등 참고 메모


def _s(name: str, note: str = "") -> SeafoodItem:
    """전남·광주 특산 품목."""
    return SeafoodItem(name, True, note)


# 월 -> 제철 수산물 목록
SEASONAL_SEAFOOD: dict[int, list[SeafoodItem]] = {
    1: [_s("굴", "여자만·보성"), _s("매생이", "강진·완도"), _s("김", "신안·완도"),
        SeafoodItem("대구"), SeafoodItem("아귀"), SeafoodItem("홍합"),
        _s("낙지", "무안·신안"), SeafoodItem("방어")],
    2: [_s("굴", "여자만·보성"), _s("매생이", "강진·완도"), _s("김", "신안·완도"),
        SeafoodItem("아귀"), SeafoodItem("바지락"), SeafoodItem("가리비"),
        _s("홍어", "목포·흑산도"), _s("꼬막", "벌교")],
    3: [SeafoodItem("주꾸미"), SeafoodItem("도다리"), SeafoodItem("바지락"),
        _s("조기", "영광"), _s("톳", "완도"), _s("미역", "완도"),
        SeafoodItem("멍게"), SeafoodItem("삼치")],
    4: [SeafoodItem("주꾸미"), SeafoodItem("멍게"), SeafoodItem("도다리"),
        SeafoodItem("갑오징어"), _s("조기", "영광"), _s("다시마", "완도"),
        SeafoodItem("소라"), _s("키조개", "장흥")],
    5: [_s("병어", "신안"), SeafoodItem("멸치"), SeafoodItem("갑오징어"),
        SeafoodItem("삼치"), SeafoodItem("우럭"), SeafoodItem("농어"),
        _s("키조개", "장흥"), SeafoodItem("붕장어")],
    6: [_s("민어", "목포"), SeafoodItem("갑오징어"), _s("전복", "완도"),
        _s("다시마", "완도"), SeafoodItem("성게"), _s("병어", "신안"),
        SeafoodItem("붕장어")],
    7: [_s("민어", "목포"), _s("전복", "완도"), SeafoodItem("붕장어"),
        SeafoodItem("농어"), SeafoodItem("갈치"), SeafoodItem("오징어")],
    8: [_s("민어", "목포"), _s("전복", "완도"), SeafoodItem("갈치"),
        SeafoodItem("오징어"), SeafoodItem("붕장어"), _s("병어", "신안")],
    9: [SeafoodItem("대하"), SeafoodItem("꽃게"), SeafoodItem("고등어"),
        SeafoodItem("갈치"), _s("낙지", "무안·신안"), _s("전어", "광양·보성")],
    10: [_s("전어", "광양·보성"), SeafoodItem("꽃게"), SeafoodItem("대하"),
         SeafoodItem("고등어"), _s("낙지", "무안·신안"), SeafoodItem("홍합"),
         SeafoodItem("삼치")],
    11: [_s("굴", "여자만·보성"), _s("홍어", "목포·흑산도"), _s("낙지", "무안·신안"),
         SeafoodItem("삼치"), SeafoodItem("고등어"), SeafoodItem("방어"),
         _s("꼬막", "벌교")],
    12: [_s("굴", "여자만·보성"), _s("매생이", "강진·완도"), _s("꼬막", "벌교"),
         SeafoodItem("방어"), SeafoodItem("대구"), _s("홍어", "목포·흑산도"),
         _s("김", "신안·완도")],
}


def iter_seafood() -> list[tuple[int, SeafoodItem]]:
    """(월, 품목) 쌍을 평탄화해 돌려준다."""
    out = []
    for month in range(1, 13):
        for item in SEASONAL_SEAFOOD.get(month, []):
            out.append((month, item))
    return out


def unique_names() -> list[str]:
    return sorted({item.name for _, item in iter_seafood()})


if __name__ == "__main__":
    rows = iter_seafood()
    names = unique_names()
    print(f"출처: {SOURCE_LABEL}")
    print(f"월×품목 {len(rows)}건, 고유 품목 {len(names)}종")
    print()
    for month in range(1, 13):
        items = SEASONAL_SEAFOOD[month]
        marks = ", ".join(f"{i.name}*" if i.is_specialty else i.name for i in items)
        print(f"{month:2d}월: {marks}")
    print()
    print("* = 광주·전남 특산으로 알려진 품목")
