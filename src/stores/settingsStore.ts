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
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      gasWebAppUrl: 'https://script.google.com/macros/s/AKfycbz4sCGJS-6aXtkzTYrrtpNBQRGJBwE2DmONwOBGhFLy4XZjOWMySjDi768yscdF0n6IWA/exec',
      setGasWebAppUrl: (url) => set({ gasWebAppUrl: url }),
      accountingWebAppUrl: 'https://script.google.com/macros/s/AKfycby_6Njs79BeLbZ16Vz6jyFyb3MFKoAnPYHzaZPwS8cvah5FNcjXxjXO3PcOz_k9IG0a/exec',
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
    }),
    {
      name: 'badminton-settings',
      onRehydrateStorage: () => (state) => {
        // 旧バージョンで保存された localStorage から復元したとき、
        // practiceType と prioritizeDiversity の整合を取り直す。
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
