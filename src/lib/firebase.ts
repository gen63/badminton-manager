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

console.log('[Firebase] Config check:', {
  hasApiKey: !!firebaseConfig.apiKey,
  hasProjectId: !!firebaseConfig.projectId,
  projectId: firebaseConfig.projectId,
});

if (hasConfig) {
  try {
    app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    console.log('[Firebase] ✓ Initialized successfully');
    
    // オフライン対応：IndexedDBを使ってローカルキャッシュを有効化
    enableIndexedDbPersistence(db).then(() => {
      console.log('[Firebase] ✓ Offline persistence enabled');
    }).catch((err) => {
      if (err.code === 'failed-precondition') {
        // 複数のタブが開いている場合は1つだけ有効
        console.warn('[Firebase] Offline persistence failed: Multiple tabs open');
      } else if (err.code === 'unimplemented') {
        // ブラウザが非対応
        console.warn('[Firebase] Offline persistence not available in this browser');
      } else {
        console.error('[Firebase] Offline persistence failed:', err);
      }
    });
  } catch (error) {
    console.error('[Firebase] ✗ Initialization failed:', error);
  }
} else {
  console.warn('[Firebase] ✗ Configuration missing - online features disabled');
}

export function isFirebaseConfigured(): boolean {
  return !!db;
}

export { app, db };
