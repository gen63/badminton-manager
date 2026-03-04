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
    }),
    {
      name: 'badminton-settings',
    }
  )
);
