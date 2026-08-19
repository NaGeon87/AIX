"""화면이 받은 "이 정보가 실제와 다른가요?" 답을 검토 목록으로 만든다.

물어보기만 하고 읽지 않으면 묻지 않느니만 못하다. accuracy_feedback 표는
manual_labels.py의 menu_key와 같은 모양으로 일부러 맞춰 두었는데(0001 마이그레이션
주석), 정작 그 표를 읽어 라벨로 되돌리는 길이 없었다. 이 스크립트가 그 길이다.

무엇을 하지 않는가: 라벨을 자동으로 고치지 않는다. "다르다"는 한 사람의 말이
곧 사실은 아니고, 맵기처럼 사람마다 갈리는 지표도 있다. 대신 누가 무엇을
어떻게 지적했는지를 현재 값과 나란히 놓아, 사람이 manual_labels.py에 옮겨
적을지 판단할 재료만 만든다.

읽기는 RLS로 닫혀 있어 service_role 키가 필요하다. 키가 없으면 아무것도 하지
않고 끝난다 — 파이프라인은 피드백 없이도 끝까지 돌아야 한다.

입력 : Supabase public.accuracy_feedback
       data/processed/menu_taste_profile.csv (현재 값 대조용)
출력 : data/processed/review/accuracy_feedback_review.csv

실행: python -m src.taste.feedback_review [--days N] [--min-different N]
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

import requests

from src.config import (
    DATA_PROCESSED_DIR,
    DATA_REVIEW_DIR,
    SUPABASE_SERVICE_ROLE_KEY,
    SUPABASE_URL,
)

PROFILE = DATA_PROCESSED_DIR / "menu_taste_profile.csv"
OUTPUT = DATA_REVIEW_DIR / "accuracy_feedback_review.csv"

AXES = ["spicy", "soup", "raw", "ingredient"]
AXIS_KO = {"spicy": "맵기", "soup": "국물", "raw": "날것", "ingredient": "주재료"}
# 프로파일 컬럼명. 지적당한 지표의 현재 값을 그대로 보여 주기 위해 짝지어 둔다.
AXIS_COLUMN = {
    "spicy": "spicy",
    "soup": "has_soup",
    "raw": "is_raw",
    "ingredient": "main_ingredients",
}

FIELDS = [
    "menu_key", "menu_name",
    "different", "same", "지적된_지표",
    "현재_맵기", "현재_국물", "현재_날것", "현재_주재료",
    "산출근거", "남긴_말", "마지막_지적",
]


def fetch(days: int) -> list[dict]:
    """피드백을 페이지 단위로 끌어온다. PostgREST 기본 상한이 1000행이다."""
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    rows: list[dict] = []
    step = 1000

    while True:
        query = urlencode({
            "select": "food_id,food_name,verdict,axes,note,shown,created_at",
            "created_at": f"gte.{since}",
            "order": "created_at.desc",
        })
        res = requests.get(
            f"{SUPABASE_URL.rstrip('/')}/rest/v1/accuracy_feedback?{query}",
            headers={
                "apikey": SUPABASE_SERVICE_ROLE_KEY,
                "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
                "Range": f"{len(rows)}-{len(rows) + step - 1}",
            },
            timeout=30,
        )
        if res.status_code >= 400:
            raise SystemExit(f"피드백을 읽지 못했습니다 ({res.status_code}): {res.text[:200]}")
        page = res.json()
        rows += page
        if len(page) < step:
            return rows


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--days", type=int, default=180, help="며칠치를 볼지")
    parser.add_argument("--min-different", type=int, default=1,
                        help="'다르다'가 이 수 이상인 메뉴만 남긴다")
    args = parser.parse_args()

    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        print("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 없어 건너뜁니다.")
        print("읽기는 RLS로 닫혀 있어 service_role 키가 필요합니다(.env 참고).")
        return

    rows = fetch(args.days)
    print(f"최근 {args.days}일 피드백 {len(rows)}건")
    if not rows:
        return

    with PROFILE.open(encoding="utf-8-sig", newline="") as fh:
        profile = {r["menu_key"]: r for r in csv.DictReader(fh)}

    verdicts: dict[str, Counter] = defaultdict(Counter)
    axis_hits: dict[str, Counter] = defaultdict(Counter)
    notes: dict[str, list[str]] = defaultdict(list)
    names: dict[str, str] = {}
    last: dict[str, str] = {}

    for row in rows:
        key = (row.get("food_id") or "").strip()
        if not key:
            continue
        verdicts[key][row.get("verdict") or ""] += 1
        names.setdefault(key, (row.get("food_name") or "").strip())
        last.setdefault(key, (row.get("created_at") or "")[:10])
        for axis in row.get("axes") or []:
            if axis in AXES:
                axis_hits[key][axis] += 1
        note = (row.get("note") or "").strip()
        if note:
            notes[key].append(note)

    out = []
    for key, count in verdicts.items():
        if count["different"] < args.min_different:
            continue
        p = profile.get(key, {})
        out.append({
            "menu_key": key,
            "menu_name": p.get("menu_name") or names.get(key, ""),
            "different": count["different"],
            "same": count["same"],
            # 어느 지표가 몇 번 지적됐는지. 이게 곧 어디를 고쳐야 하는지다.
            "지적된_지표": " ".join(
                f"{AXIS_KO[a]}×{n}" for a, n in axis_hits[key].most_common()
            ),
            "현재_맵기": p.get("spicy", ""),
            "현재_국물": p.get("has_soup", ""),
            "현재_날것": p.get("is_raw", ""),
            "현재_주재료": p.get("main_ingredients", ""),
            # rule인지 manual인지가 판단을 가른다. 이미 사람이 매긴 값을
            # 또 지적했다면 그 사람과 이 사람의 의견이 갈린 것이다.
            "산출근거": p.get("source", "프로파일에 없음"),
            "남긴_말": " / ".join(notes[key][:5]),
            "마지막_지적": last.get(key, ""),
        })

    # 지적이 많고, 반대 의견('같다')이 적은 것부터. 신호가 뚜렷한 순서다.
    out.sort(key=lambda r: (-r["different"], r["same"], r["menu_key"]))

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT.open("w", encoding="utf-8-sig", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(out)

    total = Counter(r.get("verdict") for r in rows)
    print(f"  같다 {total['same']}건 / 다르다 {total['different']}건")
    print(f"검토 대상 {len(out)}개 → {OUTPUT}")

    missing = [r["menu_key"] for r in out if r["산출근거"] == "프로파일에 없음"]
    if missing:
        print(f"  ※ 지금 프로파일에 없는 메뉴 {len(missing)}개(검수하며 합쳐진 것일 수 있음): "
              f"{', '.join(missing[:5])}")

    if out:
        print("\n지적이 많은 순")
        for r in out[:10]:
            print(f"  {r['menu_key']:<28} 다르다 {r['different']}/같다 {r['same']}"
                  f"  {r['지적된_지표']}  {r['남긴_말'][:30]}")


if __name__ == "__main__":
    main()
