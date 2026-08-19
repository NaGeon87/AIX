import { MapChatExplorer } from "@/components/MapChatExplorer";
import { streets } from "@/lib/data";

export default function TastePage() {
  return <MapChatExplorer streets={streets.filter((s) => s.category === "음식")} />;
}
