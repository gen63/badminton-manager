# バドミントンゲーム練習管理システム - セッション管理と通知機能

## 目次
- [1. セッション管理](#1-セッション管理)
- [2. 通知機能](#2-通知機能)
- [3. 練習リセット機能](#3-練習リセット機能)
- [4. 履歴コピー機能](#4-履歴コピー機能)

---

## 1. セッション管理

### 1.1 セッション作成（管理者）
- **管理者用URL**: `/session/create`
- **フロー**:
  1. 管理者が管理者用URLにアクセス
  2. セッションIDを自動生成（例: ABC123）
  3. S01（セッション作成・初期設定画面）で参加者リスト、点数設定などを入力
  4. 参加者用URLを表示（`/session/{sessionId}`）
  5. URLをLINEやメールで共有
  6. 「次へ」ボタンでS03（メイン画面）へ遷移

### 1.2 参加者の入室
- **参加者用URL**: `/session/{sessionId}`
- **フロー**:
  1. 参加者がURLをタップ（LINEやメールで共有）
  2. S02（参加者選択画面）へ遷移
  3. 自分の名前を選択して入室
  4. S03（メイン画面）へ遷移

### 1.3 セッションの有効期限
- **保持期間**: 48時間アクセスなしで自動削除
- **削除方法**: Cloud Functionsで定期的にチェック
- **手動削除**: 練習リセット機能で即座削除可能

---

## 2. 通知機能

### 2.1 実装方式
- **FCM（Firebase Cloud Messaging）**: プッシュ通知
- **Web Audio API**: アプリ内音声再生
- **併用**: スマホロック中はFCM、アプリ開いている時はFCM + 音声

### 2.2 試合開始通知

#### トリガー
ゲーム開始ボタン押下時

#### 通知対象
配置された4人のメンバー

#### 通知内容
- **プッシュ通知**: "試合開始 - あなたの試合が始まります！"
- **アプリ内音声**: 試合開始音（match-start.mp3）

#### 実装フロー
```javascript
// 1. プッシュ通知送信（FCM）
await sendPushNotification(playerIds, {
  title: "試合開始",
  body: "あなたの試合が始まります！"
});

// 2. アプリ開いている場合は音声も再生（Web Audio）
if (document.hasFocus()) {
  const audio = new Audio('/sounds/match-start.mp3');
  audio.play();
}
```

### 2.3 スコア未入力リマインダー

#### トリガー
10分間隔で自動チェック（Cloud Functions または クライアント側タイマー）

#### 通知対象
スコア未入力の試合に参加した4人のメンバー

#### 通知内容
- **プッシュ通知**: "スコア未入力 - 試合結果を入力してください"

#### 動作
1. 試合終了後、10分経過してもスコア未入力の場合に通知
2. 以降10分ごとに繰り返し通知
3. スコア入力完了で通知停止

#### 実装フロー
```javascript
// Cloud Functions (scheduled)
export const checkUnscoredMatches = functions.pubsub
  .schedule('every 10 minutes')
  .onRun(async () => {
    const unscoredMatches = await getUnscoredMatches();
    
    for (const match of unscoredMatches) {
      const elapsedMinutes = (Date.now() - match.endTime) / 60000;
      
      if (elapsedMinutes >= 10 && elapsedMinutes % 10 < 1) {
        await sendPushNotification(match.playerIds, {
          title: "スコア未入力",
          body: "試合結果を入力してください"
        });
      }
    }
  });
```

---

## 3. 練習リセット機能

### 3.1 目的
同じセッション・参加者リストで新しい練習を開始する

### 3.2 配置場所
S05（設定画面）の「セッション管理」セクション

### 3.3 リセット操作

#### 操作フロー
1. 「練習をリセット」ボタンをタップ
2. 確認ダイアログ表示:
   - **ログを保存してリセット**: 本日のログを日時付きでアーカイブ（将来実装）
   - **ログを削除してリセット**: ログを完全削除
   - **キャンセル**: リセット中止

### 3.4 リセット時の動作

#### リセットされるデータ
- 全員の試合数を0にリセット
- 待機時間をリセット
- スコア未入力状態をクリア
- 全コートを空き状態に
- 全員を待機メンバーに移動
- 休憩状態を解除
- 試合ログ（ログ削除を選択した場合）

#### 保持されるデータ
- 参加者リスト
- レーティング情報
- セッションID・参加者用URL
- 点数設定
- コート数

### 3.5 リセット後
- 参加者の再入室は不要
- 全員が同じセッションで継続
- メイン画面に戻り、新しい練習を開始可能

### 3.6 ユースケース
- 同日に午前・午後で2回練習する場合
- 途中で設定をやり直したい場合
- 試合ログが不要になった場合

---

## 4. 履歴コピー機能

### 4.1 目的
試合ログをテキストとしてクリップボードにコピーし、ExcelやGoogleスプレッドシートに貼り付け可能にする

### 4.2 配置場所
S05（設定画面）の「セッション管理」セクション

### 4.3 コピー操作

#### 操作フロー
1. 「履歴をコピー」ボタンをタップ
2. スコア入力済みの試合のみをタブ区切り形式でクリップボードにコピー
3. 「コピーしました」とトースト通知表示

### 4.4 コピーフォーマット

#### 形式例
```
2026/01/28 14:30

連番	ペアA	ペアB	スコア	時刻	試合時間
1	たかし・ゆうこ	けんた・まい	21-15	14:00	12分
2	ひろし・さき	だいき・りょう	18-21	14:15	15分
3	なお・まさる	あい・ゆき	21-19	14:30	13分
```

#### 形式詳細
- **1行目**: 日付（YYYY/MM/DD HH:MM形式）
- **2行目**: 空行
- **3行目**: ヘッダー行（タブ区切り）
  - `連番	ペアA	ペアB	スコア	時刻	試合時間`
- **4行目以降**: データ行（タブ区切り）
  - 連番: 通し番号
  - ペアA: 名前1・名前2
  - ペアB: 名前3・名前4
  - スコア: 21-15形式
  - 時刻: HH:MM形式
  - 試合時間: N分

#### フィルタリング
- スコア未入力の試合は含まない
- スコア入力済みの試合のみ出力

### 4.5 実装例

```javascript
function copyHistoryToClipboard(matches) {
  // スコア入力済みの試合のみフィルタ
  const scoredMatches = matches.filter(m => m.score);
  
  // ヘッダー
  const now = new Date();
  const dateStr = `${now.getFullYear()}/${(now.getMonth()+1).toString().padStart(2,'0')}/${now.getDate().toString().padStart(2,'0')} ${now.getHours()}:${now.getMinutes()}`;
  
  let text = `${dateStr}\n\n`;
  text += `連番\tペアA\tペアB\tスコア\t時刻\t試合時間\n`;
  
  // データ行
  scoredMatches.forEach((match, idx) => {
    const pairA = match.pairA.join('・');
    const pairB = match.pairB.join('・');
    const time = formatTime(match.startTime);
    const duration = `${match.duration}分`;
    
    text += `${idx + 1}\t${pairA}\t${pairB}\t${match.score}\t${time}\t${duration}\n`;
  });
  
  // クリップボードにコピー
  navigator.clipboard.writeText(text);
  
  // トースト通知
  showToast('コピーしました');
}
```

### 4.6 ユースケース
- 練習後にExcelで管理したい
- メンバーにLINEで共有したい
- 統計分析用にデータを保存したい

---

## 関連ドキュメント

- [01_overview.md](./01_overview.md) - 概要
- [02_functional_requirements.md](./02_functional_requirements.md) - 機能要件
- [04_technical_spec.md](./04_technical_spec.md) - 技術仕様
- [05_screen_design.md](./05_screen_design.md) - 画面設計

---

**作成日**: 2026/01/29  
**最終更新**: 2026/01/29
