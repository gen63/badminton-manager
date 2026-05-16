/**
 * セッション管理サービス
 *
 * Phase 4 で Firestore 必須化。Firebase 未設定時は起動エラー（`db` が null
 * のため `requireDb()` で例外）。localStorage フォールバックは廃止済み。
 */

import {
  doc,
  setDoc,
  getDoc,
  updateDoc,
  onSnapshot,
  serverTimestamp,
  runTransaction,
  deleteDoc,
  collection,
  query,
  orderBy,
  limit,
  getDocs,
  FieldPath,
  deleteField,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { Session, PresenceEntry } from '../types/session';
import type { Player } from '../types/player';
import type { Court } from '../types/court';
import type { Match } from '../types/match';
import type { Reservation } from '../types/reservation';
import { SessionError } from '../lib/errorHandler';
import { requireDb, sanitize } from '../lib/firestoreUtils';
import { computeFirstMatchStartedAt, isSessionVisible } from '../lib/sessionArchive';

/** セッションレベルの設定（Firebase同期対象） */
export interface SyncSettings {
  recordScores?: boolean;
  continuousMatchMode?: boolean;
  practiceType?: '単' | '複' | '楽';
}

/** ゲーム状態の型（Firestore同期用） */
export interface GameState {
  players: Player[];
  courts: Court[];
  matchHistory: Match[];
  reservations: Reservation[];
  settings?: SyncSettings;
}

/** セッションID生成（6文字の英数字） */
function generateFirebaseSessionId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/** Firestoreドキュメントからセッションを変換 */
function docToSession(id: string, data: Record<string, unknown>): Session {
  const gameState = data.gameState as
    | {
        matchHistory?: unknown[];
        players?: Player[];
        settings?: { practiceType?: '単' | '複' | '楽' };
      }
    | undefined;
  const paidCount = Array.isArray(gameState?.players)
    ? gameState.players.filter((p) => p?.operationStatus?.payment === true).length
    : 0;
  const accounting = data.accounting as Session['accounting'];
  let incomeTotal: number | undefined;
  if (accounting) {
    const players = gameState?.players ?? [];
    const maleFee = accounting.maleFee ?? 0;
    const femaleFee = accounting.femaleFee ?? 0;
    // 運営協力割引（標準会費と実支払額の差額の合計）
    let discount = 0;
    for (const p of players) {
      if (!p?.operationStatus?.payment) continue;
      const actual = p.paymentAmount ?? 0;
      if (actual === 0) continue;
      const expectedFee = p.gender === 'F' ? femaleFee : maleFee;
      const diff = expectedFee - actual;
      if (diff > 0) discount += diff;
    }
    const maleTotal = (accounting.maleCount ?? 0) * maleFee;
    const femaleTotal = (accounting.femaleCount ?? 0) * femaleFee;
    const otherAmount = accounting.otherAmount ?? 0;
    incomeTotal = maleTotal + femaleTotal - discount + (otherAmount > 0 ? otherAmount : 0);
  }
  return {
    id,
    config: data.config as Session['config'],
    createdAt: typeof data.createdAt === 'number'
      ? data.createdAt
      : (data.createdAt as { seconds: number })?.seconds * 1000 || Date.now(),
    updatedAt: typeof data.updatedAt === 'number'
      ? data.updatedAt
      : (data.updatedAt as { seconds: number })?.seconds * 1000 || Date.now(),
    createdBy: data.createdBy as string | undefined,
    participants: data.participants as string[] | undefined,
    registeredPlayers: data.registeredPlayers as string[] | undefined,
    admins: data.admins as string[] | undefined,
    status: data.status as Session['status'],
    information: data.information as Session['information'],
    accounting: data.accounting as Session['accounting'],
    presence: data.presence as Session['presence'],
    firstMatchStartedAt: (data.firstMatchStartedAt as number | null | undefined) ?? null,
    matchCount: Array.isArray(gameState?.matchHistory) ? gameState.matchHistory.length : 0,
    paidCount,
    incomeTotal,
    practiceType: gameState?.settings?.practiceType,
  };
}

/**
 * セッションを作成する。
 *
 * `gameState` を同時に渡すと session document と gameState が **1 回の書き込み**
 * で揃う。これを渡さない場合は session のみ作成され、後から
 * `overwriteGameState` で gameState を初期化する必要がある（CON3 修正で
 * 同梱書き込みを推奨）。
 */
export async function createSession(
  session: Partial<Session>,
  gameState?: GameState,
): Promise<string> {
  const _db = requireDb();

  // セッションID衝突を避けるため、最大3回リトライ
  const maxRetries = 3;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const sessionId = generateFirebaseSessionId();
    const docRef = doc(_db, 'sessions', sessionId);

    try {
      // 既存のセッションIDをチェック
      const existingDoc = await getDoc(docRef);
      if (existingDoc.exists()) {
        console.warn(`[SessionService] Session ID collision detected: ${sessionId}, retrying...`);
        continue; // 次のIDで再試行
      }

      // IDが未使用なら作成。gameState が渡されていれば同梱して 1 回の setDoc で
      // 全フィールドを一発書き込み（CON3 修正）。
      const payload: Record<string, unknown> = {
        ...session,
        id: sessionId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        status: session.status || 'active',
        participants: session.participants ?? [],
      };
      if (gameState) {
        payload.gameState = sanitize(gameState);
        payload.registeredPlayers = gameState.players.map((p) => p.name);
        payload.firstMatchStartedAt = computeFirstMatchStartedAt(gameState.matchHistory);
      }
      await setDoc(docRef, payload);

      return sessionId;
    } catch (error) {
      if (attempt === maxRetries - 1) {
        // 最後の試行で失敗
        console.error('Firebase write failed:', error);
        throw new SessionError(
          'セッションの作成に失敗しました。ネットワーク接続を確認してください。',
          'firebase-write-failed'
        );
      }
    }
  }

  // 3回すべて衝突した場合（極めて低確率）
  throw new SessionError(
    'セッションIDの生成に失敗しました。もう一度お試しください。',
    'id-generation-failed'
  );
}

