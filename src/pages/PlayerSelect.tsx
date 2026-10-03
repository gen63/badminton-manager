import { useEffect, useState } from 'react';
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
import { resolveFees } from '../lib/accountingCalc';
import { useDefaultFees } from '../hooks/useDefaultFees';
import { sortPlayersByExpectedDiff } from '../lib/playerSort';
import { countByGender, formatGenderBreakdown, genderLabel } from '../lib/genderBreakdown';
import { computeExpectedGames, computeGamesStats, computeStayStats, expectedDiffTone, formatDiff, formatExpected, formatMedian, formatStayMinutes, type ExpectedDiffTone } from '../lib/playerStats';
import { resolvePracticeEndTime } from '../lib/practiceEndPhase';
import { BottomNav } from '../components/BottomNav';
import { PaymentModal } from '../components/PaymentModal';
import { PlayerEditModal } from '../components/PlayerEditModal';

/** 滞在時間（相対時間）の再評価間隔 */
const STAY_TICK_MS = 30_000;

/**
 * 性別バッジの表示色。男=青 / 女=ピンクは `PlayerEditModal`・`ReservationPage` と揃える。
 * 未設定は「埋めてほしい」注意喚起なので amber。
 */
const GENDER_BADGE_CLASS: Record<'M' | 'F' | 'unknown', string> = {
  M: 'bg-blue-100 text-blue-700',
  F: 'bg-pink-100 text-pink-700',
  unknown: 'bg-amber-100 text-amber-700',
};

/** 期待との差の色分け（normal=揺らぎ / watch=様子見 / alert=声かけ・調整） */
const EXPECTED_DIFF_TONE_CLASS: Record<ExpectedDiffTone, string> = {
  normal: 'text-muted-foreground',
  watch: 'text-amber-600',
  alert: 'text-red-600',
};

