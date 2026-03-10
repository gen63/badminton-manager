import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGameStore } from '../stores/gameStore';
import { usePlayerStore } from '../stores/playerStore';
import { useSessionStore } from '../stores/sessionStore';
import { useSettingsStore } from '../stores/settingsStore';
import { formatTime, copyToClipboard } from '../lib/utils';
import { sendMatchesToSheets } from '../lib/sheetsApi';
import { Copy, Trash2, Edit3, Clock, Upload, Loader2, History } from 'lucide-react';
import { useToast } from '../hooks/useToast';
import { Toast } from '../components/Toast';
import { EmptyState } from '../components/EmptyState';
import { BottomNav } from '../components/BottomNav';

export function HistoryPage() {
  const navigate = useNavigate();
  const { matchHistory, deleteMatch } = useGameStore();
  const { players } = usePlayerStore();
  const { session, isCreator } = useSessionStore();
  const isAdmin = isCreator();
  const { gasWebAppUrl } = useSettingsStore();
  const toast = useToast();
  const [isUploading, setIsUploading] = useState(false);
  const getPlayerName = (playerId: string) => {
    return players.find((p) => p.id === playerId)?.name || '不明';
  };

  const handleEdit = (matchId: string) => {
    navigate(`/score/${matchId}`, { state: { from: '/history' } });
  };

  const handleDelete = (matchId: string) => {
    deleteMatch(matchId);
  };

  const handleCopyHistory = async () => {
    const dateStr = session?.config.practiceDate || new Date().toISOString().slice(0, 10);
    const gymName = session?.config.gym || '';

    let text = '日付,場所,A選手1,A選手2,B選手1,B選手2,スコアA,スコアB,試合時間\n';
    matchHistory.forEach((match) => {
      const [a1, a2] = match.teamA.map(getPlayerName);
      const [b1, b2] = match.teamB.map(getPlayerName);
      const duration = Math.round((match.finishedAt - match.startedAt) / 60000);
      text += `${dateStr},${gymName},${a1},${a2},${b1},${b2},${match.scoreA},${match.scoreB},${duration}\n`;
    });

    const success = await copyToClipboard(text);
    if (!success) {
      toast.error('コピーに失敗しました');
    }
  };

  const handleUpload = async () => {
    if (!session || !gasWebAppUrl || isUploading) return;
    setIsUploading(true);
    try {
      const result = await sendMatchesToSheets(
        gasWebAppUrl,
        matchHistory,
        players,
        session
      );
      if (result.success) {
        toast.success(result.message);
      } else {
        toast.error(result.message);
      }
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="bg-app pb-[calc(60px+env(safe-area-inset-bottom)+1rem)]">
      {/* ヘッダー */}
      <div className="header-gradient text-foreground p-3">
        <div className="max-w-6xl mx-auto flex items-center gap-3">
          <div className="flex items-center gap-2 flex-1">
            <History size={20} />
            <h1 className="text-lg font-bold">試合履歴</h1>
          </div>
          {gasWebAppUrl && (
            <button
              onClick={handleUpload}
              disabled={isUploading || matchHistory.length === 0}
              aria-label="Sheetsにアップロード"
              className="icon-btn disabled:opacity-50"
            >
              {isUploading ? <Loader2 size={20} className="animate-spin" /> : <Upload size={20} />}
            </button>
          )}
          <button
            onClick={handleCopyHistory}
            aria-label="コピー"
            className="icon-btn"
            disabled={matchHistory.length === 0}
          >
            <Copy size={20} />
          </button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 pt-2 pb-4">
        {/* 試合履歴 */}
        <div className="card p-4">
          {matchHistory.length === 0 ? (
            <EmptyState
              icon="🏸"
              title="まだ試合がありません"
              description="メイン画面でゲームを開始すると、ここに履歴が表示されます。"
            />
          ) : (
            <div className="space-y-2">
              {[...matchHistory].reverse().map((match, reverseIndex) => {
                const matchNumber = matchHistory.length - reverseIndex;
                const duration = Math.round((match.finishedAt - match.startedAt) / 60000);
                const isNoScore = match.scoreA === 0 && match.scoreB === 0 && !match.winner;

                // 勝ちペアを左に、スコアの高い方を左に
                const isTeamAWinner = match.winner === 'A';
                const leftTeam = isTeamAWinner ? match.teamA : match.teamB;
                const rightTeam = isTeamAWinner ? match.teamB : match.teamA;
                const leftScore = isTeamAWinner ? match.scoreA : match.scoreB;
                const rightScore = isTeamAWinner ? match.scoreB : match.scoreA;

                const leftNames = leftTeam.map(getPlayerName).join(' ');
                const rightNames = rightTeam.map(getPlayerName).join(' ');

                return (
                  <div
                    key={match.id}
                    className={`rounded-lg p-2 border ${isNoScore ? 'bg-orange-50 border-orange-300' : 'bg-gradient-to-r from-gray-50 to-slate-50 border-gray-100'}`}
                  >
                    <div className="flex items-center gap-2">
                      {/* 試合番号 */}
                      <span className="text-xs font-bold text-indigo-600 bg-indigo-100 w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0">
                        {matchNumber}
                      </span>

                      {/* メイン情報 */}
                      <div className="flex-1 min-w-0 space-y-0.5">
                        {/* 名前（横一列・改行なし） */}
                        <div className="flex items-center text-sm gap-1.5 leading-tight">
                          <span className="font-bold text-foreground whitespace-nowrap flex-shrink-0">
                            {leftNames}
                          </span>
                          <span className="text-muted-foreground font-bold text-[10px] px-1.5 bg-card rounded-full py-0.5 flex-shrink-0">VS</span>
                          <span className="text-muted-foreground truncate">
                            {rightNames}
                          </span>
                        </div>
                        
                        {/* 時間・スコア（横一列・改行なし） */}
                        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground leading-tight">
                          <span className="flex items-center gap-0.5 whitespace-nowrap">
                            <Clock size={11} />
                            {formatTime(match.finishedAt)}
                          </span>
                          <span className="whitespace-nowrap">({duration}分)</span>
                          {isNoScore ? (
                            <span className="text-xs font-bold text-orange-600 bg-orange-100 px-2 py-0.5 rounded-full whitespace-nowrap">
                              未入力
                            </span>
                          ) : (
                            <span className="text-xs font-bold text-foreground bg-card px-2 py-0.5 rounded-full shadow-sm whitespace-nowrap">
                              {leftScore} - {rightScore}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* 編集・削除ボタン（横並び） */}
                      <div className="flex gap-0.5 flex-shrink-0">
                        <button
                          onClick={() => handleEdit(match.id)}
                          aria-label="編集"
                          className="p-1.5 text-muted-foreground hover:text-indigo-500 hover:bg-indigo-50 active:bg-indigo-100 active:scale-[0.98] rounded-full transition-all duration-150 min-w-[44px] min-h-[44px] flex items-center justify-center"
                        >
                          <Edit3 size={13} />
                        </button>
                        {isAdmin && (
                          <button
                            onClick={() => handleDelete(match.id)}
                            aria-label="削除"
                            className="p-1.5 text-muted-foreground hover:text-red-500 hover:bg-red-50 active:bg-red-100 active:scale-[0.98] rounded-full transition-all duration-150 min-w-[44px] min-h-[44px] flex items-center justify-center"
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Toast notifications */}
      {toast.toasts.map((t) => (
        <Toast
          key={t.id}
          message={t.message}
          type={t.type}
          onClose={() => toast.hideToast(t.id)}
        />
      ))}

      <BottomNav activeTab="history" />
    </div>
  );
}
