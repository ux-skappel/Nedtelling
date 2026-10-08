import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SetupForm } from "@/components/assessment/setup-form";

export const dynamicParams = false;

export function generateStaticParams() {
  return [{ mode: "quick" }, { mode: "full" }];
}

export async function generateMetadata({ params }: PageProps<"/start/[mode]">): Promise<Metadata> {
  const { mode } = await params;
  return { title: mode === "quick" ? "Quick assessment" : "Full assessment" };
}

export default async function StartPage({ params }: PageProps<"/start/[mode]">) {
  const { mode } = await params;
  if (mode !== "quick" && mode !== "full") notFound();
  return <SetupForm mode={mode} />;
}
