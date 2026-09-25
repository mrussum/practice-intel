import { describe, expect, it } from "vitest";
import { reciprocalRankFusion } from "../src/lib/fusion.js";

const items = (...ids: string[]) => ids.map((id) => ({ id }));
const ranked = (lists: { id: string }[][], k?: number) =>
  reciprocalRankFusion(lists, k).map(({ item, score }) => [item.id, Number(score.toFixed(6))]);

describe("reciprocalRankFusion", () => {
  it("worked example with k = 1: agreement beats a single first place", () => {
    // x: 1/(1+1) = 0.5            (rank 1 in list A only)
    // y: 1/(1+2) + 1/(1+1) = 0.833333 (rank 2 in A, rank 1 in B)
    // z: 1/(1+2) = 0.333333       (rank 2 in B only)
    expect(ranked([items("x", "y"), items("y", "z")], 1)).toEqual([
      ["y", 0.833333],
      ["x", 0.5],
      ["z", 0.333333],
    ]);
  });

  it("worked example with the default k = 60", () => {
    // a: 1/61 + 1/62 = 0.032522   c: 1/63 + 1/61 = 0.032266
    // b: 1/62 = 0.016129          d: 1/63 = 0.015873
    expect(ranked([items("a", "b", "c"), items("c", "a", "d")])).toEqual([
      ["a", 0.032522],
      ["c", 0.032266],
      ["b", 0.016129],
      ["d", 0.015873],
    ]);
  });

  it("breaks ties by first appearance so output is deterministic", () => {
    expect(ranked([items("a"), items("b")]).map(([id]) => id)).toEqual(["a", "b"]);
    expect(ranked([items("b"), items("a")]).map(([id]) => id)).toEqual(["b", "a"]);
  });

  it("handles empty input and keeps the original objects", () => {
    expect(reciprocalRankFusion([])).toEqual([]);
    expect(reciprocalRankFusion([[], []])).toEqual([]);
    const obj = { id: "a", text: "hello" };
    expect(reciprocalRankFusion([[obj]])[0]!.item).toBe(obj);
  });
});
