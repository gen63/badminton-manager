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
        // information の readBy が undefined の場合は空配列にフォールバック
        const information = session.information
          ? {
              ...session.information,
              readBy: session.information.readBy || [],
            }
          : undefined;

        updateSession({
          config: session.config,
          participants: session.participants,
          registeredPlayers: session.registeredPlayers,
          admins: session.admins,
          status: session.status,
          information,
        });
      }
    });

    return () => {
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
    };
  }, [sessionId, updateSession]);
}
