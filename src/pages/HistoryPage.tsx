import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGameStore } from '../stores/gameStore';
import { usePlayerStore } from '../stores/playerStore';
import { calculatePlayerStats } from '../lib/algorithm';
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
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const lastTapRef = useRef<{ matchId: string; time: number } | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);

  const stats = calculatePlayerStats(players, matchHistory);
  const sortedStats = [...stats].sort((a, b) => b.gamesPlayed - a.gamesPlayed);

  const getPlayerName = (playerId: string) => {
    return players.find((p) => p.id === playerId)?.name || '不明';
  };

  const handleMatchClick = (matchId: string) => {
    if (isEditMode) return; // 編集モード中はクリック無効
    
    const now = Date.now();
    const last = lastTapRef.current;

    if (last && last.matchId === matchId && now - last.time < 500) {
      // ダブルタップ → スコア編集へ
      lastTapRef.current = null;
      navigate(`/score/${matchId}`);
    } else {
      // シングルタップ → 記録
      lastTapRef.current = { matchId, time: now };
    }
  };

  const handleDeleteClick = (matchId: string) => {
    setDeleteConfirmId(matchId);
  };

  const handleDeleteConfirm = () => {
    if (deleteConfirmId) {
      deleteMatch(deleteConfirmId);
      setDeleteConfirmId(null);
    }
  };

  const handleDeleteCancel = () => {
    setDeleteConfirmId(null);
  };

  const handleToggleEditMode = () => {
    setIsEditMode(!isEditMode);
    if (isEditMode) {
      // 編集モード終了時は削除確認ダイアログも閉じる
      setDeleteConfirmId(null);
    }
  };

  const handleCopyHistory = async () => {
    let text = '=== 試合履歴 ===\n\n';
    matchHistory.forEach((match, index) => {
      const teamANames = match.teamA.map(getPlayerName).join(' / ');
      const teamBNames = match.teamB.map(getPlayerName).join(' / ');
      text += `試合 ${index + 1}\n`;
      text += `${teamANames} ${match.scoreA} - ${match.scoreB} ${teamBNames}\n`;
      text += `勝者: チーム ${match.winner}\n`;
      text += `時刻: ${formatTime(match.finishedAt)}\n\n`;
    });

    text += '\n=== 統計 ===\n\n';
    sortedStats.forEach((stat) => {
      text += `${stat.name}: ${stat.gamesPlayed}試合 ${stat.wins}勝${stat.losses}敗 (${stat.points}点)\n`;
    });

    const success = await copyToClipboard(text);
    if (!success) {
      toast.error('コピーに失敗しました');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      {/* ヘッダー */}
      <div className="bg-blue-600 text-white p-4 shadow-lg">
        <div className="max-w-6xl mx-auto flex items-center gap-4">
          <button
            onClick={() => navigate('/main')}
            className="p-2 hover:bg-blue-700 rounded-lg transition"
          >
            <ArrowLeft size={24} />
          </button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold">試合履歴</h1>
          </div>
          {matchHistory.length > 0 && (
            <button
              onClick={handleToggleEditMode}
              className="px-3 py-2 bg-blue-700 rounded-lg hover:bg-blue-800 transition text-sm font-semibold flex items-center gap-1"
            >
              {isEditMode ? (
                '完了'
              ) : (
                <>
                  <Edit3 size={18} />
                  編集
                </>
              )}
            </button>
          )}
          <button
            onClick={handleCopyHistory}
            className="p-2 bg-blue-700 rounded-lg hover:bg-blue-800 transition"
          >
            <Copy size={24} />
          </button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto p-4 space-y-6">
        {/* 試合履歴 */}
        <div className="bg-white rounded-lg shadow-lg p-6">
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
            <div className="space-y-3">
              {[...matchHistory].reverse().map((match) => {
                const teamANames = match.teamA.map(getPlayerName).join(' ');
                const teamBNames = match.teamB.map(getPlayerName).join(' ');

                const duration = Math.round((match.finishedAt - match.startedAt) / 60000);
                
                return (
                  <div
                    key={match.id}
                    className="border border-gray-200 rounded-lg bg-white p-3 hover:bg-gray-50 transition"
                  >
                    <div 
                      onClick={() => handleMatchClick(match.id)}
                      className={isEditMode ? '' : 'cursor-pointer'}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <div className="text-sm flex-1">
                          <span className={match.winner === 'A' ? 'font-bold text-blue-600' : 'text-gray-700'}>
                            {teamANames}
                          </span>
                          <span className="text-gray-400 mx-2">vs</span>
                          <span className={match.winner === 'B' ? 'font-bold text-red-600' : 'text-gray-700'}>
                            {teamBNames}
                          </span>
                        </div>
                        {isEditMode && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteClick(match.id);
                            }}
                            className="p-2 text-red-500 hover:bg-red-50 rounded transition active:bg-red-100 flex-shrink-0"
                          >
                            <Trash2 size={20} />
                          </button>
                        )}
                      </div>
                      <div className="flex items-center text-xs text-gray-500">
                        <span>{formatTime(match.finishedAt)}</span>
                        <span className="mx-3">{duration}分</span>
                        <span className="text-gray-700 font-semibold">
                          ({match.scoreA}-{match.scoreB})
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* 削除確認ダイアログ */}
      {deleteConfirmId && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
          onClick={handleDeleteCancel}
        >
          <div 
            className="bg-white rounded-lg shadow-xl max-w-sm w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-gray-800 mb-2">
              試合を削除しますか？
            </h3>
            <p className="text-sm text-gray-600 mb-6">
              この操作は取り消せません。
            </p>
            <div className="flex gap-3">
              <button
                onClick={handleDeleteCancel}
                className="flex-1 py-3 bg-gray-200 text-gray-800 rounded-lg font-semibold hover:bg-gray-300 transition active:bg-gray-400 touch-manipulation"
              >
                キャンセル
              </button>
              <button
                onClick={handleDeleteConfirm}
                className="flex-1 py-3 bg-red-600 text-white rounded-lg font-semibold hover:bg-red-700 transition active:bg-red-800 touch-manipulation"
              >
                削除
              </button>
            </div>
          </div>
        </div>
      )}

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
