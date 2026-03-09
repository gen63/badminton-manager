import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Session, SessionConfig } from '../types/session';

interface SessionState {
  session: Session | null;
  currentUser: string | null;
  setSession: (session: Session) => void;
  updateConfig: (config: Partial<SessionConfig>) => void;
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
