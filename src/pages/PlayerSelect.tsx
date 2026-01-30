import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePlayerStore } from '../stores/playerStore';
import { Trash2, UserPlus } from 'lucide-react';

export function PlayerSelect() {
  const navigate = useNavigate();
  const { players, addPlayers, removePlayer } = usePlayerStore();
  const [newPlayerNames, setNewPlayerNames] = useState('');

  const handleAddPlayers = () => {
    if (newPlayerNames.trim()) {
      // 改行で分割して、空行を除外
      const names = newPlayerNames
        .split('\n')
        .map((name) => name.trim())
        .filter((name) => name.length > 0);
      
      if (names.length > 0) {
        addPlayers(names);
        setNewPlayerNames('');
      }
    }
  };

  const handleContinue = () => {
    navigate('/settings');
  };

  return (
    <div className="min-h-screen bg-gray-100 p-6">
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-6">
          <h1 className="text-lg font-medium text-gray-600 mb-1">
            参加者を追加
          </h1>
          <p className="text-sm text-gray-500">
            現在: {players.length}人
          </p>
        </div>

        {/* プレイヤー追加フォーム */}
        <div className="bg-white rounded-2xl shadow-sm p-6 mb-4">
          <label className="block text-sm font-medium text-gray-600 mb-3">
            名前を入力（1行に1人、複数行で一度に追加できます）
          </label>
          <div className="space-y-3">
            <textarea
              value={newPlayerNames}
              onChange={(e) => setNewPlayerNames(e.target.value)}
              placeholder="田中太郎&#10;山田花子&#10;佐藤次郎&#10;鈴木一郎"
              rows={6}
              className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-300 focus:border-transparent focus:outline-none resize-none text-base transition-all duration-150"
            />
            <button
              onClick={handleAddPlayers}
              disabled={!newPlayerNames.trim()}
              className="w-full min-h-[48px] px-6 py-3 bg-blue-500 text-white rounded-full font-semibold hover:bg-blue-600 active:bg-blue-700 active:scale-[0.98] transition-all duration-150 disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              <UserPlus size={18} />
              追加
            </button>
          </div>
        </div>

        {/* プレイヤーリスト */}
        <div className="bg-white rounded-2xl shadow-sm p-6 mb-4">
          <h2 className="text-base font-semibold text-gray-700 mb-4">
            参加者一覧 ({players.length}人)
          </h2>
          {players.length === 0 ? (
            <p className="text-gray-500 text-sm text-center py-8">
              まだ参加者が登録されていません
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {players.map((player) => (
                <div
                  key={player.id}
                  className="flex items-center justify-between min-h-[44px] p-2 bg-gray-50 rounded-full border border-gray-200 hover:bg-gray-100 transition-all duration-150"
                >
                  <span className="font-medium text-gray-800 text-sm truncate pl-2">
                    {player.name}
                  </span>
                  <button
                    onClick={() => removePlayer(player.id)}
                    aria-label={`${player.name}を削除`}
                    className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 active:bg-red-100 active:scale-[0.98] rounded-full transition-all duration-150 flex-shrink-0"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 完了ボタン */}
        <button
          onClick={handleContinue}
          className="w-full min-h-[48px] bg-blue-500 text-white py-3 rounded-full font-semibold hover:bg-blue-600 active:bg-blue-700 active:scale-[0.98] transition-all duration-150"
        >
          完了
        </button>
      </div>
    </div>
  );
}
