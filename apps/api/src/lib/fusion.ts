/**
 * Reciprocal rank fusion (Cormack et al., 2009): score(d) = Σ 1 / (k + rank),
 * with ranks starting at 1, summed over every list that contains d.
 *
 * Why RRF: vector and full-text scores live on incomparable scales (cosine vs
 * ts_rank). RRF only uses ranks, so there is nothing to normalise or tune
 * beyond k. k = 60 is the paper's default and dampens the head of each list.
 */
export function reciprocalRankFusion<T extends { id: string }>(
  lists: T[][],
  k = 60,
): { item: T; score: number }[] {
  const scores = new Map<string, { item: T; score: number; firstSeen: number }>();
  let seen = 0;
  for (const list of lists) {
    list.forEach((item, index) => {
      const entry = scores.get(item.id) ?? { item, score: 0, firstSeen: seen++ };
      entry.score += 1 / (k + index + 1);
      scores.set(item.id, entry);
    });
  }
  // Ties broken by first appearance, so results are deterministic.
  return [...scores.values()]
    .sort((a, b) => b.score - a.score || a.firstSeen - b.firstSeen)
    .map(({ item, score }) => ({ item, score }));
}
