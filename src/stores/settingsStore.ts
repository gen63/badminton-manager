import { create } from 'zustand';
import { persist } from 'zustand/middleware';

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
  prioritizeDiversity: boolean;
  setPrioritizeDiversity: (value: boolean) => void;
  practiceType: '単' | '複' | '楽';
  setPracticeType: (value: '単' | '複' | '楽') => void;
  lateBalanceMode: boolean;
  setLateBalanceMode: (value: boolean) => void;
  lateBalanceAutoFired: boolean;
  setLateBalanceAutoFired: (value: boolean) => void;
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
      prioritizeDiversity: false,
      setPrioritizeDiversity: (value) => set({ prioritizeDiversity: value }),
      practiceType: '複',
      setPracticeType: (value) =>
        set(() => {
          // 楽 は多様性優先固定、単 は回数優先固定。
          // 切替時に prioritizeDiversity も整合させる。
          if (value === '単') return { practiceType: value, prioritizeDiversity: false };
          if (value === '楽') return { practiceType: value, prioritizeDiversity: true };
          return { practiceType: value };
        }),
      lateBalanceMode: false,
      setLateBalanceMode: (value) => set({ lateBalanceMode: value }),
      lateBalanceAutoFired: false,
      setLateBalanceAutoFired: (value) => set({ lateBalanceAutoFired: value }),
    }),
    {
      name: 'badminton-settings',
      // Phase A: Firestore 同期対象 (`practiceType` / `continuousMatchMode` /
      // `recordScores`) は localStorage に書かない。Firestore がソース・onSnapshot
      // 受信で値が入る。前セッションから持ち越して別セッションに drift する
      // 不具合 (例: 単→ダブルス意図のセッションでも singles フローが走る) を
      // 原理的に消す。`useFirebaseSync` 側のフォールバックは旧セッション保険
      // として残す。
      version: 2,
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
        return state;
      },
      partialize: (state) => ({
        gasWebAppUrl: state.gasWebAppUrl,
        accountingWebAppUrl: state.accountingWebAppUrl,
        useStayDurationPriority: state.useStayDurationPriority,
        prioritizeDiversity: state.prioritizeDiversity,
      }),
      onRehydrateStorage: () => (state) => {
        // 旧バージョンで保存された localStorage から復元したとき、
        // practiceType と prioritizeDiversity の整合を取り直す。
        // version 1 以降は practiceType を persist しないので state.practiceType は
        // 必ずデフォルトの '複' になり下記のチェックは no-op になる。安全弁として残す。
        if (!state) return;
        if (state.practiceType === '単' && state.prioritizeDiversity !== false) {
          state.prioritizeDiversity = false;
        } else if (state.practiceType === '楽' && state.prioritizeDiversity !== true) {
          state.prioritizeDiversity = true;
        }
      },
    }
  )
);
