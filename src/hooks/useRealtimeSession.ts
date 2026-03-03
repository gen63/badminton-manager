/**
 * リアルタイムセッション同期フック
 * 
 * Phase 1: Firestore リアルタイムリスナーとの連携
 * Firebase登録後に有効化
 */

import { useEffect, useRef } from 'react';
import { subscribeToSession } from '../services/sessionService';
import { useSessionStore } from '../stores/sessionStore';

/**
 * セッションをリアルタイム監視
 * 
 * @param sessionId - セッションID
 * @param enabled - 監視を有効化するかどうか（デフォルト: true）
 */
export function useRealtimeSession(sessionId: string | null, enabled = true) {
  const updateSession = useSessionStore((state) => state.updateSession);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  
  useEffect(() => {
    // 無効化されている場合は何もしない
    if (!enabled || !sessionId) {
      return;
    }
    
    console.log('🔄 Starting realtime sync for session:', sessionId);
    
    // リアルタイムリスナーを開始
    unsubscribeRef.current = subscribeToSession(sessionId, (session) => {
      if (session) {
        console.log('📥 Received session update:', session.id);
        
        // ローカル状態を更新（Firestoreからの変更を反映）
        updateSession({
          config: session.config,
          participants: session.participants,
          status: session.status,
          updatedAt: typeof session.createdAt === 'string'
            ? new Date(session.createdAt).getTime()
            : session.createdAt
        });
      }
    });
    
    // クリーンアップ: コンポーネントアンマウント時に監視を停止
    return () => {
      if (unsubscribeRef.current) {
        console.log('🛑 Stopping realtime sync for session:', sessionId);
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
    };
  }, [sessionId, enabled, updateSession]);
  
  return {
    isConnected: !!unsubscribeRef.current
  };
}

/**
 * セッション同期の手動停止
 * 
 * メイン画面以外（設定画面など）で同期を一時停止する場合に使用
 */
export function useRealtimeSessionControl(sessionId: string | null) {
  const session = useSessionStore((state) => state.session);
  const shouldSync = session?.id === sessionId;
  
  return useRealtimeSession(sessionId, shouldSync);
}
