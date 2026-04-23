import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AccountingInput, Session, SessionConfig } from '../types/session';

// 開発モード判定（useDevMode フックはコンポーネント専用のため localStorage を直読みする）
const isDevMode = (): boolean => {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem('dev-mode') === '1';
  } catch {
    return false;
  }
};

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
  updateInformation: (text: string) => Promise<void>;
  markInformationAsRead: () => Promise<void>;
  updateAccounting: (patch: Partial<AccountingInput>) => Promise<void>;
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set, get) => ({
      session: null,
      currentUser: null,
      setSession: (session) => set({ session }),
      updateConfig: async (config) => {
        // ローカル更新（即座に反映、クライアント時刻）
        set((state) => ({
          session: state.session
            ? {
                ...state.session,
                config: { ...state.session.config, ...config },
                updatedAt: Date.now(), // ローカルクライアント時刻
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
          } catch (error) {
            console.error('[SessionStore] Failed to sync config to Firestore:', error);
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
        // ローカルモード: 全員管理者
        if (!session?.createdBy) return true;
        // 開発モード: 作成者扱い
        if (isDevMode()) return true;
        // オンラインモード: currentUser が必要
        if (!currentUser) return false;
        return currentUser === session.createdBy;
      },
      isAdmin: () => {
        const { session, currentUser } = get();
        // ローカルモード: 全員管理者
        if (!session?.createdBy) return true;
        // 開発モード: 管理者扱い
        if (isDevMode()) return true;
        // オンラインモード: currentUser が必要
        if (!currentUser) return false;
        return currentUser === session.createdBy || session.admins?.includes(currentUser) || false;
      },
      updateSession: (updates) =>
        set((state) => ({
          session: state.session
            ? { ...state.session, ...updates, updatedAt: Date.now() } // ローカルクライアント時刻
            : null,
        })),
      updateInformation: async (text) => {
        const { session, currentUser } = get();
        if (!session) return;

        // 空文字列の場合は情報を削除
        if (!text.trim()) {
          // ローカル更新
          set((state) => ({
            session: state.session
              ? { ...state.session, information: undefined, updatedAt: Date.now() }
              : null,
          }));

          // オンラインモード: Firebaseにも反映（deleteField()でフィールドを削除）
          if (session.id && session.createdBy) {
            const { updateSession: updateFirebaseSession } = await import('../services/sessionService');
            const { deleteField } = await import('firebase/firestore');
            try {
              await updateFirebaseSession(session.id, { information: deleteField() } as unknown as Partial<Session>);
            } catch (error) {
              console.error('[SessionStore] Failed to delete information:', error);
            }
          }
          return;
        }

        const newInformation = {
          text: text.trim(),
          updatedAt: Date.now(), // ローカルクライアント時刻
          updatedBy: currentUser || undefined,
          readBy: currentUser ? [currentUser] : [], // 編集者は既読扱い
        };

        // ローカル更新
        set((state) => ({
          session: state.session
            ? { ...state.session, information: newInformation, updatedAt: Date.now() }
            : null,
        }));

        // オンラインモード: Firebaseにも反映
        if (session.id && session.createdBy) {
          const { updateSession: updateFirebaseSession } = await import('../services/sessionService');
          try {
            await updateFirebaseSession(session.id, { information: newInformation });
          } catch (error) {
            console.error('[SessionStore] Failed to update information:', error);
          }
        }
      },
      markInformationAsRead: async () => {
        const { session, currentUser } = get();
        if (!session || !session.information || !currentUser) return;

        // readBy が未定義の場合は空配列として扱う
        const currentReadBy = session.information.readBy ?? [];

        // 既に既読の場合は何もしない
        if (currentReadBy.includes(currentUser)) return;

        const updatedReadBy = [...currentReadBy, currentUser];
        const updatedInformation = { ...session.information, readBy: updatedReadBy };

        // ローカル更新
        set((state) => ({
          session: state.session
            ? { ...state.session, information: updatedInformation }
            : null,
        }));

        // オンラインモード: arrayUnionでアトミックに既読追加（競合を防止）
        if (session.id && session.createdBy) {
          try {
            const { updateDoc, doc, arrayUnion } = await import('firebase/firestore');
            const { db } = await import('../lib/firebase');
            if (db) {
              const docRef = doc(db, 'sessions', session.id);
              await updateDoc(docRef, {
                'information.readBy': arrayUnion(currentUser),
              });
            }
          } catch (error) {
            console.error('[SessionStore] Failed to mark information as read:', error);
          }
        }
      },
      updateAccounting: async (patch) => {
        const { session } = get();
        if (!session) return;

        const merged: AccountingInput = {
          exemptCount: 0,
          maleCount: 0,
          femaleCount: 0,
          maleFee: 0,
          femaleFee: 0,
          gymCost: 0,
          shuttlePrice: 0,
          shuttleCount: 0,
          matchCount: 0,
          practiceType: '複',
          ...session.accounting,
          ...patch,
        };

        // ローカル更新（即時反映）
        set((state) => ({
          session: state.session
            ? { ...state.session, accounting: merged, updatedAt: Date.now() }
            : null,
        }));

        // オンラインモード: Firestoreにも反映
        if (session.id && session.createdBy) {
          const { updateSession: updateFirebaseSession } = await import('../services/sessionService');
          try {
            await updateFirebaseSession(session.id, { accounting: merged });
          } catch (error) {
            console.error('[SessionStore] Failed to update accounting:', error);
          }
        }
      },
    }),
    {
      name: 'badminton-session',
    }
  )
);
