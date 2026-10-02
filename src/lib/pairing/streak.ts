/**
 * 連続出場数（`streakOf`）の組み立て。目的8 `recency` の入力。
 * `docs/plans/2026-10-01-recency-just-finished-streak.md`
 *
 * ## 連続の定義（時刻ベース）
 *
 * 「たった今終わったコートに居た人」だけが連続候補になる。
 *
 * - その人の**最後の試合の `finishedAt` 以降に、他の試合が1つも開始していない**
 *   ⇔ streak >= 1。他の試合とは履歴上の試合と、**現在進行中コートの試合**の両方
 * - 過去へ遡り、その人の連続する2出場 k → k+1 の間（`finish_k` 〜 `start_{k+1}`）に
 *   他の試合の開始が無ければ連続としてカウントする
 * - streak ＝ 連続して出た試合数（直前の1試合だけなら 1）
 *
 * 連続モードでは「今終わったコートの4人」がちょうどこれに当たり、手動配置でも
 * 同じ定義で自然に効く。旧定義（出場間隔 < コート数）は複数コートで待機者のほぼ
 * 全員が連続扱いになり、区別できなかった。
 *
 * ## 時刻の扱い
 *
 * - **履歴内の値どうしの比較のみ**。`Date.now()` に依存しない（bench・テストが決定的）
 * - 開始の判定は **`start >= finishedAt`（下限を含む）**。連続モードは
 *   `computeFinishAndContinue` が終了と次の配置を同じ瞬間（同一 ms になりうる）に
 *   行うため、同時刻の開始は「終了後に始まった試合」として数えないと、直前に
 *   終わった人が連続のまま残ってしまう
 * - 連鎖の上限側は `start_{k+1}` を**含まない**（自分自身の次の試合を数えない）。
 *   連続モードで自分が即再配置されたとき（start_{k+1} == finish_k）は間が空なので連続
 * - 時刻が無い旧データ（`startedAt` / `finishedAt` が 0・非数）はその試合を
 *   「判定不能」として扱い、そこで連鎖を打ち切る（最新の試合が判定不能なら 0）。
 *   減点しない側に倒れる
 * - 自動終了で `finishedAt` が `開始 + 15分` に丸められた場合（2026-09-30-auto-end-always.md）、
 *   実際の終了より前の時刻になるので、丸めと実終了の間に始まった他コートの試合が
 *   あれば連続は切れる。こちらも減点しない側に倒れるだけで破綻しない
 */

import type { Match } from '../../types/match';

/** 判定に使える時刻か（0・負・非数は旧データ／未設定として無効） */
function isValidTime(t: number | undefined): t is number {
  return typeof t === 'number' && Number.isFinite(t) && t > 0;
}

/**
 * 進行中コートの開始時刻を取り出す（`assignCourts` の `inProgressStartedAt` 用）。
 *
 * 配置済み（チームに ID がある）コートが対象。開始前（準備中）で `startedAt` が
 * 未設定なら配置時刻 `assignedAt` を使う。どちらも無ければ（旧データ）無視する。
 * 呼び出し側は**これから配置する対象コートをクリアした後**の courts を渡すこと。
 */
export function courtStartTimes(
  courts: { teamA: [string, string]; startedAt: number; assignedAt?: number }[]
): number[] {
  const times: number[] = [];
  for (const c of courts) {
    if (!c.teamA[0] || c.teamA[0].trim() === '') continue;
    const t = isValidTime(c.startedAt) ? c.startedAt : c.assignedAt;
    if (isValidTime(t)) times.push(t);
  }
  return times;
}

/**
 * 全員の streak（連続出場数）を作る。連続していない人・未出場は Map に入れない（＝0）。
 *
 * @param matchHistory 終了済みの試合（並び順は問わない。時刻だけを見る）
 * @param inProgressStartedAt 現在進行中コートの開始時刻（{@link courtStartTimes}）。
 *   省略時は履歴上の試合の開始だけで判定する
 */
export function buildStreakById(
  matchHistory: Match[],
  inProgressStartedAt: number[] = []
): Map<string, number> {
  const streakById = new Map<string, number>();
  if (matchHistory.length === 0) return streakById;

  // 全試合の開始時刻（昇順）。区間内に開始があるかを二分探索で見る
  const starts: number[] = [];
  for (const m of matchHistory) if (isValidTime(m.startedAt)) starts.push(m.startedAt);
  for (const t of inProgressStartedAt) if (isValidTime(t)) starts.push(t);
  starts.sort((a, b) => a - b);

  /** `from <= start < to` の開始が存在するか */
  const hasStartIn = (from: number, to: number): boolean => {
    let lo = 0;
    let hi = starts.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (starts[mid] < from) lo = mid + 1;
      else hi = mid;
    }
    return lo < starts.length && starts[lo] < to;
  };

  // 人ごとの出場（時刻不明は null のまま持ち、連鎖の打ち切りに使う）
  const byPlayer = new Map<string, Match[]>();
  for (const m of matchHistory) {
    for (const id of [...m.teamA, ...m.teamB]) {
      if (!id) continue; // シングルスの空スロット
      const list = byPlayer.get(id);
      if (list) list.push(m);
      else byPlayer.set(id, [m]);
    }
  }

  for (const [id, matches] of byPlayer) {
    // 新しい順。同時刻は履歴の並びの後ろ（＝より新しい終了）を優先
    const sorted = matches
      .map((m, i) => ({ m, i }))
      .sort((a, b) => (b.m.startedAt || 0) - (a.m.startedAt || 0) || b.i - a.i)
      .map(x => x.m);

    const latest = sorted[0];
    if (!isValidTime(latest.finishedAt)) continue;
    // 最後の試合の終了以降に他の試合が始まっていれば、もう連続ではない
    if (hasStartIn(latest.finishedAt, Infinity)) continue;

    let streak = 1;
    for (let k = 1; k < sorted.length; k++) {
      const prev = sorted[k];
      const next = sorted[k - 1];
      if (!isValidTime(prev.finishedAt) || !isValidTime(next.startedAt)) break;
      if (hasStartIn(prev.finishedAt, next.startedAt)) break;
      streak++;
    }
    streakById.set(id, streak);
  }
  return streakById;
}
