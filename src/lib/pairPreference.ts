/**
 * ペア希望（`PairPreference`）から配置エンジンへ渡す入力を算出する純粋関数群。
 *
 * `docs/plans/2026-08-31-pair-preference.md` の「2. 「確率を上げる」の表現方法」
 * 「3b. 試合機会への影響」に対応する接続層。`src/lib/pairing/` の目的関数
 * エンジンには一切依存を持ち込まず（`AffinityPair` / `StrongPair` の型だけ使う）、
 * `algorithm.ts` から呼ばれる。
 *
 * **2026-09-01 に飽和（実績比率ベースの `deficit`）を廃止した。** 旧版は
 * 「実績 / 機会」の達成度から不足度を出し、目標に達すると 0 になって
 * `variety` に譲る設計だったが、常に最大強度で押し続ける仕様に変更した。
 * `computeAffinityPairs` はもう実績（`partnerCounts`）を見ない — 「対象に
 * するかどうか」（候補プールにいるか・公平性ガード）だけを判定する。
 */
import type { PairPreference } from '../types/pairPreference';
import type { Player } from '../types/player';
import type { AffinityPair } from './pairing/objective';
import type { StrongPair } from './pairing/assignRound';

/**
 * 希望ペアのうち「対象にするもの」だけを、目的関数（第7目的 `affinity`）に
 * そのまま渡せる `AffinityPair[]` として組み立てる。対象ペアは常に最大強度
 * （旧 `deficit = 1.0` 相当）で扱う — 実績比率による飽和は無い。
 *
 * - **両者が候補プール（`players`）にいる希望ペアだけ**を返す。片方でも
 *   `players` にいないペアは対象外（plan「3. 目的関数への追加」の評価対象）
 * - **公平性ガード（plan 3b）**: どちらかの `gamesPlayed − medianGames >=
 *   blockThreshold` なら、そのペアは対象外にする。これが無いと「ペア希望を
 *   登録すると試合数が増える」不公平が生じる。**飽和を廃止した今、これが
 *   ペア希望の出場頻度への影響を抑える唯一の仕組み**なので消さない。
 *   `medianGames` / `blockThreshold` は呼び出し側（`algorithm.ts`）が予約
 *   保留判定と共通のものを渡すこと（新しい閾値は増やさない）
 * - `strength` による区別はしない（`normal` / `strong` のどちらも対象なら
 *   同じ強度で返す）。`normal` と `strong` の違いは呼び出し側で
 *   `computeStrongPairs` が追加するハード制約の有無だけになる
 */
export function computeAffinityPairs(
  preferences: PairPreference[],
  players: Player[],
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

    result.push({ a, b });
  }

  return result;
}

/**
 * 強度「必ず」（`strong`）の希望ペアを、ハード制約用の `StrongPair[]` として
 * 抽出する。`evaluate()` 側で (a)「両方が出るなら必ず味方」に加えて
 * (b)「2人一緒に出るか、2人とも控えるか」も判定される
 * （`docs/plans/2026-08-31-pair-preference.md` 3d、2026-09-01 に (b) を追加）。
 *
 * `computeAffinityPairs` の公平性ガード（`medianGames` / `blockThreshold`）は
 * **一切適用しない**。ハード制約側（`StrongPair`）にガードを掛けると
 * 「出場したのに敵同士にされる」「一緒に出られるはずが片方だけ弾かれる」と
 * いう `strong` の意味論が壊れるため、ソフト項（`affinity`）にだけ掛ける
 * という設計は (b) を足した後も変わらない。
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
