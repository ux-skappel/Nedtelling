import type { Metadata } from "next";
import { HistoryList } from "@/components/history/history-list";

export const metadata: Metadata = { title: "My results" };

export default function HistoryPage() {
  return (
    <div className="mx-auto max-w-3xl px-5 py-12 sm:px-8 sm:py-16">
      <p className="eyebrow">Stored on this device</p>
      <h1 className="mt-2 text-3xl font-semibold">My results</h1>
      <p className="mt-3 text-muted-foreground">
        Assessments are kept only in this browser. Clearing your browser data removes them.
      </p>
      <div className="mt-8">
        <HistoryList />
      </div>
    </div>
  );
}
