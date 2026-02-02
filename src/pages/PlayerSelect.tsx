import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePlayerStore } from '../stores/playerStore';
import { Trash2, UserPlus, Users, ArrowRight } from 'lucide-react';

export function PlayerSelect() {
  const navigate = useNavigate();
  const { players, addPlayers, removePlayer } = usePlayerStore();
  const [newPlayerNames, setNewPlayerNames] = useState('');

  // 入力をパース: "名前 レーティング" or "名前\tレーティング" or "名前"
  const parsePlayerInput = (line: string): { name: string; rating?: number } | null => {
    const trimmed = line.trim();
    if (!trimmed) return null;

    // タブまたは2つ以上のスペースで分割
    const parts = trimmed.split(/\t|\s{2,}/);
    const name = parts[0].trim();
    if (!name) return null;

    if (parts.length >= 2) {
      const ratingStr = parts[parts.length - 1].trim();
      const rating = parseInt(ratingStr, 10);
      if (!isNaN(rating)) {
        return { name, rating };
      }
    }
    return { name };
  };

  const handleAddPlayers = () => {
    if (newPlayerNames.trim()) {
      // 改行で分割して、パース
      const inputs = newPlayerNames
        .split('\n')
        .map(parsePlayerInput)
        .filter((input): input is { name: string; rating?: number } => input !== null);

      if (inputs.length > 0) {
        addPlayers(inputs);
        setNewPlayerNames('');
      }
    }
  };

  const handleContinue = () => {
    navigate('/settings');
  };

  return (
    <div className="bg-app">
      <div className="max-w-2xl mx-auto px-5 py-8">
        {/* ヘッダー */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 shadow-button mb-4">
            <Users size={28} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-800 tracking-tight">
            参加者を追加
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            現在: <span className="font-semibold text-blue-600">{players.length}人</span>
          </p>
        </div>

        {/* プレイヤー追加フォーム */}
        <div className="card p-6 mb-4">
          <label className="label">
            名前を入力（1行に1人、複数行で一度に追加できます）
          </label>
          <div className="space-y-3">
            <textarea
              value={newPlayerNames}
              onChange={(e) => setNewPlayerNames(e.target.value)}
              placeholder="田中太郎&#10;山田花子&#10;佐藤次郎&#10;鈴木一郎"
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
            <span className="ml-2 text-sm font-normal text-gray-500">
              ({players.length}人)
            </span>
          </h2>
          {players.length === 0 ? (
            <div className="text-center py-10">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-gray-100 mb-3">
                <Users size={24} className="text-gray-400" />
              </div>
              <p className="text-gray-500 text-sm">
                まだ参加者が登録されていません
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {players.map((player) => (
                <div
                  key={player.id}
                  className="player-pill"
                >
                  <span className="font-medium text-gray-800 text-sm truncate">
                    {player.name}
                  </span>
                  <button
                    onClick={() => removePlayer(player.id)}
                    aria-label={`${player.name}を削除`}
                    className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 active:bg-red-100 rounded-full flex-shrink-0 transition-all duration-150"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
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
    </div>
  );
}
