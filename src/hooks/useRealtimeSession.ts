import { useEffect, useRef } from 'react';
import { subscribeToSession } from '../services/sessionService';
import { useSessionStore } from '../stores/sessionStore';

/**
 * セッションをリアルタイム監視するフック
 * Phase 1（Firebase）モード時のみ有効
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
          status: session.status,
        });
      }
    });

    return () => {
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
    };
  }, [sessionId, updateSession]);

  return {
    isConnected: !!unsubscribeRef.current,
  };
}
