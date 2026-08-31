import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Plus, Trash2, ChevronDown, Users, Clock, CheckCircle2, CalendarCheck } from 'lucide-react';
import { useReservationStore } from '../stores/reservationStore';
import { usePlayerStore } from '../stores/playerStore';
import { useGameStore } from '../stores/gameStore';
import { useSessionStore } from '../stores/sessionStore';
import { usePairPreferenceStore } from '../stores/pairPreferenceStore';
import { useSessionWriter } from '../hooks/useSessionWriter';
import { ReservationAddModal } from '../components/ReservationAddModal';
import { PairPreferenceAddModal } from '../components/PairPreferenceAddModal';
import { PairPreferenceCard } from '../components/PairPreferenceCard';
import { BottomNav } from '../components/BottomNav';
import { EmptyState } from '../components/EmptyState';
import { isPlayerReady as checkPlayerReady, getReservationStatus, inferDoublesCategory, getCategoryShortLabel } from '../lib/reservationUtils';

export function ReservationPage() {
  const session = useSessionStore((s) => s.session);
  const currentUser = useSessionStore((s) => s.currentUser);
  const players = usePlayerStore((s) => s.players);
  const courts = useGameStore((s) => s.courts);
  const matchHistory = useGameStore((s) => s.matchHistory);
  const reservations = useReservationStore((s) => s.reservations);
  const pairPreferences = usePairPreferenceStore((s) => s.pairPreferences);
  const writer = useSessionWriter();
  const [showAdd, setShowAdd] = useState(false);
  const [showAddPairPreference, setShowAddPairPreference] = useState(false);
  const [showFulfilled, setShowFulfilled] = useState(false);
  const isSingles = session?.config.gameMode === 'singles';

  if (!session) {
    return <Navigate to="/" replace />;
  }

  const pendingReservations = reservations.filter(r => r.status === 'pending');
  const fulfilledReservations = reservations.filter(r => r.status === 'fulfilled');

  const playersInCourts = new Set(
    courts.flatMap((c) => [...c.teamA, ...c.teamB]).filter((id) => id && id.trim())
  );

  const getPlayerName = (playerId: string) => {
    return players.find((p) => p.id === playerId)?.name || '未設定';
  };

  const isPlayerReady = (playerId: string) => checkPlayerReady(playerId, players, playersInCourts);

  if (showAdd) {
    return (
      <ReservationAddModal
        players={players}
        getPlayerName={getPlayerName}
        onConfirm={async (playerIds) => {
          await writer.addReservation(playerIds, currentUser || undefined);
          setShowAdd(false);
        }}
        onCancel={() => setShowAdd(false)}
      />
    );
  }

  if (showAddPairPreference) {
    return (
      <PairPreferenceAddModal
        players={players}
        existingPreferences={pairPreferences}
        getPlayerName={getPlayerName}
        onConfirm={async (playerIds, strength) => {
          await writer.addPairPreference(playerIds, strength, currentUser || undefined);
          setShowAddPairPreference(false);
        }}
        onCancel={() => setShowAddPairPreference(false)}
      />
    );
  }

  return (
    <div className="pb-20">
      {/* ヘッダー */}
      <div className="text-foreground p-3">
        <div className="max-w-6xl mx-auto flex items-center gap-3">
          <div className="flex items-center gap-2">
            <CalendarCheck size={20} />
            <h1 className="text-lg font-bold">試合予約</h1>
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
          const status = getReservationStatus(reservation.playerIds, players, playersInCourts);
          const rsvCategory = inferDoublesCategory(reservation.playerIds, players);
          const rsvCategoryLabel = getCategoryShortLabel(rsvCategory);
          return (
            <div
              key={reservation.id}
              className={`card p-3 ${
                status === 'ready' ? 'border-green-300 bg-green-50/50' : ''
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-muted-foreground">
                    #{reservation.orderNumber ?? index + 1}
                    {reservation.createdBy && (
                      <span className="text-[10px] text-muted-foreground/70 ml-1">
                        追加:{reservation.createdBy}
                      </span>
                    )}
                  </span>
                  {rsvCategoryLabel && (
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                      rsvCategory === '男子ダブルス'
                        ? 'bg-blue-100 text-blue-700'
                        : rsvCategory === '女子ダブルス'
                        ? 'bg-pink-100 text-pink-700'
                        : 'bg-purple-100 text-purple-700'
                    }`}>
                      {rsvCategoryLabel}
                    </span>
                  )}
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
                  onClick={() => void writer.removeReservation(reservation.id)}
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

        {/* 予約追加ボタン */}
        <button
          onClick={() => setShowAdd(true)}
          className="w-full py-3 bg-primary text-primary-foreground rounded-xl font-semibold text-sm hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
        >
          <Plus size={16} />
          予約追加
        </button>

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
                      <span className="text-xs font-bold text-muted-foreground">
                        #{reservation.orderNumber ?? '?'}
                        {reservation.createdBy && (
                          <span className="text-[10px] text-muted-foreground/70 ml-1">
                            追加:{reservation.createdBy}
                          </span>
                        )}
                      </span>
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

        {/* ペア希望セクション（予約とは別物: 消化されず、副作用も無い） */}
        {!isSingles && (
          <div className="mt-6 pt-4 border-t border-border">
            <div className="flex items-center gap-2 mb-3">
              <h2 className="text-sm font-bold text-foreground">ペア希望</h2>
              {pairPreferences.length > 0 && (
                <span className="text-sm text-muted-foreground">
                  {pairPreferences.length}組
                </span>
              )}
            </div>

            <div className="space-y-2">
              {pairPreferences.map((preference) => (
                <PairPreferenceCard
                  key={preference.id}
                  preference={preference}
                  players={players}
                  matchHistory={matchHistory}
                  getPlayerName={getPlayerName}
                  onRemove={() => void writer.removePairPreference(preference.id)}
                />
              ))}

              <button
                onClick={() => setShowAddPairPreference(true)}
                className="w-full py-3 bg-secondary text-secondary-foreground rounded-xl font-semibold text-sm hover:bg-secondary/90 transition-colors flex items-center justify-center gap-2"
              >
                <Plus size={16} />
                ペア希望を追加
              </button>
            </div>
          </div>
        )}
      </div>

      <BottomNav activeTab="reservation" />
    </div>
  );
}
