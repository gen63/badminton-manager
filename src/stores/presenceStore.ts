import { create } from 'zustand';
import type { PresenceEntry } from '../types/session';

/**
 * プレゼンス情報（画面を開いている/操作中のユーザー）の揮発ストア
 *
 * sessionStore は persist で localStorage に永続化されるため、
 * ハートビートのたびに localStorage 書き込みが発生しないよう別ストアで管理する。
 */
type PresenceMap = { [username: string]: PresenceEntry };
/** ユーザー名 -> 最終画面参照時刻 (Unix ms) */
type LastSeenMap = { [username: string]: number };

interface PresenceState {
  remotePresence: PresenceMap;
  /** 最後にアプリ画面を見てから何分経ったか計算用（presence とは独立、削除されない） */
  lastSeen: LastSeenMap;
  /** onSnapshot 1 回で両方まとめて更新（再レンダー 1 回に抑える） */
  setPresenceSnapshot: (snapshot: { presence: PresenceMap; lastSeen: LastSeenMap }) => void;
  clear: () => void;
}

export const usePresenceStore = create<PresenceState>()((set) => ({
  remotePresence: {},
  lastSeen: {},
  setPresenceSnapshot: ({ presence, lastSeen }) => set({ remotePresence: presence, lastSeen }),
  clear: () => set({ remotePresence: {}, lastSeen: {} }),
}));
