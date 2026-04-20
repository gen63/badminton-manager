/**
 * Firebase同期ユーティリティ関数
 * テスト可能な純粋関数として抽出
 */

/**
 * マージ用の汎用GameState型
 * 各エンティティはIDフィールドを持つオブジェクトの配列
 */
export type SyncGameState = {
  players: { id: string }[];
  courts: { id: number }[];
  matchHistory: { id: string; startedAt?: number }[];
  reservations: { id: string }[];
  settings?: Record<string, unknown>;
};

/**
 * Firestoreタイムスタンプをミリ秒に変換（堅牢版）
 * @returns ミリ秒、または取得失敗時はnull
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
  reservations: unknown[];
  settings?: unknown;
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

/**
 * IDベースの3-wayマージ（汎用）
 *
 * base（最後の同期状態）を基準に、ローカルで変更されたアイテムはlocal版を採用し、
 * ローカルで変更されていないアイテムはremote版を採用する。
 * これにより、他クライアントの変更を保持しつつ自分の変更を優先できる。
 */
function mergeById<T extends { id: string | number }>(
  base: T[] | undefined,
  local: T[],
  remote: T[],
): T[] {
  if (!base) return local;

  const baseMap = new Map(base.map(item => [item.id, item]));
  const remoteMap = new Map(remote.map(item => [item.id, item]));

  const result: T[] = [];
  const seen = new Set<string | number>();

  // 1. ローカル配列の順序を基準にする
  for (const localItem of local) {
    seen.add(localItem.id);
    const baseItem = baseMap.get(localItem.id);
    const remoteItem = remoteMap.get(localItem.id);

    if (!remoteItem) {
      // リモートに存在しない
      if (!baseItem) {
        // baseにもない → ローカルで新規追加 → 追加
        result.push(localItem);
      }
      // baseにある → リモートで削除された → 削除（追加しない）
      continue;
    }

    // リモートにも存在する
    const localChanged = !baseItem || JSON.stringify(baseItem) !== JSON.stringify(localItem);
    if (localChanged) {
      result.push(localItem); // ローカル変更を優先
    } else {
      result.push(remoteItem); // ローカル未変更 → リモート版を採用
    }
  }

  // 2. リモートにのみ存在するアイテム（他クライアントが追加）
  for (const remoteItem of remote) {
    if (seen.has(remoteItem.id)) continue;
    seen.add(remoteItem.id);

    const baseItem = baseMap.get(remoteItem.id);
    if (!baseItem) {
      // baseにもない → リモートで新規追加 → 追加
      result.push(remoteItem);
    }
    // baseにある → ローカルで削除された → 削除（追加しない）
  }

  return result;
}

/**
 * matchHistory専用マージ（和集合 + 時系列ソート）
 *
 * matchHistoryはappend-onlyの性質を持つため、IDベースの和集合で十分。
 * ローカルで変更（スコア編集等）されたものはローカル版を優先。
 */
function mergeMatchHistory<T extends { id: string; startedAt?: number }>(
  base: T[] | undefined,
  local: T[],
  remote: T[],
): T[] {
  if (!base) return local;

  const baseMap = new Map(base.map(m => [m.id, m]));
  const localMap = new Map(local.map(m => [m.id, m]));
  const result = new Map<string, T>();

  // ローカルのアイテムを追加（変更含む）
  for (const item of local) {
    result.set(item.id, item);
  }

  // リモートのアイテムを追加（ローカルに無いもの、かつローカルで削除されていないもの）
  for (const remoteItem of remote) {
    if (result.has(remoteItem.id)) {
      // 両方にある場合: ローカルで変更されていればローカル版、そうでなければリモート版
      const baseItem = baseMap.get(remoteItem.id);
      const localItem = localMap.get(remoteItem.id)!;
      const localChanged = !baseItem || JSON.stringify(baseItem) !== JSON.stringify(localItem);
      if (!localChanged) {
        result.set(remoteItem.id, remoteItem);
      }
    } else {
      // ローカルに無い場合
      const baseItem = baseMap.get(remoteItem.id);
      if (!baseItem) {
        // baseにも無い → リモートで新規追加 → 追加
        result.set(remoteItem.id, remoteItem);
      }
      // baseにある → ローカルで削除 → 追加しない
    }
  }

  return Array.from(result.values()).sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));
}

/**
 * settings オブジェクトのフィールド単位 3-way マージ
 *
 * - base→local で変更があったキー: local の値を採用（ユーザーの変更を優先）
 * - base→local で変更がないキー: remote の値を採用（他クライアントの変更を保持）
 *
 * これにより、ユーザー A が practiceType を変更している最中にユーザー B が
 * recordScores を変更した場合でも、両者の変更がマージされる。
 */
function mergeSettings(
  base: Record<string, unknown> | undefined,
  local: Record<string, unknown> | undefined,
  remote: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!local && !remote) return undefined;
  if (!local) return remote;
  if (!remote) return local;

  const result: Record<string, unknown> = {};
  const keys = new Set<string>([
    ...Object.keys(base ?? {}),
    ...Object.keys(local),
    ...Object.keys(remote),
  ]);

  for (const key of keys) {
    const baseVal = base?.[key];
    const localVal = local[key];
    const remoteVal = remote[key];

    const localChanged = !base || JSON.stringify(baseVal) !== JSON.stringify(localVal);
    const value = localChanged ? localVal : remoteVal;
    if (value !== undefined) {
      result[key] = value;
    }
  }

  return result;
}

/**
 * 3-wayマージ: base（最後の同期状態）をもとに、ローカル変更をリモートに適用
 *
 * - base→localで変更されたアイテム: local版を採用
 * - base→localで変更なしのアイテム: remote版を採用（他クライアントの変更を保持）
 * - baseがnullの場合: localをそのまま返す（初回push、後方互換）
 */
export function mergeGameState(
  base: SyncGameState | null,
  local: SyncGameState,
  remote: SyncGameState,
): SyncGameState {
  if (!base) return local;

  return {
    players: mergeById(base.players, local.players, remote.players),
    courts: mergeById(
      base.courts as (typeof local.courts[number])[],
      local.courts as (typeof local.courts[number])[],
      remote.courts as (typeof local.courts[number])[],
    ),
    matchHistory: mergeMatchHistory(base.matchHistory, local.matchHistory, remote.matchHistory),
    reservations: mergeById(base.reservations, local.reservations, remote.reservations),
    settings: mergeSettings(base.settings, local.settings, remote.settings),
  };
}
