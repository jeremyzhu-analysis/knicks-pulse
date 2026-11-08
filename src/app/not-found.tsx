import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Not found · New York Knicks",
};

export default function NotFound() {
  return (
    <main className="mx-auto max-w-[1080px] px-5 py-16">
      <p className="text-[11px] uppercase tracking-[0.18em] text-muted">Missing</p>
      <h1 className="mt-2 text-[32px] font-bold">That game or player is not in the snapshot.</h1>
      <p className="mt-4 max-w-[60ch] text-[16px]">
        It may be from a season this report does not ingest, or the id is wrong.{" "}
        <Link href="/" className="text-ink">
          Return to the team report
        </Link>
        .
      </p>
    </main>
  );
}
