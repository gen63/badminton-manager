import { Play, Pause, Clock, Users } from 'lucide-react';
import { useGameTimer } from '../hooks/useGameTimer';
import type { Court } from '../types/court';

interface CourtCardProps {
  court: Court;
  getPlayerName: (playerId: string) => string;
  getPlayerGames?: (playerId: string) => number;
  onStartGame: () => void;
  onFinishGame: () => void;
  onAutoAssign: () => void;
  onClear: () => void;
  onPlayerTap: (playerId: string, position: number) => void;
  selectedPlayerId?: string | null;
  onClearSelection: () => void;
  canAutoAssign?: boolean;
}

// 丸囲み数字
const circledNumbers = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];

export function CourtCard({
  court,
  getPlayerName,
  getPlayerGames,
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

  // プレイヤーピルボタンコンポーネント
  const PlayerPill = ({ playerId, position }: { playerId: string | null; position: number }) => {
    if (!playerId) {
      return (
        <div className="h-10 bg-white rounded-full border border-gray-200" />
      );
    }

    const isSelected = selectedPlayerId === playerId;
    const games = getPlayerGames ? getPlayerGames(playerId) : null;

    return (
      <div
        onClick={() => onPlayerTap(playerId, position)}
        className={`h-10 px-4 bg-white rounded-full border flex items-center justify-between cursor-pointer transition-all ${
          isSelected
            ? 'border-blue-400 ring-2 ring-blue-200 bg-blue-50'
            : 'border-gray-200 hover:border-gray-300'
        }`}
      >
        <span className="text-gray-800 text-sm font-medium truncate">
          {getPlayerName(playerId)}
        </span>
        <div className="flex items-center gap-1 flex-shrink-0 ml-2">
          {games !== null && (
            <span className="text-gray-400 text-sm">{games}</span>
          )}
          {isSelected && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onClearSelection();
              }}
              className="text-xs text-red-500 hover:text-red-600 font-bold"
            >
              ✕
            </button>
          )}
        </div>
      </div>
    );
  };

  // 未配置状態
  const EmptySlots = () => (
    <div className="space-y-2">
      <div className="h-10 bg-white rounded-full border border-gray-200" />
      <div className="h-10 bg-white rounded-full border border-gray-200" />
    </div>
  );

  const hasPlayers = court.teamA[0] || court.teamB[0];

  return (
    <div className="bg-[#f0e6da] rounded-2xl p-4 space-y-2 flex-1 min-w-0 shadow-sm">
      {/* コート番号 */}
      <div className="flex flex-col items-center gap-1">
        <span className="text-xl text-gray-500">{circledNumbers[court.id - 1] || court.id}</span>
        {court.isPlaying && (
          <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-xs font-semibold flex items-center gap-1">
            <Clock size={12} />
            {timer.formatted}
          </span>
        )}
      </div>

      {/* チームA */}
      <div className="space-y-2">
        {court.teamA[0] ? (
          <>
            <PlayerPill playerId={court.teamA[0]} position={0} />
            <PlayerPill playerId={court.teamA[1]} position={1} />
          </>
        ) : (
          <EmptySlots />
        )}
      </div>

      {/* VS */}
      <div className="text-center text-gray-400 text-xs py-1">vs</div>

      {/* チームB */}
      <div className="space-y-2">
        {court.teamB[0] ? (
          <>
            <PlayerPill playerId={court.teamB[0]} position={2} />
            <PlayerPill playerId={court.teamB[1]} position={3} />
          </>
        ) : (
          <EmptySlots />
        )}
      </div>

      {/* コントロールボタン */}
      <div className="flex gap-2 pt-2">
        {!court.isPlaying && !hasPlayers && (
          <button
            onClick={onAutoAssign}
            disabled={!canAutoAssign}
            className="w-full bg-[#d4c4b0] text-gray-700 py-2 px-3 rounded-full text-xs font-medium hover:bg-[#c9b9a5] transition flex items-center justify-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Users size={14} />
            配置
          </button>
        )}
        {!court.isPlaying && hasPlayers && (
          <>
            <button
              onClick={onClear}
              className="flex-1 bg-white text-gray-600 py-2 px-3 rounded-full text-xs font-medium hover:bg-gray-50 transition border border-gray-200"
            >
              クリア
            </button>
            <button
              onClick={onStartGame}
              className="flex-1 bg-[#d4c4b0] text-gray-700 py-2 px-3 rounded-full text-xs font-medium hover:bg-[#c9b9a5] transition flex items-center justify-center gap-1"
            >
              <Play size={14} />
              開始
            </button>
          </>
        )}
        {court.isPlaying && (
          <button
            onClick={onFinishGame}
            className="w-full bg-[#e8a87c] text-white py-2 px-3 rounded-full text-xs font-medium hover:bg-[#d4956b] transition flex items-center justify-center gap-1"
          >
            <Pause size={14} />
            終了
          </button>
        )}
      </div>
    </div>
  );
}
