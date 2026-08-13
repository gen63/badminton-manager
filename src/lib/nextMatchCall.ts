/**
 * 「次の試合に入りそう」事前呼び出し通知の判定
 *
 * MainPage から副作用（Notification / トースト送出）を切り離し、いつ呼び出すべきかの
 * 判定だけを純粋関数として持つ。プレイ中コートのうち経過時間が最大のコートを
 * 基準にする（それが最初に終わる可能性が最も高いコートだから）。`certainIds` は
 * `nextMatchPrediction` の「ほぼ確定」メンバーで、どのコートが終わっても選ばれる
 * ため、基準コートが実際にどれになっても呼ぶ相手は変わらない。
 */

import type { Court } from '../types/court';
import { MATCH_CALL_THRESHOLD_MS } from './gameOperations';

/** プレイ中コートの経過時間の最大値（ms）。プレイ中のコートが無ければ 0 */
export function maxPlayingElapsedMs(courts: Court[], now: number): number {
  let max = 0;
  for (const c of courts) {
    if (!c.isPlaying || c.startedAt <= 0) continue;
    const elapsed = now - c.startedAt;
    if (elapsed > max) max = elapsed;
  }
  return max;
}

export interface NextMatchCallArgs {
  courts: Court[];
  /** 配置予測の「ほぼ確定」メンバー（候補 likelyIds は対象外） */
  certainIds: Set<string>;
  /** 自分の Player ID。特定できないときは null */
  myPlayerId: string | null;
  now: number;
  /** すでに呼び出し済みか */
  alreadyCalled: boolean;
}

/** 次の試合に入りそうなメンバーへの事前呼び出し通知を出すべきか判定する */
export function shouldCallNextMatch(args: NextMatchCallArgs): boolean {
  const { courts, certainIds, myPlayerId, now, alreadyCalled } = args;

  if (myPlayerId === null) return false;
  if (alreadyCalled) return false;
  if (!certainIds.has(myPlayerId)) return false;

  const onAnyCourt = courts.some(
    (c) => c.teamA.includes(myPlayerId) || c.teamB.includes(myPlayerId),
  );
  if (onAnyCourt) return false;

  return maxPlayingElapsedMs(courts, now) >= MATCH_CALL_THRESHOLD_MS;
}
