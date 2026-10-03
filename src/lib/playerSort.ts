import type { ExpectedGames } from './playerStats';

/** ソートに必要な最小フィールドだけを要求（Player 型全体に依存させない） */
interface SortablePlayer {
  id: string;
  name: string;
  gamesPlayed: number;
}

/**
 * 参加者一覧を「期待との差（実績 − 期待値）が小さい順」（足りていない人が上）に並べ、
 * currentUser と名前が一致する本人を `self` に切り出す（入力配列は破壊しない）。
 *
 * - 差が算出できない人（null。未完了など）は差ありの人の後ろ。その中は試合数昇順。
 * - 最終 tie-break は名前昇順（`localeCompare('ja')`）。
 * - `self` は並びと無関係に取り出され、`others` からは除外される。
 */
export function sortPlayersByExpectedDiff<T extends SortablePlayer>(
  players: T[],
  expectedById: ReadonlyMap<string, ExpectedGames>,
  currentUser: string | null | undefined,
): { self: T | null; others: T[] } {
  const diffOf = (p: T): number | null => expectedById.get(p.id)?.diff ?? null;
  const sorted = [...players].sort((a, b) => {
    const da = diffOf(a);
    const db = diffOf(b);
    if (da !== null && db !== null) {
      if (da !== db) return da - db;
    } else if (da !== null) {
      return -1;
    } else if (db !== null) {
      return 1;
    } else if (a.gamesPlayed !== b.gamesPlayed) {
      return a.gamesPlayed - b.gamesPlayed;
    }
    return a.name.localeCompare(b.name, 'ja');
  });
  const selfIndex = currentUser ? sorted.findIndex((p) => p.name === currentUser) : -1;
  if (selfIndex < 0) return { self: null, others: sorted };
  const self = sorted[selfIndex];
  return { self, others: sorted.filter((_, i) => i !== selfIndex) };
}
