import { revalidatePath } from "next/cache";
import { ingest } from "@/lib/ingest";

export const dynamic = "force-dynamic";

export async function POST() {
  const result = await ingest();
  revalidatePath("/", "layout");
  return Response.json(result);
}
