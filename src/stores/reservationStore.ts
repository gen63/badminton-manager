import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Reservation } from '../types/reservation';

interface ReservationState {
  reservations: Reservation[];
  addReservation: (playerIds: string[]) => void;
  removeReservation: (id: string) => void;
  fulfillReservation: (id: string) => void;
  clearReservations: () => void;
}

export const useReservationStore = create<ReservationState>()(
  persist(
    (set) => ({
      reservations: [],

      addReservation: (playerIds) =>
        set((state) => {
          const maxOrder = state.reservations.reduce((max, r) => Math.max(max, r.orderNumber ?? 0), 0);
          return {
            reservations: [
              ...state.reservations,
              {
                id: `rsv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                orderNumber: maxOrder + 1,
                playerIds,
                status: 'pending',
                createdAt: Date.now(),
                fulfilledAt: null,
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
    }),
    {
      name: 'badminton-reservations',
    }
  )
);
