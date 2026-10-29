"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { etDateTime } from "@/lib/format";

interface IngestResponse {
  added: { id: string; label: string }[];
  updated: { id: string; label: string }[];
  skipped: number;
  errors: { id: string; message: string }[];
  checkedAt: string;
  games: number;
  busy?: boolean;
}

let autoStarted = false;

export function IngestControl({ checkedAt }: { checkedAt: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState(`Snapshot checked ${etDateTime(checkedAt)}.`);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setPending(true);
    setError(null);
    setMessage("Checking ESPN for a completed game…");
    try {
      const response = await fetch("/api/ingest", { method: "POST" });
      const body = (await response.json()) as IngestResponse;
      if (!response.ok) throw new Error("Ingest failed.");
      if (body.busy) {
        setMessage("An ingest is already running.");
        return;
      }
      const changed = body.added.length + body.updated.length;
      if (body.errors.length && changed === 0) {
        setError(body.errors[0]?.message ?? "ESPN did not return a game.");
        setMessage("The snapshot was not changed.");
        return;
      }
      if (body.added.length) {
        setMessage(`Ingested ${body.added.map((game) => game.label).join("; ")}.`);
      } else if (body.updated.length) {
        setMessage(`No new game. Refreshed ${body.updated.length} recent ${body.updated.length === 1 ? "box score" : "box scores"}.`);
      } else {
        setMessage(`No new game. ${body.games} games in the snapshot.`);
      }
      if (body.added.length) router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ingest failed.");
      setMessage("The snapshot was not changed.");
    } finally {
      setPending(false);
    }
  }

  useEffect(() => {
    if (autoStarted) return;
    autoStarted = true;
    void run();
    // The daily check should run once per page load, not on every refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col items-start gap-2 md:items-end">
      <Button type="button" variant="outline" size="sm" onClick={() => void run()} disabled={pending}>
        {pending ? "Ingesting…" : "Ingest latest game"}
      </Button>
      <p className="max-w-[280px] text-left text-[12px] leading-snug text-muted md:text-right">{message}</p>
      {error ? <p className="max-w-[280px] text-left text-[12px] leading-snug text-loss md:text-right">{error}</p> : null}
    </div>
  );
}
