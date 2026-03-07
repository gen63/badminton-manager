import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2, ChevronDown, Users, Clock, CheckCircle2, CalendarCheck } from 'lucide-react';
import { useReservationStore } from '../stores/reservationStore';
import { usePlayerStore } from '../stores/playerStore';
import { useGameStore } from '../stores/gameStore';
import { useSessionStore } from '../stores/sessionStore';
import { ReservationAddModal } from '../components/ReservationAddModal';
import { BottomNav } from '../components/BottomNav';
import { EmptyState } from '../components/EmptyState';

export function ReservationPage() {
  const navigate = useNavigate();
  const { session } = useSessionStore();
  const { players } = usePlayerStore();
  const { courts } = useGameStore();
  const { reservations, addReservation, removeReservation } = useReservationStore();
  const [showAdd, setShowAdd] = useState(false);
  const [showFulfilled, setShowFulfilled] = useState(false);

  if (!session) {
    navigate('/');
    return null;
  }

  const pendingReservations = reservations.filter(r => r.status === 'pending');
  const fulfilledReservations = reservations.filter(r => r.status === 'fulfilled');

  const playersInCourts = new Set(
    courts.flatMap((c) => [...c.teamA, ...c.teamB]).filter((id) => id && id.trim())
  );

  const getPlayerName = (playerId: string) => {
    return players.find((p) => p.id === playerId)?.name || '未設定';
  };

  const isPlayerReady = (playerId: string) => {
    const player = players.find(p => p.id === playerId);
    return player && !player.isResting && !playersInCourts.has(playerId);
  };

  const getReservationStatus = (reservation: { playerIds: string[] }) => {
    return reservation.playerIds.every(id => isPlayerReady(id)) ? 'ready' : 'waiting';
  };

  if (showAdd) {
    return (
      <ReservationAddModal
        players={players}
        getPlayerName={getPlayerName}
        onConfirm={(playerIds) => {
          addReservation(playerIds);
          setShowAdd(false);
        }}
        onCancel={() => setShowAdd(false)}
      />
    );
  }

  return (
    <div className="bg-app pb-20">
      {/* ヘッダー */}
      <div className="header-gradient text-gray-800 p-3">
        <div className="max-w-6xl mx-auto flex items-center gap-3">
          <div className="flex items-center gap-2">
            <CalendarCheck size={20} />
            <h1 className="text-lg font-bold">予約一覧</h1>
          </div>
          {pendingReservations.length > 0 && (
            <span className="text-sm text-muted-foreground">
              {pendingReservations.length}件
            </span>
          )}
        </div>
      </div>

      <div className="max-w-md mx-auto p-4 space-y-3">
        {pendingReservations.length === 0 && fulfilledReservations.length === 0 && (
          <EmptyState
            icon="📋"
            title="予約はありません"
            description="「予約追加」ボタンから次に試合するメンバーを予約できます。"
          />
        )}

        {pendingReservations.map((reservation, index) => {
          const status = getReservationStatus(reservation);
          return (
            <div
              key={reservation.id}
              className={`card p-3 ${
                status === 'ready' ? 'border-green-300 bg-green-50/50' : ''
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-muted-foreground">#{reservation.orderNumber ?? index + 1}</span>
                  {status === 'ready' ? (
                    <span className="flex items-center gap-1 text-[10px] font-semibold text-green-700 bg-green-100 px-1.5 py-0.5 rounded-full">
                      <CheckCircle2 size={10} />
                      準備完了
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-[10px] font-semibold text-orange-700 bg-orange-100 px-1.5 py-0.5 rounded-full">
                      <Clock size={10} />
                      メンバー不足
                    </span>
                  )}
                </div>
                <button
                  onClick={() => removeReservation(reservation.id)}
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

        {/* 消化済み予約 */}
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

        {/* 予約追加ボタン */}
        <button
          onClick={() => setShowAdd(true)}
          className="w-full py-3 bg-primary text-primary-foreground rounded-xl font-semibold text-sm hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
        >
          <Plus size={16} />
          予約追加
        </button>
      </div>

      <BottomNav activeTab="reservation" />
    </div>
  );
}
