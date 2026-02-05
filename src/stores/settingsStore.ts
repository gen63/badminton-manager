import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface SettingsState {
  gasWebAppUrl: string;
  setGasWebAppUrl: (url: string) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      gasWebAppUrl: '',
      setGasWebAppUrl: (url) => set({ gasWebAppUrl: url }),
    }),
    {
      name: 'badminton-settings',
    }
  )
);
