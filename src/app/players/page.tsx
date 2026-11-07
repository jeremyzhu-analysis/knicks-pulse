import { redirect } from "next/navigation";
import { hrefFor } from "@/lib/nav";

export default function PlayersPage() {
  redirect(hrefFor("players", "impact"));
}
