import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { usePlayerStore } from '../stores/playerStore';
import { useGameStore } from '../stores/gameStore';
import { useSessionWriterWithToast } from '../hooks/useSessionWriterToast';
import { useGuardedAction } from '../hooks/useGuardedAction';
import { useToast } from '../hooks/useToast';
import { Toast } from '../components/Toast';
import { Trash2, Pencil, Users, ChevronDown, ChevronUp } from 'lucide-react';
import { useSessionStore } from '../stores/sessionStore';
import { useSettingsStore } from '../stores/settingsStore';
import { PRACTICE_TYPE_OPTIONS } from '../lib/accountingCalc';
import { BottomNav } from '../components/BottomNav';
import { PaymentModal } from '../components/PaymentModal';
import { PlayerEditModal } from '../components/PlayerEditModal';

export function PlayerSelect() {
  const players = usePlayerStore((s) => s.players);
  const matchHistory = useGameStore((s) => s.matchHistory);
  const session = useSessionStore((s) => s.session);
  const isAdminFn = useSessionStore((s) => s.isAdmin);
  const currentUser = useSessionStore((s) => s.currentUser);
  const practiceType = useSettingsStore((s) => s.practiceType);
  const isAdmin = isAdminFn();
  const toast = useToast();
  const writer = useSessionWriterWithToast(toast);
  const rosterToggle = useGuardedAction(async (playerId: string) => {
    await writer.toggleOperationStatus(playerId, 'roster');
  });
  const paymentToggle = useGuardedAction(async (playerId: string, amount: number) => {
    await writer.applyPayment(playerId, amount);
  });
  const [paymentModalPlayer, setPaymentModalPlayer] = useState<{ id: string; name: string; defaultAmount: number } | null>(null);
  const [editModalPlayer, setEditModalPlayer] = useState<{ id: string; name: string; gender?: 'M' | 'F' } | null>(null);
  const [paidCollapsed, setPaidCollapsed] = useState(true);
  const practiceDefaults =
    PRACTICE_TYPE_OPTIONS.find((t) => t.value === practiceType) ?? PRACTICE_TYPE_OPTIONS[0];
  const maleFee = session?.accounting?.maleFee ?? practiceDefaults.maleFee;
  const femaleFee = session?.accounting?.femaleFee ?? practiceDefaults.femaleFee;

  // 試合履歴に登場するプレイヤーIDのセット
  const playersInHistory = new Set(
    matchHistory.flatMap((match) => [...match.teamA, ...match.teamB])
  );

  // 参加回数の多い順でソート
  const sortedPlayers = [...players].sort((a, b) => b.gamesPlayed - a.gamesPlayed);

  const handleDelete = async (player: { id: string; name: string }) => {
    if (playersInHistory.has(player.id)) {
      toast.warning(`${player.name}は試合履歴があるため削除できません`);
      return;
    }
    await writer.removePlayer(player.id);
  };

  const handleEdit = (player: { id: string; name: string; gender?: 'M' | 'F' }) => {
    setEditModalPlayer({ id: player.id, name: player.name, gender: player.gender });
  };

  const handleEditSave = async (name: string, gender?: 'M' | 'F', rating?: number) => {
    if (!editModalPlayer) return;
    const oldName = editModalPlayer.name;
    const updates: { name: string; gender?: 'M' | 'F'; rating?: number } = { name, gender };
    if (rating !== undefined) updates.rating = rating;
    const result = await writer.updatePlayer(editModalPlayer.id, updates);
    // 自己 rename の場合は localStorage の currentUser を新名へ追従させる。
    // sessionMutations.updatePlayer は createdBy / admins / participants を新名に
    // 書き換えるため、currentUser だけ旧名のまま残ると isCreator/isAdmin /
    // BottomNav の自分の試合フィルタ等が一斉に壊れる。result からサーバ確定後の
    // 新名（sanitize 済み）を取り、currentUser と一致した場合のみ追従する。
    if (result) {
      const updated = result.players.find((p) => p.id === editModalPlayer.id);
      if (
        updated &&
        updated.name !== oldName &&
        useSessionStore.getState().currentUser === oldName
      ) {
        useSessionStore.getState().setCurrentUser(updated.name);
      }
    }
    setEditModalPlayer(null);
  };

  const handlePaymentClick = (playerId: string) => {
    const player = players.find(p => p.id === playerId);
    if (!player) return;

    const defaultAmount = player.gender === 'M'
      ? maleFee
      : player.gender === 'F'
      ? femaleFee
      : maleFee; // 性別不明の場合は男性料金

    setPaymentModalPlayer({
      id: player.id,
      name: player.name,
      defaultAmount,
    });
  };

  const handlePaymentConfirm = async (amount: number) => {
    if (!paymentModalPlayer) return;
    await paymentToggle.run(paymentModalPlayer.id, amount);
    setPaymentModalPlayer(null);
  };

  const renderPlayerCard = (player: typeof sortedPlayers[number]) => {
    const hasHistory = playersInHistory.has(player.id);
    const status = player.operationStatus || { payment: false, roster: false, checkin: false };
    // 編集は admin/creator か「自分自身」のみ。自分判定は currentUser（localStorage 名）と
    // player.name の一致で行う（player ID を持たない設計のため）。
    const canEdit = isAdmin || player.name === currentUser;
    // 削除は admin/creator のみ（自分自身の self-delete は誤操作リスクのため不可）。
    const canDelete = isAdmin;
    return (
      <div
        key={player.id}
        className="bg-card border border-border rounded-xl px-3 py-2 flex items-center gap-2 shadow-sm"
      >
        {/* 名前 + 編集/削除 */}
        <div className="flex-1 min-w-0 flex items-center gap-2">
          <span className="text-sm font-semibold text-foreground truncate">{player.name}</span>
          {canEdit && (
            <button
              onClick={() => handleEdit(player)}
              aria-label={`${player.name}を編集`}
              className="w-5 h-5 rounded-full flex items-center justify-center bg-blue-100 text-blue-600 hover:bg-blue-200 transition-colors flex-shrink-0"
            >
              <Pencil className="w-3 h-3" />
            </button>
          )}
          {!hasHistory && canDelete && (
            <button
              onClick={() => handleDelete(player)}
              aria-label={`${player.name}を削除`}
              className="w-5 h-5 rounded-full flex items-center justify-center bg-red-100 text-red-600 hover:bg-red-200 transition-colors flex-shrink-0"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          )}
        </div>

        {/* 試合数 */}
        <span className="text-xs text-muted-foreground whitespace-nowrap flex-shrink-0 tabular-nums">
          {player.gamesPlayed}
        </span>

        {/* 支払 / 名簿 ボタン */}
        <button
          onClick={() => handlePaymentClick(player.id)}
          className="w-14 flex-shrink-0 text-xs py-1 px-1 rounded-lg transition-colors flex items-center justify-center gap-1"
          style={{
            backgroundColor: status.payment ? '#10b981' : '#e5e7eb',
            color: status.payment ? '#ffffff' : '#6b7280',
          }}
        >
          {status.payment ? '✓' : ''}支払
        </button>
        <button
          onClick={() => void rosterToggle.run(player.id)}
          disabled={rosterToggle.isPending}
          className="w-14 flex-shrink-0 text-xs py-1 px-1 rounded-lg transition-colors flex items-center justify-center gap-1 disabled:opacity-50"
          style={{
            backgroundColor: status.roster ? '#10b981' : '#e5e7eb',
            color: status.roster ? '#ffffff' : '#6b7280',
          }}
        >
          {status.roster ? '✓' : ''}名簿
        </button>
      </div>
    );
  };

  const renderPlayerList = () => {
    if (players.length === 0) {
      return (
        <div className="text-center py-10">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-muted mb-3">
            <Users size={24} className="text-muted-foreground" />
          </div>
          <p className="text-muted-foreground text-sm">
            まだ参加者が登録されていません
          </p>
        </div>
      );
    }

    const incompletePlayers = sortedPlayers.filter(p => !p.operationStatus?.payment || !p.operationStatus?.roster);
    const completePlayers = sortedPlayers.filter(p => p.operationStatus?.payment && p.operationStatus?.roster);

    return (
      <div className="space-y-2">
        {/* 未完了の参加者（常に表示） */}
        {incompletePlayers.map(renderPlayerCard)}

        {/* タスク完了済み参加者（折りたたみ可能） */}
        {completePlayers.length > 0 && (
          <>
            <button
              onClick={() => setPaidCollapsed(!paidCollapsed)}
              className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm font-medium transition-colors"
              style={{
                backgroundColor: '#d1fae5',
                color: '#065f46',
              }}
            >
              <span>完了済み（{completePlayers.length}人）</span>
              {paidCollapsed ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
            </button>
            {!paidCollapsed && completePlayers.map(renderPlayerCard)}
          </>
        )}
      </div>
    );
  };

  if (!session) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="pb-20">
      {/* ヘッダー */}
      <div className="text-foreground p-3">
        <div className="max-w-6xl mx-auto flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Users size={20} />
            <h1 className="text-lg font-bold">参加者管理</h1>
          </div>
        </div>
      </div>

      <div className="max-w-md mx-auto p-3 space-y-3">
        {/* プレイヤーリスト */}
        <div className="card p-4">
          <h2 className="section-title mb-4">
            参加者一覧
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              ({players.length}人)
            </span>
          </h2>
          {renderPlayerList()}
        </div>
      </div>

      {/* トースト通知 */}
      <div className="fixed bottom-20 left-0 right-0 z-50 flex flex-col items-center gap-2 pointer-events-none">
        {toast.toasts.map((t) => (
          <Toast key={t.id} message={t.message} type={t.type} onClose={() => toast.hideToast(t.id)} />
        ))}
      </div>

      {/* 支払いモーダル */}
      {paymentModalPlayer && (
        <PaymentModal
          playerName={paymentModalPlayer.name}
          defaultAmount={paymentModalPlayer.defaultAmount}
          onConfirm={handlePaymentConfirm}
          onCancel={() => setPaymentModalPlayer(null)}
        />
      )}

      {/* 編集モーダル */}
      {editModalPlayer && (
        <PlayerEditModal
          playerName={editModalPlayer.name}
          playerGender={editModalPlayer.gender}
          existingNames={players.filter(p => p.id !== editModalPlayer.id).map(p => p.name)}
          onSave={handleEditSave}
          onCancel={() => setEditModalPlayer(null)}
        />
      )}

      <BottomNav activeTab="players" />
    </div>
  );
}
