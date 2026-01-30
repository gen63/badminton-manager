import { useState, useRef } from 'react';
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
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const lastTapRef = useRef<{ matchId: string; time: number } | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);

  const getPlayerName = (playerId: string) => {
    return players.find((p) => p.id === playerId)?.name || '不明';
  };

  const handleMatchClick = (matchId: string) => {
    if (isEditMode) return;
    
    const now = Date.now();
    const last = lastTapRef.current;

    if (last && last.matchId === matchId && now - last.time < 500) {
      lastTapRef.current = null;
      navigate(`/score/${matchId}`, { state: { from: '/history' } });
    } else {
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
      setDeleteConfirmId(null);
    }
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
            className="p-2 hover:bg-gray-100 rounded-full transition"
          >
            <ArrowLeft size={24} className="text-gray-600" />
          </button>
          <h1 className="text-xl font-semibold text-gray-700 flex-1">試合履歴</h1>
          {matchHistory.length > 0 && (
            <button
              onClick={handleToggleEditMode}
              className={`px-4 py-2 rounded-full text-sm font-medium transition ${
                isEditMode
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {isEditMode ? '完了' : <><Edit3 size={16} className="inline mr-1" />編集</>}
            </button>
          )}
          <button
            onClick={handleCopyHistory}
            className="p-2 bg-gray-100 rounded-full hover:bg-gray-200 transition"
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
              {[...matchHistory].reverse().map((match) => {
                const teamANames = match.teamA.map(getPlayerName).join(' ');
                const teamBNames = match.teamB.map(getPlayerName).join(' ');
                const duration = Math.round((match.finishedAt - match.startedAt) / 60000);
                
                return (
                  <div
                    key={match.id}
                    onClick={() => handleMatchClick(match.id)}
                    className={`bg-gray-50 rounded-xl p-3 transition ${!isEditMode && 'cursor-pointer hover:bg-gray-100'}`}
                  >
                    <div className="flex items-center justify-between">
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
                      {isEditMode && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteClick(match.id);
                          }}
                          className="p-2 text-red-500 hover:bg-red-50 rounded-full transition flex-shrink-0 ml-2"
                        >
                          <Trash2 size={20} />
                        </button>
                      )}
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
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
          onClick={handleDeleteCancel}
        >
          <div 
            className="bg-white rounded-2xl max-w-sm w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-gray-700 mb-2">
              試合を削除しますか？
            </h3>
            <p className="text-sm text-gray-600 mb-6">
              この操作は取り消せません。
            </p>
            <div className="flex gap-3">
              <button
                onClick={handleDeleteCancel}
                className="flex-1 py-3 bg-gray-100 text-gray-700 rounded-full font-semibold hover:bg-gray-200 transition"
              >
                キャンセル
              </button>
              <button
                onClick={handleDeleteConfirm}
                className="flex-1 py-3 bg-red-500 text-white rounded-full font-semibold hover:bg-red-600 transition"
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
