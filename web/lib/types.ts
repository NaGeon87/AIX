/** 주재료 분류. "채소"는 식물성 전반(곡물·과일·버섯 포함)을 뜻한다. */
export const CATEGORIES = ["해산물", "육류", "채소"] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_META: Record<Category, { label: string; icon: string; color: string }> = {
  해산물: { label: "해산물", icon: "🐟", color: "#2E6E8E" },
  육류: { label: "육류", icon: "🥩", color: "#B23A22" },
  채소: { label: "채소", icon: "🥬", color: "#3E7A3A" },
};

/** 맵기 0~3. 라벨은 슬라이더 아래와 결과 카드에서 같은 문구를 쓴다. */
export const SPICY_LEVELS = [
  { value: 0, label: "안 매움" },
  { value: 1, label: "약간" },
  { value: 2, label: "매움" },
  { value: 3, label: "아주 매움" },
] as const;

export const SPICY_COLOR = "#C4392A";
export const SOUP_COLOR = "#C8862B";
export const RAW_COLOR = "#6B4A8F";

/** 디저트·음료는 데이터 단계에서 걸러져 식사만 남는다. */
export type Course = "식사";

export interface Restaurant {
  id: string;
  name: string;
  region: string;
  area: string;
  address: string;
  lat: number | null;
  lon: number | null;
  isLocalSpecialty: boolean;
}

export interface Food {
  id: string;
  name: string;
  displayName: string;
  ingredient: string;
  /** 0 안 매움 / 1 약간 / 2 매움 / 3 아주 매움 */
  spicy: number;
  hasSoup: boolean;
  isRaw: boolean;
  /** 대표 주재료. 두 계열이 맞부딪히면 둘 다 들어 있다. */
  mainIngredients: Category[];
  course: Course;
  /** 지표의 근거 강도. 0.6 미만이면 화면에 단서가 약하다고 밝힌다. */
  confidence: number;
  /** "rule" | "manual" — 지표를 누가 매겼는지 */
  source: string;
  months: number[];
  regions: string[];
  restaurantCount: number;
  restaurants: Restaurant[];
}

/** 거리 반경 안의 관광지·문화시설. TourAPI 위치기반 조회로 빌드 시점에 받는다. */
export interface NearbyPlace {
  id: string;
  title: string;
  /** "관광지" | "문화시설" */
  type: string;
  addr: string;
  /** 거리 지점에서 몇 m */
  dist: number;
  lat: number | null;
  lon: number | null;
  /** 대표 이미지 URL. 없을 수 있다. */
  image: string;
  tel: string;
}

export interface Street {
  id: string;
  name: string;
  description: string;
  category: "음식" | "쇼핑" | "문화" | "기타";
  foodKeywords: string[];
  sido: string;
  sigungu: string;
  address: string;
  lat: number | null;
  lon: number | null;
  coordSource: string;
  /** 지도 음식 마커용 OpenMoji 코드. 예: 1F419(낙지/문어) */
  iconCode?: string;
  /** 아이콘 이미지가 로드되지 않을 때 보여줄 이모지 */
  iconFallback?: string;
  /** 대표 음식 접근성 라벨 */
  iconLabel?: string;
  lengthM: number;
  shopCount: number;
  designatedYear: number | null;
  orgName: string;
  orgTel: string;
  dataDate: string;
  nearby: NearbyPlace[];
}

export interface Meta {
  builtAt: string;
  foodCount: number;
  streetCount: number;
  categories: string[];
  sources: string[];
}
