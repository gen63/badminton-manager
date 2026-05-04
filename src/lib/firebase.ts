import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getFirestore, type Firestore, enableIndexedDbPersistence } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '',
};

let app: FirebaseApp | null = null;
let db: Firestore | null = null;

const hasConfig = firebaseConfig.apiKey && firebaseConfig.projectId;

if (hasConfig) {
  try {
    app = initializeApp(firebaseConfig);
    db = getFirestore(app);

    // オフライン対応：IndexedDBを使ってローカルキャッシュを有効化
    enableIndexedDbPersistence(db).catch((err) => {
      if (err.code !== 'failed-precondition' && err.code !== 'unimplemented') {
        console.error('[Firebase] Offline persistence failed:', err);
      }
    });
  } catch (error) {
    console.error('[Firebase] Initialization failed:', error);
  }
} else {
  // Phase 4: Firebase は必須。.env の VITE_FIREBASE_* を設定する必要がある。
  console.error(
    '[Firebase] Configuration missing. Please set VITE_FIREBASE_API_KEY and VITE_FIREBASE_PROJECT_ID in .env',
  );
}

export function isFirebaseConfigured(): boolean {
  return !!db;
}

export { app, db };
