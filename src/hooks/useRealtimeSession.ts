import { useEffect, useRef } from 'react';
import { subscribeToSession } from '../services/sessionService';
import { useSessionStore } from '../stores/sessionStore';

/**
 * セッションをリアルタイム監視するフック
 * オンラインモード時のみ有効
 */
export function useRealtimeSession(sessionId: string | null) {
  const updateSession = useSessionStore((state) => state.updateSession);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!sessionId) return;

    unsubscribeRef.current = subscribeToSession(sessionId, (session) => {
      if (session) {
        updateSession({
          config: session.config,
          participants: session.participants,
          admins: session.admins,
          status: session.status,
          information: session.information,
        });
      }
    });

    return () => {
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
    };
  }, [sessionId, updateSession]);
}
