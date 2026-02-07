import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface SettingsState {
  gasWebAppUrl: string;
  setGasWebAppUrl: (url: string) => void;
  useStayDurationPriority: boolean;
  setUseStayDurationPriority: (value: boolean) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      gasWebAppUrl: 'https://script.google.com/macros/s/AKfycbyW2kn3h7UrLE3Bb8mxjnsfCCiEOsbBvBpmqR9aY0XY6pu-CYh2-pmWZJbah7ahpW-SgQ/exec',
      setGasWebAppUrl: (url) => set({ gasWebAppUrl: url }),
      useStayDurationPriority: true,
      setUseStayDurationPriority: (value) => set({ useStayDurationPriority: value }),
    }),
    {
      name: 'badminton-settings',
    }
  )
);
