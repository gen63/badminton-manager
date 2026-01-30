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

// 丸囲み数字
const circledNumbers = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];

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

  // プレイヤーピルボタン（44px以上のタップターゲット）
  const PlayerPill = ({ playerId, position }: { playerId: string | null; position: number }) => {
    if (!playerId) {
      return (
        <div className="h-11 bg-gray-50 rounded-full border border-gray-200" />
      );
    }

    const isSelected = selectedPlayerId === playerId;

    return (
      <div
        onClick={() => onPlayerTap(playerId, position)}
        className={`h-11 px-4 rounded-full border flex items-center justify-between cursor-pointer transition-all active:scale-[0.98] ${
          isSelected
            ? 'bg-blue-50 border-blue-400 ring-2 ring-blue-200'
            : 'bg-gray-50 border-gray-200 hover:border-gray-300 active:bg-gray-100'
        }`}
      >
        <span className="text-gray-800 text-sm font-medium truncate">
          {getPlayerName(playerId)}
        </span>
        {isSelected && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClearSelection();
            }}
            aria-label="選択解除"
            className="p-2 text-red-500 hover:bg-red-50 active:bg-red-100 rounded-full ml-1 transition-all duration-150"
          >
            ✕
          </button>
        )}
      </div>
    );
  };

  // 未配置状態
  const EmptySlots = () => (
    <div className="space-y-2">
      <div className="h-11 bg-gray-50 rounded-full border border-gray-200" />
      <div className="h-11 bg-gray-50 rounded-full border border-gray-200" />
    </div>
  );

  const hasPlayers = court.teamA[0] || court.teamB[0];

  return (
    <div className="bg-white rounded-2xl p-4 space-y-2 flex-1 min-w-0 shadow-sm border border-gray-100">
      {/* コート番号 */}
      <div className="flex items-center justify-center gap-2">
        <span className="text-xl text-gray-400">{circledNumbers[court.id - 1] || court.id}</span>
        {court.isPlaying && (
          <span className="px-2 py-1 bg-green-100 text-green-700 rounded-full text-xs font-semibold flex items-center gap-1">
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

      {/* コントロールボタン（44px以上のタップターゲット） */}
      <div className="flex gap-3 pt-2">
        {!court.isPlaying && !hasPlayers && (
          <button
            onClick={onAutoAssign}
            disabled={!canAutoAssign}
            className="w-full bg-gray-100 text-gray-600 min-h-[44px] py-2.5 px-4 rounded-full text-sm font-medium hover:bg-gray-200 active:bg-gray-300 active:scale-[0.98] transition-all duration-150 flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Users size={16} />
            配置
          </button>
        )}
        {!court.isPlaying && hasPlayers && (
          <>
            <button
              onClick={onStartGame}
              className="flex-1 bg-blue-500 text-white min-h-[44px] py-2.5 px-4 rounded-full text-sm font-medium hover:bg-blue-600 active:bg-blue-700 active:scale-[0.98] transition-all duration-150 flex items-center justify-center gap-1.5"
            >
              <Play size={16} />
              開始
            </button>
            <button
              onClick={onClear}
              className="flex-1 bg-gray-100 text-gray-600 min-h-[44px] py-2.5 px-4 rounded-full text-sm font-medium hover:bg-gray-200 active:bg-gray-300 active:scale-[0.98] transition-all duration-150"
            >
              クリア
            </button>
          </>
        )}
        {court.isPlaying && (
          <button
            onClick={onFinishGame}
            className="w-full bg-orange-500 text-white min-h-[44px] py-2.5 px-4 rounded-full text-sm font-medium hover:bg-orange-600 active:bg-orange-700 active:scale-[0.98] transition-all duration-150 flex items-center justify-center gap-1.5"
          >
            <Pause size={16} />
            終了
          </button>
        )}
      </div>
    </div>
  );
}
