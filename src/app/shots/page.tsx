import { redirect } from "next/navigation";
import { hrefFor } from "@/lib/nav";

export default async function ShotsPage({ searchParams }: { searchParams: Promise<{ player?: string }> }) {
  const { player } = await searchParams;
  redirect(hrefFor("players", "shots", player));
}
