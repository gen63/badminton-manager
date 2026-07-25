/** 参加者管理ページのソートモード。`games` = 試合数が多い順（既定）、`lastSeen` = 見ていない順 */
export type PlayerSortMode = 'games' | 'lastSeen';

/** ソートに必要な最小フィールドだけを要求（Player 型全体に依存させない） */
interface SortablePlayer {
  name: string;
  gamesPlayed: number;
}

/**
 * 参加者一覧を指定モードでソートした新配列を返す（入力配列は破壊しない）。
 *
 * - `games`: 試合数が多い順。同値は名前昇順（`localeCompare('ja')`）で安定化する
 *   （現状は同値時の順序が配列順依存なので、tie-break を入れて描画のちらつきも減らす）。
 * - `lastSeen`: 最終画面参照が古い人が上（見ていない順）。`lastSeen[name]` が
 *   `undefined` / 数値でない場合は `未閲覧` として最上位に寄せる。同値は試合数の
 *   多い順 → 名前昇順で安定化する。
 */
export function sortPlayers<T extends SortablePlayer>(
  players: T[],
  mode: PlayerSortMode,
  lastSeen: { [username: string]: number },
): T[] {
  if (mode === 'lastSeen') {
    return [...players].sort((a, b) => {
      const aSeen = toLastSeenSortKey(lastSeen[a.name]);
      const bSeen = toLastSeenSortKey(lastSeen[b.name]);
      if (aSeen !== bSeen) return aSeen - bSeen;
      if (b.gamesPlayed !== a.gamesPlayed) return b.gamesPlayed - a.gamesPlayed;
      return a.name.localeCompare(b.name, 'ja');
    });
  }

  return [...players].sort((a, b) => {
    if (b.gamesPlayed !== a.gamesPlayed) return b.gamesPlayed - a.gamesPlayed;
    return a.name.localeCompare(b.name, 'ja');
  });
}

/** `lastSeen` の値をソート用キーに変換する。未閲覧（未設定/数値でない）は `-Infinity` として先頭に寄せる */
function toLastSeenSortKey(value: number | undefined): number {
  return typeof value === 'number' && !Number.isNaN(value) ? value : -Infinity;
}
