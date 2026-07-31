import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { usePlayerStore } from '../stores/playerStore';
import { useGameStore } from '../stores/gameStore';
import { usePresenceStore } from '../stores/presenceStore';
import { useSessionWriterWithToast } from '../hooks/useSessionWriterToast';
import { useGuardedAction } from '../hooks/useGuardedAction';
import { useToast } from '../hooks/useToast';
import { Toast } from '../components/Toast';
import { Trash2, Pencil, Users, ChevronDown, ChevronUp, Clock } from 'lucide-react';
import { useSessionStore } from '../stores/sessionStore';
import { useSettingsStore } from '../stores/settingsStore';
import { PRACTICE_TYPE_OPTIONS } from '../lib/accountingCalc';
import { formatLastSeen, type LastSeenTone } from '../lib/lastSeen';
import { sortPlayers, type PlayerSortMode } from '../lib/playerSort';
import { countByGender, formatGenderBreakdown, genderLabel } from '../lib/genderBreakdown';
import { formatTime } from '../lib/utils';
import { BottomNav } from '../components/BottomNav';
import { PaymentModal } from '../components/PaymentModal';
import { PlayerEditModal } from '../components/PlayerEditModal';

/** 経過時間トーンごとの表示色（DESIGN.md のカラーガイドラインに沿った semantic 色） */
const LAST_SEEN_TONE_CLASS: Record<LastSeenTone, string> = {
  live: 'text-emerald-600',
  recent: 'text-muted-foreground',
  stale: 'text-amber-600',
  never: 'text-muted-foreground',
};

/** 経過時間バッジの再評価間隔（相対時間表示なので `PresenceIndicator` より長め） */
const LAST_SEEN_TICK_MS = 30_000;

/**
 * 性別バッジの表示色。男=青 / 女=ピンクは `PlayerEditModal`・`ReservationPage` と揃える。
 * 未設定は「埋めてほしい」注意喚起なので amber（`LAST_SEEN_TONE_CLASS.stale` と同系）。
 */
const GENDER_BADGE_CLASS: Record<'M' | 'F' | 'unknown', string> = {
  M: 'bg-blue-100 text-blue-700',
  F: 'bg-pink-100 text-pink-700',
  unknown: 'bg-amber-100 text-amber-700',
};

