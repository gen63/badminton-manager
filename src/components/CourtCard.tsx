import { Play, Pause, Clock, Users } from 'lucide-react';
import { useGameTimer } from '../hooks/useGameTimer';
import type { Court } from '../types/court';

interface CourtCardProps {
  court: Court;
  getPlayerName: (playerId: string) => string;
  onStartGame: () => void;
  onFinishGame: () => void;
  onAutoAssign: () => void;
  onClear: () => void;
  onPlayerTap: (playerId: string, position: number) => void;
  selectedPlayerId?: string | null;
  onClearSelection: () => void;
  canAutoAssign?: boolean;
}

export function CourtCard({
  court,
  getPlayerName,
  onStartGame,
  onFinishGame,
  onAutoAssign,
  onClear,
  onPlayerTap,
  selectedPlayerId,
  onClearSelection,
  canAutoAssign = true,
}: CourtCardProps) {
  const timer = useGameTimer(court.startedAt, court.isPlaying);

  return (
    <div className="bg-white rounded-lg shadow-lg p-3 space-y-1.5 flex-1 min-w-0">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-[10px] font-normal text-gray-500">コート {court.id}</h3>
        {court.isPlaying && (
          <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-xs font-semibold flex items-center gap-1">
            <Clock size={12} />
            {timer.formatted}
          </span>
        )}
      </div>

      {/* チームA */}
      <div className="border border-blue-200 rounded-lg p-2 bg-blue-50 space-y-1">
        {court.teamA[0] ? (
          <>
            <div
              onClick={() => onPlayerTap(court.teamA[0], 0)}
              className={`p-1.5 rounded cursor-pointer transition flex items-center justify-between ${
                selectedPlayerId === court.teamA[0]
                  ? 'bg-blue-300'
                  : 'hover:bg-blue-100'
              }`}
            >
              <span className="text-gray-800 text-xs font-medium whitespace-nowrap">
                {getPlayerName(court.teamA[0])}
              </span>
              {selectedPlayerId === court.teamA[0] && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onClearSelection();
                  }}
                  className="text-xs bg-red-500 text-white px-1.5 py-0.5 rounded hover:bg-red-600 flex-shrink-0 ml-1"
                >
                  ✕
                </button>
              )}
            </div>
            <div
              onClick={() => onPlayerTap(court.teamA[1], 1)}
              className={`p-1.5 rounded cursor-pointer transition flex items-center justify-between ${
                selectedPlayerId === court.teamA[1]
                  ? 'bg-blue-300'
                  : 'hover:bg-blue-100'
              }`}
            >
              <span className="text-gray-800 text-xs font-medium whitespace-nowrap">
                {getPlayerName(court.teamA[1])}
              </span>
              {selectedPlayerId === court.teamA[1] && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onClearSelection();
                  }}
                  className="text-xs bg-red-500 text-white px-1.5 py-0.5 rounded hover:bg-red-600 flex-shrink-0 ml-1"
                >
                  ✕
                </button>
              )}
            </div>
          </>
        ) : (
          <div className="flex items-center justify-center text-gray-400 text-xs h-[68px]">未配置</div>
        )}
      </div>

      {/* VS */}
      <div className="text-center text-gray-400 font-bold text-xs">VS</div>

      {/* チームB */}
      <div className="border border-red-200 rounded-lg p-2 bg-red-50 space-y-1">
        {court.teamB[0] ? (
          <>
            <div
              onClick={() => onPlayerTap(court.teamB[0], 2)}
              className={`p-1.5 rounded cursor-pointer transition flex items-center justify-between ${
                selectedPlayerId === court.teamB[0]
                  ? 'bg-red-300'
                  : 'hover:bg-red-100'
              }`}
            >
              <span className="text-gray-800 text-xs font-medium whitespace-nowrap">
                {getPlayerName(court.teamB[0])}
              </span>
              {selectedPlayerId === court.teamB[0] && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onClearSelection();
                  }}
                  className="text-xs bg-red-500 text-white px-1.5 py-0.5 rounded hover:bg-red-600 flex-shrink-0 ml-1"
                >
                  ✕
                </button>
              )}
            </div>
            <div
              onClick={() => onPlayerTap(court.teamB[1], 3)}
              className={`p-1.5 rounded cursor-pointer transition flex items-center justify-between ${
                selectedPlayerId === court.teamB[1]
                  ? 'bg-red-300'
                  : 'hover:bg-red-100'
              }`}
            >
              <span className="text-gray-800 text-xs font-medium whitespace-nowrap">
                {getPlayerName(court.teamB[1])}
              </span>
              {selectedPlayerId === court.teamB[1] && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onClearSelection();
                  }}
                  className="text-xs bg-red-500 text-white px-1.5 py-0.5 rounded hover:bg-red-600 flex-shrink-0 ml-1"
                >
                  ✕
                </button>
              )}
            </div>
          </>
        ) : (
          <div className="flex items-center justify-center text-gray-400 text-xs h-[68px]">未配置</div>
        )}
      </div>

      {/* コントロールボタン */}
      <div className="flex gap-2">
        {!court.isPlaying && !court.teamA[0] && (
          <button
            onClick={onAutoAssign}
            disabled={!canAutoAssign}
            className="w-full bg-blue-600 text-white py-1.5 px-1 rounded text-xs font-semibold hover:bg-blue-700 transition flex items-center justify-center gap-0.5 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-blue-600"
          >
            <Users size={12} />
            配置
          </button>
        )}
        {!court.isPlaying && court.teamA[0] && (
          <>
            <button
              onClick={onClear}
              className="flex-1 bg-gray-200 text-gray-800 py-1.5 px-1 rounded text-xs font-semibold hover:bg-gray-300 transition"
            >
              クリア
            </button>
            <button
              onClick={onStartGame}
              className="flex-1 bg-green-600 text-white py-1.5 px-1 rounded text-xs font-semibold hover:bg-green-700 transition flex items-center justify-center gap-0.5"
            >
              <Play size={12} />
              開始
            </button>
          </>
        )}
        {court.isPlaying && (
          <button
            onClick={onFinishGame}
            className="w-full bg-red-600 text-white py-1.5 px-1 rounded text-xs font-semibold hover:bg-red-700 transition flex items-center justify-center gap-0.5"
          >
            <Pause size={12} />
            終了
          </button>
        )}
      </div>
    </div>
  );
}
