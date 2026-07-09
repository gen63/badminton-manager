import { create } from 'zustand';
import type { PresenceEntry } from '../types/session';

/**
 * プレゼンス情報（画面を開いている/操作中のユーザー）の揮発ストア
 *
 * sessionStore は persist で localStorage に永続化されるため、
 * ハートビートのたびに localStorage 書き込みが発生しないよう別ストアで管理する。
 */
type PresenceMap = { [username: string]: PresenceEntry };

interface PresenceState {
  remotePresence: PresenceMap;
  setRemotePresence: (presence: PresenceMap) => void;
  clear: () => void;
}

export const usePresenceStore = create<PresenceState>()((set) => ({
  remotePresence: {},
  setRemotePresence: (presence) => set({ remotePresence: presence }),
  clear: () => set({ remotePresence: {} }),
}));
