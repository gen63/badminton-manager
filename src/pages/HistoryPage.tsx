import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGameStore } from '../stores/gameStore';
import { usePlayerStore } from '../stores/playerStore';
import { calculatePlayerStats } from '../lib/algorithm';
import { formatTime, formatDuration, copyToClipboard } from '../lib/utils';
import { ArrowLeft, Copy, Trash2 } from 'lucide-react';
import { useToast } from '../hooks/useToast';
import { Toast } from '../components/Toast';
import { EmptyState } from '../components/EmptyState';

export function HistoryPage() {
  const navigate = useNavigate();
  const { matchHistory, deleteMatch } = useGameStore();
  const { players } = usePlayerStore();
  const toast = useToast();
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const tapTimeoutRef = useRef<number | null>(null);
  const tapCountRef = useRef<{ [key: string]: number }>({});

  const stats = calculatePlayerStats(players, matchHistory);
  const sortedStats = [...stats].sort((a, b) => b.gamesPlayed - a.gamesPlayed);

  const getPlayerName = (playerId: string) => {
    return players.find((p) => p.id === playerId)?.name || '不明';
  };

  const handleMatchClick = (matchId: string) => {
    const currentCount = tapCountRef.current[matchId] || 0;
    tapCountRef.current[matchId] = currentCount + 1;

    if (tapTimeoutRef.current) {
      clearTimeout(tapTimeoutRef.current);
    }

    if (tapCountRef.current[matchId] === 2) {
      // ダブルタップ → スコア編集へ
      tapCountRef.current[matchId] = 0;
      navigate(`/score/${matchId}`);
    } else {
      // シングルタップ → 300msでリセット
      tapTimeoutRef.current = setTimeout(() => {
        tapCountRef.current[matchId] = 0;
      }, 300);
    }
  };

  const handleDeleteClick = (matchId: string, e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setDeleteConfirmId(matchId);
  };

  const handleDeleteConfirm = () => {
    if (deleteConfirmId) {
      deleteMatch(deleteConfirmId);
      toast.success('試合を削除しました');
      setDeleteConfirmId(null);
    }
  };

  const handleDeleteCancel = () => {
    setDeleteConfirmId(null);
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
    if (success) {
      toast.success('履歴をコピーしました！');
    } else {
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
          <h2 className="text-xl font-bold text-gray-800 mb-4">
            試合履歴 ({matchHistory.length}試合)
          </h2>
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
            <div className="space-y-4">
              {[...matchHistory].reverse().map((match, index) => {
                const teamANames = match.teamA.map(getPlayerName).join(' / ');
                const teamBNames = match.teamB.map(getPlayerName).join(' / ');
                const duration = formatDuration(
                  match.startedAt,
                  match.finishedAt
                );

                return (
                  <div
                    key={match.id}
                    onClick={() => handleMatchClick(match.id)}
                    className="border border-gray-200 rounded-lg p-4 cursor-pointer hover:bg-gray-50 transition relative"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-semibold text-gray-600">
                        試合 #{matchHistory.length - index}
                      </span>
                      <div className="flex items-center gap-2">
                        <div className="text-sm text-gray-500">
                          {formatTime(match.finishedAt)} ({duration})
                        </div>
                        <button
                          onClick={(e) => handleDeleteClick(match.id, e)}
                          onTouchStart={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            handleDeleteClick(match.id, e);
                          }}
                          className="p-1 text-red-500 hover:bg-red-50 rounded transition active:bg-red-100"
                          title="削除"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-4 items-center">
                      <div
                        className={`text-center p-3 rounded-lg ${
                          match.winner === 'A'
                            ? 'bg-blue-100 border-2 border-blue-400'
                            : 'bg-gray-50'
                        }`}
                      >
                        <div className="font-medium text-gray-800 mb-2">
                          {teamANames}
                        </div>
                        <div className="text-2xl font-bold text-blue-600">
                          {match.scoreA}
                        </div>
                      </div>

                      <div className="text-center text-gray-400 font-bold">
                        VS
                      </div>

                      <div
                        className={`text-center p-3 rounded-lg ${
                          match.winner === 'B'
                            ? 'bg-red-100 border-2 border-red-400'
                            : 'bg-gray-50'
                        }`}
                      >
                        <div className="font-medium text-gray-800 mb-2">
                          {teamBNames}
                        </div>
                        <div className="text-2xl font-bold text-red-600">
                          {match.scoreB}
                        </div>
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
