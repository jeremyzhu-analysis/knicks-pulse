/** The report's two layers and the tabs of each, in display order. */
export const LAYERS = [
  {
    id: "team",
    label: "Team",
    tabs: [
      { id: "season", label: "Season" },
      { id: "games", label: "Games" },
      { id: "quarters", label: "Quarters" },
      { id: "factors", label: "Offense and defense" },
      { id: "situations", label: "Situations" },
    ],
  },
  {
    id: "players",
    label: "Players",
    tabs: [
      { id: "impact", label: "Impact" },
      { id: "pairs", label: "Pairings" },
    ],
  },
] as const;

export type ReportView = { page: "report"; layer: string; tab: string };
export type View = ReportView | { page: "game"; id: string };

/** The section anchors of the single-page report, so links to them still land on the right tab. */
const ANCHORS: Record<string, string> = {
  season: "team/season",
  games: "team/games",
  quarters: "team/quarters",
  factors: "team/factors",
  situations: "team/situations",
  pairs: "players/pairs",
  players: "players/impact",
};

/** "#team/games", "#game/401…"; anything unknown is the first tab. */
export function parseHash(hash: string): View {
  const path = hash.replace(/^#/, "");
  const [first = "", second = ""] = (ANCHORS[path] ?? path).split("/");
  if (first === "game" && second) return { page: "game", id: second };
  const layer = LAYERS.find((l) => l.id === first) ?? LAYERS[0];
  const tab = layer.tabs.find((t) => t.id === second) ?? layer.tabs[0];
  return { page: "report", layer: layer.id, tab: tab.id };
}
