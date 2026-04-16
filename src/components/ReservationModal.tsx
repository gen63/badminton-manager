import { useState } from 'react';
import { X, Plus, Trash2, ChevronDown, Users, Clock, CheckCircle2 } from 'lucide-react';
import type { Reservation } from '../types/reservation';
import type { Player } from '../types/player';
import { ReservationAddModal } from './ReservationAddModal';
import { isPlayerReady as checkPlayerReady, getReservationStatus } from '../lib/reservationUtils';

interface ReservationModalProps {
  reservations: Reservation[];
  players: Player[];
  playersInCourts: Set<string>;
  getPlayerName: (id: string) => string;
  onAdd: (playerIds: string[]) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
  gameMode?: 'singles' | 'doubles';
}

export function ReservationModal({
  reservations,
  players,
  playersInCourts,
  getPlayerName,
  onAdd,
  onRemove,
  onClose,
  gameMode = 'doubles',
}: ReservationModalProps) {
  const [showAdd, setShowAdd] = useState(false);
  const [showFulfilled, setShowFulfilled] = useState(false);

  const pendingReservations = reservations.filter(r => r.status === 'pending');
  const fulfilledReservations = reservations.filter(r => r.status === 'fulfilled');

  const isPlayerReady = (playerId: string) => checkPlayerReady(playerId, players, playersInCourts);

  if (showAdd) {
    return (
      <ReservationAddModal
        players={players}
        getPlayerName={getPlayerName}
        onConfirm={(playerIds) => {
          onAdd(playerIds);
          onClose();
        }}
        onCancel={() => setShowAdd(false)}
        maxPlayers={gameMode === 'singles' ? 2 : 4}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-background rounded-2xl shadow-2xl w-[90%] max-w-md max-h-[80vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-background border-b border-border px-6 py-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-foreground">予約一覧</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full hover:bg-muted flex items-center justify-center text-muted-foreground transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 flex flex-col gap-3">
          {pendingReservations.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-6">
              予約はありません
            </p>
          )}

          {pendingReservations.map((reservation, index) => {
            const status = getReservationStatus(reservation.playerIds, players, playersInCourts);
            return (
              <div
                key={reservation.id}
                className={`bg-card border rounded-xl p-3 shadow-sm ${
                  status === 'ready' ? 'border-green-300 bg-green-50/50' : 'border-border'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-muted-foreground">#{reservation.orderNumber ?? index + 1}</span>
                    <span className={`flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full min-w-[70px] justify-center ${
                      status === 'ready'
                        ? 'text-green-700 bg-green-100'
                        : 'text-orange-700 bg-orange-100'
                    }`}>
                      {status === 'ready' ? <CheckCircle2 size={10} /> : <Clock size={10} />}
                      {status === 'ready' ? '準備完了' : 'メンバー不足'}
                    </span>
                  </div>
                  <button
                    onClick={() => onRemove(reservation.id)}
                    className="w-7 h-7 rounded-full hover:bg-red-100 text-muted-foreground hover:text-red-600 flex items-center justify-center transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {reservation.playerIds.map(id => {
                    const ready = isPlayerReady(id);
                    const player = players.find(p => p.id === id);
                    const textColor = player?.gender === 'M'
                      ? 'text-blue-700'
                      : player?.gender === 'F'
                      ? 'text-pink-700'
                      : 'text-foreground';
                    return (
                      <span
                        key={id}
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold ${
                          ready
                            ? `bg-green-100 ${textColor}`
                            : 'bg-muted text-muted-foreground'
                        }`}
                      >
                        <Users size={10} />
                        {getPlayerName(id)}
                        {!ready && (
                          <span className="text-[9px] opacity-70">
                            {player?.isResting ? '(休憩中)' : '(試合中)'}
                          </span>
                        )}
                      </span>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {/* Fulfilled reservations */}
          {fulfilledReservations.length > 0 && (
            <div className="mt-2">
              <button
                onClick={() => setShowFulfilled(!showFulfilled)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <ChevronDown size={14} className={`transition-transform ${showFulfilled ? 'rotate-180' : ''}`} />
                消化済み ({fulfilledReservations.length})
              </button>
              {showFulfilled && (
                <div className="mt-2 flex flex-col gap-2 opacity-60">
                  {fulfilledReservations.map((reservation) => (
                    <div
                      key={reservation.id}
                      className="bg-muted/30 border border-border rounded-xl p-3"
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-bold text-muted-foreground">#{reservation.orderNumber ?? '?'}</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {reservation.playerIds.map(id => (
                          <span
                            key={id}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold bg-muted text-muted-foreground"
                          >
                            {getPlayerName(id)}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-background border-t border-border px-6 py-4">
          <button
            onClick={() => setShowAdd(true)}
            className="w-full py-3 bg-primary text-primary-foreground rounded-xl font-semibold text-sm hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
          >
            <Plus size={16} />
            予約追加
          </button>
        </div>
      </div>
    </div>
  );
}
