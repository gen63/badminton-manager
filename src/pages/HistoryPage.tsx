import { useNavigate } from 'react-router-dom';
import { useGameStore } from '../stores/gameStore';
import { usePlayerStore } from '../stores/playerStore';
import { formatTime, copyToClipboard } from '../lib/utils';
import { ArrowLeft, Copy, Trash2, Edit3 } from 'lucide-react';
import { useToast } from '../hooks/useToast';
import { Toast } from '../components/Toast';
import { EmptyState } from '../components/EmptyState';

export function HistoryPage() {
  const navigate = useNavigate();
  const { matchHistory, deleteMatch } = useGameStore();
  const { players } = usePlayerStore();
  const toast = useToast();
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
    const today = new Date();
    const dateStr = `${today.getFullYear()}/${String(today.getMonth() + 1).padStart(2, '0')}/${String(today.getDate()).padStart(2, '0')}`;
    
    let text = `${dateStr}\n`;
    matchHistory.forEach((match, index) => {
      const teamANames = match.teamA.map(getPlayerName).join(' ');
      const teamBNames = match.teamB.map(getPlayerName).join(' ');
      text += `${index + 1} ${teamANames} ${match.scoreA}-${match.scoreB} ${teamBNames}\n`;
    });

    const success = await copyToClipboard(text);
    if (!success) {
      toast.error('コピーに失敗しました');
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 pb-20">
      {/* ヘッダー */}
      <div className="bg-white p-4 shadow-sm">
        <div className="max-w-6xl mx-auto flex items-center gap-3">
          <button
            onClick={() => navigate('/main')}
            aria-label="戻る"
            className="p-3 hover:bg-gray-100 active:bg-gray-200 active:scale-[0.98] rounded-full transition-all duration-150 min-w-[44px] min-h-[44px] flex items-center justify-center"
          >
            <ArrowLeft size={24} className="text-gray-600" />
          </button>
          <h1 className="text-base font-medium text-gray-600 flex-1">試合履歴</h1>
          <button
            onClick={handleCopyHistory}
            aria-label="コピー"
            className="p-3 bg-gray-100 rounded-full hover:bg-gray-200 active:bg-gray-300 active:scale-[0.98] transition-all duration-150 min-w-[44px] min-h-[44px] flex items-center justify-center"
          >
            <Copy size={20} className="text-gray-600" />
          </button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto p-4">
        {/* 試合履歴 */}
        <div className="bg-white rounded-2xl shadow-sm p-4">
          {matchHistory.length === 0 ? (
            <EmptyState
              icon="🏸"
              title="まだ試合がありません"
              description="メイン画面でゲームを開始すると、ここに履歴が表示されます。"
              action={{
                label: 'メイン画面へ',
                onClick: () => navigate('/main'),
              }}
            />
          ) : (
            <div className="space-y-2">
              {[...matchHistory].reverse().map((match, reverseIndex) => {
                const matchNumber = matchHistory.length - reverseIndex;
                const teamANames = match.teamA.map(getPlayerName).join(' ');
                const teamBNames = match.teamB.map(getPlayerName).join(' ');
                const duration = Math.round((match.finishedAt - match.startedAt) / 60000);
                
                return (
                  <div
                    key={match.id}
                    className="bg-gray-50 rounded-xl p-3"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-start gap-3 flex-1 min-w-0">
                        <span className="text-sm font-medium text-gray-400 w-6 flex-shrink-0">
                          {matchNumber}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm mb-1">
                            <span className={match.winner === 'A' ? 'font-semibold text-gray-800' : 'text-gray-600'}>
                              {teamANames}
                            </span>
                            <span className="text-gray-400 mx-2">vs</span>
                            <span className={match.winner === 'B' ? 'font-semibold text-gray-800' : 'text-gray-600'}>
                              {teamBNames}
                            </span>
                          </div>
                          <div className="flex items-center text-xs text-gray-500 gap-2">
                            <span>{formatTime(match.finishedAt)}</span>
                            <span>({duration}分)</span>
                            <span className="text-gray-700 font-semibold">
                              {match.scoreA}-{match.scoreB}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0 ml-2">
                        <button
                          onClick={() => handleEdit(match.id)}
                          aria-label="編集"
                          className="p-2.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 active:bg-blue-100 active:scale-[0.98] rounded-full transition-all duration-150 min-w-[44px] min-h-[44px] flex items-center justify-center"
                        >
                          <Edit3 size={18} />
                        </button>
                        <button
                          onClick={() => handleDelete(match.id)}
                          aria-label="削除"
                          className="p-2.5 text-gray-400 hover:text-red-500 hover:bg-red-50 active:bg-red-100 active:scale-[0.98] rounded-full transition-all duration-150 min-w-[44px] min-h-[44px] flex items-center justify-center"
                        >
                          <Trash2 size={18} />
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
