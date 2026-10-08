import type { Metadata } from "next";
import { ItemReview } from "@/components/review/item-review";

export const metadata: Metadata = {
  title: "Item bank review",
  robots: { index: false, follow: false },
};

/**
 * Reviewer view of the whole item bank, with keys and explanations. It is
 * disabled in production unless NEXT_PUBLIC_ENABLE_ITEM_REVIEW=true, because
 * publishing the keys would compromise the items for future participants.
 */
export default function ReviewPage() {
  const enabled = process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_ENABLE_ITEM_REVIEW === "true";
  if (!enabled) {
    return (
      <div className="mx-auto max-w-2xl px-5 py-20 sm:px-8">
        <h1 className="text-2xl font-semibold">Item review is disabled</h1>
        <p className="mt-3 text-muted-foreground">
          Publishing the answer keys would compromise the items. Set NEXT_PUBLIC_ENABLE_ITEM_REVIEW=true on a private
          deployment to enable this page for reviewers.
        </p>
      </div>
    );
  }
  return <ItemReview />;
}