/** セッションを取得 */
export async function getSession(sessionId: string): Promise<Session | null> {
  const _db = requireDb();
  const docSnap = await getDoc(doc(_db, 'sessions', sessionId));
  if (!docSnap.exists()) return null;
  return docToSession(sessionId, docSnap.data());
}

/** セッションをリアルタイム監視 */
export function subscribeToSession(
  sessionId: string,
  callback: (session: Session | null) => void,
): () => void {
  const _db = requireDb();
  return onSnapshot(
    doc(_db, 'sessions', sessionId),
    (snap) => {
      if (snap.exists()) {
        callback(docToSession(sessionId, snap.data()));
      } else {
        callback(null);
      }
    },
    (error) => {
      console.error('Session subscription error:', error);
    },
  );
}

/** セッション状態を更新 */
export async function updateSession(
  sessionId: string,
  updates: Partial<Session>,
): Promise<void> {
  const _db = requireDb();
  const docRef = doc(_db, 'sessions', sessionId);
  await updateDoc(docRef, {
    ...updates,
    updatedAt: serverTimestamp(), // Firestoreサーバー時刻（同期の基準時刻）
  });
}

/** bot 作成セッションの sentinel 値。最初にログインした人が作成者に昇格する */
export const AUTO_SESSION_BOT_CREATOR = 'auto-session-bot';

/** セッションに参加者を追加（トランザクションでgameState.playersにも追加） */
export async function joinSession(
  sessionId: string,
  playerName: string,
  options?: { gender?: 'M' | 'F' }
): Promise<{ newCreator?: string }> {
  if (!playerName.trim()) {
    throw new SessionError('参加者名を入力してください', 'invalid-name');
  }
  const _db = requireDb();
  const docRef = doc(_db, 'sessions', sessionId);

  return await runTransaction(_db, async (transaction) => {
    const snap = await transaction.get(docRef);
    if (!snap.exists()) {
      throw new SessionError(`セッション ${sessionId} が見つかりません`, 'not-found');
    }

    const data = snap.data();
    const participants = (data.participants as string[] | undefined) ?? [];

    // 既参加でも黙って再入室を許可（重複排除して末尾に追加）
    const newParticipants = [
      ...participants.filter((name) => name !== playerName),
      playerName,
    ];

    const updates: Record<string, unknown> = {
      participants: newParticipants,
      updatedAt: serverTimestamp(),
    };

    // bot 作成セッション: 最初にログインした人を作成者に自動昇格
    // transaction 内なので同時入室でも先着 1 人のみ昇格する
    let newCreator: string | undefined;
    if (data.createdBy === AUTO_SESSION_BOT_CREATOR) {
      updates.createdBy = playerName;
      newCreator = playerName;
    }

    // gameState.playersに未登録の場合、新規プレイヤーとして追加
    // dot notationでplayersのみ更新し、courts/matchHistory等を上書きしない
    const gameState = data.gameState as GameState | undefined;
    if (gameState) {
      const playerExists = gameState.players.some((p) => p.name === playerName);
      if (!playerExists) {
        const newPlayer: Player = {
          id: crypto.randomUUID(),
          name: playerName,
          gender: options?.gender,
          isResting: true,
          gamesPlayed: 0,
          lastPlayedAt: 0,
          activatedAt: 0,
        };
        const newPlayers = [...gameState.players, newPlayer];
        updates['gameState.players'] = sanitize(newPlayers);
        updates.registeredPlayers = newPlayers.map((p) => p.name);
      }
    }

    transaction.update(docRef, updates);
    return { newCreator };
  });
}

