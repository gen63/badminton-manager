import { useState } from 'react';
import { X, RefreshCw } from 'lucide-react';
import type { Court } from '../types/court';
import type { Player } from '../types/player';

interface PlayerSwapModalProps {
  courts: Court[];
  players: Player[];
  getPlayerName: (playerId: string) => string;
  onSwap: (courtId: number, position: number, newPlayerId: string) => void;
  onClose: () => void;
}

export function PlayerSwapModal({
  courts,
  players,
  getPlayerName,
  onSwap,
  onClose,
}: PlayerSwapModalProps) {
  const [selectedCourt, setSelectedCourt] = useState<number | null>(null);
  const [selectedPosition, setSelectedPosition] = useState<number | null>(null);

  const handlePlayerSelect = (playerId: string) => {
    if (selectedCourt !== null && selectedPosition !== null) {
      onSwap(selectedCourt, selectedPosition, playerId);
      onClose();
    }
  };

  const activePlayers = players.filter((p) => !p.isResting);
  
  // コート内のプレイヤーIDを取得
  const playersInCourts = new Set(
    courts.flatMap((c) => [...c.teamA, ...c.teamB]).filter(Boolean)
  );

  // 待機中のプレイヤー（コート外）
  const waitingPlayers = activePlayers.filter(
    (p) => !playersInCourts.has(p.id)
  );

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-2xl w-full max-h-[80vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b p-4 flex items-center justify-between">
          <h3 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            <RefreshCw size={24} />
            メンバー交換
          </h3>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition"
          >
            <X size={24} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* ステップ1: コートとポジションを選択 */}
          <div>
            <h4 className="font-semibold text-gray-700 mb-2">
              1. 交換したいコート内のプレイヤーを選択
            </h4>
            <div className="space-y-2">
              {courts.map((court) => (
                <div key={court.id} className="border rounded-lg p-3">
                  <div className="font-medium text-gray-700 mb-2">
                    コート {court.id}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {[...court.teamA, ...court.teamB].map((playerId, index) => (
                      <button
                        key={index}
                        onClick={() => {
                          setSelectedCourt(court.id);
                          setSelectedPosition(index);
                        }}
                        disabled={!playerId}
                        className={`p-2 rounded-lg text-sm transition ${
                          selectedCourt === court.id &&
                          selectedPosition === index
                            ? 'bg-blue-600 text-white'
                            : playerId
                            ? 'bg-gray-100 hover:bg-gray-200 text-gray-800'
                            : 'bg-gray-50 text-gray-400 cursor-not-allowed'
                        }`}
                      >
                        {playerId ? getPlayerName(playerId) : '未配置'}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ステップ2: 待機中のプレイヤーを選択 */}
          {selectedCourt !== null && selectedPosition !== null && (
            <div>
              <h4 className="font-semibold text-gray-700 mb-2">
                2. 交換する待機中のプレイヤーを選択
              </h4>
              {waitingPlayers.length === 0 ? (
                <p className="text-gray-500 text-sm py-4 text-center">
                  待機中のプレイヤーがいません
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {waitingPlayers.map((player) => (
                    <button
                      key={player.id}
                      onClick={() => handlePlayerSelect(player.id)}
                      className="p-3 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg text-gray-800 font-medium transition"
                    >
                      {player.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
