import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Session, SessionConfig } from '../types/session';

interface SessionState {
  session: Session | null;
  setSession: (session: Session) => void;
  updateConfig: (config: Partial<SessionConfig>) => void;
  clearSession: () => void;
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set) => ({
      session: null,
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
      clearSession: () => set({ session: null }),
    }),
    {
      name: 'badminton-session',
    }
  )
);
