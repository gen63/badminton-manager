import { useNavigate } from 'react-router-dom';
import { usePlayerStore } from '../stores/playerStore';
import { useGameStore } from '../stores/gameStore';
import { useSessionStore } from '../stores/sessionStore';
import { assignCourts } from '../lib/algorithm';
import { Settings, History, Coffee } from 'lucide-react';
import { useToast } from '../hooks/useToast';
import { Toast } from '../components/Toast';
import { CourtCard } from '../components/CourtCard';

export function MainPage() {
  const navigate = useNavigate();
  const { session } = useSessionStore();
  const { players, toggleRest, updatePlayer } = usePlayerStore();
  const { courts, matchHistory, updateCourt, startGame, finishGame } =
    useGameStore();
  const toast = useToast();

  if (!session) {
    navigate('/');
    return null;
  }

  const handleAutoAssign = () => {
    try {
      const assignments = assignCourts(
        players,
        session.config.courtCount,
        matchHistory
      );

      assignments.forEach((assignment) => {
        updateCourt(assignment.courtId, {
          teamA: assignment.teamA,
          teamB: assignment.teamB,
          scoreA: 0,
          scoreB: 0,
          isPlaying: false,
          startedAt: null,
          finishedAt: null,
        });
      });

      toast.success('コートに自動配置しました！');
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'プレイヤーの配置に失敗しました'
      );
    }
  };

  const handleStartGame = (courtId: number) => {
    startGame(courtId);
  };

  const handleFinishGame = (courtId: number) => {
    const court = courts.find((c) => c.id === courtId);
    if (!court) return;

    finishGame(courtId, court.scoreA, court.scoreB);

    // プレイヤーの統計を更新
    [...court.teamA, ...court.teamB].forEach((playerId) => {
      const player = players.find((p) => p.id === playerId);
      if (player) {
        updatePlayer(playerId, {
          gamesPlayed: player.gamesPlayed + 1,
          lastPlayedAt: Date.now(),
        });
      }
    });

    toast.success('試合が終了しました！');
  };

  const handleScoreChange = (
    courtId: number,
    team: 'A' | 'B',
    delta: number
  ) => {
    const court = courts.find((c) => c.id === courtId);
    if (!court) return;

    const newScore =
      team === 'A'
        ? Math.max(0, court.scoreA + delta)
        : Math.max(0, court.scoreB + delta);

    updateCourt(courtId, {
      [team === 'A' ? 'scoreA' : 'scoreB']: newScore,
    });
  };

  const getPlayerName = (playerId: string) => {
    return players.find((p) => p.id === playerId)?.name || '未設定';
  };

  const activePlayers = players.filter((p) => !p.isResting);
  const restingPlayers = players.filter((p) => p.isResting);

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      {/* ヘッダー */}
      <div className="bg-blue-600 text-white p-4 shadow-lg">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">🏸 練習管理</h1>
            <p className="text-sm text-blue-100">
              {session.config.practiceDate} | {session.config.targetScore}点先取
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => navigate('/history')}
              className="p-2 bg-blue-700 rounded-lg hover:bg-blue-800 transition"
            >
              <History size={24} />
            </button>
            <button
              onClick={() => navigate('/settings')}
              className="p-2 bg-blue-700 rounded-lg hover:bg-blue-800 transition"
            >
              <Settings size={24} />
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto p-4 space-y-6">
        {/* コート一覧 */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {courts.map((court) => (
            <CourtCard
              key={court.id}
              court={court}
              targetScore={session.config.targetScore}
              getPlayerName={getPlayerName}
              onStartGame={() => handleStartGame(court.id)}
              onFinishGame={() => handleFinishGame(court.id)}
              onScoreChange={(team, delta) =>
                handleScoreChange(court.id, team, delta)
              }
              onAutoAssign={handleAutoAssign}
            />
          ))}
        </div>

        {/* プレイヤーリスト */}
        <div className="bg-white rounded-lg shadow-lg p-4">
          <h3 className="text-lg font-bold text-gray-800 mb-4">
            参加者一覧 ({players.length}人)
          </h3>
          <div className="space-y-2">
            <div>
              <h4 className="text-sm font-semibold text-green-700 mb-2">
                アクティブ ({activePlayers.length}人)
              </h4>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {activePlayers.map((player) => (
                  <div
                    key={player.id}
                    className="flex items-center justify-between p-2 bg-green-50 rounded-lg"
                  >
                    <span className="text-gray-800">{player.name}</span>
                    <button
                      onClick={() => toggleRest(player.id)}
                      className="text-gray-500 hover:text-orange-600"
                    >
                      <Coffee size={18} />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {restingPlayers.length > 0 && (
              <div className="mt-4">
                <h4 className="text-sm font-semibold text-orange-700 mb-2">
                  休憩中 ({restingPlayers.length}人)
                </h4>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {restingPlayers.map((player) => (
                    <div
                      key={player.id}
                      className="flex items-center justify-between p-2 bg-orange-50 rounded-lg"
                    >
                      <span className="text-gray-800">{player.name}</span>
                      <button
                        onClick={() => toggleRest(player.id)}
                        className="text-orange-600 hover:text-green-600"
                      >
                        <Coffee size={18} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Toast notifications */}
      {toast.toasts.map((t) => (
        <Toast
          key={t.id}
          message={t.message}
          type={t.type}
          onClose={() => toast.hideToast(t.id)}
        />
      ))}
    </div>
  );
}
