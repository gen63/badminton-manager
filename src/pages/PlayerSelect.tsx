import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePlayerStore } from '../stores/playerStore';
import { useGameStore } from '../stores/gameStore';
import { buildInitialOrder, applyStreakSwaps } from '../lib/algorithm';
import { parsePlayerInput } from '../lib/utils';
import { Trash2, UserPlus, Users, ArrowRight } from 'lucide-react';

export function PlayerSelect() {
  const navigate = useNavigate();
  const { players, addPlayers, removePlayer } = usePlayerStore();
  const { matchHistory } = useGameStore();
  const [newPlayerNames, setNewPlayerNames] = useState('');

  // 動的序列でソート（弱い順 = 序列の逆順）
  const dynamicOrder = applyStreakSwaps(buildInitialOrder(players), matchHistory, 3);
  const sortedPlayers = [...players].sort((a, b) => {
    const aIdx = dynamicOrder.indexOf(a.id);
    const bIdx = dynamicOrder.indexOf(b.id);
    const aPos = aIdx === -1 ? Infinity : aIdx;
    const bPos = bIdx === -1 ? Infinity : bIdx;
    return bPos - aPos;
  });

  const handleAddPlayers = () => {
    if (newPlayerNames.trim()) {
      // 改行で分割して、パース
      const inputs = newPlayerNames
        .split('\n')
        .map(line => parsePlayerInput(line))
        .filter((input): input is { name: string; rating?: number; gender?: 'M' | 'F' } => input !== null);

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
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500 to-indigo-600 shadow-button mb-4">
            <Users size={28} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-800 tracking-tight">
            参加者を追加
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            現在: <span className="font-semibold text-indigo-600">{players.length}人</span>
          </p>
        </div>

        {/* プレイヤー追加フォーム */}
        <div className="card p-6 mb-4">
          <label className="label">
            名前を入力（1行に1人、複数行で一度に追加できます）
            <span className="block text-xs text-gray-400 mt-0.5">例: 田中  男  1500</span>
          </label>
          <div className="space-y-3">
            <textarea
              value={newPlayerNames}
              onChange={(e) => setNewPlayerNames(e.target.value)}
              placeholder="星野真吾  男&#10;佐野朋美  女  1500&#10;山口裕史"
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
              {sortedPlayers.map((player) => (
                <div
                  key={player.id}
                  className={`player-pill ${
                    player.gender === 'M' ? 'player-pill-male'
                    : player.gender === 'F' ? 'player-pill-female'
                    : ''
                  }`}
                >
                  <span className="font-medium text-gray-800 text-sm truncate">
                    {player.name}
                  </span>
                  <button
                    onClick={() => removePlayer(player.id)}
                    aria-label={`${player.name}を削除`}
                    className="min-w-[44px] min-h-[44px] -mr-2 flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-50 active:bg-red-100 rounded-full flex-shrink-0 transition-all duration-150"
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
          className="btn-primary w-full flex items-center justify-center gap-2"
        >
          完了
          <ArrowRight size={18} />
        </button>
      </div>
    </div>
  );
}
