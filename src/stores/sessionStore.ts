import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Session, SessionConfig } from '../types/session';

interface SessionState {
  session: Session | null;
  currentUser: string | null; // Phase 1: 名前ベース、Phase 1.5: LINE UID
  
  // セッション管理
  setSession: (session: Session) => void;
  initialize: (session: Session) => void; // Phase 1用
  updateSession: (updates: Partial<Session>) => void;
  updateConfig: (config: Partial<SessionConfig>) => void;
  clearSession: () => void;
  
  // ユーザー管理
  setCurrentUser: (user: string | null) => void;
  
  // 権限判定
  isCreator: () => boolean;
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set, get) => ({
      session: null,
      currentUser: null,
      
      setSession: (session) => set({ session }),
      
      initialize: (session) => set({ 
        session,
        currentUser: session.createdBy || null // 管理者として設定
      }),
      
      updateSession: (updates) =>
        set((state) => ({
          session: state.session
            ? {
                ...state.session,
                ...updates,
                updatedAt: Date.now(),
              }
            : null,
        })),
      
      updateConfig: (config) =>
        set((state) => ({
          session: state.session
            ? {
                ...state.session,
                config: { ...state.session.config, ...config },
                updatedAt: Date.now(),
              }
            : null,
        })),
      
      clearSession: () => set({ session: null, currentUser: null }),
      
      setCurrentUser: (user) => set({ currentUser: user }),
      
      // 管理者判定
      isCreator: () => {
        const { session, currentUser } = get();
        if (!session || !currentUser) return false;
        
        // Phase 1: 名前ベースの判定
        // Phase 1.5: LINE UIDベースに変更予定
        return session.createdBy === currentUser;
      },
    }),
    {
      name: 'badminton-session',
    }
  )
);
