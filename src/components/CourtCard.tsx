import { Play, Pause, Clock, Users } from 'lucide-react';
import { useGameTimer } from '../hooks/useGameTimer';
import type { Court } from '../types/court';

interface CourtCardProps {
  court: Court;
  getPlayerName: (playerId: string) => string;
  onStartGame: () => void;
  onFinishGame: () => void;
  onAutoAssign: () => void;
}

export function CourtCard({
  court,
  getPlayerName,
  onStartGame,
  onFinishGame,
  onAutoAssign,
}: CourtCardProps) {
  const timer = useGameTimer(court.startedAt, court.isPlaying);

  return (
    <div className="bg-white rounded-lg shadow-lg p-3 space-y-3 flex-1 min-w-0">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold text-gray-800">コート {court.id}</h3>
        {court.isPlaying ? (
          <div className="flex items-center gap-2">
            <span className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-sm font-semibold flex items-center gap-1">
              <Clock size={14} />
              {timer.formatted}
            </span>
          </div>
        ) : (
          <span className="px-3 py-1 bg-gray-100 text-gray-600 rounded-full text-sm font-semibold">
            待機中
          </span>
        )}
      </div>

      {/* チームA */}
      <div className="border border-blue-200 rounded-lg p-3 bg-blue-50">
        <div className="text-gray-800 font-medium">
          {court.teamA[0] && court.teamA[1]
            ? `${getPlayerName(court.teamA[0])} / ${getPlayerName(
                court.teamA[1]
              )}`
            : '未配置'}
        </div>
      </div>

      {/* VS */}
      <div className="text-center text-gray-400 font-bold">VS</div>

      {/* チームB */}
      <div className="border border-red-200 rounded-lg p-3 bg-red-50">
        <div className="text-gray-800 font-medium">
          {court.teamB[0] && court.teamB[1]
            ? `${getPlayerName(court.teamB[0])} / ${getPlayerName(
                court.teamB[1]
              )}`
            : '未配置'}
        </div>
      </div>

      {/* コントロールボタン */}
      <div className="flex gap-2">
        {!court.isPlaying && (
          <button
            onClick={onAutoAssign}
            className="flex-1 bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 transition flex items-center justify-center gap-2"
          >
            <Users size={20} />
            配置
          </button>
        )}
        {!court.isPlaying ? (
          <button
            onClick={onStartGame}
            disabled={!court.teamA[0] || !court.teamB[0]}
            className="flex-1 bg-green-600 text-white py-3 rounded-lg font-semibold hover:bg-green-700 transition disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            <Play size={20} />
            開始
          </button>
        ) : (
          <button
            onClick={onFinishGame}
            className="w-full bg-red-600 text-white py-3 rounded-lg font-semibold hover:bg-red-700 transition flex items-center justify-center gap-2"
          >
            <Pause size={20} />
            終了
          </button>
        )}
      </div>
    </div>
  );
}
