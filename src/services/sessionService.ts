/**
 * セッション管理サービス
 *
 * Firestore実装（Firebase未設定時はlocalStorageフォールバック）
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
import { mergeGameState, type SyncGameState } from '../lib/syncUtils';
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

/** Firestoreが使えるかどうか */
const useFirestore = !!db;

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
    | { matchHistory?: unknown[]; settings?: { practiceType?: '単' | '複' | '楽' } }
    | undefined;
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
    practiceType: gameState?.settings?.practiceType,
  };
}

/** セッションを作成 */
export async function createSession(session: Partial<Session>): Promise<string> {
  // Firebaseが設定されていない場合はエラー
  if (!useFirestore) {
    throw new SessionError(
      'オンラインセッション機能が利用できません。Firebase設定を確認してください。',
      'firebase-not-configured'
    );
  }

  // セッションID衝突を避けるため、最大3回リトライ
  const maxRetries = 3;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const sessionId = generateFirebaseSessionId();
    const docRef = doc(db!, 'sessions', sessionId);
    
    try {
      // 既存のセッションIDをチェック
      const existingDoc = await getDoc(docRef);
      if (existingDoc.exists()) {
        console.warn(`[SessionService] Session ID collision detected: ${sessionId}, retrying...`);
        continue; // 次のIDで再試行
      }

      // IDが未使用なら作成
      await setDoc(docRef, {
        ...session,
        id: sessionId,
        createdAt: serverTimestamp(), // Firestoreサーバー時刻（同期の基準時刻）
        updatedAt: serverTimestamp(), // Firestoreサーバー時刻（同期の基準時刻）
        status: session.status || 'active',
        participants: session.participants ?? [],
      });
      
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
  if (useFirestore) {
    const docSnap = await getDoc(doc(db!, 'sessions', sessionId));
    if (!docSnap.exists()) return null;
    return docToSession(sessionId, docSnap.data());
  }

  // フォールバック: localStorage
  const data = localStorage.getItem(`firebase_session_${sessionId}`);
  if (!data) return null;
  return JSON.parse(data) as Session;
}

/** セッションをリアルタイム監視 */
export function subscribeToSession(
  sessionId: string,
  callback: (session: Session | null) => void,
): () => void {
  if (useFirestore) {
    return onSnapshot(
      doc(db!, 'sessions', sessionId),
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

  // フォールバック: 2秒ポーリング
  const interval = setInterval(async () => {
    const session = await getSession(sessionId);
    callback(session);
  }, 2000);

  getSession(sessionId).then(callback);

  return () => clearInterval(interval);
}

/** セッション状態を更新 */
export async function updateSession(
  sessionId: string,
  updates: Partial<Session>,
): Promise<void> {
  if (useFirestore) {
    const docRef = doc(db!, 'sessions', sessionId);
    await updateDoc(docRef, {
      ...updates,
      updatedAt: serverTimestamp(), // Firestoreサーバー時刻（同期の基準時刻）
    });
    return;
  }

  // フォールバック: localStorage
  const session = await getSession(sessionId);
  if (!session) {
    throw new SessionError(`セッション ${sessionId} が見つかりません`, 'not-found');
  }
  const updated = { ...session, ...updates, updatedAt: Date.now() };
  localStorage.setItem(`firebase_session_${sessionId}`, JSON.stringify(updated));
}

/** bot 作成セッションの sentinel 値。最初にログインした人が作成者に昇格する */
export const AUTO_SESSION_BOT_CREATOR = 'auto-session-bot';

/** セッションに参加者を追加（トランザクションでgameState.playersにも追加） */
export async function joinSession(
  sessionId: string,
  playerName: string,
  options?: { force?: boolean; gender?: 'M' | 'F' }
): Promise<{ isAlreadyJoined: boolean; newCreator?: string }> {
  if (!playerName.trim()) {
    throw new SessionError('参加者名を入力してください', 'invalid-name');
  }

  if (useFirestore) {
    const docRef = doc(db!, 'sessions', sessionId);

    return await runTransaction(db!, async (transaction) => {
      const snap = await transaction.get(docRef);
      if (!snap.exists()) {
        throw new SessionError(`セッション ${sessionId} が見つかりません`, 'not-found');
      }

      const data = snap.data();
      const participants = (data.participants as string[] | undefined) ?? [];
      const isAlreadyJoined = participants.includes(playerName);

      if (isAlreadyJoined && !options?.force) {
        return { isAlreadyJoined: true };
      }

      // participants配列を更新
      let newParticipants: string[];
      if (isAlreadyJoined && options?.force) {
        newParticipants = [...participants.filter((name) => name !== playerName), playerName];
      } else {
        newParticipants = [...participants, playerName];
      }

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
      return { isAlreadyJoined: false, newCreator };
    });
  }

  // フォールバック: localStorage
  const session = await getSession(sessionId);
  if (!session) {
    throw new SessionError(`セッション ${sessionId} が見つかりません`, 'not-found');
  }

  const isAlreadyJoined = session.participants?.includes(playerName) ?? false;
  if (isAlreadyJoined && !options?.force) {
    return { isAlreadyJoined: true };
  }

  let participants = session.participants ?? [];
  if (isAlreadyJoined && options?.force) {
    participants = participants.filter((name) => name !== playerName);
  }
  participants = [...participants, playerName];

  const updates: Partial<Session> = { participants };
  let newCreator: string | undefined;
  if (session.createdBy === AUTO_SESSION_BOT_CREATOR) {
    updates.createdBy = playerName;
    newCreator = playerName;
  }

  await updateSession(sessionId, updates);
  return { isAlreadyJoined: false, newCreator };
}

/** participants から自分を除去する。createdBy は変更しない。 */
export async function leaveSession(sessionId: string, playerName: string): Promise<void> {
  if (!sessionId || !playerName) return;
  if (!useFirestore) return;

  const docRef = doc(db!, 'sessions', sessionId);
  try {
    await runTransaction(db!, async (transaction) => {
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

/** undefinedをnullに変換（Firestoreはundefinedを受け付けない） */
function sanitize<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

/** ゲーム状態をFirestoreに同期（管理者が呼ぶ） */
export async function syncGameState(
  sessionId: string,
  gameState: GameState,
): Promise<void> {
  if (!useFirestore) return;

  const docRef = doc(db!, 'sessions', sessionId);
  const registeredPlayers = gameState.players.map((p) => p.name);
  await updateDoc(docRef, {
    gameState: sanitize(gameState),
    registeredPlayers,
    firstMatchStartedAt: computeFirstMatchStartedAt(gameState.matchHistory),
    updatedAt: serverTimestamp(), // Firestoreサーバー時刻（同期の基準時刻）
  });
}

/**
 * ゲーム状態をFirestoreに同期（Transaction使用 + 3-wayマージ）
 *
 * 競合時に自動リトライ（最大5回）し、同時更新を安全に処理します。
 * baseStateが指定されている場合、リモート状態との3-wayマージを行い、
 * 他クライアントの変更を保持しつつローカル変更を適用します。
 */
export async function syncGameStateWithTransaction(
  sessionId: string,
  gameState: GameState,
  baseState?: GameState | null,
): Promise<GameState> {
  if (!useFirestore) return gameState;

  const docRef = doc(db!, 'sessions', sessionId);

  let writtenState: GameState = gameState;

  try {
    await runTransaction(db!, async (transaction) => {
      const snap = await transaction.get(docRef);
      if (!snap.exists()) {
        throw new Error('Session not found');
      }

      const data = snap.data();
      const remoteState = data?.gameState as GameState | undefined;

      // リモート状態とbaseがある場合は3-wayマージ、なければ従来通り上書き
      const finalState = (remoteState && baseState)
        ? mergeGameState(
            baseState as unknown as SyncGameState,
            gameState as unknown as SyncGameState,
            remoteState as unknown as SyncGameState,
          ) as unknown as GameState
        : gameState;

      writtenState = finalState;

      const registeredPlayers = finalState.players.map((p) => p.name);
      transaction.update(docRef, {
        gameState: sanitize(finalState),
        registeredPlayers,
        firstMatchStartedAt: computeFirstMatchStartedAt(finalState.matchHistory),
        updatedAt: serverTimestamp(),
      });
    });
  } catch (error: unknown) {
    if ((error as { code?: string })?.code === 'aborted') {
      throw new SessionError(
        '他のユーザーが更新しました。もう一度お試しください',
        'conflict'
      );
    }
    throw error;
  }

  return writtenState;
}

/**
 * べき等な試合終了Transaction
 *
 * startedAt をべき等キーとして使用し、同じ試合の二重終了を防ぐ。
 * 2人が同時に「終了」をタップしても、1人目のみ成功し、
 * 2人目は 'already_finished' を受け取る。
 *
 * @param computeNewState リモート状態を受け取り、新しい状態を返す純粋関数
 * @returns 'success' | 'already_finished'
 */
export async function finishGameTransaction(
  sessionId: string,
  courtId: number,
  matchStartedAt: number,
  computeNewState: (remoteState: GameState) => GameState,
): Promise<{ result: 'success' | 'already_finished'; writtenState?: GameState }> {
  if (!useFirestore) return { result: 'success' };

  const docRef = doc(db!, 'sessions', sessionId);

  try {
    return await runTransaction(db!, async (transaction) => {
      const snap = await transaction.get(docRef);
      if (!snap.exists()) {
        throw new Error('Session not found');
      }

      const data = snap.data();
      const remoteState = data.gameState as GameState;
      const remoteCourt = remoteState.courts.find(c => c.id === courtId);

      // べき等チェック: この試合がまだ進行中か？
      if (!remoteCourt?.isPlaying || remoteCourt.startedAt !== matchStartedAt) {
        return { result: 'already_finished' };
      }

      // リモート状態に対して新しい状態を計算
      const newState = computeNewState(remoteState);

      transaction.update(docRef, {
        gameState: sanitize(newState),
        firstMatchStartedAt: computeFirstMatchStartedAt(newState.matchHistory),
        updatedAt: serverTimestamp(),
      });

      return { result: 'success', writtenState: newState };
    });
  } catch (error: unknown) {
    if ((error as { code?: string })?.code === 'aborted') {
      throw new SessionError(
        '他のユーザーが更新しました。もう一度お試しください',
        'conflict'
      );
    }
    throw error;
  }
}

/** ゲーム状態をリアルタイム監視（参加者が呼ぶ） */
export function subscribeToGameState(
  sessionId: string,
  callback: (gameState: GameState | null) => void,
): () => void {
  if (!useFirestore) return () => {};

  return onSnapshot(
    doc(db!, 'sessions', sessionId),
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

/** 最近アクティブなセッションを取得（最大count件、updatedAt降順） */
export async function listRecentActiveSessions(
  count = 50,
  options?: { includeArchived?: boolean },
): Promise<Session[]> {
  if (!useFirestore) return [];

  // NOTE: statusフィルターなし（現状セッション終了機能が未実装のため全セッションがactive）
  // 単一フィールドorderByのみで複合インデックス不要
  // 12h自動アーカイブ判定はクライアント側でフィルタ（Firestore OR queryを避けるため）
  const q = query(
    collection(db!, 'sessions'),
    orderBy('updatedAt', 'desc'),
    limit(count),
  );

  const snapshot = await getDocs(q);
  const sessions = snapshot.docs.map((snap) => docToSession(snap.id, snap.data()));
  const filtered = options?.includeArchived ? sessions : sessions.filter((s) => isSessionVisible(s));
  return filtered.sort((a, b) => b.config.practiceStartTime - a.config.practiceStartTime);
}

/** セッションを削除（Firestoreドキュメントを完全削除） */
export async function deleteSession(sessionId: string): Promise<void> {
  if (useFirestore) {
    const docRef = doc(db!, 'sessions', sessionId);
    await deleteDoc(docRef);
    return;
  }

  // フォールバック: localStorage
  localStorage.removeItem(`firebase_session_${sessionId}`);
}

/**
 * プレゼンスエントリを書き込み
 *
 * - ユーザー名に `.` が含まれてもキー階層が壊れないよう `FieldPath` を使用
 * - `updatedAt` は意図的に更新しない（TTL カウントと onSnapshot 経路の無駄トリガを避けるため）
 * - Firestore 未設定時・無効な引数は no-op
 */
export async function writePresence(
  sessionId: string,
  username: string,
  patch: Partial<PresenceEntry>,
): Promise<void> {
  if (!useFirestore) return;
  if (!sessionId || !username) return;
  const entries = Object.entries(patch);
  if (entries.length === 0) return;

  const docRef = doc(db!, 'sessions', sessionId);
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
 * プレゼンスエントリを削除（unmount/非表示時）
 */
export async function clearPresence(sessionId: string, username: string): Promise<void> {
  if (!useFirestore) return;
  if (!sessionId || !username) return;

  const docRef = doc(db!, 'sessions', sessionId);
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
 * 古いプレゼンスエントリを一括削除（漂流対策）
 *
 * マウント時に1回のみ呼び出す想定。
 * `lastSeenAt` が `thresholdMs` より古いエントリを `deleteField` で削除。
 */
export async function pruneStalePresence(
  sessionId: string,
  staleUsernames: string[],
): Promise<void> {
  if (!useFirestore) return;
  if (!sessionId || staleUsernames.length === 0) return;

  const docRef = doc(db!, 'sessions', sessionId);
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
