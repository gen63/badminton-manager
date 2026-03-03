/**
 * セッション管理サービス
 * 
 * Firestore とのやり取りを抽象化
 * モック実装 → Firebase実装に段階的に移行可能
 */

import type { Session } from '../types/session';
import { SessionError, logError, isOffline, getOfflineMessage } from '../lib/errorHandler';

/**
 * セッションID生成（6文字の英数字）
 */
export function generateSessionId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * セッションを作成
 * 
 * @param session - セッション情報
 * @returns セッションID
 * @throws SessionError
 */
export async function createSession(session: Partial<Session>): Promise<string> {
  try {
    // オフラインチェック
    if (isOffline()) {
      throw new SessionError(getOfflineMessage(), 'offline');
    }
    
    const sessionId = generateSessionId();
    
    // TODO: Firestore に保存
    // const docRef = doc(db, 'sessions', sessionId);
    // await setDoc(docRef, {
    //   ...session,
    //   id: sessionId,
    //   createdAt: serverTimestamp(),
    //   status: 'active'
    // });
    
    // モック実装: LocalStorage に保存（開発用）
    const sessionData = {
      ...session,
      id: sessionId,
      createdAt: new Date().toISOString(),
      status: 'active'
    };
    
    localStorage.setItem(`session_${sessionId}`, JSON.stringify(sessionData));
    console.log('📝 Session created (mock):', sessionId);
    
    return sessionId;
  } catch (error) {
    logError(error, 'createSession');
    throw error instanceof SessionError 
      ? error 
      : new SessionError('セッション作成に失敗しました');
  }
}

/**
 * セッションを取得
 * 
 * @param sessionId - セッションID
 * @returns セッション情報 | null
 * @throws SessionError
 */
export async function getSession(sessionId: string): Promise<Session | null> {
  try {
    // オフラインチェック（モック実装では不要だが、Firebase実装時に有効化）
    // if (isOffline()) {
    //   throw new SessionError(getOfflineMessage(), 'offline');
    // }
    
    // TODO: Firestore から取得
    // const docRef = doc(db, 'sessions', sessionId);
    // const docSnap = await getDoc(docRef);
    // return docSnap.exists() ? docSnap.data() as Session : null;
    
    // モック実装: LocalStorage から取得
    const data = localStorage.getItem(`session_${sessionId}`);
    if (!data) return null;
    
    return JSON.parse(data) as Session;
  } catch (error) {
    logError(error, 'getSession');
    throw error instanceof SessionError 
      ? error 
      : new SessionError('セッション取得に失敗しました');
  }
}

/**
 * セッションをリアルタイム監視
 * 
 * @param sessionId - セッションID
 * @param callback - 変更時のコールバック
 * @returns 監視解除関数
 */
export function subscribeToSession(
  sessionId: string,
  callback: (session: Session | null) => void
): () => void {
  // TODO: Firestore リアルタイムリスナー
  // const docRef = doc(db, 'sessions', sessionId);
  // return onSnapshot(docRef, (doc) => {
  //   callback(doc.exists() ? doc.data() as Session : null);
  // });
  
  // モック実装: 定期的にポーリング（開発用）
  const interval = setInterval(async () => {
    const session = await getSession(sessionId);
    callback(session);
  }, 2000); // 2秒ごと
  
  // 初回取得
  getSession(sessionId).then(callback);
  
  // 監視解除関数
  return () => clearInterval(interval);
}

/**
 * セッション状態を更新
 * 
 * @param sessionId - セッションID
 * @param updates - 更新内容
 * @throws SessionError
 */
export async function updateSession(
  sessionId: string,
  updates: Partial<Session>
): Promise<void> {
  try {
    // TODO: Firestore を更新
    // const docRef = doc(db, 'sessions', sessionId);
    // await updateDoc(docRef, updates);
    
    // モック実装: LocalStorage を更新
    const session = await getSession(sessionId);
    if (!session) {
      throw new SessionError(`セッション ${sessionId} が見つかりません`, 'not-found');
    }
    
    const updated = { ...session, ...updates };
    localStorage.setItem(`session_${sessionId}`, JSON.stringify(updated));
    console.log('🔄 Session updated (mock):', sessionId);
  } catch (error) {
    logError(error, 'updateSession');
    throw error instanceof SessionError 
      ? error 
      : new SessionError('セッション更新に失敗しました');
  }
}

/**
 * セッション参加者を追加
 * 
 * @param sessionId - セッションID
 * @param playerName - 参加者名
 * @throws SessionError
 */
export async function joinSession(
  sessionId: string,
  playerName: string
): Promise<void> {
  try {
    if (!playerName || playerName.trim() === '') {
      throw new SessionError('参加者名を入力してください', 'invalid-name');
    }
    
    // TODO: Firestore のサブコレクションに追加
    // const participantRef = doc(db, `sessions/${sessionId}/participants`, playerName);
    // await setDoc(participantRef, {
    //   name: playerName,
    //   joinedAt: serverTimestamp()
    // });
    
    // モック実装: セッションに参加者リストを追加
    const session = await getSession(sessionId);
    if (!session) {
      throw new SessionError(`セッション ${sessionId} が見つかりません`, 'not-found');
    }
    
    // 既に参加済みかチェック
    if (session.participants?.includes(playerName)) {
      console.log('✅ Already joined:', playerName);
      return;
    }
    
    const participants = [...(session.participants || []), playerName];
    await updateSession(sessionId, { participants });
    console.log('👥 Player joined (mock):', playerName);
  } catch (error) {
    logError(error, 'joinSession');
    throw error instanceof SessionError 
      ? error 
      : new SessionError('入室に失敗しました');
  }
}
