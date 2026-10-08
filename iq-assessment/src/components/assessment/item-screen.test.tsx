// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import bankJson from "@/data/item-bank.json";
import type { Item, ItemBank } from "@/lib/items/types";
import { ItemScreen, type ItemResult } from "./item-screen";

const bank = bankJson as unknown as ItemBank;
const textItem = bank.items.find((i) => i.family === "vocabulary" && !i.practice) as Item;
const numericItem = bank.items.find((i) => i.family === "number-series" && !i.practice) as Item;

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function renderItem(item: Item, onSubmit: (r: ItemResult) => void, extra: Partial<Parameters<typeof ItemScreen>[0]> = {}) {
  const order = item.response.kind === "choice" ? [...item.response.options.map((o) => o.id)].reverse() : null;
  return render(
    <ItemScreen
      item={item}
      mode="test"
      optionOrder={order}
      timeLimitMs={item.timeLimitSec ? item.timeLimitSec * 1000 : null}
      initialElapsedMs={0}
      resumed={false}
      hidden={false}
      glyphs={bank.assets.glyphs}
      onSubmit={onSubmit}
      {...extra}
    />,
  );
}

describe("ItemScreen", () => {
  it("shows options in the presented order and never reveals correctness", () => {
    if (textItem.response.kind !== "choice") throw new Error("expected choice item");
    renderItem(textItem, () => {});
    const radios = screen.getAllByRole("radio");
    const reversed = [...textItem.response.options].reverse();
    radios.forEach((r, i) => expect(r).toHaveTextContent((reversed[i].content as { text: string }).text));
    expect(screen.queryByText(/Correct/)).toBeNull();
  });

  it("selects with number keys and submits with Enter", () => {
    const onSubmit = vi.fn();
    renderItem(textItem, onSubmit);
    expect(screen.getByRole("button", { name: /Next/ })).toBeDisabled();
    fireEvent.keyDown(window, { key: "3" });
    expect(screen.getAllByRole("radio")[2]).toHaveAttribute("aria-checked", "true");
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const result = onSubmit.mock.calls[0][0] as ItemResult;
    expect(result.timedOut).toBe(false);
    expect(result.response).toEqual({ kind: "choice", optionId: screen.getAllByRole("radio")[2].id.split("-").pop() });
    expect(result.rtMs).toBeGreaterThanOrEqual(0);
  });

  it("accepts only whole numbers for numeric items", () => {
    const onSubmit = vi.fn();
    renderItem(numericItem, onSubmit);
    const input = screen.getByPlaceholderText("Your answer");
    fireEvent.change(input, { target: { value: "4a2" } });
    expect(input).toHaveValue("42");
    fireEvent.submit(input.closest("form")!);
    expect(onSubmit.mock.calls[0][0].response).toEqual({ kind: "numeric", value: 42 });
  });

  it("submits a time-out when the limit is reached", async () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "requestAnimationFrame", "cancelAnimationFrame", "performance", "Date"],
    });
    const onSubmit = vi.fn();
    renderItem(textItem, onSubmit, { timeLimitMs: 1000 });
    // Advance in steps so React can run the effects that start the clock.
    for (let i = 0; i < 8; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(250);
      });
    }
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0].timedOut).toBe(true);
  });
});
