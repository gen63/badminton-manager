/**
 * GAS アップロード状態のバッジ判定（セッション一覧・開発モード限定表示用）
 *
 * 方針は「やり忘れの発見」なので、アップロードすべきものが無いセッション
 * （試合 0 件 / 会計未入力）ではバッジを出さない。
 * 詳細: docs/plans/2026-07-08-session-upload-status.md
 */

import type { Session } from '../types/session';

/**
 * 試合結果アップロードのバッジ状態
 * - none: バッジ不要（試合なし、またはアップロード済みで差分なし）
 * - not-uploaded: 試合があるのに未アップロード
 * - stale: アップロード後に試合が増えた（再アップロードが必要）
 */
export type MatchUploadBadge = 'none' | 'not-uploaded' | 'stale';

export function getMatchUploadBadge(session: Session): MatchUploadBadge {
  // 勝敗記録モード OFF のセッションは試合結果を GAS に上げない運用のため、
  // 「未アップロード」を促すバッジ自体を出さない（recordScores 未設定は ON 扱い）。
  if (session.recordScores === false) return 'none';
  const matchCount = session.matchCount ?? 0;
  if (matchCount === 0) return 'none';
  if (!session.matchUpload) return 'not-uploaded';
  if (matchCount > session.matchUpload.matchCount) return 'stale';
  return 'none';
}

/** 会計入力があるのに未アップロードのとき true */
export function needsAccountingUploadBadge(session: Session): boolean {
  return !!session.accounting && !session.accountingUpload;
}
