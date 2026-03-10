import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Session, SessionConfig } from '../types/session';

interface SessionState {
  session: Session | null;
  currentUser: string | null;
  setSession: (session: Session) => void;
  updateConfig: (config: Partial<SessionConfig>) => Promise<void>;
  clearSession: () => void;
  // オンラインモード用
  setCurrentUser: (name: string) => void;
  initialize: (session: Session) => void;
  isCreator: () => boolean;
  isAdmin: () => boolean;
  updateSession: (updates: Partial<Session>) => void;
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set, get) => ({
      session: null,
      currentUser: null,
      setSession: (session) => set({ session }),
      updateConfig: async (config) => {
        // ローカル更新（即座に反映）
        set((state) => ({
          session: state.session
            ? {
                ...state.session,
                config: { ...state.session.config, ...config },
                updatedAt: Date.now(),
              }
            : null,
        }));
        
        // オンラインモード: Firestoreにも反映
        const { session } = get();
        if (session?.id && session?.createdBy) {
          const { updateSession: updateFirebaseSession } = await import('../services/sessionService');
          try {
            const mergedConfig = { ...session.config, ...config };
            await updateFirebaseSession(session.id, { config: mergedConfig });
            console.log('[SessionStore] Config synced to Firestore:', config);
          } catch (error) {
            console.error('[SessionStore] Failed to sync config to Firestore:', error);
            
            // Toast通知を表示（動的インポートで循環依存を回避）
            const toastModule = await import('../hooks/useToast');
            if (toastModule && 'useToast' in toastModule) {
              // useToastはhookなので、ここでは直接使えない
              // 代わりに、グローバルToast関数を使う（後で実装）
              // 今は警告のみログ出力
              console.warn('[SessionStore] Config sync failed, but local update succeeded');
            }
          }
        }
      },
      clearSession: () => set({ session: null, currentUser: null }),
      // オンラインモード
      setCurrentUser: (name) => set({ currentUser: name }),
      initialize: (session) =>
        set({
          session,
          currentUser: session.createdBy || null,
        }),
      isCreator: () => {
        const { session, currentUser } = get();
        if (!session?.createdBy || !currentUser) return true; // ローカルモード: 全員管理者
        return currentUser === session.createdBy;
      },
      isAdmin: () => {
        const { session, currentUser } = get();
        if (!session?.createdBy || !currentUser) return true; // ローカルモード: 全員管理者
        return currentUser === session.createdBy || session.admins?.includes(currentUser) || false;
      },
      updateSession: (updates) =>
        set((state) => ({
          session: state.session
            ? { ...state.session, ...updates, updatedAt: Date.now() }
            : null,
        })),
    }),
    {
      name: 'badminton-session',
    }
  )
);
