import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGameStore } from '../stores/gameStore';
import { usePlayerStore } from '../stores/playerStore';
import { useSessionStore } from '../stores/sessionStore';
import { useSettingsStore } from '../stores/settingsStore';
import { formatTime, copyToClipboard } from '../lib/utils';
import { sendMatchesToSheets } from '../lib/sheetsApi';
import { ArrowLeft, Copy, Trash2, Edit3, Clock, Upload, Loader2 } from 'lucide-react';
import { useToast } from '../hooks/useToast';
import { Toast } from '../components/Toast';
import { EmptyState } from '../components/EmptyState';

export function HistoryPage() {
  const navigate = useNavigate();
  const { matchHistory, deleteMatch } = useGameStore();
  const { players } = usePlayerStore();
  const session = useSessionStore((state) => state.session);
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
    <div className="bg-app pb-20">
      {/* ヘッダー */}
      <div className="header-gradient text-gray-800 p-3">
        <div className="max-w-6xl mx-auto flex items-center gap-3">
          <button
            onClick={() => navigate('/main')}
            aria-label="戻る"
            className="icon-btn"
          >
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-lg font-bold flex-1">試合履歴</h1>
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

      <div className="max-w-6xl mx-auto p-4">
        {/* 試合履歴 */}
        <div className="card p-6">
          {matchHistory.length === 0 ? (
            <EmptyState
              icon="🏸"
              title="まだ試合がありません"
              description="メイン画面でゲームを開始すると、ここに履歴が表示されます。"
            />
          ) : (
            <div className="space-y-3">
              {[...matchHistory].reverse().map((match, reverseIndex) => {
                const matchNumber = matchHistory.length - reverseIndex;
                const duration = Math.round((match.finishedAt - match.startedAt) / 60000);
                
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
                    className="bg-gradient-to-r from-gray-50 to-slate-50 rounded-xl p-4 border border-gray-100"
                  >
                    <div className="flex items-center gap-3">
                      {/* 試合番号 */}
                      <span className="text-sm font-bold text-indigo-600 bg-indigo-100 w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0">
                        {matchNumber}
                      </span>

                      {/* メイン情報 */}
                      <div className="flex-1 min-w-0">
                        {/* 名前（横一列・改行なし） */}
                        <div className="flex items-center text-sm mb-1.5 gap-2 overflow-x-auto scrollbar-hide">
                          <span className="font-bold text-gray-800 whitespace-nowrap">
                            {leftNames}
                          </span>
                          <span className="text-gray-400 font-bold text-xs px-2 bg-white rounded-full py-0.5 flex-shrink-0">VS</span>
                          <span className="text-gray-600 whitespace-nowrap">
                            {rightNames}
                          </span>
                        </div>
                        
                        {/* 時間・スコア（横一列・改行なし） */}
                        <div className="flex items-center gap-2 text-xs text-gray-500">
                          <span className="flex items-center gap-1 whitespace-nowrap">
                            <Clock size={12} />
                            {formatTime(match.finishedAt)}
                          </span>
                          <span className="whitespace-nowrap">({duration}分)</span>
                          <span className="text-base font-bold text-gray-800 bg-white px-3 py-0.5 rounded-full shadow-sm whitespace-nowrap">
                            {leftScore} - {rightScore}
                          </span>
                        </div>
                      </div>

                      {/* 編集・削除ボタン（縦並び） */}
                      <div className="flex flex-col gap-1 flex-shrink-0">
                        <button
                          onClick={() => handleEdit(match.id)}
                          aria-label="編集"
                          className="p-2 text-gray-400 hover:text-indigo-500 hover:bg-indigo-50 active:bg-indigo-100 active:scale-[0.98] rounded-full transition-all duration-150 min-w-[40px] min-h-[40px] flex items-center justify-center"
                        >
                          <Edit3 size={16} />
                        </button>
                        <button
                          onClick={() => handleDelete(match.id)}
                          aria-label="削除"
                          className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 active:bg-red-100 active:scale-[0.98] rounded-full transition-all duration-150 min-w-[40px] min-h-[40px] flex items-center justify-center"
                        >
                          <Trash2 size={16} />
                        </button>
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
    </div>
  );
}
