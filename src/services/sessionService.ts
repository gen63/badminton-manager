/**
 * セッション管理サービス
 *
 * モック実装（localStorage）→ Firebase実装に段階的移行可能
 */

import type { Session } from '../types/session';
import { SessionError, isOffline } from '../lib/errorHandler';

/** セッションID生成（6文字の英数字） */
function generateFirebaseSessionId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/** セッションを作成 */
export async function createSession(session: Partial<Session>): Promise<string> {
  if (isOffline()) {
    throw new SessionError('オフラインです。インターネット接続を確認してください', 'offline');
  }

  const sessionId = generateFirebaseSessionId();

  // TODO: Firestore実装に切り替え
  // const docRef = doc(db, 'sessions', sessionId);
  // await setDoc(docRef, { ...session, id: sessionId, createdAt: serverTimestamp(), status: 'active' });

  // モック実装: localStorage
  const sessionData = {
    ...session,
    id: sessionId,
    createdAt: Date.now(),
    status: 'active',
  };
  localStorage.setItem(`firebase_session_${sessionId}`, JSON.stringify(sessionData));

  return sessionId;
}

/** セッションを取得 */
export async function getSession(sessionId: string): Promise<Session | null> {
  // TODO: Firestore実装に切り替え
  // const docSnap = await getDoc(doc(db, 'sessions', sessionId));
  // return docSnap.exists() ? docSnap.data() as Session : null;

  // モック実装
  const data = localStorage.getItem(`firebase_session_${sessionId}`);
  if (!data) return null;
  return JSON.parse(data) as Session;
}

/** セッションをリアルタイム監視 */
export function subscribeToSession(
  sessionId: string,
  callback: (session: Session | null) => void,
): () => void {
  // TODO: Firestore onSnapshot に切り替え
  // return onSnapshot(doc(db, 'sessions', sessionId), (snap) => {
  //   callback(snap.exists() ? snap.data() as Session : null);
  // });

  // モック実装: 2秒ポーリング
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
  // TODO: Firestore updateDoc に切り替え

  // モック実装
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

  // TODO: Firestore サブコレクションに切り替え

  // モック実装
  const session = await getSession(sessionId);
  if (!session) {
    throw new SessionError(`セッション ${sessionId} が見つかりません`, 'not-found');
  }

  if (session.participants?.includes(playerName)) {
    return; // 既に参加済み
  }

  const participants = [...(session.participants || []), playerName];
  await updateSession(sessionId, { participants });
}
