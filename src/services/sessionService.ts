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
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { Session } from '../types/session';
import type { Player } from '../types/player';
import type { Court } from '../types/court';
import type { Match } from '../types/match';
import type { Reservation } from '../types/reservation';
import { SessionError, isOffline } from '../lib/errorHandler';

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
    status: data.status as Session['status'],
  };
}

/** セッションを作成 */
export async function createSession(session: Partial<Session>): Promise<string> {
  if (isOffline()) {
    throw new SessionError('オフラインです。インターネット接続を確認してください', 'offline');
  }

  const sessionId = generateFirebaseSessionId();

  if (useFirestore) {
    const docRef = doc(db!, 'sessions', sessionId);
    await setDoc(docRef, {
      ...session,
      id: sessionId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      status: session.status || 'active',
      participants: session.participants || [],
    });
  } else {
    // フォールバック: localStorage
    const sessionData = {
      ...session,
      id: sessionId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: 'active',
    };
    localStorage.setItem(`firebase_session_${sessionId}`, JSON.stringify(sessionData));
  }

  return sessionId;
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
export async function joinSession(sessionId: string, playerName: string): Promise<void> {
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
    if ((data.participants as string[] || []).includes(playerName)) {
      return; // 既に参加済み
    }
    await updateDoc(docRef, {
      participants: arrayUnion(playerName),
      updatedAt: serverTimestamp(),
    });
    return;
  }

  // フォールバック: localStorage
  const session = await getSession(sessionId);
  if (!session) {
    throw new SessionError(`セッション ${sessionId} が見つかりません`, 'not-found');
  }

  if (session.participants?.includes(playerName)) {
    return;
  }

  const participants = [...(session.participants || []), playerName];
  await updateSession(sessionId, { participants });
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