/**
 * participants から自分を除去する。createdBy は変更しない。
 *
 * fire-and-forget 用途（unmount cleanup / セッション切替時の旧セッション離脱）で
 * 呼ばれるため、Firebase 未設定や transaction 失敗は throw せず warn で握り潰す。
 */
export async function leaveSession(sessionId: string, playerName: string): Promise<void> {
  if (!sessionId || !playerName) return;
  if (!db) return;

  const docRef = doc(db, 'sessions', sessionId);
  try {
    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(docRef);
      if (!snap.exists()) return;
      const data = snap.data();
      const participants = (data.participants as string[] | undefined) ?? [];
      if (!participants.includes(playerName)) return;
      transaction.update(docRef, {
        participants: participants.filter((name) => name !== playerName),
        updatedAt: serverTimestamp(),
      });
    });
  } catch (error) {
    console.warn('[SessionService] leaveSession failed:', error);
  }
}

/** 作成者を変更（dev モード専用） */
export async function updateCreator(sessionId: string, newCreator: string): Promise<void> {
  if (!newCreator.trim()) {
    throw new SessionError('新しい作成者名を指定してください', 'invalid-name');
  }
  await updateSession(sessionId, { createdBy: newCreator });
}

/** ゲーム状態をFirestoreに同期（管理者が呼ぶ） */
export async function syncGameState(
  sessionId: string,
  gameState: GameState,
): Promise<void> {
  const _db = requireDb();
  const docRef = doc(_db, 'sessions', sessionId);
  const registeredPlayers = gameState.players.map((p) => p.name);
  await updateDoc(docRef, {
    gameState: sanitize(gameState),
    registeredPlayers,
    firstMatchStartedAt: computeFirstMatchStartedAt(gameState.matchHistory),
    updatedAt: serverTimestamp(), // Firestoreサーバー時刻（同期の基準時刻）
  });
}

/** ゲーム状態をリアルタイム監視（参加者が呼ぶ） */
export function subscribeToGameState(
  sessionId: string,
  callback: (gameState: GameState | null) => void,
): () => void {
  const _db = requireDb();
  return onSnapshot(
    doc(_db, 'sessions', sessionId),
    (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        if (data.gameState) {
          callback(data.gameState as GameState);
        }
      }
    },
    (error) => {
      console.error('GameState subscription error:', error);
    },
  );
}

/** 最近アクティブなセッション一覧クエリを構築する（list/subscribe で共有） */
function recentActiveSessionsQuery(count: number) {
  const _db = requireDb();
  // NOTE: statusフィルターなし（現状セッション終了機能が未実装のため全セッションがactive）
  // 単一フィールドorderByのみで複合インデックス不要
  // 12h自動アーカイブ判定はクライアント側でフィルタ（Firestore OR queryを避けるため）
  return query(
    collection(_db, 'sessions'),
    orderBy('updatedAt', 'desc'),
    limit(count),
  );
}

/** snapshot 配列から表示用セッション配列を作る（filter + practiceStartTime 降順） */
function mapSnapshotToSessions(
  docs: { id: string; data: () => Record<string, unknown> }[],
  includeArchived: boolean,
): Session[] {
  const sessions = docs.map((snap) => docToSession(snap.id, snap.data()));
  const filtered = includeArchived ? sessions : sessions.filter((s) => isSessionVisible(s));
  return filtered.sort((a, b) => b.config.practiceStartTime - a.config.practiceStartTime);
}

