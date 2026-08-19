import foodsJson from "@/public/data/foods.json";
import streetsJson from "@/public/data/streets.json";
import metaJson from "@/public/data/meta.json";

import type { Food, Meta, Street } from "./types";

// 빌드 시점에 번들로 굳는다. 2천 행 수준이라 서버도 DB도 필요 없다.
// 데이터를 갱신하려면 python -m src.export.build_web_data 를 다시 돌린다.
export const foods = foodsJson as unknown as Food[];
export const streets = streetsJson as unknown as Street[];
export const meta = metaJson as unknown as Meta;

export function findFood(id: string): Food | undefined {
  return foods.find((f) => f.id === id);
}

export function findStreet(id: string): Street | undefined {
  return streets.find((s) => s.id === id);
}
