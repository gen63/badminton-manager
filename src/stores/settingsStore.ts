import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_RESERVATION_BLOCK_THRESHOLD } from '../lib/algorithm';

interface SettingsState {
  gasWebAppUrl: string;
  setGasWebAppUrl: (url: string) => void;
  accountingWebAppUrl: string; // 会計データ専用URL（ユーザーには非表示）
  useStayDurationPriority: boolean;
  setUseStayDurationPriority: (value: boolean) => void;
  continuousMatchMode: boolean;
  setContinuousMatchMode: (value: boolean) => void;
  recordScores: boolean;
  setRecordScores: (value: boolean) => void;
  forceBulkAssignment: boolean;
  setForceBulkAssignment: (value: boolean) => void;
  practiceType: '単' | '複' | '楽';
  setPracticeType: (value: '単' | '複' | '楽') => void;
  lateBalanceMode: boolean;
  setLateBalanceMode: (value: boolean) => void;
  /**
   * 男女比調整。オンなら 3-1 のコートと男女戦（男男 vs 女女）を強く避ける。
   * オフでも完全には無効化せず、実力の釣り合いが明確に良くなるときだけ許容する。
   * Firestore 同期（persist しない）。
   */
  genderBalanceMode: boolean;
  setGenderBalanceMode: (value: boolean) => void;
  lateBalanceAutoFired: boolean;
  setLateBalanceAutoFired: (value: boolean) => void;
  /** 予約保留の閾値（中央値+この値以上の試合数のメンバーを含む予約を保留）。Firestore 同期。 */
  reservationBlockThreshold: number;
  setReservationBlockThreshold: (value: number) => void;
  /** 呼び出し通知時に音・振動を鳴らすか。端末ローカル設定（Firestore 同期しない）。 */
  matchCallAlert: boolean;
  setMatchCallAlert: (value: boolean) => void;
  /**
   * 管理者向け「もうすぐ試合です」アナウンスを鳴らすか。端末ローカル設定
   * （Firestore 同期しない）。管理者が複数いる場合に各自で切れる必要がある。
   */
  adminMatchCallAnnounce: boolean;
  setAdminMatchCallAnnounce: (value: boolean) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      gasWebAppUrl: 'https://script.google.com/macros/s/AKfycbz4sCGJS-6aXtkzTYrrtpNBQRGJBwE2DmONwOBGhFLy4XZjOWMySjDi768yscdF0n6IWA/exec',
      setGasWebAppUrl: (url) => set({ gasWebAppUrl: url }),
      accountingWebAppUrl: 'https://script.google.com/macros/s/AKfycbxNDglh8HEedqjDcYV0lsJQmPh-VZv5IQUA-VrvQlhC-DqoJnwLmMYnRm4YukP4Ir_0/exec',
      useStayDurationPriority: true,
      setUseStayDurationPriority: (value) => set({ useStayDurationPriority: value }),
      continuousMatchMode: true,
      setContinuousMatchMode: (value) => set({ continuousMatchMode: value }),
      recordScores: true,
      setRecordScores: (value) => set({ recordScores: value }),
      forceBulkAssignment: true,
      setForceBulkAssignment: (value) => set({ forceBulkAssignment: value }),
      practiceType: '複',
      setPracticeType: (value) =>
        set(() => {
          // 楽 は一括配置強制 ON 固定、単 は OFF 固定。
          // 切替時に forceBulkAssignment も整合させる。
          if (value === '単') return { practiceType: value, forceBulkAssignment: false };
          if (value === '楽') return { practiceType: value, forceBulkAssignment: true };
          return { practiceType: value };
        }),
      lateBalanceMode: false,
      setLateBalanceMode: (value) => set({ lateBalanceMode: value }),
      genderBalanceMode: true,
      setGenderBalanceMode: (value) => set({ genderBalanceMode: value }),
      lateBalanceAutoFired: false,
      setLateBalanceAutoFired: (value) => set({ lateBalanceAutoFired: value }),
      reservationBlockThreshold: DEFAULT_RESERVATION_BLOCK_THRESHOLD,
      setReservationBlockThreshold: (value) => set({ reservationBlockThreshold: value }),
      matchCallAlert: true,
      setMatchCallAlert: (value) => set({ matchCallAlert: value }),
      adminMatchCallAnnounce: true,
      setAdminMatchCallAnnounce: (value) => set({ adminMatchCallAnnounce: value }),
    }),
    {
      name: 'badminton-settings',
      // Phase A: Firestore 同期対象 (`practiceType` / `continuousMatchMode` /
      // `recordScores`) は localStorage に書かない。Firestore がソース・onSnapshot
      // 受信で値が入る。前セッションから持ち越して別セッションに drift する
      // 不具合 (例: 単→ダブルス意図のセッションでも singles フローが走る) を
      // 原理的に消す。`useFirebaseSync` 側のフォールバックは旧セッション保険
      // として残す。
      //
      // version 3: `useStayDurationPriority` も Firestore 同期へ移した。配置モードは
      // セッション全体の挙動を決めるため、端末ごとに違うと「試合終了を押した人の
      // 設定で連続配置のモードが変わる」ことになる。
      // docs/plans/2026-08-11-stay-duration-mode-not-applied.md
      //
      // version 4: `prioritizeDiversity` を `forceBulkAssignment` にリネームし、同様に
      // Firestore 同期へ移した（デフォルトも false→true に変更）。
      // docs/plans/2026-08-13-force-bulk-assignment.md
      version: 4,
      migrate: (persisted, version) => {
        let state = persisted;
        if (version < 1 && state && typeof state === 'object') {
          // 旧 version で localStorage に書かれていた同期対象を剥がす
          const { practiceType: _pt, continuousMatchMode: _cm, recordScores: _rs, ...rest } =
            state as Record<string, unknown>;
          void _pt;
          void _cm;
          void _rs;
          state = rest;
        }
        if (version < 2 && state && typeof state === 'object') {
          // 旧 accountingWebAppUrl を剥がし、新しいデフォルトを適用する
          const { accountingWebAppUrl: _acc, ...rest } = state as Record<string, unknown>;
          void _acc;
          state = rest;
        }
        if (version < 3 && state && typeof state === 'object') {
          // 旧 version で localStorage に書かれていた useStayDurationPriority を剥がす。
          // Firestore がソースになるので、持ち越して別セッションに drift させない。
          const { useStayDurationPriority: _sd, ...rest } = state as Record<string, unknown>;
          void _sd;
          state = rest;
        }
        if (version < 4 && state && typeof state === 'object') {
          // 旧 version で localStorage に書かれていた prioritizeDiversity を剥がす。
          // forceBulkAssignment として Firestore がソースになる。
          const { prioritizeDiversity: _pd, ...rest } = state as Record<string, unknown>;
          void _pd;
          state = rest;
        }
        return state;
      },
      partialize: (state) => ({
        gasWebAppUrl: state.gasWebAppUrl,
        accountingWebAppUrl: state.accountingWebAppUrl,
        matchCallAlert: state.matchCallAlert,
        adminMatchCallAnnounce: state.adminMatchCallAnnounce,
      }),
      onRehydrateStorage: () => (state) => {
        // 旧バージョンで保存された localStorage から復元したとき、
        // practiceType と forceBulkAssignment の整合を取り直す。
        // version 1 以降は practiceType を persist しないので state.practiceType は
        // 必ずデフォルトの '複' になり下記のチェックは no-op になる。安全弁として残す。
        if (!state) return;
        if (state.practiceType === '単' && state.forceBulkAssignment !== false) {
          state.forceBulkAssignment = false;
        } else if (state.practiceType === '楽' && state.forceBulkAssignment !== true) {
          state.forceBulkAssignment = true;
        }
      },
    }
  )
);
