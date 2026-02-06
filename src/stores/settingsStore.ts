import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface SettingsState {
  gasWebAppUrl: string;
  setGasWebAppUrl: (url: string) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      gasWebAppUrl: 'https://script.google.com/macros/s/AKfycbyG7Vud0xcxe8k3B-rhKu-4eJlWlcSMyAtSP3BFchGZ8b6E08sKN2noYmpy_PottXXQBA/exec',
      setGasWebAppUrl: (url) => set({ gasWebAppUrl: url }),
    }),
    {
      name: 'badminton-settings',
    }
  )
);
