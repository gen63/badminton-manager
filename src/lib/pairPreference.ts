/**
 * ペア希望（`PairPreference`）から配置エンジンへ渡す入力を算出する純粋関数群。
 *
 * `docs/plans/2026-08-31-pair-preference.md` の「2. 「確率を上げる」の表現方法」
 * 「3b. 試合機会への影響」に対応する接続層。`src/lib/pairing/` の目的関数
 * エンジンには一切依存を持ち込まず（`AffinityPair` / `StrongPair` の型だけ使う）、
 * `algorithm.ts` から呼ばれる。
 */
import type { PairPreference } from '../types/pairPreference';
import { TARGET_RATIO } from '../types/pairPreference';
import type { Player } from '../types/player';
import type { AffinityPair } from './pairing/objective';
import type { StrongPair } from './pairing/assignRound';

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

/**
 * 希望ペアごとの `deficit`（不足度、0〜1）を算出し、目的関数（第7目的
 * `affinity`）にそのまま渡せる `AffinityPair[]` を組み立てる。
 *
 * ```
 * 実績   actual      = partnerCounts から取得（味方だった回数）
 * 機会   opportunity = min(gamesPlayed_a, gamesPlayed_b)
 * 達成度 achieved    = actual / max(1, opportunity)
 * 不足度 deficit     = clamp01((targetRatio − achieved) / targetRatio)
 * ```
 *
 * - **両者が候補プール（`players`）にいる希望ペアだけ**を返す。片方でも
 *   `players` にいないペアは対象外（plan「3. 目的関数への追加」の評価対象）
 * - **公平性ガード（plan 3b）**: どちらかの `gamesPlayed − medianGames >=
 *   blockThreshold` なら、そのペアは対象外にする（`deficit` を 0 扱いにして
 *   除外するのと同じ）。これが無いと「ペア希望を登録すると試合数が増える」
 *   不公平が生じる。`medianGames` / `blockThreshold` は呼び出し側
 *   （`algorithm.ts`）が予約保留判定と共通のものを渡すこと（新しい閾値は
 *   増やさない）
 * - `deficit <= 0`（目標達成済み・超過）のペアも対象外にする。0 を含めても
 *   `objective.ts` 側で無害だが、`affinityPairs`（実運用1〜3組）を評価対象数の
 *   計算に混ぜないため、ここで削っておく
 */
export function computeAffinityPairs(
  preferences: PairPreference[],
  players: Player[],
  partnerCounts: Map<string, number>,
  pairKeyOf: (a: string, b: string) => string,
  medianGames: number,
  blockThreshold: number,
): AffinityPair[] {
  if (preferences.length === 0) return [];

  const playerById = new Map(players.map((p) => [p.id, p]));
  const result: AffinityPair[] = [];

  for (const pref of preferences) {
    const [a, b] = pref.playerIds;
    const playerA = playerById.get(a);
    const playerB = playerById.get(b);
    if (!playerA || !playerB) continue; // 片方が候補プールにいない

    // 公平性ガード（3b）: どちらかが「試合数超過」なら保留（予約保留判定と同じ基準）
    if (playerA.gamesPlayed - medianGames >= blockThreshold) continue;
    if (playerB.gamesPlayed - medianGames >= blockThreshold) continue;

    const opportunity = Math.min(playerA.gamesPlayed, playerB.gamesPlayed);
    const actual = partnerCounts.get(pairKeyOf(a, b)) ?? 0;
    const achieved = actual / Math.max(1, opportunity);
    const targetRatio = TARGET_RATIO[pref.strength];
    const deficit = clamp01((targetRatio - achieved) / targetRatio);
    if (deficit <= 0) continue; // 目標達成済み・超過は対象外

    result.push({ a, b, deficit });
  }

  return result;
}

/**
 * 強度「必ず」（`strong`）の希望ペアを、ハード制約用の `StrongPair[]` として
 * 抽出する。
 *
 * `computeAffinityPairs` のソフト項ガード（`medianGames` / `blockThreshold`）は
 * **一切適用しない**。plan 3d のとおり、公平性リークはソフト項が2人を
 * コートへ引っ張ることに由来しており、ハード制約側（「両方出るなら必ず味方」）
 * は出場頻度に干渉しないため、ガードを掛ける必要が無い（掛けると「出場したのに
 * 敵同士にされる」という `strong` の意味論が壊れる）。
 *
 * `computeAffinityPairs` と同じく、**両者が候補プールにいる希望ペアだけ**を
 * 返す（片方が候補プールにいなければハード制約としても意味を持たないため）。
 */
export function computeStrongPairs(
  preferences: PairPreference[],
  players: Player[],
): StrongPair[] {
  if (preferences.length === 0) return [];

  const playerIds = new Set(players.map((p) => p.id));
  const result: StrongPair[] = [];

  for (const pref of preferences) {
    if (pref.strength !== 'strong') continue;
    const [a, b] = pref.playerIds;
    if (!playerIds.has(a) || !playerIds.has(b)) continue;
    result.push({ a, b });
  }

  return result;
}
