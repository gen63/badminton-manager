/**
 * Firebase同期ユーティリティ関数
 * テスト可能な純粋関数として抽出
 */

/**
 * Firestoreタイムスタンプをミリ秒に変換（堅牢版）
 * @returns ミリ秒、または取得失敗時は0
 */
export function getTimestampMillis(timestamp: unknown): number | null {
  if (!timestamp) {
    return null;
  }
  
  // 数値（ミリ秒）の場合
  if (typeof timestamp === 'number') {
    return timestamp;
  }
  
  // Firestore Timestamp型
  if (typeof timestamp === 'object' && timestamp !== null) {
    // toMillis()メソッドがあれば使用（推奨）
    if ('toMillis' in timestamp && typeof timestamp.toMillis === 'function') {
      return (timestamp as { toMillis(): number }).toMillis();
    }
    // secondsフィールドで変換（フォールバック）
    if ('seconds' in timestamp && typeof timestamp.seconds === 'number') {
      return (timestamp as { seconds: number }).seconds * 1000;
    }
  }
  
  return null;
}

/**
 * データのハッシュを計算（簡易版）
 */
export function hashGameState(data: { 
  players: unknown[]; 
  courts: unknown[]; 
  matchHistory: unknown[]; 
  reservations: unknown[] 
}): string {
  return JSON.stringify(data);
}

/**
 * リモートデータを適用すべきか判定
 * 
 * @param incomingHash 受信データのハッシュ
 * @param lastPushedHash 最後にpushしたデータのハッシュ
 * @param remoteUpdatedAt リモートデータの更新時刻（ミリ秒）
 * @param lastAppliedRemoteUpdatedAt 最後に適用したリモートデータの更新時刻（ミリ秒）
 * @param lastPushedTime 最後にpushした時刻（ミリ秒）
 * @param currentTime 現在時刻（ミリ秒）
 * @param pushBlockMs push後のブロック時間（ミリ秒）
 * @returns { shouldApply: boolean, reason?: string }
 */
export function shouldApplyRemoteData(params: {
  incomingHash: string;
  lastPushedHash: string;
  remoteUpdatedAt: number;
  lastAppliedRemoteUpdatedAt: number;
  lastPushedTime: number;
  currentTime: number;
  pushBlockMs?: number;
}): { shouldApply: boolean; reason?: string } {
  const {
    incomingHash,
    lastPushedHash,
    remoteUpdatedAt,
    lastAppliedRemoteUpdatedAt,
    lastPushedTime,
    currentTime,
    pushBlockMs = 500,
  } = params;

  // 自分が最後にpushしたデータと同じなら無視
  if (incomingHash === lastPushedHash) {
    return { shouldApply: false, reason: 'same as last push' };
  }

  // リモートデータが古い（または同じ）なら無視
  if (lastAppliedRemoteUpdatedAt > 0 && remoteUpdatedAt <= lastAppliedRemoteUpdatedAt) {
    return { 
      shouldApply: false, 
      reason: `older remote data (${remoteUpdatedAt} <= ${lastAppliedRemoteUpdatedAt})`,
    };
  }

  // 最後のpush操作から短時間以内なら無視（自分の操作を優先）
  const timeSinceLastPush = currentTime - lastPushedTime;
  if (timeSinceLastPush < pushBlockMs) {
    return { 
      shouldApply: false, 
      reason: `too soon after push (${timeSinceLastPush}ms < ${pushBlockMs}ms)`,
    };
  }

  return { shouldApply: true };
}
