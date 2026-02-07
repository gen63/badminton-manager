import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface SettingsState {
  gasWebAppUrl: string;
  uploadedMatchIds: string[];
  setGasWebAppUrl: (url: string) => void;
  markMatchesAsUploaded: (ids: string[]) => void;
  clearUploadedMatchIds: () => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      gasWebAppUrl: 'https://script.google.com/macros/s/AKfycbyW2kn3h7UrLE3Bb8mxjnsfCCiEOsbBvBpmqR9aY0XY6pu-CYh2-pmWZJbah7ahpW-SgQ/exec',
      uploadedMatchIds: [],
      setGasWebAppUrl: (url) => set({ gasWebAppUrl: url }),
      markMatchesAsUploaded: (ids) =>
        set((state) => ({
          uploadedMatchIds: [...new Set([...state.uploadedMatchIds, ...ids])],
        })),
      clearUploadedMatchIds: () => set({ uploadedMatchIds: [] }),
    }),
    {
      name: 'badminton-settings',
    }
  )
);
