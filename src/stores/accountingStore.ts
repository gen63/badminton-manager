import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AccountingRecord } from '../types/accounting';

interface LastInput {
  exemptCount: number;
  maleCount: number;
  femaleCount: number;
  maleFee: number;
  femaleFee: number;
  gymCost: number;
  shuttlePrice: number;
  shuttleCount: number;
  matchCount: number;
  practiceType: string;
  otherDescription?: string;
  otherAmount?: number;
}

interface AccountingState {
  records: AccountingRecord[];
  lastInput: LastInput | null;
  addRecord: (record: Omit<AccountingRecord, 'id' | 'timestamp'>) => void;
  deleteRecord: (id: string) => void;
  clearRecords: () => void;
  saveLastInput: (input: LastInput) => void;
}

export const useAccountingStore = create<AccountingState>()(
  persist(
    (set) => ({
      records: [],
      lastInput: null,

      addRecord: (record) =>
        set((state) => ({
          records: [
            ...state.records,
            {
              ...record,
              id: crypto.randomUUID(),
              timestamp: Date.now(),
            },
          ],
        })),

      deleteRecord: (id) =>
        set((state) => ({
          records: state.records.filter((r) => r.id !== id),
        })),

      clearRecords: () => set({ records: [], lastInput: null }),

      saveLastInput: (input) =>
        set({ lastInput: input }),
    }),
    {
      name: 'accounting-storage',
    }
  )
);