export function PlayerSelect() {
  const players = usePlayerStore((s) => s.players);
  const matchHistory = useGameStore((s) => s.matchHistory);
  const session = useSessionStore((s) => s.session);
  const isAdminFn = useSessionStore((s) => s.isAdmin);
  const currentUser = useSessionStore((s) => s.currentUser);
  const practiceType = useSettingsStore((s) => s.practiceType);
  // 滞在表示は滞在時間優先モードのときだけ（回数平均モードでは出さない）
  const useStayDurationPriority = useSettingsStore((s) => s.useStayDurationPriority);
  const isAdmin = isAdminFn();
  // 滞在時間の再評価用 tick（並び順が期待との差＝滞在按分に依存するため全員で張る）
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), STAY_TICK_MS);
    return () => clearInterval(id);
  }, []);
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
  const [editModalPlayer, setEditModalPlayer] = useState<{ id: string; name: string; gender?: 'M' | 'F'; excludeFromOperator?: boolean } | null>(null);
  // アコーディオンの開閉。null = ユーザー未操作（自動判定に委ねる）。
  // 未操作なら全員完了時に自動で開き、それ以外は既定で閉じる。ユーザーが一度
  // タップしたらその選択（override）を優先し、以降は allComplete の変化で
  // 上書きされない（下記 paidCollapsed の算出を参照）。
  const [paidCollapsedOverride, setPaidCollapsedOverride] = useState<boolean | null>(null);
  // 会費は「セッション保存値 → グローバル既定 → コード定数」の順に解決する
  const { fees: defaultFees } = useDefaultFees();
  const practiceDefaults = resolveFees(practiceType, defaultFees);
  const maleFee = session?.accounting?.maleFee ?? practiceDefaults.maleFee;
  const femaleFee = session?.accounting?.femaleFee ?? practiceDefaults.femaleFee;

  // 試合履歴に登場するプレイヤーIDのセット
  const playersInHistory = new Set(
    matchHistory.flatMap((match) => [...match.teamA, ...match.teamB])
  );

  // 試合数の統計と滞在時間。滞在はアルゴリズムの resolveStayStart と同じ起点
  const gamesStats = computeGamesStats(players);
  const stayStats = computeStayStats(
    players,
    session?.config.practiceStartTime ?? 0,
    now,
    resolvePracticeEndTime(session?.config),
  );

  // 期待試合数と実績との差。並び順（全員共通）に使い、数値の表示は管理者のみ
  const expectedById = computeExpectedGames(players, useStayDurationPriority ? 'stay' : 'count', stayStats.byId);

  // 期待との差が小さい順（足りていない人が上）。本人は常に最上部へ固定し others から除外する
  const { self: selfPlayer, others: sortedPlayers } = sortPlayersByExpectedDiff(players, expectedById, currentUser);

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

  const handleEdit = (player: { id: string; name: string; gender?: 'M' | 'F'; excludeFromOperator?: boolean }) => {
    setEditModalPlayer({
      id: player.id,
      name: player.name,
      gender: player.gender,
      excludeFromOperator: player.excludeFromOperator,
    });
  };

  const handleEditSave = async (
    name: string,
    gender?: 'M' | 'F',
    rating?: number,
    excludeFromOperator?: boolean,
  ) => {
    if (!editModalPlayer) return;
    const oldName = editModalPlayer.name;
    const updates: { name: string; gender?: 'M' | 'F'; rating?: number; excludeFromOperator?: boolean } = { name, gender };
    if (rating !== undefined) updates.rating = rating;
    // 担当外は管理者だけが変えられる（非管理者にはトグルが出ないので値を触らない）。
    // OFF は false を書く（undefined は sanitize で落ちて更新されないため）
    if (isAdmin && excludeFromOperator !== undefined) updates.excludeFromOperator = excludeFromOperator;
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
    // 期待試合数・滞在時間（全員に表示。滞在は滞在時間モードのみ）
    const expectedInfo = expectedById.get(player.id);
    const stay = useStayDurationPriority ? stayStats.byId.get(player.id) : undefined;
    return (
      <div
        key={player.id}
        className="bg-card border border-border rounded-xl px-3 py-2 shadow-sm"
      >
        <div className="flex items-center gap-2">
          {/* 2段構成。1段目: 性別・名前・編集/削除 | N試合、2段目: 滞在 | 期待（N試合の真下）。文字は 11px 統一 */}
          {/* 段ごとに独立した flex にする（grid だと右列幅が広い「期待」に引っ張られ1段目の名前幅が削られるため） */}
          <div className="flex-1 min-w-0 flex flex-col gap-0.5 text-[11px] leading-tight tabular-nums">
            <div className="flex items-center gap-2">
              {/* 1段目左: 性別・名前・編集/削除（名前は残り幅で truncate） */}
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
                {/* 編集 / 削除（名前のすぐ右。どちらも無ければ出さない） */}
                {(canEdit || (!hasHistory && canDelete)) && (
                  <div className="flex items-center gap-1 flex-shrink-0">
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
                )}
              </div>
              {/* 1段目右: N試合 */}
              <span className="flex-shrink-0 text-right whitespace-nowrap text-foreground">{player.gamesPlayed}試合</span>
            </div>
            <div className="flex items-center gap-2">
              {/* 2段目左: 滞在（滞在時間モードのみ。未完了は「—（未完了）」） */}
              <span className="whitespace-nowrap text-muted-foreground">
                {stay &&
                  (stay.complete
                    ? `滞在 ${formatStayMinutes(stay.minutes)}${stay.percent !== null ? ` (${stay.percent}%)` : ''}`
                    : '滞在 —（未完了）')}
              </span>
              {/* 2段目右: 期待（差の色分け） */}
              <span
                className={`ml-auto text-right whitespace-nowrap ${
                  expectedInfo && expectedInfo.diff !== null ? EXPECTED_DIFF_TONE_CLASS[expectedDiffTone(expectedInfo.diff)] : ''
                }`}
              >
                {expectedInfo &&
                  expectedInfo.expected !== null &&
                  expectedInfo.diff !== null &&
                  `期待 ${formatExpected(expectedInfo.expected)} (${formatDiff(expectedInfo.diff)})`}
              </span>
            </div>
          </div>

          {/* 右カラム: 支払 / 名簿 ボタンを縦並び */}
          <div className="flex flex-col gap-0.5 flex-shrink-0 self-center">
            <button
              onClick={() => handlePaymentClick(player.id)}
              className="w-12 h-4 text-[10px] leading-none rounded-md transition-colors flex items-center justify-center"
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
              className="w-12 h-4 text-[10px] leading-none rounded-md transition-colors flex items-center justify-center disabled:opacity-50"
              style={{
                backgroundColor: status.roster ? '#10b981' : '#e5e7eb',
                color: status.roster ? '#ffffff' : '#6b7280',
              }}
            >
              {status.roster ? '✓' : ''}名簿
            </button>
          </div>

        </div>
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
        {/* 本人は完了/未完了・アコーディオンに関わらず常に最上部 */}
        {selfPlayer && renderPlayerCard(selfPlayer)}

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
          <div className="flex items-start gap-2 mb-4">
            {/* 左: 「参加者」と内訳は同じ行。内訳が収まらないときだけ括弧ごと次行へ送る（途中では割らない） */}
            <div className="min-w-0 flex flex-wrap items-center gap-x-2">
              <h2 className="section-title h-7 flex items-center">参加者</h2>
              <span className="h-7 flex items-center text-sm font-normal text-muted-foreground whitespace-nowrap">
                ({formatGenderBreakdown(genderBreakdown)})
              </span>
            </div>
            {/* 現在の割り振りモード（全員に表示）。1行目の高さを見出しと揃え、補足は右寄せの2行目 */}
            <div className="ml-auto flex-shrink-0 flex flex-col items-end gap-0.5">
              <span
                className="px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap my-1.5"
                style={
                  useStayDurationPriority
                    ? { backgroundColor: '#e0e7ff', color: '#3730a3' }
                    : { backgroundColor: '#d1fae5', color: '#065f46' }
                }
              >
                {useStayDurationPriority ? '滞在時間モード' : '回数平均モード'}
              </span>
              <span className="text-[10px] leading-tight text-muted-foreground whitespace-nowrap">
                {useStayDurationPriority ? '滞在時間で試合数を調整' : '試合回数が少ない人を優先'}
              </span>
            </div>
          </div>
          {gamesStats && (
            <div className="mb-3 rounded-lg bg-muted px-3 py-1.5 text-[11px] text-muted-foreground tabular-nums flex flex-wrap gap-x-3 gap-y-0.5">
              <span>最大 {gamesStats.max}試合</span>
              <span>最小 {gamesStats.min}試合</span>
              <span>中央値 {formatMedian(gamesStats.median)}試合</span>
              {useStayDurationPriority && stayStats.maxMinutes > 0 && <span>最長滞在 {formatStayMinutes(stayStats.maxMinutes)}</span>}
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
          playerExcludeFromOperator={editModalPlayer.excludeFromOperator}
          isAdmin={isAdmin}
          existingNames={players.filter(p => p.id !== editModalPlayer.id).map(p => p.name)}
          onSave={handleEditSave}
          onCancel={() => setEditModalPlayer(null)}
        />
      )}

      <BottomNav activeTab="players" />
    </div>
  );
}
