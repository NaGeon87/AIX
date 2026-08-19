import Link from "next/link";

import festivalsJson from "@/public/data/festivals.json";
import tourismJson from "@/public/data/tourism.json";

type Festival = {
  sigungu: string;
  name: string;
  period: string;
  place: string;
  source?: string;
};

type DesignatedTourism = {
  sigungu: string;
  name: string;
  location: string;
  designatedDate?: string;
  note?: string;
};

type PopularTourism = {
  id: string;
  name: string;
  type: string;
  ageGroup: string;
  share: number;
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const GWANGJU_POPULAR_NAMES = new Set([
  "국립아시아문화전당",
  "김대중컨벤션센터",
  "광주기아챔피언스필드",
  "국립광주과학관",
  "광주패밀리랜드",
  "상무시민공원",
  "어등산CC",
  "광주월드컵경기장",
  "쌍암공원",
  "국립광주박물관",
  "광주호호수생태원",
  "증심사",
  "518기념문화센터",
  "운천저수지",
  "우치공원동물원",
  "퐁퐁플라워광주빛고을센터",
  "무각사",
  "빛고을CC",
  "전일빌딩245",
  "광주비엔날레전시관",
]);

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function normalizeArea(value: string) {
  return value.replace(/^광주\s+/, "").replace(/^전남\s+/, "").trim();
}

export default async function NearbyPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const restaurant = one(params.restaurant);
  const food = one(params.food);
  const region = one(params.region);
  const area = normalizeArea(one(params.area));

  const tourism = tourismJson as {
    designated: DesignatedTourism[];
    popular: PopularTourism[];
    sourceDate: string;
  };
  const festivals = festivalsJson as Festival[];

  const localTourism = tourism.designated
    .filter((item) => normalizeArea(item.sigungu) === area)
    .slice(0, 6);

  const gwangjuPopular = region === "광주"
    ? tourism.popular
        .filter((item) => GWANGJU_POPULAR_NAMES.has(item.name))
        .sort((a, b) => b.share - a.share)
        .slice(0, 6)
    : [];

  const localFestivals = festivals
    .filter((item) => {
      const festivalArea = normalizeArea(item.sigungu);
      if (region === "광주") return item.sigungu.includes("광주") && (festivalArea === area || !area);
      return festivalArea === area;
    })
    .slice(0, 6);

  const hasTourism = localTourism.length > 0 || gwangjuPopular.length > 0;

  return (
    <main className="min-h-dvh bg-canvas px-5 py-8 text-fg">
      <div className="mx-auto w-full max-w-[820px]">
        <Link href="/taste" className="text-[12px] font-bold text-brand">
          ← 음식 추천 지도로 돌아가기
        </Link>

        <section className="mt-4 rounded-3xl border border-line bg-surface p-6 shadow-sm">
          <p className="text-[11px] font-bold text-brand">{region} {area}</p>
          <h1 className="mt-1 font-display text-[30px] leading-tight text-fg">
            {restaurant || "선택한 음식점"} 근처 추천
          </h1>
          {food && <p className="mt-2 text-[13px] text-fg-muted">먹을 메뉴 · {food}</p>}
          <p className="mt-4 rounded-2xl bg-canvas px-4 py-3 text-[12px] leading-relaxed text-fg-muted">
            현재 관광지·축제 원본 데이터에는 위·경도가 없어 실제 km 거리순이 아니라
            <strong className="font-bold text-fg"> 같은 시·군·구 권역</strong>을 기준으로 추천합니다.
          </p>
        </section>

        <section className="mt-6">
          <div className="mb-3 flex items-end justify-between gap-3">
            <div>
              <p className="text-[11px] font-bold text-brand">TOUR</p>
              <h2 className="font-display text-[24px] text-fg">근처 관광지</h2>
            </div>
            <span className="text-[11px] text-fg-muted">관광 데이터 기준 {tourism.sourceDate}</span>
          </div>

          {hasTourism ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {localTourism.map((item) => (
                <article key={`${item.sigungu}-${item.name}`} className="rounded-2xl border border-line bg-surface p-4">
                  <p className="text-[10px] font-bold text-brand">{item.note || "관광지"}</p>
                  <h3 className="mt-1 font-display text-[19px] text-fg">{item.name}</h3>
                  <p className="mt-2 text-[12px] text-fg-muted">{item.sigungu} · {item.location}</p>
                </article>
              ))}
              {gwangjuPopular.map((item) => (
                <article key={item.id} className="rounded-2xl border border-line bg-surface p-4">
                  <p className="text-[10px] font-bold text-brand">광주권 인기 관광 · {item.type}</p>
                  <h3 className="mt-1 font-display text-[19px] text-fg">{item.name}</h3>
                  <p className="mt-2 text-[12px] text-fg-muted">방문 비중 {item.share.toFixed(1)}%</p>
                </article>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-line bg-surface p-5 text-[13px] text-fg-muted">
              현재 데이터에서 {region} {area} 권역 관광지를 찾지 못했어요.
            </div>
          )}
        </section>

        <section className="mt-8">
          <div className="mb-3">
            <p className="text-[11px] font-bold text-brand">FESTIVAL</p>
            <h2 className="font-display text-[24px] text-fg">근처 축제</h2>
          </div>

          {localFestivals.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {localFestivals.map((festival) => (
                <article key={`${festival.sigungu}-${festival.name}`} className="rounded-2xl border border-line bg-surface p-4">
                  <p className="text-[10px] font-bold text-brand">{festival.sigungu}</p>
                  <h3 className="mt-1 font-display text-[19px] text-fg">{festival.name}</h3>
                  <p className="mt-2 text-[12px] font-medium text-fg">{festival.period}</p>
                  <p className="mt-1 text-[12px] text-fg-muted">{festival.place}</p>
                </article>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-line bg-surface p-5 text-[13px] text-fg-muted">
              현재 축제 데이터에는 {region} {area} 권역의 등록 축제가 없어요.
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
