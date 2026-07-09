import { create } from 'zustand';
import type { Reservation } from '../types/reservation';

interface ReservationState {
  reservations: Reservation[];
  clearReservations: () => void;
}

export const useReservationStore = create<ReservationState>()((set) => ({
  reservations: [],
  clearReservations: () => set({ reservations: [] }),
}));
