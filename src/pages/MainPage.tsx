import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePlayerStore } from '../stores/playerStore';
import { useGameStore } from '../stores/gameStore';
import { useSessionStore } from '../stores/sessionStore';
import { assignCourts } from '../lib/algorithm';
import { Settings, History, Coffee, Users, Plus, Minus, RefreshCw } from 'lucide-react';
import { useToast } from '../hooks/useToast';
import { Toast } from '../components/Toast';
import { CourtCard } from '../components/CourtCard';
import { PlayerSwapModal } from '../components/PlayerSwapModal';

export function MainPage() {
  const navigate = useNavigate();
  const { session, updateConfig } = useSessionStore();
  const { players, toggleRest, updatePlayer } = usePlayerStore();
  const { courts, matchHistory, updateCourt, startGame, finishGame, initializeCourts } =
    useGameStore();
  const toast = useToast();
  const [showSwapModal, setShowSwapModal] = useState(false);

  if (!session) {
    navigate('/');
    return null;
  }

  const handleAutoAssign = (courtId?: number) => {
    try {
      // 指定されたコートIDまたは全コート
      const courtsToAssign = courtId ? [courtId] : courts.map(c => c.id);
      
      const assignments = assignCourts(
        players,
        courtsToAssign.length,
        matchHistory
      );

      courtsToAssign.forEach((id, index) => {
        const assignment = assignments[index];
        if (assignment) {
          updateCourt(id, {
            teamA: assignment.teamA,
            teamB: assignment.teamB,
            scoreA: 0,
            scoreB: 0,
            isPlaying: false,
            startedAt: null,
            finishedAt: null,
          });
        }
      });

      if (courtId) {
        toast.success(`コート${courtId}に配置しました！`);
      } else {
        toast.success('全コートに配置しました！');
      }
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

  const getPlayerName = (playerId: string) => {
    return players.find((p) => p.id === playerId)?.name || '未設定';
  };

  // コート内のプレイヤーIDを取得
  const playersInCourts = new Set(
    courts.flatMap((c) => [...c.teamA, ...c.teamB]).filter(Boolean)
  );

  // 待機中のプレイヤー（コート外 & 休憩中でない）
  const activePlayers = players.filter(
    (p) => !p.isResting && !playersInCourts.has(p.id)
  );
  const restingPlayers = players.filter((p) => p.isResting);

  const handleCourtCountChange = (delta: number) => {
    const newCount = Math.max(1, Math.min(3, session.config.courtCount + delta));
    if (newCount !== session.config.courtCount) {
      updateConfig({ courtCount: newCount });
      initializeCourts(newCount);
      toast.success(`コート数を${newCount}に変更しました`);
    }
  };

  // スコア未入力の試合（0-0の試合）を最大5件
  const unfinishedMatches = [...matchHistory]
    .reverse()
    .filter((m) => m.scoreA === 0 && m.scoreB === 0)
    .slice(0, 5);

  const handleSwapPlayer = (courtId: number, position: number, newPlayerId: string) => {
    const court = courts.find((c) => c.id === courtId);
    if (!court) return;

    // 現在のプレイヤーIDを取得
    const allPlayers = [...court.teamA, ...court.teamB];
    const oldPlayerId = allPlayers[position];

    // 新しい配置を作成
    const newTeamA = [...court.teamA];
    const newTeamB = [...court.teamB];

    if (position < 2) {
      newTeamA[position] = newPlayerId;
    } else {
      newTeamB[position - 2] = newPlayerId;
    }

    updateCourt(courtId, {
      teamA: [newTeamA[0], newTeamA[1]],
      teamB: [newTeamB[0], newTeamB[1]],
    });

    const oldPlayerName = players.find((p) => p.id === oldPlayerId)?.name || '未設定';
    const newPlayerName = players.find((p) => p.id === newPlayerId)?.name || '不明';
    
    toast.success(`${oldPlayerName} と ${newPlayerName} を交換しました`);
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      {/* ヘッダー */}
      <div className="bg-blue-600 text-white p-3 shadow-lg">
        <div className="max-w-6xl mx-auto flex items-center justify-end gap-2">
          <button
            onClick={() => navigate('/history')}
            className="p-2 bg-blue-700 rounded-lg hover:bg-blue-800 transition"
          >
            <History size={20} />
          </button>
          <button
            onClick={() => navigate('/settings')}
            className="p-2 bg-blue-700 rounded-lg hover:bg-blue-800 transition"
          >
            <Settings size={20} />
          </button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto p-4 space-y-6">
        {/* コントロールエリア */}
        <div className="bg-white rounded-lg shadow-lg p-4">
          <div className="flex items-center gap-4 mb-4">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-700">コート数:</span>
              <button
                onClick={() => handleCourtCountChange(-1)}
                disabled={session.config.courtCount <= 1}
                className="p-2 bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Minus size={16} />
              </button>
              <span className="text-lg font-bold text-gray-800 min-w-[2rem] text-center">
                {session.config.courtCount}
              </span>
              <button
                onClick={() => handleCourtCountChange(1)}
                disabled={session.config.courtCount >= 3}
                className="p-2 bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Plus size={16} />
              </button>
            </div>
          </div>
          
          {/* アクションボタン */}
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => handleAutoAssign()}
              className="bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 transition flex items-center justify-center gap-2"
            >
              <Users size={20} />
              一括配置
            </button>
            <button
              onClick={() => setShowSwapModal(true)}
              className="bg-green-600 text-white py-3 rounded-lg font-semibold hover:bg-green-700 transition flex items-center justify-center gap-2"
            >
              <RefreshCw size={20} />
              メンバー交換
            </button>
          </div>
        </div>

        {/* コート一覧 */}
        <div className="flex gap-3">
          {courts.map((court) => (
            <CourtCard
              key={court.id}
              court={court}
              getPlayerName={getPlayerName}
              onStartGame={() => handleStartGame(court.id)}
              onFinishGame={() => handleFinishGame(court.id)}
              onAutoAssign={() => handleAutoAssign(court.id)}
            />
          ))}
        </div>

        {/* スコア未入力の試合 */}
        {unfinishedMatches.length > 0 && (
          <div className="bg-white rounded-lg shadow-lg p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-800">
                スコア未入力の試合
              </h3>
            </div>
            <div className="space-y-2">
              {unfinishedMatches.map((match) => {
                const teamANames = match.teamA.map(getPlayerName).join(' / ');
                const teamBNames = match.teamB.map(getPlayerName).join(' / ');
                return (
                  <div
                    key={match.id}
                    className="flex items-center justify-between p-3 bg-gray-50 rounded-lg text-sm hover:bg-gray-100 cursor-pointer transition"
                    onClick={() => {
                      // TODO: スコア入力モーダルを開く
                      toast.info('スコア入力機能は次のアップデートで追加予定');
                    }}
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-gray-700">
                          {teamANames}
                        </span>
                        <span className="text-gray-400">vs</span>
                        <span className="text-gray-700">
                          {teamBNames}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* プレイヤーリスト */}
        <div className="bg-white rounded-lg shadow-lg p-4">
          <h3 className="text-lg font-bold text-gray-800 mb-4">
            参加者一覧 ({players.length}人)
          </h3>
          <div className="space-y-4">
            <div>
              <h4 className="text-sm font-semibold text-blue-700 mb-2">
                待機中 ({activePlayers.length}人)
              </h4>
              <div className="grid gap-2 grid-cols-3">
                {activePlayers.map((player) => (
                  <div
                    key={player.id}
                    className="flex items-center justify-between p-2 bg-blue-50 rounded-lg border border-blue-200"
                  >
                    <span className="text-gray-800 text-sm">{player.name}</span>
                    <button
                      onClick={() => toggleRest(player.id)}
                      className="text-gray-500 hover:text-orange-600 flex-shrink-0"
                    >
                      <Coffee size={16} />
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
                <div className="grid gap-2 grid-cols-3">
                  {restingPlayers.map((player) => (
                    <div
                      key={player.id}
                      className="flex items-center justify-between p-2 bg-orange-50 rounded-lg border border-orange-200"
                    >
                      <span className="text-gray-800 text-sm">{player.name}</span>
                      <button
                        onClick={() => toggleRest(player.id)}
                        className="text-orange-600 hover:text-blue-600 flex-shrink-0"
                      >
                        <Coffee size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Player swap modal */}
      {showSwapModal && (
        <PlayerSwapModal
          courts={courts}
          players={players}
          getPlayerName={getPlayerName}
          onSwap={handleSwapPlayer}
          onClose={() => setShowSwapModal(false)}
        />
      )}

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
