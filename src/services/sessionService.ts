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
  arrayUnion,
  serverTimestamp,
  runTransaction,
  deleteDoc,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { Session } from '../types/session';
import type { Player } from '../types/player';
import type { Court } from '../types/court';
import type { Match } from '../types/match';
import type { Reservation } from '../types/reservation';
import { SessionError } from '../lib/errorHandler';

/** ゲーム状態の型（Firestore同期用） */
export interface GameState {
  players: Player[];
  courts: Court[];
  matchHistory: Match[];
  reservations: Reservation[];
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
  };
}

/** セッションを作成 */
export async function createSession(session: Partial<Session>): Promise<string> {
  console.log('[SessionService] createSession - useFirestore:', useFirestore, 'db:', !!db);
  
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
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        status: session.status || 'active',
        participants: session.participants || [],
      });
      
      console.log(`[SessionService] Session created successfully: ${sessionId}`);
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
      updatedAt: serverTimestamp(),
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

/** セッションに参加者を追加 */
export async function joinSession(
  sessionId: string,
  playerName: string,
  options?: { force?: boolean }
): Promise<{ alreadyJoined: boolean }> {
  if (!playerName.trim()) {
    throw new SessionError('参加者名を入力してください', 'invalid-name');
  }

  if (useFirestore) {
    const docRef = doc(db!, 'sessions', sessionId);
    const docSnap = await getDoc(docRef);
    if (!docSnap.exists()) {
      throw new SessionError(`セッション ${sessionId} が見つかりません`, 'not-found');
    }
    const data = docSnap.data();
    const participants = (data.participants as string[] || []);
    const alreadyJoined = participants.includes(playerName);

    if (alreadyJoined && !options?.force) {
      return { alreadyJoined: true };
    }

    // force=trueの場合、既存の参加を削除してから追加（追い出し）
    if (alreadyJoined && options?.force) {
      const newParticipants = participants.filter((name) => name !== playerName);
      await updateDoc(docRef, {
        participants: [...newParticipants, playerName],
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(docRef, {
        participants: arrayUnion(playerName),
        updatedAt: serverTimestamp(),
      });
    }
    return { alreadyJoined: false };
  }

  // フォールバック: localStorage
  const session = await getSession(sessionId);
  if (!session) {
    throw new SessionError(`セッション ${sessionId} が見つかりません`, 'not-found');
  }

  const alreadyJoined = session.participants?.includes(playerName) || false;
  if (alreadyJoined && !options?.force) {
    return { alreadyJoined: true };
  }

  let participants = session.participants || [];
  if (alreadyJoined && options?.force) {
    participants = participants.filter((name) => name !== playerName);
  }
  participants = [...participants, playerName];

  await updateSession(sessionId, { participants });
  return { alreadyJoined: false };
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
  await updateDoc(docRef, {
    gameState: sanitize(gameState),
    updatedAt: serverTimestamp(),
  });
}

/**
 * ゲーム状態をFirestoreに同期（Transaction使用）
 * 
 * 競合時に自動リトライ（最大5回）し、同時更新を安全に処理します。
 * すべての操作（配置、メンバー交換、ゲーム開始など）で使用されます。
 */
export async function syncGameStateWithTransaction(
  sessionId: string,
  gameState: GameState,
): Promise<void> {
  if (!useFirestore) return;

  const docRef = doc(db!, 'sessions', sessionId);
  
  try {
    await runTransaction(db!, async (transaction) => {
      // Firestoreが競合検出に使用（読み取り必須）
      const snap = await transaction.get(docRef);
      if (!snap.exists()) {
        throw new Error('Session not found');
      }
      
      // 更新（競合があればFirestoreが自動リトライ）
      transaction.update(docRef, {
        gameState: sanitize(gameState),
        updatedAt: serverTimestamp(),
      });
    });
  } catch (error: unknown) {
    // Firestoreが最大5回リトライした後に失敗
    if ((error as { code?: string })?.code === 'aborted') {
      throw new SessionError(
        '他のユーザーが更新しました。もう一度お試しください',
        'conflict'
      );
    }
    // その他のエラー
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
