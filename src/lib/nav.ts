export type LayerId = "team" | "players";

export const LAYERS: { id: LayerId; label: string; tabs: { id: string; label: string }[] }[] = [
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
      { id: "shots", label: "Shots" },
    ],
  },
];

export function parseView(layer?: string | null, tab?: string | null): { layer: LayerId; tab: string } {
  const found = LAYERS.find((item) => item.id === layer) ?? LAYERS[0];
  const chosen = found.tabs.find((item) => item.id === tab) ?? found.tabs[0];
  return { layer: found.id, tab: chosen.id };
}

export function viewFromPath(path: string, layer?: string | null, tab?: string | null): { layer: LayerId; tab: string } {
  if (path.startsWith("/games")) return { layer: "team", tab: "games" };
  if (path.startsWith("/shots")) return { layer: "players", tab: "shots" };
  if (path.startsWith("/players")) return { layer: "players", tab: "impact" };
  return parseView(layer, tab);
}

export function hrefFor(layer: LayerId, tab: string, player?: string): string {
  const params = new URLSearchParams({ layer, tab });
  if (player) params.set("player", player);
  return `/?${params.toString()}`;
}
