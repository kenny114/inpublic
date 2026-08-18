import { notFound } from "next/navigation";
import DemoStudio from "@/components/DemoStudio";

export const metadata = { title: "InPublic Demo Studio" };

export default function DemoStudioPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <DemoStudio />;
}

