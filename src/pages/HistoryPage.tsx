import { useNavigate } from 'react-router-dom';
import { useGameStore } from '../stores/gameStore';
import { usePlayerStore } from '../stores/playerStore';
import { useSessionStore } from '../stores/sessionStore';
import { formatTime, copyToClipboard } from '../lib/utils';
import { ArrowLeft, Copy, Trash2, Edit3, Clock } from 'lucide-react';
import { useToast } from '../hooks/useToast';
import { Toast } from '../components/Toast';
import { EmptyState } from '../components/EmptyState';

export function HistoryPage() {
  const navigate = useNavigate();
  const { matchHistory, deleteMatch } = useGameStore();
  const { players } = usePlayerStore();
  const session = useSessionStore((state) => state.session);
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
                const teamANames = match.teamA.map(getPlayerName).join(' ');
                const teamBNames = match.teamB.map(getPlayerName).join(' ');
                const duration = Math.round((match.finishedAt - match.startedAt) / 60000);
                const isTeamAWinner = match.winner === 'A';
                const isTeamBWinner = match.winner === 'B';

                return (
                  <div
                    key={match.id}
                    className="bg-gradient-to-r from-gray-50 to-slate-50 rounded-xl p-4 border border-gray-100"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-start gap-3 flex-1 min-w-0">
                        <span className="text-sm font-bold text-indigo-600 bg-indigo-100 w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0">
                          {matchNumber}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="grid grid-cols-[1fr_auto_1fr] items-center text-sm mb-2 gap-2">
                            <span className={`truncate text-right ${isTeamAWinner ? 'font-bold text-gray-800' : 'text-gray-600'}`}>
                              {teamANames}
                            </span>
                            <span className="text-gray-400 font-bold text-xs px-2 bg-white rounded-full py-0.5">VS</span>
                            <span className={`truncate ${isTeamBWinner ? 'font-bold text-gray-800' : 'text-gray-600'}`}>
                              {teamBNames}
                            </span>
                          </div>
                          <div className="flex items-center justify-center gap-3 text-xs text-gray-500">
                            <span className="flex items-center gap-1">
                              <Clock size={12} />
                              {formatTime(match.finishedAt)}
                            </span>
                            <span>({duration}分)</span>
                            <span className="text-base font-bold text-gray-800 bg-white px-3 py-0.5 rounded-full shadow-sm">
                              {match.scoreA} - {match.scoreB}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0 ml-3">
                        <button
                          onClick={() => handleEdit(match.id)}
                          aria-label="編集"
                          className="p-2.5 text-gray-400 hover:text-indigo-500 hover:bg-indigo-50 active:bg-indigo-100 active:scale-[0.98] rounded-full transition-all duration-150 min-w-[44px] min-h-[44px] flex items-center justify-center"
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
