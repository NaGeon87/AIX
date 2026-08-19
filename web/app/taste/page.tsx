import { MapChatExplorer } from "@/components/MapChatExplorer";
import { foods, streets } from "@/lib/data";
import { getKstMonth } from "@/lib/kst";

export default function TastePage() {
  return (
    <MapChatExplorer
      streets={streets.filter((street) => street.category === "음식")}
      foods={foods}
      defaultMonth={getKstMonth()}
    />
  );
}
