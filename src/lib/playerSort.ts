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

/** 「試合から時間が経った順」の並べ替えに必要なフィールド */
interface LastGameSortable extends SortablePlayer {
  lastPlayedAt: number;
}

/**
 * 参加者一覧を「最後の試合終了から経過が長い順」に並べ、本人を `self` に切り出す。
 *
 * 並び: 未試合（lastPlayedAt=0 でコート上にいない）→ 経過の長い順 → 現在コートで試合中の人（最後尾）。
 * tie-break は名前昇順（`localeCompare('ja')`）。入力配列は破壊しない。
 */
export function sortPlayersBySinceLastGame<T extends LastGameSortable>(
  players: T[],
  inCourtIds: ReadonlySet<string>,
  now: number,
  currentUser: string | null | undefined,
): { self: T | null; others: T[] } {
  // 小さいほど上。未試合 = -Infinity、試合中 = +Infinity、それ以外は経過ミリ秒の負数（長いほど小さい）
  const keyOf = (p: T): number => {
    if (inCourtIds.has(p.id)) return Infinity;
    if (!p.lastPlayedAt || p.lastPlayedAt <= 0) return -Infinity;
    return -(now - p.lastPlayedAt);
  };
  const sorted = [...players].sort((a, b) => {
    const ka = keyOf(a);
    const kb = keyOf(b);
    if (ka !== kb) return ka < kb ? -1 : 1;
    return a.name.localeCompare(b.name, 'ja');
  });
  const selfIndex = currentUser ? sorted.findIndex((p) => p.name === currentUser) : -1;
  if (selfIndex < 0) return { self: null, others: sorted };
  return { self: sorted[selfIndex], others: sorted.filter((_, i) => i !== selfIndex) };
}
