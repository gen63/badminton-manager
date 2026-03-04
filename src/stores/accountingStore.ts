import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AccountingRecord } from '../types/accounting';

interface AccountingState {
  records: AccountingRecord[];
  addRecord: (record: Omit<AccountingRecord, 'id' | 'timestamp'>) => void;
  deleteRecord: (id: string) => void;
  clearRecords: () => void;
}

export const useAccountingStore = create<AccountingState>()(
  persist(
    (set) => ({
      records: [],

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

      clearRecords: () => set({ records: [] }),
    }),
    {
      name: 'accounting-storage',
    }
  )
);