export function PlayerSelect() {
  const players = usePlayerStore((s) => s.players);
  const matchHistory = useGameStore((s) => s.matchHistory);
  const session = useSessionStore((s) => s.session);
  const isAdminFn = useSessionStore((s) => s.isAdmin);
  const currentUser = useSessionStore((s) => s.currentUser);
  const practiceType = useSettingsStore((s) => s.practiceType);
  const isAdmin = isAdminFn();
  const lastSeen = usePresenceStore((s) => s.lastSeen);
  // 相対時間の再評価用 tick。非管理者では interval 自体を張らない（無駄な再レンダー回避）。
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!isAdmin) return;
    const id = setInterval(() => setNow(Date.now()), LAST_SEEN_TICK_MS);
    return () => clearInterval(id);
  }, [isAdmin]);
  const toast = useToast();
  const writer = useSessionWriterWithToast(toast);
  const rosterToggle = useGuardedAction(async (playerId: string) => {
    await writer.toggleOperationStatus(playerId, 'roster');
  });
  const paymentToggle = useGuardedAction(async (playerId: string, amount: number) => {
    await writer.applyPayment(playerId, amount);
  });
  const paymentRevert = useGuardedAction(async (playerId: string) => {
    await writer.toggleOperationStatus(playerId, 'payment');
  });
  const [paymentModalPlayer, setPaymentModalPlayer] = useState<{ id: string; name: string; defaultAmount: number; isPaid: boolean } | null>(null);
  const [editModalPlayer, setEditModalPlayer] = useState<{ id: string; name: string; gender?: 'M' | 'F' } | null>(null);
  // アコーディオンの開閉。null = ユーザー未操作（自動判定に委ねる）。
  // 未操作なら全員完了時に自動で開き、それ以外は既定で閉じる。ユーザーが一度
  // タップしたらその選択（override）を優先し、以降は allComplete の変化で
  // 上書きされない（下記 paidCollapsed の算出を参照）。
  const [paidCollapsedOverride, setPaidCollapsedOverride] = useState<boolean | null>(null);
  // ソート選択（settingsStore へは永続化しない。CLAUDE.md のローカルストレージ最小化方針）。
  // 非管理者は lastSeen データが見えないため、ロジックでも 'games' 固定にする（下記 sortedPlayers 参照）。
  const [sortMode, setSortMode] = useState<PlayerSortMode>('games');
  const practiceDefaults =
    PRACTICE_TYPE_OPTIONS.find((t) => t.value === practiceType) ?? PRACTICE_TYPE_OPTIONS[0];
  const maleFee = session?.accounting?.maleFee ?? practiceDefaults.maleFee;
  const femaleFee = session?.accounting?.femaleFee ?? practiceDefaults.femaleFee;

  // 試合履歴に登場するプレイヤーIDのセット
  const playersInHistory = new Set(
    matchHistory.flatMap((match) => [...match.teamA, ...match.teamB])
  );

  // 参加者一覧のソート（非管理者は lastSeen が非表示のため常に 'games' 固定）
  const sortedPlayers = sortPlayers(players, isAdmin ? sortMode : 'games', lastSeen);

  // 見出しに出す性別内訳（例: 13人：男8・女4・未設定1）
  const genderBreakdown = countByGender(players);

  // タスク（会費・名簿）未完了 / 完了済みのグルーピング。アコーディオン自動展開の
  // 派生値（allComplete）が incompletePlayers.length を参照するため renderPlayerList
  // から巻き上げる。
  const incompletePlayers = sortedPlayers.filter(p => !p.operationStatus?.payment || !p.operationStatus?.roster);
  const completePlayers = sortedPlayers.filter(p => p.operationStatus?.payment && p.operationStatus?.roster);

  // 全員のタスクが完了（未完了 0 人）なら「完了済み」を自動で開く対象とする。
  const allComplete = players.length > 0 && incompletePlayers.length === 0;
  // 手動操作（override）が無い間は allComplete の派生値、操作後はその選択を優先する。
  // effect を使わない純粋な派生値なので、毎レンダーで再評価されても手動で閉じた
  // 状態が上書きされることはない（override が一度でも設定されればそちらが勝つ）。
  const paidCollapsed = paidCollapsedOverride ?? !allComplete;

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

    const genderFee = player.gender === 'M'
      ? maleFee
      : player.gender === 'F'
      ? femaleFee
      : maleFee; // 性別不明の場合は男性料金

    setPaymentModalPlayer({
      id: player.id,
      name: player.name,
      // 既に金額が入力済みなら修正しやすいようその値を初期表示する
      defaultAmount: player.paymentAmount ?? genderFee,
      isPaid: player.operationStatus?.payment ?? false,
    });
  };

  const handlePaymentConfirm = async (amount: number) => {
    if (!paymentModalPlayer) return;
    await paymentToggle.run(paymentModalPlayer.id, amount);
    setPaymentModalPlayer(null);
  };

  const handlePaymentRevert = async () => {
    if (!paymentModalPlayer) return;
    await paymentRevert.run(paymentModalPlayer.id);
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
    // 最終画面参照からの経過時間（管理者のみ）。1行目は幅がタイトなため、
    // カード内の2行目に表示してレイアウト崩れ・シフトを避ける。
    const lastSeenAt = isAdmin ? lastSeen[player.name] : undefined;
    const view = formatLastSeen(lastSeenAt, now);
    return (
      <div
        key={player.id}
        className="bg-card border border-border rounded-xl px-3 py-2 shadow-sm"
      >
        <div className="flex items-center gap-2">
          {/* 性別 + 名前 + 編集/削除 */}
          <div className="flex-1 min-w-0 flex items-center gap-2">
            {/* 性別バッジ。未設定を一目で見つけて編集モーダルで埋められるようにする */}
            <span
              aria-label={`性別${genderLabel(player.gender)}`}
              className={`flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] leading-none font-medium ${
                GENDER_BADGE_CLASS[player.gender ?? 'unknown']
              }`}
            >
              {genderLabel(player.gender)}
            </span>
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

        {/* 最終画面参照からの経過時間（2行目・管理者のみ） */}
        {isAdmin && (
          <div className={`mt-0.5 flex items-center gap-1 text-[10px] leading-tight ${LAST_SEEN_TONE_CLASS[view.tone]}`}>
            <Clock className="w-3 h-3 shrink-0" aria-hidden />
            <span title={typeof lastSeenAt === 'number' ? formatTime(lastSeenAt) : undefined}>
              {view.label}
            </span>
          </div>
        )}
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

    return (
      <div className="space-y-2">
        {/* 未完了の参加者（常に表示） */}
        {incompletePlayers.map(renderPlayerCard)}

        {/* タスク完了済み参加者（折りたたみ可能） */}
        {completePlayers.length > 0 && (
          <>
            <button
              onClick={() => setPaidCollapsedOverride(!paidCollapsed)}
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
              ({formatGenderBreakdown(genderBreakdown)})
            </span>
          </h2>
          {/* ソート切替（管理者のみ表示。非管理者には lastSeen の根拠データが見えないため） */}
          {isAdmin && (
            <div className="flex gap-2 mb-3">
              {([['games', '試合数が多い順'], ['lastSeen', '見ていない順']] as const).map(([mode, label]) => (
                <button
                  key={mode}
                  onClick={() => setSortMode(mode)}
                  aria-pressed={sortMode === mode}
                  className={`flex-1 min-h-[44px] px-2 rounded-xl text-sm font-medium transition-colors active:scale-[0.98] ${
                    sortMode === mode ? '' : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
                  }`}
                  style={sortMode === mode ? { backgroundColor: '#e0e7ff', color: '#3730a3' } : undefined}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
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
          isPaid={paymentModalPlayer.isPaid}
          onConfirm={handlePaymentConfirm}
          onRevert={handlePaymentRevert}
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
