/**
 * 「操作担当」ガイドの判定
 *
 * 「気づいた人が終了操作をする」運用を「次の試合に入るメンバー（配置予測の
 * ほぼ確定＝濃い青）が操作する」運用へ変えるための案内。担当に期待するのは
 * 終了ボタンだけでなく **終了 → 配置 → 開始** の一連なので、ラベルは
 * 「終了操作担当」ではなく「操作担当」にしている。
 *
 * **出すのは 4:30（`MATCH_CALL_THRESHOLD_MS`）を過ぎてから**。それ以前は
 * 「誰が担当か」しか言えず、同じ顔ぶれを常時出している配置予測バー
 * （`NextMatchPredictionBar`、見出しに「操作担当」と明記）と情報が重複する。
 * このガイドが担うのは **どのコート付近で待てばいいか** だけで、それが分かるのが
 * 4:30 以降だけだから。役割（操作担当）は配置予測バー側の担当なので文言に含めない。
 *
 * 4:30 の呼び出し通知（`nextMatchCall.ts`）は OS 通知・チャイム・読み上げで
 * 「画面を見ていない人に気づかせる」役割、こちらは同じ時刻に画面上へ出て
 * 「いつでも確認できる」役割で補完する。
 *
 * 判定に必要な「経過最大のプレイ中コート」は `nextMatchCall.ts` の
 * `maxPlayingCourt` / `maxPlayingElapsedMs` をそのまま再利用する。
 * 詳細: docs/plans/2026-08-18-finish-operation-guide.md
 */

import type { Court } from '../types/court';
import { MATCH_CALL_THRESHOLD_MS } from './gameOperations';
import { maxPlayingCourt, maxPlayingElapsedMs } from './nextMatchCall';

export interface FinishOperationGuide {
  /**
   * 最も早く終わりそうなプレイ中コートの ID。
   * 1 面運用（`showCourtNumber === false`）なら null。
   */
  courtId: number | null;
  /** 操作の担当（`certainIds` のうちまだコートに乗っていない人） */
  playerIds: string[];
}

export interface FinishOperationGuideArgs {
  courts: Court[];
  /** 配置予測の「ほぼ確定」メンバー（候補 likelyIds は対象外） */
  certainIds: Set<string>;
  now: number;
  /** コート番号を出すか。呼び出し側が `courts.length > 1` で判断する */
  showCourtNumber: boolean;
}

/** コートに乗っているか（配置済み・プレイ中を問わない） */
function isOnAnyCourt(courts: Court[], playerId: string): boolean {
  return courts.some((c) => c.teamA.includes(playerId) || c.teamB.includes(playerId));
}

/**
 * 表示すべきガイドを組み立てる。出す必要が無ければ null。
 *
 * `courtId` に `callBasisCourtId` を使わないのは意図的。あちらは「次に配置される
 * 先」なので空きコートを優先するが、ここで欲しいのは「終了操作の対象＝もうすぐ
 * 終わるプレイ中コート」で別物。
 */
export function buildFinishOperationGuide(
  args: FinishOperationGuideArgs,
): FinishOperationGuide | null {
  const { courts, certainIds, now, showCourtNumber } = args;

  const basis = maxPlayingCourt(courts, now);
  if (basis === null) return null;

  // 4:30 未満は出さない（配置予測バーと情報が重複するだけなので）
  if (maxPlayingElapsedMs(courts, now) < MATCH_CALL_THRESHOLD_MS) return null;

  // 既にコートに乗っている人は促す相手にならない（`shouldAnnounceToAdmin` の
  // allOnCourt 条件と同じ考え方）。全員乗っていれば出す意味が無い。
  const playerIds = Array.from(certainIds).filter((id) => !isOnAnyCourt(courts, id));
  if (playerIds.length === 0) return null;

  return {
    courtId: showCourtNumber ? basis.id : null,
    playerIds,
  };
}

/**
 * コート番号の丸数字表記（1 → `①`）。コートカードのヘッダーが番号を丸バッジで
 * 出しているので、丸数字だけで「どのコートか」は十分伝わり、`コート` の3文字を
 * 省ける。Unicode に丸数字がある 1〜20 の範囲外は素の数字＋`コート` に戻す。
 */
function circledCourt(courtId: number): string {
  if (!Number.isInteger(courtId) || courtId < 1 || courtId > 20) return `${courtId}コート`;
  return String.fromCharCode(0x2460 + courtId - 1);
}

/**
 * ガイドの見出し文言。名前は表示側がチップで描くのでここには含めない。
 *
 * **どこで待つか**だけを言う。「操作担当」であることは配置予測バーの見出し
 * （`配置予測（操作担当）`）が常時示しているので、ここで繰り返さない。
 * 「付近」は呼び出し通知（`Nコート付近で試合終了をお待ちください`）と同じ語彙。
 */
export function buildFinishOperationGuideHeadline(guide: FinishOperationGuide): string {
  return guide.courtId === null ? 'コート付近待機' : `${circledCourt(guide.courtId)}付近待機`;
}

/**
 * ガイドが出るまで（4:30 に達するまで）の待ち時間（ms）。
 * 既に 4:30 を超えている、またはプレイ中コートが無ければ null（タイマー不要）。
 * 毎秒 tick する代わりに閾値ちょうどで1回だけ再評価させるために使う
 * （`courtEmphasis.ts` の `getNextCourtEmphasisDelay` と同じ考え方）。
 */
export function getNextFinishGuideDelay(courts: Court[], now: number): number | null {
  const court = maxPlayingCourt(courts, now);
  if (court === null) return null;
  const elapsed = now - court.startedAt;
  if (elapsed >= MATCH_CALL_THRESHOLD_MS) return null;
  return MATCH_CALL_THRESHOLD_MS - elapsed;
}