/** 最近アクティブなセッションを取得（最大count件、updatedAt降順） */
export async function listRecentActiveSessions(
  count = 50,
  options?: { includeArchived?: boolean },
): Promise<Session[]> {
  const snapshot = await getDocs(recentActiveSessionsQuery(count));
  return mapSnapshotToSessions(snapshot.docs, options?.includeArchived === true);
}

/**
 * 最近アクティブなセッション一覧をリアルタイム購読する。
 * 一覧画面を開きっぱなしのときに新規セッション作成や情報更新を検知するため使う。
 */
export function subscribeToRecentActiveSessions(
  count: number,
  options: { includeArchived?: boolean },
  onData: (sessions: Session[]) => void,
  onError?: (error: Error) => void,
): () => void {
  return onSnapshot(
    recentActiveSessionsQuery(count),
    (snap) => {
      onData(mapSnapshotToSessions(snap.docs, options.includeArchived === true));
    },
    (error) => {
      console.error('Recent sessions subscription error:', error);
      onError?.(error);
    },
  );
}

/** セッションを削除（Firestoreドキュメントを完全削除） */
export async function deleteSession(sessionId: string): Promise<void> {
  const _db = requireDb();
  const docRef = doc(_db, 'sessions', sessionId);
  await deleteDoc(docRef);
}

/**
 * プレゼンスエントリを書き込み（fire-and-forget）
 *
 * - ユーザー名に `.` が含まれてもキー階層が壊れないよう `FieldPath` を使用
 * - `updatedAt` は意図的に更新しない（TTL カウントと onSnapshot 経路の無駄トリガを避けるため）
 * - Firestore 未設定 / 無効な引数 / 書き込み失敗 はすべて silent（warn）。
 *   ハートビート系は失敗してもアプリの主要機能を止めないことが優先。
 */
export async function writePresence(
  sessionId: string,
  username: string,
  patch: Partial<PresenceEntry>,
): Promise<void> {
  if (!db) return;
  if (!sessionId || !username) return;
  const entries = Object.entries(patch);
  if (entries.length === 0) return;

  const docRef = doc(db, 'sessions', sessionId);
  // updateDoc の可変長 (FieldPath, value)... 形式で書き込み
  const args: unknown[] = [];
  for (const [key, value] of entries) {
    if (value === undefined) continue;
    args.push(new FieldPath('presence', username, key), value);
  }
  if (args.length === 0) return;

  try {
    // 型: updateDoc(docRef, fieldPath, value, ...moreFieldsAndValues)
    await (updateDoc as (...args: unknown[]) => Promise<void>)(docRef, ...args);
  } catch (error) {
    console.warn('[Presence] writePresence failed:', error);
  }
}

/**
 * プレゼンスエントリを削除（unmount/非表示時、fire-and-forget）
 *
 * `writePresence` と同じく Firebase 未設定 / 失敗は silent（warn）。
 */
export async function clearPresence(sessionId: string, username: string): Promise<void> {
  if (!db) return;
  if (!sessionId || !username) return;

  const docRef = doc(db, 'sessions', sessionId);
  try {
    await (updateDoc as (...args: unknown[]) => Promise<void>)(
      docRef,
      new FieldPath('presence', username),
      deleteField(),
    );
  } catch (error) {
    console.warn('[Presence] clearPresence failed:', error);
  }
}

/**
 * 古いプレゼンスエントリを一括削除（漂流対策、fire-and-forget）
 *
 * マウント時に1回のみ呼び出す想定。`lastSeenAt` が閾値より古いエントリを
 * `deleteField` で削除。Firebase 未設定 / 失敗は silent（warn）。
 */
export async function pruneStalePresence(
  sessionId: string,
  staleUsernames: string[],
): Promise<void> {
  if (!db) return;
  if (!sessionId || staleUsernames.length === 0) return;

  const docRef = doc(db, 'sessions', sessionId);
  const args: unknown[] = [];
  for (const username of staleUsernames) {
    args.push(new FieldPath('presence', username), deleteField());
  }

  try {
    await (updateDoc as (...args: unknown[]) => Promise<void>)(docRef, ...args);
  } catch (error) {
    console.warn('[Presence] pruneStalePresence failed:', error);
  }
}
