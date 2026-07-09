import { create } from 'zustand';
import type { ToastType } from '../components/Toast';

interface Notice {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
}

interface NoticeState {
  notices: Notice[];
  show: (message: string, type?: ToastType, duration?: number) => void;
  hide: (id: string) => void;
}

/**
 * ページローカルな `useToast` と違い、どの画面にいても表示されるグローバル
 * トースト。`useFirebaseSync` のような画面外のコードから全メンバーへの
 * お知らせ（未対応強制休憩など）を出すのに使う。表示は App 直下の
 * `GlobalNotices` が担う。persist しない（揮発でよい）。
 */
export const useNoticeStore = create<NoticeState>((set) => ({
  notices: [],
  show: (message, type = 'info', duration) =>
    set((state) => ({
      notices: [
        ...state.notices,
        { id: `notice-${Date.now()}-${Math.random()}`, message, type, duration },
      ],
    })),
  hide: (id) =>
    set((state) => ({ notices: state.notices.filter((n) => n.id !== id) })),
}));
