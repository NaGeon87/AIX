"""메뉴명에서 취향 지표 네 가지를 산출하는 룰 엔진.

지표
----
- spicy            0 안 매움 / 1 약간 / 2 매움 / 3 아주 매움
- has_soup         국물 요리인가 (True/False)
- is_raw           날것으로 먹는가 (True/False)
- main_ingredients 주재료 분류 — 해산물 | 육류 | 채소
                   대표 재료 하나만 붙이되, 두 계열이 각각 독립된 재료어로
                   이름에 있고 어느 하나를 빼면 그 음식이 아닐 때만
                   (전복삼계탕, 홍어삼합) 둘 다 붙인다.

설계 원칙
---------
조리법이 국물 유무와 맵기를 결정하고, 재료명이 주재료 분류와 날것 여부를
결정한다. 그래서 사전을 조리법 계열과 재료 계열로 나눠 두었다.

주재료·맵기 판정은 resolve_ingredients / resolve_spicy 하나로만 한다.
판정 근거(reason)를 함께 돌려주므로 relabel_review.py가 검수 자료를 만들 때
같은 함수를 쓴다. 기준을 고칠 곳은 여기 한 군데다.

신뢰도(confidence)는 "조리법과 재료를 각각 짚었는가"로 매긴다. 0.6 미만은
사람이 직접 매기는 대상이다(manual_labels.py).
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, asdict

# 주재료 분류. "채소"는 식물성 전반(곡물·과일·버섯 포함)을 뜻한다.
SEAFOOD = "해산물"
MEAT = "육류"
VEGGIE = "채소"
CATEGORIES = (SEAFOOD, MEAT, VEGGIE)

SPICY_MIN, SPICY_MAX = 0, 3


def _hits(text: str, tokens: tuple[str, ...]) -> str | None:
    """가장 긴 매칭 토큰을 돌려준다. 없으면 None.

    긴 쪽을 택해야 '수육'이 '탕수육'을, '게장'이 '양념게장'을 가로채지 않는다.
    """
    best = None
    for token in tokens:
        if token in text and (best is None or len(token) > len(best)):
            best = token
    return best


# --------------------------------------------------------------------------
# 정규화
# --------------------------------------------------------------------------

_TRAILING_NOISE = re.compile(r"[\s,/·]*(등|외|기타)\s*$")
_BRACKETS = re.compile(r"[（(\[][^）)\]]*[）)\]]?")
_PRICE_NOTE = re.compile(r"※.*$")
_MULTISPACE = re.compile(r"\s+")
_NOT_A_MENU = re.compile(r"(변동|문의|권장|예약|사전|참고 요망)")


def normalize_menu(name: str) -> str:
    """비교·매칭용으로 메뉴명을 다듬는다. 표시용 이름과는 별개다."""
    if not name:
        return ""
    text = unicodedata.normalize("NFKC", name)
    text = _PRICE_NOTE.sub("", text)
    text = _BRACKETS.sub(" ", text)
    text = text.replace("ㆍ", " ").replace("·", " ")
    text = _MULTISPACE.sub(" ", text).strip()
    for _ in range(2):
        text = _TRAILING_NOISE.sub("", text).strip()
    return text


def is_menu_like(name: str) -> bool:
    text = normalize_menu(name)
    if len(text) < 2 or len(text) > 40:
        return False
    return not _NOT_A_MENU.search(text)


# --------------------------------------------------------------------------
# 코스 — 디저트·음료는 맵기와 국물을 따질 대상이 아니다.
# --------------------------------------------------------------------------

DRINK_KEYWORDS = (
    "라떼", "에이드", "스무디", "아메리카노", "커피", "아인슈페너", "쥬스", "주스",
    "우유", "차 ", "티", "식혜", "수정과", "쌍화차", "모히또", "아이스티", "밀크",
)
DESSERT_KEYWORDS = (
    "빙수", "케이크", "케익", "타르트", "크로플", "와플", "파르페", "젤라또", "아이스크림",
    "빵", "베이글", "도넛", "도나스", "쿠키", "약과", "양갱", "푸딩", "깜빠뉴", "파운드",
    "떡", "개떡", "전병", "스프", "샐러드", "피자", "파스타", "라자냐", "리소토", "돈까스",
)
_COURSE_OVERRIDE_MEAL = (
    "떡국", "떡갈비", "떡볶이", "물떡", "쌀떡", "치즈떡",
    "죽순떡갈비", "오리떡갈비", "닭떡갈비", "유황오리떡갈비",
)
# 차·음료 계열인데 위 사전에 안 걸리는 이름들. 룰이 "차"를 못 잡아 식사로
# 넘기던 항목들이라 따로 적어 둔다.
_EXPLICIT_DRINKS = (
    "대추차", "유자차", "생강차", "쑥차", "잎차", "통차", "도라지차", "배차",
    "오미자", "한라봉", "매실차", "구기자",
)


def classify_course(menu_norm: str) -> str:
    """'식사' | '디저트' | '음료'."""
    for kw in _EXPLICIT_DRINKS:
        if kw in menu_norm:
            return "음료"
    for kw in _COURSE_OVERRIDE_MEAL:
        if kw in menu_norm:
            return "식사"
    for kw in DRINK_KEYWORDS:
        if kw in menu_norm:
            return "음료"
    for kw in DESSERT_KEYWORDS:
        if kw in menu_norm:
            return "디저트"
    return "식사"


# --------------------------------------------------------------------------
# 국물 — 조리법이 정하고, 가장 강한 신호 하나를 채택한다.
# --------------------------------------------------------------------------

SOUP_KEYWORDS = (
    "연포탕", "매운탕", "지리", "간국", "해신탕", "탕", "국밥", "곰탕", "삼계탕",
    "육개장", "찌개", "전골", "샤브", "뚝배기", "국", "칼국수", "수제비", "라면",
    "짬뽕", "쌀국수", "물회", "떡국", "죽", "해장국", "백숙", "곰국",
)
# 위 키워드를 품고 있어도 국물 요리가 아닌 것들. "탕탕이"가 대표 사례다.
NO_SOUP_OVERRIDE = (
    "탕탕이", "탕수육", "탕평채", "설렁탕면", "국수전골",
)
# 이름에 국물 키워드가 없어도 국물이 있는 것.
EXTRA_SOUP = ("국수", "냉면", "우동", "메밀국수")
# 국수류 중 비빔은 국물이 없다.
NOODLE_NO_SOUP = ("비빔", "짜장", "쟁반", "골동면", "초계")


def detect_soup(text: str) -> tuple[bool, bool]:
    """(국물 여부, 조리법을 짚었는지) 를 돌려준다."""
    for kw in NO_SOUP_OVERRIDE:
        if kw in text:
            return False, True
    for kw in SOUP_KEYWORDS:
        if kw in text:
            return True, True
    for kw in EXTRA_SOUP:
        if kw in text:
            if any(x in text for x in NOODLE_NO_SOUP):
                return False, True
            return True, True
    # 국물이 없다고 확실히 말할 수 있는 조리법
    for kw in ("구이", "회", "무침", "전", "튀김", "볶음", "찜", "조림", "밥",
               "정식", "백반", "쌈밥", "보쌈", "수육", "장", "젓갈", "숙회",
               "사시미", "초밥", "샤브샤브용"):
        if kw in text:
            return False, True
    return False, False


# --------------------------------------------------------------------------
# 맵기 0~3
# --------------------------------------------------------------------------

# 기준
#   0 전혀 안 매움
#   1 양념이 들어가긴 하나 매운맛이 주요맛이 아님
#   2 매운 양념이 음식의 주요맛
#   3 강한 매운맛을 특징으로 하는 음식
#
# 옛 사전은 3단계 신호가 '아주 매운' 같은 수식어뿐이라 600건 중 5건만 3이
# 나왔다. 지표 구실을 못 해서, 음식 이름 자체가 매운맛을 뜻하는 것들을
# 3단계로 올렸다.

# 3 — 강한 매운맛 자체가 그 음식의 특징
SPICY3_TOKENS = (
    "아주 매운", "매운", "얼큰", "불닭", "화끈", "땡초", "청양",
    "매운탕", "아귀찜", "아구찜", "낙지볶음", "짬뽕", "육개장", "떡볶이", "닭발",
)
# 2 — 매운 양념이 주요맛
SPICY2_TOKENS = (
    "무침", "비빔", "볶음", "제육", "주물럭", "매콤", "조림", "찌개", "물회",
    "덮밥", "라면", "순두부", "김치", "묵은지", "쟁반", "알탕", "꽃게탕", "고추장",
)
# 1 — 양념은 있으나 매운맛이 주요맛은 아님
SPICY1_TOKENS = (
    "게장", "간장", "꼬막장", "전복장", "젓갈", "젓", "떡갈비", "갈비", "불고기",
    "불백", "숯불", "국밥", "보쌈", "잡채", "찜", "전골", "쌈밥", "호롱", "짜장",
    "추어", "보리밥", "청국장",
)
# 맵지 않다고 이름이 말해 주는 조리법. 2·1보다 먼저 본다.
NOT_SPICY_TOKENS = (
    "하얀", "맑은", "지리", "간국", "샤브", "백숙", "삼계탕", "탕수", "수육",
    "초밥", "사시미", "숙회", "연포탕",
)
# 순한 조리법. 구체 신호를 다 본 뒤, '정식/백반'으로 넘어가기 전에 본다.
MILD_TOKENS = (
    "회", "구이", "죽", "튀김", "칼국수", "수제비", "냉면", "떡국", "솥밥", "묵밥",
    "만두", "국수", "탕", "국", "뚝배기", "전병", "파전", "육전", "스테이크",
    "샐러드", "파스타", "피자", "리소토",
)
# 이것만으로는 맵기를 정할 수 없는, 상차림을 가리키는 말
SET_TOKENS = ("정식", "백반", "한상", "세트", "코스")

# 생선 + 찜은 고춧가루 양념찜이다. 꽃게찜·전복찜과는 다르다.
FISH_FOR_STEAM = ("갈치", "병어", "우럭", "대구", "코다리", "명태", "홍어", "삼치", "고등어")

# 이름만으로는 룰이 놓치는 것들. 근거를 함께 적는다.
SPICY_EXCEPTIONS: dict[str, tuple[int, str]] = {
    "고추잡채": (2, "고추·피망이 주재료라 매운맛이 주요맛이다"),
    "홍어애탕": (1, "된장·보리순 국물이라 매운맛이 주요맛은 아니다"),
    "보리애국": (1, "된장 국물에 보리순을 넣는다"),
    "아귀대창": (2, "매콤한 양념으로 내는 것이 일반적이나 조리법이 이름에 없다"),
    "표고버섯 메밀 골동면": (1, "골동면은 비빔면이나 양념이 간장인지 고추장인지 이름에 없다"),
}


def resolve_spicy(menu_norm: str, course: str) -> dict:
    """{"level": 0~3, "reason": 판정 근거, "matched": 근거가 된 말}.

    판정 근거는 메뉴명뿐이다. 매칭된 제철 식재료는 보지 않는다. '갈치'가
    맵기를 정하지는 않기 때문이다.
    """
    if course in ("디저트", "음료"):
        return {"level": 0, "reason": f"{course}라 맵기를 따질 대상이 아니다", "matched": course}

    for name, (level, reason) in SPICY_EXCEPTIONS.items():
        if name in menu_norm:
            return {"level": level, "reason": reason, "matched": name}

    token = _hits(menu_norm, SPICY3_TOKENS)
    if token:
        return {"level": 3, "reason": f"'{token}'은 강한 매운맛 자체가 특징인 음식이다", "matched": token}
    if "양념" in menu_norm and ("게장" in menu_norm or "꼬막" in menu_norm):
        return {"level": 3, "reason": "양념게장·양념꼬막은 고춧가루 양념의 매운맛이 특징이다", "matched": "양념"}
    if "주꾸미" in menu_norm and ("볶음" in menu_norm or "쌈밥" in menu_norm):
        return {"level": 3, "reason": "주꾸미볶음은 강한 매운맛이 특징이다", "matched": "주꾸미볶음"}

    token = _hits(menu_norm, NOT_SPICY_TOKENS)
    if token:
        return {"level": 0, "reason": f"'{token}'은 맵게 내지 않는 조리법이다", "matched": token}

    if "된장" in menu_norm or "청국장" in menu_norm:
        return {"level": 1, "reason": "된장·청국장 양념이라 매운맛이 주요맛은 아니다", "matched": "된장"}

    if "찜" in menu_norm:
        fish = _hits(menu_norm, FISH_FOR_STEAM)
        if fish:
            return {"level": 2, "reason": f"{fish}찜은 고춧가루 양념이 주요맛이다", "matched": f"{fish}찜"}

    # 전골은 넣는 재료가 정한다. 아래에서 따로 본다.
    token = _hits(menu_norm, SPICY2_TOKENS)
    if token and token != "전골":
        return {"level": 2, "reason": f"'{token}'은 매운 양념이 주요맛인 조리법이다", "matched": token}

    if "전골" in menu_norm and _hits(menu_norm, ("낙지", "김치", "불고기", "곱창")):
        return {"level": 2, "reason": "낙지·김치를 넣은 전골은 얼큰한 국물이 주요맛이다", "matched": "전골"}

    if "주꾸미" in menu_norm:
        return {"level": 2, "reason": "주꾸미 요리는 매운 양념으로 내는 것이 일반적이다", "matched": "주꾸미"}

    token = _hits(menu_norm, SPICY1_TOKENS)
    if token:
        return {"level": 1, "reason": f"'{token}'은 양념이 들어가되 매운맛이 주요맛은 아니다", "matched": token}

    token = _hits(menu_norm, MILD_TOKENS)
    if token or menu_norm.endswith("전"):
        hit = token or "전"
        return {"level": 0, "reason": f"'{hit}'은 양념을 매운맛으로 쓰지 않는 조리법이다", "matched": hit}

    token = _hits(menu_norm, SET_TOKENS)
    if token:
        return {"level": 1, "reason": f"'{token}'은 반찬에 양념이 따르나 매운맛이 주요맛은 아니다", "matched": token}

    return {"level": 0, "reason": "조리법을 가리키는 말이 이름에 없다", "matched": None}


# --------------------------------------------------------------------------
# 날것 여부
# --------------------------------------------------------------------------

RAW_KEYWORDS = (
    "회", "사시미", "물회", "탕탕이", "산낙지", "세발낙지", "육회", "생굴",
    "초밥", "게장", "젓갈", "젓", "홍어", "멍게", "해삼", "기절낙지", "생선회",
    "활어", "선어", "다짐", "세꼬시", "생물",
)
# "회"를 품지만 익힌 것.
NOT_RAW_OVERRIDE = (
    "숙회", "회무침전골", "회덮밥탕", "구이", "튀김", "전골", "찜", "탕",
    "국", "찌개", "볶음", "조림", "샤브", "라면", "죽", "만두",
)
# 위 예외에 걸려도 여전히 날것인 조합.
RAW_STRONG = ("산낙지", "탕탕이", "생굴", "육회", "물회", "사시미", "홍어회", "세꼬시")


def detect_raw(text: str, course: str) -> tuple[bool, bool]:
    """(날것 여부, 근거를 짚었는지)."""
    if course in ("디저트", "음료"):
        return False, True
    for kw in RAW_STRONG:
        if kw in text:
            return True, True
    if any(kw in text for kw in NOT_RAW_OVERRIDE):
        return False, True
    for kw in RAW_KEYWORDS:
        if kw in text:
            return True, True
    return False, False


# --------------------------------------------------------------------------
# 주재료 분류
# --------------------------------------------------------------------------

# CORE   그 자체로 대표 주재료가 될 수 있는 재료어.
# SECOND 곁재료·양념·반죽/곡물처럼 음식 정체성의 핵심이 아닌 재료어.
#        다른 계열에 CORE 근거가 하나도 없을 때만 대표로 승격한다.
#        (도토리묵은 채소, 도토리해물파전은 해산물이 되는 이유다.)
#
# 조리법 단어는 어느 쪽에도 넣지 않는다. '수육'·'탕수육'은 육류가 아니고
# '회'는 해산물이 아니다. 옛 사전은 이 둘을 재료로 세는 바람에 복수 라벨이
# 96건까지 늘었다. 대표 재료는 하나가 기본이다.

CORE: dict[str, tuple[str, ...]] = {
    SEAFOOD: (
        "세발낙지", "산낙지", "낙지", "전복", "갈치", "새꼬막", "참꼬막", "꼬막",
        "꽃게", "칠게", "대게", "게장", "홍어", "보리굴비", "굴비", "조기", "굴",
        "아귀", "아구", "병어", "바지락", "고등어", "삼치", "붕장어", "장어", "하모",
        "민어", "키조개", "갑오징어", "오징어", "주꾸미", "쭈꾸미", "대하", "새우",
        "문어", "우럭", "농어", "도다리", "방어", "전어", "매생이", "톳", "해조류",
        "멸치", "다슬기", "짱뚱어", "대구", "멍게", "해삼", "서대", "코다리", "명태",
        "미역", "백합", "소라", "해물", "해산물", "생선", "활어", "우렁이", "우렁",
        "가리비", "홍합", "골뱅이", "붕어", "메기", "미꾸라지", "추어", "관자",
    ),
    MEAT: (
        "한우암소", "한우", "쇠고기", "소고기", "돼지고기", "암돼지", "삼겹살", "목살",
        "차돌", "육회", "육개장", "유황오리", "오리", "토종닭", "닭가슴살", "닭",
        "흑염소", "곱창", "대창", "막창", "떡갈비", "갈비", "불고기", "불백", "제육",
        "보쌈", "삼계탕", "백숙", "주물럭", "돈까스", "스테이크", "베이컨", "햄",
    ),
    VEGGIE: (
        "죽순", "애호박", "단호박", "호박", "순두부", "두부", "시금치", "열무",
        "감자", "고구마", "옥수수", "수수", "가지", "토마토", "유자", "매실", "대추",
        "도라지", "더덕", "산딸기", "딸기", "무화과", "사과", "복숭아", "멜론",
        "팥", "한라봉", "포도", "블루베리", "오디", "자두", "석류", "곶감", "밤",
        "토란", "오미자", "구기자", "연잎", "청포도",
    ),
}

SECOND: dict[str, tuple[str, ...]] = {
    VEGGIE: (
        "들깨", "묵은지", "갓김치", "김치", "시래기", "콩나물", "콩", "미나리",
        "야채", "채소", "산채", "나물", "새싹", "상추", "양파", "마늘", "생강",
        "곰보배추", "배추", "배", "버섯", "표고", "능이", "고추", "쌈밥", "쌈",
        "메밀", "우리밀", "쌀", "보리", "흑미", "녹두", "도토리", "바질", "샐러드",
        "청국장", "된장",
        # 쑥은 도다리쑥국에서 향채다. 쑥차·쑥라떼처럼 다른 근거가 없을 때만
        # 대표로 올라온다.
        "쑥",
    ),
}

# 양념 이름일 뿐 재료 근거로 쓰지 않는다. 매칭 전에 지운다.
# '유자골'·'오리엔탈'은 지명·수식어인데 재료어를 품고 있어 함께 지운다.
STRIP_BEFORE_MATCH = ("고추장", "유자골", "오리엔탈", "대통밥")

# 순두부 계열은 앞에 무엇이 붙든 대표 재료가 순두부다.
SOONDUBU = "순두부"

# 이름만으로 대표를 못 정하는 예외. (라벨, 근거)
ING_EXCEPTIONS: dict[str, tuple[list[str], str]] = {
    "삼합|소고기": ([SEAFOOD, MEAT], "장흥삼합은 소고기와 키조개가 함께여야 성립한다"),
    "삼합|키조개": ([SEAFOOD, MEAT], "장흥삼합은 소고기와 키조개가 함께여야 성립한다"),
    "삼합|표고버섯": ([SEAFOOD, MEAT], "장흥삼합은 소고기와 키조개가 함께여야 성립한다. 표고는 곁재료"),
    "홍어삼합|홍어": ([SEAFOOD, MEAT], "삼합은 홍어와 돼지수육이 함께여야 성립하는 이름이다"),
    "오징어육개장|오징어": ([SEAFOOD], "대표는 오징어. 소고기가 함께 들어가는지는 이름에 없다"),
    "죽순게장 한우정식|죽순": ([SEAFOOD, VEGGIE], "죽순게장이 주 메뉴이고 한우는 상차림 구성이다"),
    "홍어일품상|홍어": ([SEAFOOD], "대표는 홍어. 돼지수육이 함께 나오는지는 이름에 없다"),
    "고추장구이|고추": ([], "고추장은 양념이라 재료 근거가 아니다. 무엇을 구웠는지 이름에 없다"),
}


def resolve_ingredients(menu_key: str, menu_norm: str, ingredient: str = "") -> dict:
    """{"labels": [...], "reason": 판정 근거, "basis": 어떻게 정했는지}.

    대표 재료는 하나가 기본이다. 두 계열이 각각 독립된 재료어로 이름에 있고
    어느 하나를 빼면 그 음식이 아닐 때만(전복삼계탕, 홍어삼합) 둘을 남긴다.
    """
    if menu_key in ING_EXCEPTIONS:
        labels, reason = ING_EXCEPTIONS[menu_key]
        return {"labels": labels, "reason": reason, "basis": "예외"}

    text = menu_norm
    for junk in STRIP_BEFORE_MATCH:
        text = text.replace(junk, " ")

    if SOONDUBU in text:
        return {
            "labels": [VEGGIE],
            "reason": "순두부찌개 계열. 앞에 붙는 해물·고기는 부재료이고 대표는 순두부다",
            "basis": "대표 1개",
        }

    core = {cat: _hits(text, tokens) for cat, tokens in CORE.items()}
    core = {cat: tok for cat, tok in core.items() if tok}

    if not core and ingredient:
        # 이름이 잘려 재료어가 없을 때만 매칭된 제철 식재료로 보완한다.
        core = {cat: _hits(ingredient, tokens) for cat, tokens in CORE.items()}
        core = {cat: tok for cat, tok in core.items() if tok}
        basis_note = "이름에 재료어가 없어 매칭 식재료로 보완"
    else:
        basis_note = ""

    if core:
        # 순서를 CATEGORIES 기준으로 고정한다. "해산물;채소"와 "채소;해산물"이
        # 따로 집계되면 분포를 읽을 수 없다.
        labels = [c for c in CATEGORIES if c in core]
        if len(labels) >= 2:
            named = " · ".join(f"{c}({core[c]})" for c in labels)
            reason = f"{named} 이 각각 독립된 재료어로 이름에 있고 어느 하나를 빼면 그 음식이 아니다"
            basis = "복수 유지"
        else:
            cat = labels[0]
            reason = f"대표 재료는 {core[cat]}. 나머지는 곁재료·양념·조리법 단어라 라벨로 세지 않는다"
            basis = "대표 1개"
        if basis_note:
            reason = f"{reason}. {basis_note}"
        return {"labels": labels[:2], "reason": reason, "basis": basis}

    second = {cat: _hits(text, tokens) for cat, tokens in SECOND.items()}
    second = {cat: tok for cat, tok in second.items() if tok}
    if second:
        cat = next(c for c in CATEGORIES if c in second)
        return {
            "labels": [cat],
            "reason": f"핵심 재료어가 없고 {second[cat]}만 있다. 이 음식에서는 {second[cat]}가 대표다",
            "basis": "곁재료 승격",
        }

    return {"labels": [], "reason": "허용 라벨(해산물·육류·채소)에 해당하는 재료어가 이름에 없다", "basis": "근거 없음"}


# --------------------------------------------------------------------------
@dataclass
class TasteProfile:
    spicy: int
    has_soup: bool
    is_raw: bool
    main_ingredients: list[str]
    course: str
    confidence: float

    def as_dict(self) -> dict:
        return asdict(self)


def score_menu(menu_name: str, ingredient: str = "") -> TasteProfile:
    """메뉴명(+매칭된 제철 식재료)으로 취향 지표를 낸다."""
    menu = normalize_menu(menu_name)
    haystack = f"{menu} {ingredient}".strip()
    course = classify_course(menu)
    menu_key = f"{menu}|{ingredient}"

    # 맵기와 주재료는 메뉴명만 본다. 매칭된 제철 식재료를 섞으면 '갈치'가
    # 맵기를 정하고, 곁들이 식재료가 대표 재료를 밀어낸다.
    # 국물·날것은 haystack 그대로 둔다. 조리법 신호라 식재료와 부딪히지 않는다.
    spicy = resolve_spicy(menu, course)
    ing = resolve_ingredients(menu_key, menu, ingredient)
    has_soup, soup_sure = detect_soup(haystack)
    is_raw, raw_sure = detect_raw(haystack, course)

    spicy_level, spicy_sure = spicy["level"], spicy["matched"] is not None
    ingredients, ing_sure = ing["labels"], ing["basis"] != "근거 없음"

    if course in ("디저트", "음료"):
        has_soup = False

    # 맵기와 날것은 "표시가 없으면 아니다"가 맞는 기본값이다. 매운 음식에는
    # 대개 매움·볶음·양념이 붙고, 날것에는 회·산낙지·게장이 붙는다. 그래서
    # 키워드를 못 찾은 것 자체를 근거 부족으로 치지 않는다.
    # 반면 국물 유무는 조리법을 짚어야만 알 수 있어 이쪽만 근거로 센다.
    _ = (spicy_sure, raw_sure)
    method_sure = soup_sure
    if method_sure and ing_sure:
        confidence = 0.85
    elif method_sure or ing_sure:
        confidence = 0.55
    else:
        confidence = 0.30

    if course in ("디저트", "음료"):
        confidence = max(confidence, 0.70)
    if len(menu) < 3:
        confidence -= 0.15
    if not is_menu_like(menu_name):
        confidence = 0.10

    return TasteProfile(
        spicy=max(SPICY_MIN, min(SPICY_MAX, spicy_level)),
        has_soup=has_soup,
        is_raw=is_raw,
        main_ingredients=ingredients,
        course=course,
        confidence=round(min(0.95, max(0.05, confidence)), 2),
    )
