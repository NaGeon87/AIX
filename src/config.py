import os
from pathlib import Path

from dotenv import load_dotenv

ROOT_DIR = Path(__file__).resolve().parent.parent
DATA_RAW_DIR = ROOT_DIR / "data" / "raw"
DATA_PROCESSED_DIR = ROOT_DIR / "data" / "processed"
# 검수·대조 도구(src/review)의 산출물. 최종 결과물인 seasonal_region_mapping.csv와
# 섞이면 팀원이 어느 게 본품인지 헷갈리므로 하위 폴더로 분리한다.
DATA_REVIEW_DIR = DATA_PROCESSED_DIR / "review"

load_dotenv(ROOT_DIR / ".env")

NONGSARO_API_KEY = os.getenv("NONGSARO_API_KEY", "")
JEONNAM_REDTABLE_API_KEY = os.getenv("JEONNAM_REDTABLE_API_KEY", "")
GWANGJU_REDTABLE_API_KEY = os.getenv("GWANGJU_REDTABLE_API_KEY", "")
TOURAPI_SERVICE_KEY = os.getenv("TOURAPI_SERVICE_KEY", "")
NFQS_API_KEY = os.getenv("NFQS_API_KEY", "")
# 맛 프로파일 LLM 보정(src/taste/llm_refine.py)에만 쓴다. 없어도 파이프라인은 돈다.
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")

# 화면이 받은 지표 정확도 피드백을 되읽을 때만 쓴다(src/taste/feedback_review.py).
# 넣기는 anon 키로 열려 있지만 읽기는 RLS로 닫아 두었으므로 service_role이 필요하다.
# 웹앱과 이름을 맞춰 둔다 — 같은 프로젝트를 가리키는 값이 두 이름으로 갈리면
# 어느 쪽이 진짜인지 나중에 알 수 없다.
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

DATA_RAW_DIR.mkdir(parents=True, exist_ok=True)
DATA_PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
DATA_REVIEW_DIR.mkdir(parents=True, exist_ok=True)
