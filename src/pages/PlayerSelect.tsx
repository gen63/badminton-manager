import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePlayerStore } from '../stores/playerStore';
import { useGameStore } from '../stores/gameStore';
import { useAccountingStore } from '../stores/accountingStore';
import { buildInitialOrder, applyStreakSwaps } from '../lib/algorithm';
import { parsePlayerInput } from '../lib/utils';
import { useToast } from '../hooks/useToast';
import { Toast } from '../components/Toast';
import { Trash2, UserPlus, Users, ArrowRight } from 'lucide-react';
import { useSessionStore } from '../stores/sessionStore';
import { BottomNav } from '../components/BottomNav';
import { PaymentModal } from '../components/PaymentModal';

export function PlayerSelect() {
  const navigate = useNavigate();
  const { players, addPlayers, removePlayer, toggleOperationStatus, setPaymentAmount } = usePlayerStore();
  const { matchHistory } = useGameStore();
  const { session, isCreator } = useSessionStore();
  const isTabMode = !!session;
  const isAdmin = isCreator();
  const [newPlayerNames, setNewPlayerNames] = useState('');
  const toast = useToast();
  const [paymentModalPlayer, setPaymentModalPlayer] = useState<{ id: string; name: string; defaultAmount: number } | null>(null);
  const accountingStore = useAccountingStore();
  const maleFee = accountingStore.lastInput?.maleFee || 800;
  const femaleFee = accountingStore.lastInput?.femaleFee || 600;

  // 試合履歴に登場するプレイヤーIDのセット
  const playersInHistory = new Set(
    matchHistory.flatMap((match) => [...match.teamA, ...match.teamB])
  );

  // 動的序列でソート（弱い順 = 序列の逆順）
  const dynamicOrder = applyStreakSwaps(buildInitialOrder(players), matchHistory, 3);
  const sortedPlayers = [...players].sort((a, b) => {
    const aIdx = dynamicOrder.indexOf(a.id);
    const bIdx = dynamicOrder.indexOf(b.id);
    const aPos = aIdx === -1 ? Infinity : aIdx;
    const bPos = bIdx === -1 ? Infinity : bIdx;
    return bPos - aPos;
  });

  const handleAddPlayers = () => {
    if (newPlayerNames.trim()) {
      // 改行で分割して、パース
      const inputs = newPlayerNames
        .split('\n')
        .map(line => parsePlayerInput(line))
        .filter((input): input is { name: string; rating?: number; gender?: 'M' | 'F' } => input !== null);

      if (inputs.length > 0) {
        const result = addPlayers(inputs);
        if (result.skipped.length > 0) {
          toast.warning(`重複スキップ: ${result.skipped.join('、')}`);
        }
        setNewPlayerNames('');
      }
    }
  };

  const handleContinue = () => {
    navigate('/settings');
  };

  const handleDelete = (player: { id: string; name: string }) => {
    if (playersInHistory.has(player.id)) {
      toast.warning(`${player.name}は試合履歴があるため削除できません`);
      return;
    }
    removePlayer(player.id);
  };

  const handlePaymentClick = (playerId: string) => {
    const player = players.find(p => p.id === playerId);
    if (!player) return;

    // デフォルト金額を計算（会計設定から）
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

  const handlePaymentConfirm = (amount: number) => {
    if (!paymentModalPlayer) return;
    
    // 金額を保存
    setPaymentAmount(paymentModalPlayer.id, amount);
    
    // 支払い完了フラグをON
    toggleOperationStatus(paymentModalPlayer.id, 'payment');
    
    setPaymentModalPlayer(null);
  };

  const renderPlayerList = () => (
    <>
      {players.length === 0 ? (
        <div className="text-center py-10">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-muted mb-3">
            <Users size={24} className="text-muted-foreground" />
          </div>
          <p className="text-muted-foreground text-sm">
            まだ参加者が登録されていません
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {sortedPlayers.map((player) => {
            const hasHistory = playersInHistory.has(player.id);
            const status = player.operationStatus || { payment: false, roster: false, checkin: false };
            return (
              <div
                key={player.id}
                className="bg-card border border-border rounded-xl px-3 py-2 flex items-center gap-2 shadow-sm"
              >
                {/* 名前 (40%) */}
                <div className="flex-[2] flex items-center gap-2">
                  <span className="text-sm font-semibold text-foreground truncate">{player.name}</span>
                  {!hasHistory && (isTabMode ? isAdmin : true) && (
                    <button
                      onClick={() => handleDelete(player)}
                      aria-label={`${player.name}を削除`}
                      className="w-5 h-5 rounded-full flex items-center justify-center bg-red-100 text-red-600 hover:bg-red-200 transition-colors flex-shrink-0"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
                
                {/* チェックボックス (各20%) */}
                <button
                  onClick={() => handlePaymentClick(player.id)}
                  className="flex-1 text-xs py-1 px-2 rounded-lg transition-colors flex items-center justify-center gap-1"
                  style={{
                    backgroundColor: status.payment ? '#10b981' : '#e5e7eb',
                    color: status.payment ? '#ffffff' : '#6b7280',
                  }}
                >
                  {status.payment ? '✓' : ''}支払
                </button>
                <button
                  onClick={() => toggleOperationStatus(player.id, 'roster')}
                  className="flex-1 text-xs py-1 px-2 rounded-lg transition-colors flex items-center justify-center gap-1"
                  style={{
                    backgroundColor: status.roster ? '#10b981' : '#e5e7eb',
                    color: status.roster ? '#ffffff' : '#6b7280',
                  }}
                >
                  {status.roster ? '✓' : ''}名簿
                </button>
                <button
                  onClick={() => toggleOperationStatus(player.id, 'checkin')}
                  className="flex-1 text-xs py-1 px-2 rounded-lg transition-colors flex items-center justify-center gap-1"
                  style={{
                    backgroundColor: status.checkin ? '#10b981' : '#e5e7eb',
                    color: status.checkin ? '#ffffff' : '#6b7280',
                  }}
                >
                  {status.checkin ? '✓' : ''}チェックイン
                </button>
              </div>
            );
          })}
        </div>
      )}
    </>
  );

  // タブモード: 他ページと統一されたレイアウト
  if (isTabMode) {
    return (
      <div className="bg-app pb-20">
        {/* ヘッダー */}
        <div className="header-gradient text-foreground p-3">
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

        <BottomNav activeTab="players" />
      </div>
    );
  }

  // セットアップモード: 従来のレイアウト
  return (
    <div className="bg-app">
      <div className="max-w-2xl mx-auto px-5 py-8">
        {/* ヘッダー */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500 to-indigo-600 shadow-button mb-4">
            <Users size={28} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">
            参加者を追加
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            現在: <span className="font-semibold text-indigo-600">{players.length}人</span>
          </p>
        </div>

        {/* プレイヤー追加フォーム */}
        <div className="card p-6 mb-4">
          <label className="label">
            名前を入力（1行に1人、複数行で一度に追加できます）
            <span className="block text-xs text-muted-foreground mt-0.5">例: 田中  男</span>
          </label>
          <div className="space-y-3">
            <textarea
              value={newPlayerNames}
              onChange={(e) => setNewPlayerNames(e.target.value)}
              placeholder="星野真吾  男&#10;佐野朋美  女&#10;山口裕史"
              rows={6}
              className="textarea-field"
            />
            <button
              onClick={handleAddPlayers}
              disabled={!newPlayerNames.trim()}
              className="btn-primary w-full flex items-center justify-center gap-2"
            >
              <UserPlus size={18} />
              追加
            </button>
          </div>
        </div>

        {/* プレイヤーリスト */}
        <div className="card p-6 mb-4">
          <h2 className="section-title mb-4">
            参加者一覧
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              ({players.length}人)
            </span>
          </h2>
          {renderPlayerList()}
        </div>

        {/* 完了ボタン */}
        <button
          onClick={handleContinue}
          className="btn-primary w-full flex items-center justify-center gap-2"
        >
          完了
          <ArrowRight size={18} />
        </button>
      </div>
      {/* トースト通知 */}
      <div className="fixed bottom-20 left-0 right-0 z-50 flex flex-col items-center gap-2 pointer-events-none">
        {toast.toasts.map((t) => (
          <Toast key={t.id} message={t.message} type={t.type} onClose={() => toast.hideToast(t.id)} />
        ))}
      </div>
    </div>
  );
}
