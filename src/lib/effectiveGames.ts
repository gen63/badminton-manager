/**
 * 進行中の試合を公平性の母集団に数えるためのヘルパー。
 *
 * `Player.gamesPlayed` は試合終了時に +1 される保存値だが、配置アルゴリズムの
 * 公平性判定（後半均等化の最大値・予約保留の中央値など）には「今まさに
 * コート上でプレイ中のメンバー」も母集団に含めたい箇所がある。配置された時点で
 * その人は1試合こなす、とみなして +1 した一時的な view を返す。
 *
 * 保存はしない（Firestore の gamesPlayed は従来どおり試合終了時 +1 のまま）。
 * 詳細: docs/plans/2026-08-13-in-progress-games-in-fairness.md
 */

import type { Player } from '../types/player';
import type { Court } from '../types/court';

/**
 * コートの teamA/teamB に ID が入っているメンバーの `gamesPlayed` を +1 した
 * 配列を返す。それ以外のプレイヤーは同一オブジェクト参照のまま返す
 * （不要な再レンダー抑止）。
 *
 * `assignedAt` / `isPlaying` は判定に使わない。「配置済み」＝チームに ID が
 * 入っているかどうかだけで判定するのが最も事故が少ない
 * （配置解除時にチームが空になるため）。
 */
export function withInProgressGames(players: Player[], courts: Court[]): Player[] {
  const inProgressIds = new Set(
    courts.flatMap((c) => [...c.teamA, ...c.teamB]).filter((id) => id && id.trim())
  );

  if (inProgressIds.size === 0) return players;

  return players.map((p) =>
    inProgressIds.has(p.id) ? { ...p, gamesPlayed: p.gamesPlayed + 1 } : p
  );
}
