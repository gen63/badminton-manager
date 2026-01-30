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
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white p-6">
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-800 mb-2">
            参加者を追加
          </h1>
          <p className="text-gray-600">
            最低4人以上の参加者が必要です（現在: {players.length}人）
          </p>
        </div>

        {/* プレイヤー追加フォーム */}
        <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            名前を入力（1行に1人、複数行で一度に追加できます）
          </label>
          <div className="space-y-3">
            <textarea
              value={newPlayerNames}
              onChange={(e) => setNewPlayerNames(e.target.value)}
              placeholder="田中太郎&#10;山田花子&#10;佐藤次郎&#10;鈴木一郎"
              rows={6}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
            />
            <button
              onClick={handleAddPlayers}
              disabled={!newPlayerNames.trim()}
              className="w-full px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              <UserPlus size={20} />
              追加
            </button>
          </div>
        </div>

        {/* プレイヤーリスト */}
        <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">
            参加者一覧 ({players.length}人)
          </h2>
          {players.length === 0 ? (
            <p className="text-gray-500 text-center py-8">
              まだ参加者が登録されていません
            </p>
          ) : (
            <div className="space-y-2">
              {players.map((player) => (
                <div
                  key={player.id}
                  className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition"
                >
                  <span className="font-medium text-gray-800">
                    {player.name}
                  </span>
                  <button
                    onClick={() => removePlayer(player.id)}
                    className="text-red-500 hover:text-red-700 transition"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 完了ボタン */}
        <button
          onClick={handleContinue}
          className="w-full bg-blue-600 text-white py-4 rounded-lg font-semibold hover:bg-blue-700 transition"
        >
          完了
        </button>
      </div>
    </div>
  );
}
