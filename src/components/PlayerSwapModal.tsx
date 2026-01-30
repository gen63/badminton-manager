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
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[80vh] overflow-y-auto shadow-xl">
        <div className="sticky top-0 bg-white border-b border-gray-100 p-4 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-800 flex items-center gap-2">
            <RefreshCw size={20} />
            メンバー交換
          </h3>
          <button
            onClick={onClose}
            aria-label="閉じる"
            className="p-2 hover:bg-gray-100 active:bg-gray-200 rounded-full transition-all min-w-[44px] min-h-[44px] flex items-center justify-center"
          >
            <X size={20} className="text-gray-600" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* ステップ1: コートとポジションを選択 */}
          <div>
            <h4 className="text-sm font-medium text-gray-600 mb-3">
              1. 交換したいコート内のプレイヤーを選択
            </h4>
            <div className="space-y-3">
              {courts.map((court) => (
                <div key={court.id} className="bg-gray-50 rounded-xl p-3">
                  <div className="text-sm font-medium text-gray-500 mb-2">
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
                        className={`min-h-[44px] px-3 py-2 rounded-full text-sm font-medium transition-all duration-150 ${
                          selectedCourt === court.id &&
                          selectedPosition === index
                            ? 'bg-blue-500 text-white ring-2 ring-blue-300 scale-105'
                            : playerId
                            ? 'bg-white border border-gray-200 hover:border-gray-300 active:bg-gray-100 text-gray-800'
                            : 'bg-gray-100 text-gray-400 cursor-not-allowed opacity-50'
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
              <h4 className="text-sm font-medium text-gray-600 mb-3">
                2. 交換する待機中のプレイヤーを選択
              </h4>
              {waitingPlayers.length === 0 ? (
                <p className="text-gray-500 text-sm py-6 text-center bg-gray-50 rounded-xl">
                  待機中のプレイヤーがいません
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {waitingPlayers.map((player) => (
                    <button
                      key={player.id}
                      onClick={() => handlePlayerSelect(player.id)}
                      className="min-h-[44px] px-4 py-2 bg-blue-50 hover:bg-blue-100 active:bg-blue-200 border border-blue-200 rounded-full text-gray-800 text-sm font-medium transition-all duration-150 active:scale-[0.98]"
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
