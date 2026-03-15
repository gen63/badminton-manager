import { useNavigate } from 'react-router-dom';
import { useSessionStore } from '../stores/sessionStore';
import { usePlayerStore } from '../stores/playerStore';
import { useAccountingStore } from '../stores/accountingStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useGameStore } from '../stores/gameStore';
import { sendAccountingToSheets } from '../lib/sheetsApi';
import { GYM_OPTIONS } from '../types/session';
import { DollarSign, Copy, Upload, Loader2, MapPin, Clock } from 'lucide-react';
import { useState, useMemo, useEffect } from 'react';
import { useToast } from '../hooks/useToast';
import { Toast } from '../components/Toast';
import { BottomNav } from '../components/BottomNav';

export function AccountingPage() {
  const navigate = useNavigate();
  const { session, updateConfig, isCreator } = useSessionStore();
  const { players } = usePlayerStore();
  const { matchHistory } = useGameStore();
  const { records, addRecord, lastInput, saveLastInput } = useAccountingStore();
  const { accountingWebAppUrl } = useSettingsStore();
  const toast = useToast();
  const isAdmin = isCreator();

  // タブ状態
  const [activeTab, setActiveTab] = useState<'input' | 'payments'>('input');

  // 入力状態
  const [exemptCount, setExemptCount] = useState<number>(0);
  const [maleCount, setMaleCount] = useState<number>(0);
  const [femaleCount, setFemaleCount] = useState<number>(0);
  const [maleFee, setMaleFee] = useState<number>(800);
  const [femaleFee, setFemaleFee] = useState<number>(600);
  const [gymCost, setGymCost] = useState<number>(900);
  const [shuttlePrice, setShuttlePrice] = useState<number>(480);
  const [shuttleCount, setShuttleCount] = useState<number>(0);
  const [matchCount, setMatchCount] = useState<number>(0);
  const [practiceType, setPracticeType] = useState<string>('複');
  const [otherDescription, setOtherDescription] = useState<string>('');
  const [otherAmount, setOtherAmount] = useState<number>(0);
  const [isOtherExpanded, setIsOtherExpanded] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [initialized, setInitialized] = useState(false);

  // 日付フォーマット（YYYY/MM/DD）
  const formattedDate = useMemo(() => {
    if (!session) return '';
    const date = new Date(session.config.practiceStartTime);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}/${month}/${day}`;
  }, [session]);

  // 体育館名（略称に変換）
  const gymShortName = useMemo(() => {
    if (!session) return '';
    const gym = session.config.gym || '';
    if (gym.includes('目白')) return '目白';
    if (gym.includes('千早')) return '千早';
    if (gym.includes('南長崎')) return '南長崎';
    if (gym.includes('巣鴨')) return '巣鴨';
    return gym;
  }, [session]);

  // 試合履歴・過去の会計データから初期値を自動設定
  useEffect(() => {
    if (initialized || !session) return;

    // 体育館別の固定料金設定
    const gymCostMap: Record<string, number> = {
      '目白': 900,
      '千早': 900,
      '南長崎': 900,
      '巣鴨': 900,
      '千川館': 900,
    };

    // 保存された入力値があればそれを優先
    if (lastInput) {
      // すべての保存された値を復元
      setExemptCount(lastInput.exemptCount);
      setMaleCount(lastInput.maleCount);
      setFemaleCount(lastInput.femaleCount);
      setMaleFee(lastInput.maleFee);
      setFemaleFee(lastInput.femaleFee);
      setGymCost(lastInput.gymCost);
      setShuttlePrice(lastInput.shuttlePrice);
      setShuttleCount(lastInput.shuttleCount);
      setMatchCount(lastInput.matchCount || 0);
      // 古いデータとの互換性のため、practiceTypeがなければデフォルト値
      // 旧形式（ダブルス/シングルス/初級）を新形式（複/単/楽）に変換
      let type = lastInput.practiceType || '複';
      if (type === 'ダブルス') type = '複';
      if (type === 'シングルス') type = '単';
      if (type === '初級') type = '楽';
      setPracticeType(type);
      // その他欄の復元（後方互換性のため存在チェック）
      if (lastInput.otherDescription !== undefined) setOtherDescription(lastInput.otherDescription);
      if (lastInput.otherAmount !== undefined) setOtherAmount(lastInput.otherAmount);
    } else if (matchHistory.length > 0) {
      // 試合履歴から参加者・シャトル数を推定
      const participantIds = new Set<string>();
      matchHistory.forEach((match) => {
        match.teamA.forEach((id) => participantIds.add(id));
        match.teamB.forEach((id) => participantIds.add(id));
      });

      // プレイヤー情報から性別を集計
      let maleParticipants = 0;
      let femaleParticipants = 0;
      let unknownGender = 0;

      participantIds.forEach((playerId) => {
        const player = players.find((p) => p.id === playerId);
        if (player?.gender === 'M') {
          maleParticipants++;
        } else if (player?.gender === 'F') {
          femaleParticipants++;
        } else {
          unknownGender++;
        }
      });

      // 性別不明者は男性として扱う（デフォルト）
      maleParticipants += unknownGender;

      // シャトル使用数の推定（1試合あたり約1.5個）
      const estimatedShuttles = Math.ceil(matchHistory.length * 1.5);

      setMaleCount(maleParticipants);
      setFemaleCount(femaleParticipants);
      setShuttleCount(estimatedShuttles);
      setMatchCount(matchHistory.length);
    }

    // 保存された値がない場合のみ、料金設定を過去データ・固定値から取得
    if (!lastInput) {
      if (records.length > 0) {
        const latestRecord = records[records.length - 1];
        setMaleFee(latestRecord.maleFee);
        setFemaleFee(latestRecord.femaleFee);
        setShuttlePrice(latestRecord.shuttlePrice);
        
        // 同じ体育館の直近データがあればその体育館代を使う
        const sameGymRecord = [...records].reverse().find(r => r.gym === gymShortName);
        if (sameGymRecord) {
          setGymCost(sameGymRecord.gymCost);
        } else {
          // なければ体育館別の固定値
          setGymCost(gymCostMap[gymShortName] || 900);
        }
      } else {
        // 過去データがない場合は体育館別の固定値
        setGymCost(gymCostMap[gymShortName] || 900);
      }
    }

    setInitialized(true);
  }, [matchHistory, players, records, gymShortName, initialized, session, lastInput]);

  // 参加人数の合計（免除+男+女）
  const participantCount = exemptCount + maleCount + femaleCount;

  // 支払い済みプレイヤーの集計
  const paymentStats = useMemo(() => {
    const paidPlayers = players.filter(p => p.operationStatus?.payment);
    const totalAmount = paidPlayers.reduce((sum, p) => sum + (p.paymentAmount ?? 0), 0);
    return {
      paidCount: paidPlayers.length,
      totalPlayers: players.length,
      totalAmount,
      players: paidPlayers.map(p => ({
        id: p.id,
        name: p.name,
        amount: p.paymentAmount ?? 0,
        gamesPlayed: p.gamesPlayed,
        paymentTimestamp: p.paymentTimestamp,
      })).sort((a, b) => {
        // 支払い時刻の新しい順でソート（時刻がない場合は金額順）
        if (a.paymentTimestamp && b.paymentTimestamp) {
          return b.paymentTimestamp - a.paymentTimestamp;
        }
        return b.amount - a.amount;
      }),
    };
  }, [players]);

  // ハイブリッド収入計算（入力済みメンバーは実金額、未入力は計算式）
  const hybridIncome = useMemo(() => {
    const paidPlayers = players.filter(p => p.operationStatus?.payment);

    if (paidPlayers.length === 0) {
      return {
        useHybrid: false,
        total: maleCount * maleFee + femaleCount * femaleFee,
        paidTotal: 0,
        unpaidTotal: maleCount * maleFee + femaleCount * femaleFee,
        paidCount: 0,
      };
    }

    // 入力済みメンバーの合計
    const paidTotal = paidPlayers.reduce((sum, p) => sum + (p.paymentAmount ?? 0), 0);

    // 入力済みの男女内訳を計算（性別不明は男性扱い）
    const paidMaleCount = paidPlayers.filter(p => p.gender === 'M' || !p.gender).length;
    const paidFemaleCount = paidPlayers.filter(p => p.gender === 'F').length;

    // 未入力メンバーの推定
    const unpaidMaleCount = Math.max(0, maleCount - paidMaleCount);
    const unpaidFemaleCount = Math.max(0, femaleCount - paidFemaleCount);
    const unpaidTotal = unpaidMaleCount * maleFee + unpaidFemaleCount * femaleFee;

    return {
      useHybrid: true,
      total: paidTotal + unpaidTotal,
      paidTotal,
      unpaidTotal,
      paidCount: paidPlayers.length,
    };
  }, [players, maleCount, femaleCount, maleFee, femaleFee]);

  // すべての入力値を保存するヘルパー関数
  const saveAllInputs = (overrides: Partial<{
    exemptCount: number;
    maleCount: number;
    femaleCount: number;
    maleFee: number;
    femaleFee: number;
    gymCost: number;
    shuttlePrice: number;
    shuttleCount: number;
    matchCount: number;
    practiceType: string;
    otherDescription: string;
    otherAmount: number;
  }> = {}) => {
    saveLastInput({
      exemptCount: overrides.exemptCount ?? exemptCount,
      maleCount: overrides.maleCount ?? maleCount,
      femaleCount: overrides.femaleCount ?? femaleCount,
      maleFee: overrides.maleFee ?? maleFee,
      femaleFee: overrides.femaleFee ?? femaleFee,
      gymCost: overrides.gymCost ?? gymCost,
      shuttlePrice: overrides.shuttlePrice ?? shuttlePrice,
      shuttleCount: overrides.shuttleCount ?? shuttleCount,
      matchCount: overrides.matchCount ?? matchCount,
      practiceType: overrides.practiceType ?? practiceType,
      otherDescription: overrides.otherDescription ?? otherDescription,
      otherAmount: overrides.otherAmount ?? otherAmount,
    });
  };

  if (!session) {
    navigate('/');
    return null;
  }

  // 計算
  const maleTotal = maleCount * maleFee;
  const femaleTotal = femaleCount * femaleFee;
  const shuttleTotal = shuttleCount * shuttlePrice;
  const incomeForTotal = hybridIncome.total;
  const finalTotal = incomeForTotal - gymCost - shuttleTotal + otherAmount;

  // 適正会費の計算（最小黒字 + 100円）
  const calculateAppropriateFee = () => {
    const totalExpense = gymCost + shuttleTotal - otherAmount; // その他を含める
    if (participantCount === 0) return { male: 0, female: 0 };

    // 練習種別に応じた男女差額
    const genderDiff = practiceType === '単' ? 400 : 200; // 単は400円差、複/楽は200円差

    let minProfitMale = 0;
    let minProfit = Infinity;

    // 男子の会費を100円刻みで探索（0円〜1500円の範囲）
    for (let male = genderDiff; male <= 1500; male += 100) {
      const female = male - genderDiff;
      if (female < 0) continue;

      const income = male * maleCount + female * femaleCount;
      const profit = income - totalExpense;

      // 赤字にならず、最も黒字が少ないものを選ぶ
      if (profit >= 0 && profit < minProfit) {
        minProfit = profit;
        minProfitMale = male;
      }
    }

    // 適正会費 = 最小黒字会費 + 100円
    const appropriateMale = minProfitMale + 100;
    const appropriateFemale = appropriateMale - genderDiff;

    return {
      male: appropriateMale,
      female: appropriateFemale,
    };
  };

  const appropriateFee = calculateAppropriateFee();

  // コピー用テキスト生成
  const generateCopyText = () => {
    const lines = [
      `${formattedDate} ${gymShortName} ${practiceType}`,
      `参加合計 ${participantCount}人(免除${exemptCount} 男${maleCount} 女${femaleCount})`,
      '',
      '【収入】',
    ];

    if (hybridIncome.useHybrid) {
      lines.push(`支払い入力済み(${hybridIncome.paidCount}人) = ${hybridIncome.paidTotal.toLocaleString()}`);
      if (hybridIncome.unpaidTotal > 0) {
        // 未入力分の内訳
        const paidPlayers = players.filter(p => p.operationStatus?.payment);
        const paidMaleCount = paidPlayers.filter(p => p.gender === 'M' || !p.gender).length;
        const paidFemaleCount = paidPlayers.filter(p => p.gender === 'F').length;
        const unpaidMaleCount = Math.max(0, maleCount - paidMaleCount);
        const unpaidFemaleCount = Math.max(0, femaleCount - paidFemaleCount);
        const unpaidParts: string[] = [];
        if (unpaidMaleCount > 0) unpaidParts.push(`男${maleFee}×${unpaidMaleCount}`);
        if (unpaidFemaleCount > 0) unpaidParts.push(`女${femaleFee}×${unpaidFemaleCount}`);
        lines.push(`未入力分 ${unpaidParts.join(' + ')} = ${hybridIncome.unpaidTotal.toLocaleString()}`);
      }
    } else {
      lines.push(
        `男 ${maleFee}×${maleCount} = ${maleTotal.toLocaleString()}`,
        `女 ${femaleFee}×${femaleCount} = ${femaleTotal.toLocaleString()}`,
        `免除 ${exemptCount}×0 = 0`,
      );
    }

    // その他欄（プラスの場合は収入に追加）
    if ((otherDescription || otherAmount !== 0) && otherAmount > 0) {
      lines.push(`${otherDescription || 'その他'} ${otherAmount.toLocaleString()}`);
    }

    lines.push(
      '',
      '【支出】',
      `体育館 -${gymCost.toLocaleString()}`,
      `シャトル使用数 -${shuttlePrice}×${shuttleCount} = -${shuttleTotal.toLocaleString()}`,
    );

    // その他欄（マイナスの場合は支出に追加）
    if ((otherDescription || otherAmount !== 0) && otherAmount < 0) {
      lines.push(`${otherDescription || 'その他'} ${otherAmount.toLocaleString()}`);
    }

    // 合計の計算式を生成
    let totalFormula: string;
    if (hybridIncome.useHybrid) {
      totalFormula = `${hybridIncome.paidTotal.toLocaleString()}+${hybridIncome.unpaidTotal.toLocaleString()}-${gymCost.toLocaleString()}-${shuttleTotal.toLocaleString()}`;
    } else {
      totalFormula = `${maleTotal.toLocaleString()}+${femaleTotal.toLocaleString()}-${gymCost.toLocaleString()}-${shuttleTotal.toLocaleString()}`;
    }
    if (otherAmount !== 0) {
      totalFormula += otherAmount >= 0 ? `+${otherAmount.toLocaleString()}` : `${otherAmount.toLocaleString()}`;
    }

    lines.push(
      '',
      '【合計】',
      `${totalFormula} = ${finalTotal.toLocaleString()}`,
    );

    // 参考セクション
    const referenceLines: string[] = [];

    // 試合数の情報（試合数がある場合のみ）
    if (matchCount > 0) {
      // 試合履歴から参加者数を計算（平均試合数用）
      let activePlayerCount = 0;
      if (matchHistory.length > 0) {
        const participantIds = new Set<string>();
        matchHistory.forEach((match) => {
          match.teamA.forEach((id) => participantIds.add(id));
          match.teamB.forEach((id) => participantIds.add(id));
        });
        activePlayerCount = participantIds.size;
      }

      const avgMatches = activePlayerCount > 0 ? (matchCount * 4 / activePlayerCount).toFixed(1) : '0.0';

      // シャトル効率の計算
      if (shuttleCount > 0) {
        const matchesPerShuttle = (matchCount / shuttleCount).toFixed(1);
        referenceLines.push(`試合数 ${matchCount}試合 (平均${avgMatches}試合/人, 1個で${matchesPerShuttle}試合)`);
      } else {
        referenceLines.push(`試合数 ${matchCount}試合 (平均${avgMatches}試合/人)`);
      }
    }

    // 適正会費（千川館以外）
    if (gymShortName !== '千川館') {
      referenceLines.push(`適正会費: 男${appropriateFee.male}円 女${appropriateFee.female}円`);

      // 適正会費との差額警告（体育館代900円以下かつ差額200円以上）
      if (gymCost <= 900 && (Math.abs(maleFee - appropriateFee.male) >= 200 || Math.abs(femaleFee - appropriateFee.female) >= 200)) {
        referenceLines.push('⚠️ 適正会費と会費の差が200円以上あります、調整を検討してください。');
      }
    }

    // 参考セクションがあれば追加
    if (referenceLines.length > 0) {
      lines.push('', '【参考】', ...referenceLines);
    }

    return lines.join('\n');
  };

  const handleCopy = async () => {
    const text = generateCopyText();
    try {
      await navigator.clipboard.writeText(text);
      toast.success('コピーしました');
    } catch (err) {
      console.error('Failed to copy:', err);
      toast.error('コピーに失敗しました');
    }
  };

  const handleUpload = async () => {
    if (!accountingWebAppUrl || isUploading) return;
    
    // 試合履歴に出たプレイヤーのIDを収集
    const participantIds = new Set<string>();
    matchHistory.forEach((match) => {
      match.teamA.forEach((id) => participantIds.add(id));
      match.teamB.forEach((id) => participantIds.add(id));
    });
    
    // 試合に参加したプレイヤーのみをメンバー情報として生成
    const participatingPlayers = players.filter(p => participantIds.has(p.id));
    const membersJson = JSON.stringify(
      participatingPlayers.map(p => ({
        name: p.name,
        gender: p.gender || '不明'
      }))
    );
    
    // 収入合計と支出合計を計算（ハイブリッド収入を使用）
    const incomeTotal = hybridIncome.total;
    const expenseTotal = gymCost + shuttleTotal + (otherAmount < 0 ? Math.abs(otherAmount) : 0);
    
    const record = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      date: formattedDate,
      gym: gymShortName,
      practiceType,
      maleCount,
      maleFee,
      femaleCount,
      femaleFee,
      exemptCount,
      participantCount,
      matchCount,
      members: membersJson,
      incomeTotal,
      gymCost,
      shuttlePrice,
      shuttleCount,
      expenseTotal,
      otherDescription: otherDescription || undefined,
      otherAmount: otherAmount || undefined,
      finalTotal,
    };

    setIsUploading(true);
    try {
      const result = await sendAccountingToSheets(accountingWebAppUrl, record);
      if (result.success) {
        // アップロード成功時にローカルにも保存（次回の自動入力用）
        addRecord({
          date: formattedDate,
          gym: gymShortName,
          practiceType,
          maleCount,
          maleFee,
          femaleCount,
          femaleFee,
          exemptCount,
          participantCount,
          matchCount,
          members: membersJson,
          incomeTotal,
          gymCost,
          shuttlePrice,
          shuttleCount,
          expenseTotal,
          otherDescription: otherDescription || undefined,
          otherAmount: otherAmount || undefined,
          finalTotal,
        });
        toast.success(result.message);
      } else {
        toast.error(result.message);
      }
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="bg-app pb-[calc(60px+env(safe-area-inset-bottom)+1rem)]">
      {/* ヘッダー */}
      <div className="header-gradient text-foreground p-3">
        <div className="max-w-6xl mx-auto flex items-center gap-3">
          <div className="flex items-center gap-2">
            <DollarSign size={20} />
            <h1 className="text-lg font-bold">会計</h1>
          </div>
        </div>
      </div>

      {/* タブ */}
      {isAdmin && (
        <div className="border-b border-border bg-card">
          <div className="max-w-md mx-auto flex">
            <button
              onClick={() => setActiveTab('input')}
              className={`flex-1 py-3 text-sm font-medium transition-colors ${
                activeTab === 'input'
                  ? 'text-primary border-b-2 border-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              入力
            </button>
            <button
              onClick={() => setActiveTab('payments')}
              className={`flex-1 py-3 text-sm font-medium transition-colors ${
                activeTab === 'payments'
                  ? 'text-primary border-b-2 border-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              支払い一覧
            </button>
          </div>
        </div>
      )}

      {activeTab === 'payments' && isAdmin ? (
        /* 支払い一覧タブ */
        <div className="max-w-md mx-auto p-3 space-y-3">
          {/* サマリー */}
          <div className="card p-4">
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">支払い済み</span>
                <span className="text-lg font-bold text-foreground">
                  {paymentStats.paidCount} / {paymentStats.totalPlayers}人
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">合計金額</span>
                <span className="text-2xl font-bold text-primary">
                  ¥{paymentStats.totalAmount.toLocaleString()}
                </span>
              </div>
              {paymentStats.players.filter(p => p.amount === 0).length > 0 && (
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">うち免除</span>
                  <span className="text-sm font-medium text-amber-600">
                    {paymentStats.players.filter(p => p.amount === 0).length}人
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* プレイヤー一覧 */}
          <div className="card p-4">
            <h2 className="section-title mb-3">支払い詳細</h2>
            {paymentStats.players.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                まだ支払いがありません
              </p>
            ) : (
              <div className="space-y-2">
                {paymentStats.players.map((player) => {
                  const paymentTime = player.paymentTimestamp
                    ? new Date(player.paymentTimestamp).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
                    : null;
                  
                  return (
                    <div
                      key={player.id}
                      className="flex items-center justify-between py-2 border-b border-border last:border-0"
                    >
                      <div>
                        <div className="text-sm font-medium text-foreground">{player.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {player.gamesPlayed}試合
                          {paymentTime && (
                            <span className="ml-2 text-[10px]">
                              🕐 {paymentTime}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className={`text-base font-bold ${player.amount === 0 ? 'text-amber-600' : 'text-foreground'}`}>
                        {player.amount === 0 ? '免除' : `¥${player.amount.toLocaleString()}`}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : (
        /* 入力タブ */
        <>
        <div className="max-w-md mx-auto p-3 space-y-3">
        {/* 日付・体育館・練習日時 */}
        <div className="card p-4 space-y-3">
          {/* 練習開始日時 */}
          <div>
            <label className="text-xs font-semibold text-gray-700 mb-1.5 block flex items-center gap-1.5">
              <Clock size={12} />
              練習開始日時
            </label>
            <input
              type="datetime-local"
              value={new Date(session.config.practiceStartTime - new Date(session.config.practiceStartTime).getTimezoneOffset() * 60000).toISOString().slice(0, 16)}
              onChange={(e) => {
                const newTime = new Date(e.target.value).getTime();
                if (!isNaN(newTime)) {
                  updateConfig({ practiceStartTime: newTime });
                }
              }}
              className="input-field min-h-[44px] w-full"
            />
          </div>

          {/* 体育館選択 */}
          <div>
            <label className="text-xs font-semibold text-gray-700 mb-1.5 block flex items-center gap-1.5">
              <MapPin size={12} />
              体育館
            </label>
            <input
              type="text"
              list="gym-options-accounting"
              value={session.config.gym || ''}
              onChange={(e) => updateConfig({ gym: e.target.value || undefined })}
              placeholder="選択または入力してください"
              className="input-field min-h-[44px] w-full"
            />
            <datalist id="gym-options-accounting">
              {GYM_OPTIONS.map((gym) => (
                <option key={gym} value={gym} />
              ))}
            </datalist>
          </div>
        </div>

        {/* 練習種別 */}
        <div className="card p-4">
          <h2 className="text-sm font-bold mb-3 text-gray-700">練習種別</h2>
          <div className="flex gap-2">
            {[
              { value: '複', maleFee: 800, femaleFee: 600 },
              { value: '単', maleFee: 1200, femaleFee: 800 },
              { value: '楽', maleFee: 600, femaleFee: 400 },
            ].map((type) => (
              <button
                key={type.value}
                onClick={() => {
                  setPracticeType(type.value);
                  setMaleFee(type.maleFee);
                  setFemaleFee(type.femaleFee);
                  saveAllInputs({ 
                    practiceType: type.value,
                    maleFee: type.maleFee,
                    femaleFee: type.femaleFee,
                  });
                }}
                className={`flex-1 select-button text-sm px-3 py-2 ${
                  practiceType === type.value
                    ? 'select-button-active'
                    : 'select-button-inactive'
                }`}
              >
                {practiceType === type.value && <span className="mr-1">✓</span>}
                {type.value}
              </button>
            ))}
          </div>
        </div>

        {/* 参加人数 */}
        <div className="card p-4">
          <h2 className="text-sm font-bold mb-3 text-gray-700">参加人数・試合数</h2>
          <div className="grid grid-cols-4 gap-2 mb-3">
            <div className="bg-blue-50 rounded-lg p-3">
              <div className="text-xs text-muted-foreground mb-1">合計</div>
              <div className="text-2xl font-bold text-blue-600">{participantCount}</div>
            </div>
            <div className="bg-muted/50 rounded-lg p-2">
              <div className="text-xs text-muted-foreground mb-1 text-center">免除</div>
              <div className="flex items-center justify-between gap-1">
                <button
                  onClick={() => {
                    const newValue = Math.max(0, exemptCount - 1);
                    setExemptCount(newValue);
                    saveAllInputs({ exemptCount: newValue });
                  }}
                  className="w-6 h-6 rounded-full bg-card text-muted-foreground hover:bg-muted active:scale-95 flex items-center justify-center font-bold text-sm"
                >
                  −
                </button>
                <span className="text-xl font-bold text-foreground">{exemptCount}</span>
                <button
                  onClick={() => {
                    const newValue = exemptCount + 1;
                    setExemptCount(newValue);
                    saveAllInputs({ exemptCount: newValue });
                  }}
                  className="w-6 h-6 rounded-full bg-card text-muted-foreground hover:bg-muted active:scale-95 flex items-center justify-center font-bold text-sm"
                >
                  +
                </button>
              </div>
            </div>
            <div className="bg-blue-100 rounded-lg p-2">
              <div className="text-xs text-muted-foreground mb-1 text-center">男</div>
              <div className="flex items-center justify-between gap-1">
                <button
                  onClick={() => {
                    const newValue = Math.max(0, maleCount - 1);
                    setMaleCount(newValue);
                    saveAllInputs({ maleCount: newValue });
                  }}
                  className="w-6 h-6 rounded-full bg-card text-blue-600 hover:bg-blue-200 active:scale-95 flex items-center justify-center font-bold text-sm"
                >
                  −
                </button>
                <span className="text-xl font-bold text-blue-800">{maleCount}</span>
                <button
                  onClick={() => {
                    const newValue = maleCount + 1;
                    setMaleCount(newValue);
                    saveAllInputs({ maleCount: newValue });
                  }}
                  className="w-6 h-6 rounded-full bg-card text-blue-600 hover:bg-blue-200 active:scale-95 flex items-center justify-center font-bold text-sm"
                >
                  +
                </button>
              </div>
            </div>
            <div className="bg-pink-100 rounded-lg p-2">
              <div className="text-xs text-muted-foreground mb-1 text-center">女</div>
              <div className="flex items-center justify-between gap-1">
                <button
                  onClick={() => {
                    const newValue = Math.max(0, femaleCount - 1);
                    setFemaleCount(newValue);
                    saveAllInputs({ femaleCount: newValue });
                  }}
                  className="w-6 h-6 rounded-full bg-card text-pink-600 hover:bg-pink-200 active:scale-95 flex items-center justify-center font-bold text-sm"
                >
                  −
                </button>
                <span className="text-xl font-bold text-pink-800">{femaleCount}</span>
                <button
                  onClick={() => {
                    const newValue = femaleCount + 1;
                    setFemaleCount(newValue);
                    saveAllInputs({ femaleCount: newValue });
                  }}
                  className="w-6 h-6 rounded-full bg-card text-pink-600 hover:bg-pink-200 active:scale-95 flex items-center justify-center font-bold text-sm"
                >
                  +
                </button>
              </div>
            </div>
          </div>
          
          {/* 試合数 */}
          <div className="mt-3 bg-green-50 rounded-lg p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-700 font-semibold">試合数</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    const newValue = Math.max(0, matchCount - 1);
                    setMatchCount(newValue);
                    saveAllInputs({ matchCount: newValue });
                  }}
                  className="w-7 h-7 rounded-full bg-white text-green-600 hover:bg-green-100 active:scale-95 flex items-center justify-center font-bold text-sm"
                >
                  −
                </button>
                <span className="text-2xl font-bold text-green-700 w-12 text-center">{matchCount}</span>
                <button
                  onClick={() => {
                    const newValue = matchCount + 1;
                    setMatchCount(newValue);
                    saveAllInputs({ matchCount: newValue });
                  }}
                  className="w-7 h-7 rounded-full bg-white text-green-600 hover:bg-green-100 active:scale-95 flex items-center justify-center font-bold text-sm"
                >
                  +
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* 収入 */}
        <div className="card p-4">
          <h2 className="text-sm font-bold mb-3 text-gray-700">収入</h2>
          <div className="space-y-2">
            <div className="flex items-center justify-between bg-blue-50 rounded-lg px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">男</span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => {
                      const newValue = Math.max(0, maleFee - 100);
                      setMaleFee(newValue);
                      saveAllInputs({ maleFee: newValue });
                    }}
                    className="w-6 h-6 rounded-full bg-card text-blue-600 hover:bg-blue-100 active:scale-95 flex items-center justify-center font-bold text-xs"
                  >
                    −
                  </button>
                  <input
                    type="number"
                    value={maleFee || ''}
                    onChange={(e) => {
                      const newValue = parseInt(e.target.value) || 0;
                      setMaleFee(newValue);
                      saveAllInputs({ maleFee: newValue });
                    }}
                    className="w-16 text-sm font-semibold bg-card rounded px-2 py-1 text-right"
                    inputMode="numeric"
                  />
                  <button
                    onClick={() => {
                      const newValue = maleFee + 100;
                      setMaleFee(newValue);
                      saveAllInputs({ maleFee: newValue });
                    }}
                    className="w-6 h-6 rounded-full bg-card text-blue-600 hover:bg-blue-100 active:scale-95 flex items-center justify-center font-bold text-xs"
                  >
                    +
                  </button>
                </div>
                <span className="text-sm text-muted-foreground">×</span>
                <span className="text-sm font-semibold">{maleCount}</span>
              </div>
              <span className="text-lg font-bold text-blue-600">
                {maleTotal.toLocaleString()}
              </span>
            </div>

            <div className="flex items-center justify-between bg-pink-50 rounded-lg px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">女</span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => {
                      const newValue = Math.max(0, femaleFee - 100);
                      setFemaleFee(newValue);
                      saveAllInputs({ femaleFee: newValue });
                    }}
                    className="w-6 h-6 rounded-full bg-card text-pink-600 hover:bg-pink-100 active:scale-95 flex items-center justify-center font-bold text-xs"
                  >
                    −
                  </button>
                  <input
                    type="number"
                    value={femaleFee || ''}
                    onChange={(e) => {
                      const newValue = parseInt(e.target.value) || 0;
                      setFemaleFee(newValue);
                      saveAllInputs({ femaleFee: newValue });
                    }}
                    className="w-16 text-sm font-semibold bg-card rounded px-2 py-1 text-right"
                    inputMode="numeric"
                  />
                  <button
                    onClick={() => {
                      const newValue = femaleFee + 100;
                      setFemaleFee(newValue);
                      saveAllInputs({ femaleFee: newValue });
                    }}
                    className="w-6 h-6 rounded-full bg-card text-pink-600 hover:bg-pink-100 active:scale-95 flex items-center justify-center font-bold text-xs"
                  >
                    +
                  </button>
                </div>
                <span className="text-sm text-muted-foreground">×</span>
                <span className="text-sm font-semibold">{femaleCount}</span>
              </div>
              <span className="text-lg font-bold text-pink-600">
                {femaleTotal.toLocaleString()}
              </span>
            </div>

            <div className="flex items-center justify-between bg-muted/50 rounded-lg px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">免除</span>
                <span className="text-sm font-semibold">0</span>
                <span className="text-sm text-muted-foreground">×</span>
                <span className="text-sm font-semibold">{exemptCount}</span>
              </div>
              <span className="text-lg font-bold text-muted-foreground">0</span>
            </div>
          </div>
        </div>

        {/* 支出 */}
        <div className="card p-4">
          <h2 className="text-sm font-bold mb-3 text-gray-700">支出</h2>
          <div className="space-y-2">
            <div className="flex items-center justify-between bg-red-50 rounded-lg px-3 py-2">
              <span className="text-sm text-muted-foreground">体育館</span>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">-</span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => {
                      const newValue = Math.max(0, gymCost - 100);
                      setGymCost(newValue);
                      saveAllInputs({ gymCost: newValue });
                    }}
                    className="w-6 h-6 rounded-full bg-card text-red-600 hover:bg-red-100 active:scale-95 flex items-center justify-center font-bold text-xs"
                  >
                    −
                  </button>
                  <input
                    type="number"
                    value={gymCost || ''}
                    onChange={(e) => {
                      const newValue = parseInt(e.target.value) || 0;
                      setGymCost(newValue);
                      saveAllInputs({ gymCost: newValue });
                    }}
                    className="w-20 text-sm font-semibold bg-card rounded px-2 py-1 text-right"
                    inputMode="numeric"
                  />
                  <button
                    onClick={() => {
                      const newValue = gymCost + 100;
                      setGymCost(newValue);
                      saveAllInputs({ gymCost: newValue });
                    }}
                    className="w-6 h-6 rounded-full bg-card text-red-600 hover:bg-red-100 active:scale-95 flex items-center justify-center font-bold text-xs"
                  >
                    +
                  </button>
                </div>
              </div>
            </div>

            <div className="bg-red-50 rounded-lg px-3 py-2">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-muted-foreground">シャトル使用数</span>
                <span className="text-lg font-bold text-red-600">
                  -{shuttleTotal.toLocaleString()}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 flex-1">
                  <input
                    type="number"
                    value={shuttlePrice || ''}
                    onChange={(e) => {
                      const newValue = parseInt(e.target.value) || 0;
                      setShuttlePrice(newValue);
                      saveAllInputs({ shuttlePrice: newValue });
                    }}
                    className="w-16 text-sm font-semibold bg-card rounded px-2 py-1 text-right"
                    inputMode="numeric"
                  />
                  <span className="text-sm text-muted-foreground">×</span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => {
                      const newValue = Math.max(0, shuttleCount - 1);
                      setShuttleCount(newValue);
                      saveAllInputs({ shuttleCount: newValue });
                    }}
                    className="w-7 h-7 rounded-full bg-card text-red-600 hover:bg-red-100 active:scale-95 flex items-center justify-center font-bold text-sm"
                  >
                    −
                  </button>
                  <span className="text-lg font-bold text-foreground w-10 text-center">{shuttleCount}</span>
                  <button
                    onClick={() => {
                      const newValue = shuttleCount + 1;
                      setShuttleCount(newValue);
                      saveAllInputs({ shuttleCount: newValue });
                    }}
                    className="w-7 h-7 rounded-full bg-card text-red-600 hover:bg-red-100 active:scale-95 flex items-center justify-center font-bold text-sm"
                  >
                    +
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* その他（アコーディオン） */}
        <div className="card overflow-hidden">
          <button
            onClick={() => setIsOtherExpanded(!isOtherExpanded)}
            className="w-full p-4 flex items-center justify-between hover:bg-muted/50 active:bg-muted transition-colors"
          >
            <h2 className="text-sm font-bold text-gray-700">その他</h2>
            <span className="text-muted-foreground text-sm">
              {isOtherExpanded ? '▲' : '▼'}
            </span>
          </button>
          
          {isOtherExpanded && (
            <div className="px-4 pb-4">
              <div className="bg-muted/50 rounded-lg px-3 py-2">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground w-16">説明</span>
                    <input
                      type="text"
                      value={otherDescription}
                      onChange={(e) => {
                        setOtherDescription(e.target.value);
                        saveAllInputs({ otherDescription: e.target.value });
                      }}
                      placeholder="例：立替払い戻し、備品購入"
                      className="flex-1 text-sm bg-card rounded px-2 py-1"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground w-16">金額</span>
                    <input
                      type="number"
                      value={otherAmount || ''}
                      onChange={(e) => {
                        const newValue = parseInt(e.target.value) || 0;
                        setOtherAmount(newValue);
                        saveAllInputs({ otherAmount: newValue });
                      }}
                      placeholder="0"
                      className="flex-1 text-sm font-semibold bg-card rounded px-2 py-1 text-right"
                      inputMode="numeric"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 適正会費との差額警告（千川館・体育館代900円超は除外） */}
        {gymShortName !== '千川館' && gymCost <= 900 && (Math.abs(maleFee - appropriateFee.male) >= 200 || Math.abs(femaleFee - appropriateFee.female) >= 200) && (
          <div className="card p-4 bg-yellow-50 border-2 border-yellow-300">
            <p className="text-sm text-yellow-800 font-semibold text-center">
              ⚠️ 適正会費と会費の差が200円以上あります、調整を検討してください。
            </p>
          </div>
        )}

        {/* 合計 */}
        <div className="card p-4 bg-gradient-to-br from-green-50 to-emerald-50 border-2 border-green-200">
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-sm font-bold text-gray-700">合計</h2>
            {hybridIncome.useHybrid && (
              <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full font-medium">
                支払い入力反映中（{hybridIncome.paidCount}人）
              </span>
            )}
          </div>
          <div className="text-xs text-muted-foreground mb-2 font-mono">
            {hybridIncome.useHybrid ? (
              <>
                入力済{hybridIncome.paidTotal.toLocaleString()}+未入力{hybridIncome.unpaidTotal.toLocaleString()}-{gymCost.toLocaleString()}-{shuttleTotal.toLocaleString()}
                {otherAmount !== 0 && (otherAmount >= 0 ? `+${otherAmount.toLocaleString()}` : `${otherAmount.toLocaleString()}`)}
              </>
            ) : (
              <>
                {maleTotal.toLocaleString()}+{femaleTotal.toLocaleString()}-{gymCost.toLocaleString()}-{shuttleTotal.toLocaleString()}
                {otherAmount !== 0 && (otherAmount >= 0 ? `+${otherAmount.toLocaleString()}` : `${otherAmount.toLocaleString()}`)}
              </>
            )}
          </div>
          <div className={`text-4xl font-bold text-center ${finalTotal >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {finalTotal >= 0 ? '+' : ''}{finalTotal.toLocaleString()}円
          </div>
        </div>

        {/* プレビュー */}
        <div className="card p-4 bg-muted/50">
          <h2 className="text-xs font-bold mb-2 text-muted-foreground">コピー内容プレビュー</h2>
          <pre className="text-xs text-gray-700 whitespace-pre-wrap font-mono bg-card p-6 rounded border border-border">
            {generateCopyText()}
          </pre>
        </div>

        {/* アクションボタン */}
        <div className="flex gap-3">
          <button
            onClick={handleCopy}
            className="flex-1 btn-primary flex items-center justify-center gap-2 py-3 px-6"
          >
            <Copy size={18} />
            コピー
          </button>
          {accountingWebAppUrl && isAdmin && (
            <button
              onClick={handleUpload}
              disabled={isUploading}
              className="flex-1 btn-primary flex items-center justify-center gap-2 py-3 px-6 disabled:opacity-50"
            >
              {isUploading ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  送信中...
                </>
              ) : (
                <>
                  <Upload size={18} />
                  アップロード
                </>
              )}
            </button>
          )}
        </div>
      </div>
      </>
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

      <BottomNav activeTab="accounting" />
    </div>
  );
}
