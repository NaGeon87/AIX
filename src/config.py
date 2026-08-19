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

DATA_RAW_DIR.mkdir(parents=True, exist_ok=True)
DATA_PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
DATA_REVIEW_DIR.mkdir(parents=True, exist_ok=True)
