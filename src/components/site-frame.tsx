import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { IngestControl } from "@/components/ingest-control";
import { LayerNav } from "@/components/layer-nav";
import { KnicksMark, Liberty } from "@/components/marks";
import { etDateTime } from "@/lib/format";

export function SiteHeader({ checkedAt }: { checkedAt: string }) {
  return (
    <header className="border-b border-rule">
      <div className="mx-auto flex max-w-[1080px] flex-col gap-4 px-5 py-4 md:flex-row md:items-end md:justify-between">
        <div className="flex items-center gap-3">
          <KnicksMark className="h-12 w-12 shrink-0" />
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-muted">New York Knicks</p>
            <Link href="/" className="mt-1 block text-[22px] leading-none text-ink no-underline">
              Game to game
            </Link>
          </div>
        </div>
        <div className="flex items-end gap-4">
          <Liberty className="h-28 w-auto shrink-0" />
          <IngestControl checkedAt={checkedAt} />
        </div>
      </div>
      <Suspense fallback={<div className="h-16 border-t border-rule" />}>
        <LayerNav />
      </Suspense>
    </header>
  );
}

export function SiteFooter({ updatedAt }: { updatedAt: string }) {
  return (
    <footer className="mx-auto max-w-[1080px] px-5 py-10 text-[12px] leading-relaxed text-muted">
      <p>
        ESPN box scores and play-by-play. Ratings are points per 100 possessions. Lineup splits keep a game within 8
        points of the box plus-minus. Updated {etDateTime(updatedAt)}.
      </p>
    </footer>
  );
}

export function Section({
  id,
  index,
  title,
  lede,
  source,
  children,
}: {
  id: string;
  index: string;
  title: string;
  lede?: string;
  source?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-6 border-b border-rule py-10 md:py-14">
      <p className="text-[11px] uppercase tracking-[0.18em] text-muted">{index}</p>
      <h2 className="mt-2 max-w-[24em] text-[26px] font-bold leading-[1.15] md:text-[32px]">{title}</h2>
      {lede ? <p className="mt-4 max-w-[68ch] text-[17px] leading-[1.55]">{lede}</p> : null}
      <div className="mt-8">{children}</div>
      {source ? <p className="mt-4 max-w-[68ch] text-[12px] leading-relaxed text-muted">{source}</p> : null}
    </section>
  );
}
