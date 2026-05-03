import { create } from 'zustand';
import type { Reservation } from '../types/reservation';

interface ReservationState {
  reservations: Reservation[];
  addReservation: (playerIds: string[], createdBy?: string) => void;
  removeReservation: (id: string) => void;
  fulfillReservation: (id: string) => void;
  clearReservations: () => void;
}

export const useReservationStore = create<ReservationState>()((set) => ({
      reservations: [],

      addReservation: (playerIds, createdBy) =>
        set((state) => {
          const maxOrder = state.reservations.reduce((max, r) => Math.max(max, r.orderNumber ?? 0), 0);
          return {
            reservations: [
              ...state.reservations,
              {
                id: crypto.randomUUID(),
                orderNumber: maxOrder + 1,
                playerIds,
                status: 'pending',
                createdAt: Date.now(),
                fulfilledAt: 0, // 未完了時は0
                createdBy,
              },
            ],
          };
        }),

      removeReservation: (id) =>
        set((state) => ({
          reservations: state.reservations.filter((r) => r.id !== id),
        })),

      fulfillReservation: (id) =>
        set((state) => ({
          reservations: state.reservations.map((r) =>
            r.id === id ? { ...r, status: 'fulfilled' as const, fulfilledAt: Date.now() } : r
          ),
        })),

      clearReservations: () => set({ reservations: [] }),
}));
