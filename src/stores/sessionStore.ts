import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AccountingInput, Session, SessionConfig } from '../types/session';
import { useUnrecordedDismissStore } from './unrecordedDismissStore';

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
  setCurrentUser: (name: string | null) => void;
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
        
        // Firestore にも反映（セッションあれば必ず）
        const { session } = get();
        if (session?.id) {
          const { updateSession: updateFirebaseSession } = await import('../services/sessionService');
          try {
            const mergedConfig = { ...session.config, ...config };
            await updateFirebaseSession(session.id, { config: mergedConfig });
          } catch (error) {
            console.error('[SessionStore] Failed to sync config to Firestore:', error);
          }
        }
      },
      clearSession: () => {
        useUnrecordedDismissStore.getState().clear();
        set({ session: null, currentUser: null });
      },
      setCurrentUser: (name) => set({ currentUser: name }),
      initialize: (session) =>
        set({
          session,
          currentUser: session.createdBy || null,
        }),
      isCreator: () => {
        const { session, currentUser } = get();
        // 開発モード: 作成者扱い
        if (isDevMode()) return true;
        if (!session || !currentUser) return false;
        return currentUser === session.createdBy;
      },
      isAdmin: () => {
        const { session, currentUser } = get();
        // 開発モード: 管理者扱い
        if (isDevMode()) return true;
        if (!session || !currentUser) return false;
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

          // Firestore からも削除（deleteField で field 自体を消す）
          if (session.id) {
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

        // SessionSelectPage と揃える: `updatedBy: undefined` を含めると Firestore
        // (`ignoreUndefinedProperties` 未設定) が write 時に例外を投げてしまう。
        // 裏管理 (currentUser=null) の場合に発生していた。
        // currentUser がある時だけプロパティを差し込む。
        const newInformation: NonNullable<Session['information']> = {
          text: text.trim(),
          updatedAt: Date.now(), // ローカルクライアント時刻
          readBy: currentUser ? [currentUser] : [], // 編集者は既読扱い
          ...(currentUser ? { updatedBy: currentUser } : {}),
        };

        // ローカル更新
        set((state) => ({
          session: state.session
            ? { ...state.session, information: newInformation, updatedAt: Date.now() }
            : null,
        }));

        // Firestore にも反映
        if (session.id) {
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

        // arrayUnion でアトミックに既読追加（競合を防止）
        if (session.id) {
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

        // Firestore にも反映
        if (session.id) {
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
      // Phase B (2026-05-06): ローカルに残すデータを最小化する方針に従い、
      // `session` (Firestore からいつでも復元できる) は persist しない。`currentUser`
      // (端末で誰として参加しているか) だけ残す。リロード時は session=null の
      // ため各ページの `if (!session) navigate('/')` ガードで SessionSelectPage に
      // 戻る → ユーザーがセッションを選び直す → SessionJoinPage で `currentUser`
      // が自動選択される、という UX。
      version: 1,
      migrate: (persisted, version) => {
        if (version < 1 && persisted && typeof persisted === 'object') {
          // 旧 version では session 全体を localStorage に書いていた。
          // currentUser だけ残してドロップする。
          const obj = persisted as Record<string, unknown>;
          return { currentUser: obj.currentUser ?? null };
        }
        return persisted;
      },
      partialize: (state) => ({
        currentUser: state.currentUser,
      }),
    }
  )
);
