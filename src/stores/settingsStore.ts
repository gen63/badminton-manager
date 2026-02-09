import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface SettingsState {
  gasWebAppUrl: string;
  setGasWebAppUrl: (url: string) => void;
  useStayDurationPriority: boolean;
  setUseStayDurationPriority: (value: boolean) => void;
  continuousMatchMode: boolean;
  setContinuousMatchMode: (value: boolean) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      gasWebAppUrl: 'https://script.google.com/macros/s/AKfycbz4sCGJS-6aXtkzTYrrtpNBQRGJBwE2DmONwOBGhFLy4XZjOWMySjDi768yscdF0n6IWA/exec',
      setGasWebAppUrl: (url) => set({ gasWebAppUrl: url }),
      useStayDurationPriority: true,
      setUseStayDurationPriority: (value) => set({ useStayDurationPriority: value }),
      continuousMatchMode: true,
      setContinuousMatchMode: (value) => set({ continuousMatchMode: value }),
    }),
    {
      name: 'badminton-settings',
    }
  )
);
