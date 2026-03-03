# Phase 1 実装ガイド

## 📋 実装済み機能

### ✅ 基盤実装（Firebase登録前でも動作）

1. **Firebase SDK 統合**
   - `package.json`: firebase 11.2.0 追加
   - `src/lib/firebase.ts`: Firebase初期化（設定は後で追加）

2. **セッション管理サービス（抽象化）**
   - `src/services/sessionService.ts`
   - モック実装（LocalStorage）→ Firebase実装に段階的移行可能
   - 主な関数:
     - `createSession()`: セッション作成
     - `getSession()`: セッション取得
     - `subscribeToSession()`: リアルタイム監視
     - `updateSession()`: セッション更新
     - `joinSession()`: 参加者追加

3. **型定義拡張**
   - `src/types/session.ts`: Session型にPhase 1フィールド追加
     - `createdBy`: 管理者名
     - `createdByUID`: LINE UID（Phase 1.5で使用）
     - `participants`: 入室済み参加者リスト
     - `status`: セッション状態

4. **ルーティング**
   - `src/App.tsx`: Phase 1ルート追加
     - `/session/create` (管理者用)
     - `/session/:sessionId` (参加者用)

5. **参加者選択画面（S02）**
   - `src/pages/SessionJoinPage.tsx`
   - URL経由で入室
   - セッション情報表示
   - 参加者リスト表示

6. **URL生成・共有機能**
   - `src/components/SessionURLDisplay.tsx`
   - クリップボードコピー
   - Web Share API対応（モバイル）
   - セッションID表示

7. **セッション作成画面の拡張**
   - `src/pages/SessionCreate.tsx`: Phase 1モード対応
   - `/session/create` からのアクセス時はFirebaseにセッション作成
   - Phase 0モード（LocalStorage）も維持

---

## 🚧 次のステップ（Firebase登録後）

### 1. Firebase 設定情報の追加

`src/lib/firebase.ts` の設定を更新:

```typescript
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abcdef"
};
```

### 2. sessionService.ts をFirestore実装に切り替え

各関数のTODOコメントを削除し、Firestore APIを有効化:

```typescript
// createSession()
const docRef = doc(db, 'sessions', sessionId);
await setDoc(docRef, {
  ...session,
  createdAt: serverTimestamp()
});

// getSession()
const docRef = doc(db, 'sessions', sessionId);
const docSnap = await getDoc(docRef);
return docSnap.exists() ? docSnap.data() as Session : null;

// subscribeToSession()
const docRef = doc(db, 'sessions', sessionId);
return onSnapshot(docRef, (doc) => {
  callback(doc.exists() ? doc.data() as Session : null);
});
```

### 3. リアルタイム同期の実装

Zustand storeをFirestoreリスナーと連携:

```typescript
// src/stores/sessionStore.ts
useEffect(() => {
  if (!sessionId) return;
  
  const unsubscribe = subscribeToSession(sessionId, (session) => {
    if (session) {
      // 状態を更新
      updateLocalState(session);
    }
  });
  
  return unsubscribe;
}, [sessionId]);
```

### 4. npm install 実行

```bash
cd /home/gen/badminton-manager
npm install
```

### 5. ローカルテスト

```bash
npm run dev
```

- Phase 0モード: http://localhost:5173/badminton-manager/
- Phase 1モード: http://localhost:5173/badminton-manager/session/create

### 6. デプロイ

```bash
git add -A
git commit -m "Phase 1完了: Firebase設定追加"
git push origin phase1-session-sharing
```

---

## 🧪 テスト方法

### Phase 0（LocalStorage版）のテスト
1. `/` にアクセス
2. セッション作成
3. `/main` へ遷移
4. 正常に動作することを確認

### Phase 1（Firebase版）のテスト
1. `/session/create` にアクセス
2. セッション作成
3. URL表示・コピー
4. 別タブで `/session/:sessionId` を開く
5. 参加者選択画面で名前を入力
6. 両タブでリアルタイム同期を確認

---

## 📁 ファイル構成

```
src/
├── lib/
│   └── firebase.ts            # Firebase初期化
├── services/
│   └── sessionService.ts      # セッション管理（抽象化）
├── components/
│   └── SessionURLDisplay.tsx  # URL表示・共有
├── pages/
│   ├── SessionCreate.tsx      # セッション作成（Phase 0/1対応）
│   └── SessionJoinPage.tsx    # 参加者選択（Phase 1）
├── stores/
│   └── sessionStore.ts        # セッション状態管理
└── types/
    └── session.ts             # 型定義
```

---

## 🔐 Firestore セキュリティルール（Phase 1）

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // セッション: 誰でも読める、誰でも書ける（Phase 1）
    match /sessions/{sessionId} {
      allow read: if true;
      allow create: if true;
      allow update: if true;
      allow delete: if false;  // 削除は不可
      
      // サブコレクション
      match /{document=**} {
        allow read, write: if true;
      }
    }
  }
}
```

**注意**: Phase 1.5（LINE認証）でルールを厳格化します。

---

## 📊 現在の状態

- ✅ ブランチ作成: `phase1-session-sharing`
- ✅ Firebase SDK追加
- ✅ セッション管理サービス実装（モック）
- ✅ URL生成・共有機能実装
- ✅ 参加者選択画面実装
- ✅ ルーティング追加
- ⏸️ Firebase 設定待ち
- ⏸️ Firebase実装への切り替え待ち
- ⏸️ リアルタイム同期実装待ち

---

## ❓ FAQ

### Q: Phase 0とPhase 1は同時に動く？
**A**: はい。`/` はPhase 0、`/session/create` はPhase 1として動作します。

### Q: Firebase登録前でもテストできる？
**A**: はい。モック実装（LocalStorage）で動作確認できます。

### Q: Firebase Config はどこに書く？
**A**: `src/lib/firebase.ts` に直接記述（公開情報なのでOK）。

### Q: リアルタイム同期はいつ実装？
**A**: Firebase設定後、`sessionService.ts` のFirestore実装を有効化した後。

---

最終更新: 2026-03-03
