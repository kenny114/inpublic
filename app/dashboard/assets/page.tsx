import { redirect } from "next/navigation";

/** The assets editor moved to /dashboard/vocabulary. Old links keep working. */
export default function AssetsPage() {
  redirect("/dashboard/vocabulary");
}
