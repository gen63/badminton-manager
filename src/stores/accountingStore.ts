import { create } from 'zustand';
import type { AccountingRecord } from '../types/accounting';

interface AccountingState {
  records: AccountingRecord[];
  addRecord: (record: Omit<AccountingRecord, 'id' | 'timestamp'>) => void;
  clearRecords: () => void;
}

/**
 * 会計記録（GAS シートにアップロード成功したレコード）の **ローカルキャッシュ**。
 *
 * Phase C (2026-05-06): localStorage への persist を撤廃。
 * Firestore も真実のソースではない（GAS シートが永続先）ため、ローカルに残す
 * 必然性は薄かった。「次回の自動入力（同じ練習種別の直近料金 / 同じ体育館の
 * 体育館代継承）」のための便利キャッシュだったが、ローカルに残すデータを
 * 最小化する方針に従い、メモリ内のみに変更。
 *
 * ユーザー影響: AccountingPage の自動入力は「直近レコードがあれば継承」から
 * 「常に体育館・練習種別の固定値」にフォールバックする。手入力工数が
 * 数フィールド増えるが受容範囲。
 */
export const useAccountingStore = create<AccountingState>()((set) => ({
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

  clearRecords: () => set({ records: [] }),
}));
