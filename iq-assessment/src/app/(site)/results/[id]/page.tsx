import type { Metadata } from "next";
import { ResultsView } from "@/components/results/results-view";

export const metadata: Metadata = { title: "Your results", robots: { index: false } };

export default async function ResultsPage({ params }: PageProps<"/results/[id]">) {
  const { id } = await params;
  return <ResultsView id={id} />;
}
