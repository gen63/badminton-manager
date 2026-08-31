import { create } from 'zustand';
import type { PairPreference } from '../types/pairPreference';

interface PairPreferenceState {
  pairPreferences: PairPreference[];
  clearPairPreferences: () => void;
}

export const usePairPreferenceStore = create<PairPreferenceState>()((set) => ({
  pairPreferences: [],
  clearPairPreferences: () => set({ pairPreferences: [] }),
}));
