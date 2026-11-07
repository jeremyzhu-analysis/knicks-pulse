"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { LAYERS, hrefFor, viewFromPath } from "@/lib/nav";

export function LayerNav() {
  const path = usePathname();
  const params = useSearchParams();
  const view = viewFromPath(path, params.get("layer"), params.get("tab"));
  const current = LAYERS.find((layer) => layer.id === view.layer) ?? LAYERS[0];

  return (
    <nav className="border-t border-rule" aria-label="Report">
      <div className="mx-auto flex max-w-[1080px] gap-6 px-5 pt-3">
        {LAYERS.map((layer) => {
          const on = layer.id === view.layer;
          return (
            <Link
              key={layer.id}
              href={hrefFor(layer.id, layer.tabs[0].id)}
              className={on ? "text-[15px] text-ink underline decoration-knicks underline-offset-4" : "text-[15px] text-muted no-underline"}
              aria-current={on ? "page" : undefined}
            >
              {layer.label}
            </Link>
          );
        })}
      </div>
      <div className="mx-auto flex max-w-[1080px] flex-wrap gap-x-5 gap-y-2 px-5 py-3 text-[13px]">
        {current.tabs.map((tab) => {
          const on = tab.id === view.tab;
          return (
            <Link
              key={tab.id}
              href={hrefFor(current.id, tab.id)}
              className={on ? "text-ink underline underline-offset-4" : "text-muted no-underline hover:text-ink"}
              aria-current={on ? "page" : undefined}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
