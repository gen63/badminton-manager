/**
 * 「終了操作をお願いします」ガイドの判定
 *
 * 「気づいた人が終了操作をする」運用を「次の試合に入るメンバー（配置予測の
 * ほぼ確定＝濃い青）が終了操作をする」運用へ変えるため、画面上部に消えない
 * 案内を出す。4:30 の呼び出し通知（`nextMatchCall.ts`）は8秒で消えるトーストで
 * 「気づかせる」役割、こちらは「いつでも確認できる」役割で補完する。
 *
 * 2段階で案内する:
 *   - `waiting`: まだどのコートが先に終わるか分からない。担当だけ示す。
 *   - `imminent`: どこかのコートが 4:30 を超えた。コート番号まで示す。
 *
 * 判定に必要な「経過最大のプレイ中コート」は `nextMatchCall.ts` の
 * `maxPlayingCourt` / `maxPlayingElapsedMs` をそのまま再利用する。
 * 詳細: docs/plans/2026-08-18-finish-operation-guide.md
 */

import type { Court } from '../types/court';
import { MATCH_CALL_THRESHOLD_MS } from './gameOperations';
import { maxPlayingCourt, maxPlayingElapsedMs } from './nextMatchCall';

/**
 * ガイドの段階。
 * - `waiting`: プレイ中だがまだ 4:30 未満（終わるコートが未定）
 * - `imminent`: 経過最大のコートが 4:30 を超えた（もうすぐ終わる）
 */
export type FinishGuidePhase = 'waiting' | 'imminent';

export interface FinishOperationGuide {
  phase: FinishGuidePhase;
  /**
   * `imminent` のとき最も早く終わりそうなプレイ中コートの ID。
   * `waiting` のとき、および 1 面運用（`showCourtNumber === false`）なら null。
   */
  courtId: number | null;
  /** 終了操作をお願いする担当（`certainIds` のうちまだコートに乗っていない人） */
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

  // 既にコートに乗っている人は促す相手にならない（`shouldAnnounceToAdmin` の
  // allOnCourt 条件と同じ考え方）。全員乗っていれば出す意味が無い。
  const playerIds = Array.from(certainIds).filter((id) => !isOnAnyCourt(courts, id));
  if (playerIds.length === 0) return null;

  const imminent = maxPlayingElapsedMs(courts, now) >= MATCH_CALL_THRESHOLD_MS;

  return {
    phase: imminent ? 'imminent' : 'waiting',
    courtId: imminent && showCourtNumber ? basis.id : null,
    playerIds,
  };
}

/**
 * ガイドの見出し文言。名前は表示側がチップで描くのでここには含めない。
 * 語彙は呼び出し通知（`buildNextMatchCallMessage`）の「コート付近で〜」と
 * 揃えつつ、こちらは操作の依頼なので「コート脇で終了操作をお願いします」にする。
 */
export function buildFinishOperationGuideHeadline(guide: FinishOperationGuide): string {
  if (guide.phase === 'waiting') return '終了操作をお願いします';
  return guide.courtId === null
    ? 'コート脇で終了操作をお願いします'
    : `${guide.courtId}コート脇で終了操作をお願いします`;
}

/**
 * `waiting` から `imminent` に変わるまでの待ち時間（ms）。
 * 既に `imminent`、またはプレイ中コートが無ければ null（タイマー不要）。
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
