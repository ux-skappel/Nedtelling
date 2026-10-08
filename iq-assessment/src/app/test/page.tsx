import type { Metadata } from "next";
import { AssessmentRunner } from "@/components/assessment/runner";

export const metadata: Metadata = { title: "Assessment in progress", robots: { index: false } };

export default function TestPage() {
  return <AssessmentRunner />;
}
