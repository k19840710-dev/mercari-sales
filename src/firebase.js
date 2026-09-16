import { initializeApp } from 'firebase/app';
import {
  getAuth,
  onAuthStateChanged,
  signInAnonymously,
  signInWithEmailAndPassword,
  signOut,
  EmailAuthProvider,
  linkWithCredential,
} from 'firebase/auth';
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  deleteDoc,
  onSnapshot,
  writeBatch,
  getDocs,
  enableIndexedDbPersistence,
} from 'firebase/firestore';

// 同じアカウントの別アプリ（メルカリ売上・在庫管理）と共通の Firebase プロジェクトを流用。
// Firestore 上は appId で名前空間を分けており、データが混ざることはない。
const firebaseConfig = {
  apiKey: 'AIzaSyAyv6B3rtdgxyCMSJxfu4_FX1IupABtKMY',
  authDomain: 'sai-4d708.firebaseapp.com',
  projectId: 'sai-4d708',
  storageBucket: 'sai-4d708.firebasestorage.app',
  messagingSenderId: '439897510721',
  appId: '1:439897510721:web:aea9095ba9bf64d80c87c0',
  measurementId: 'G-PW8FD91NP7',
};

// このアプリ専用の名前空間（Firestore パス: artifacts/{APP_ID}/users/{uid}/...）
export const APP_ID = 'card-tracker';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// オフライン時も直前のデータを読めるようにキャッシュを有効化。
// 複数タブを開いている場合は片方でしか有効化できないため、失敗しても致命的ではない。
enableIndexedDbPersistence(db).catch(() => {});

export const getCardsColRef = (uid) => collection(db, 'artifacts', APP_ID, 'users', uid, 'cards');
export const getTransactionsColRef = (uid) => collection(db, 'artifacts', APP_ID, 'users', uid, 'transactions');
export const cardDocRef = (uid, id) => doc(db, 'artifacts', APP_ID, 'users', uid, 'cards', id);
export const transactionDocRef = (uid, id) => doc(db, 'artifacts', APP_ID, 'users', uid, 'transactions', id);
// Gmail自動取り込み（Apps Script）が、確信を持てなかった利用通知メールを保留する場所。
// 未登録カードの自動作成や、判定が曖昧な明細の自動登録はしない方針のため、
// ここに一旦溜めて、アプリ側でユーザーが内容を確認してから登録する。
export const getPendingImportsColRef = (uid) => collection(db, 'artifacts', APP_ID, 'users', uid, 'pendingImports');
export const pendingImportDocRef = (uid, id) => doc(db, 'artifacts', APP_ID, 'users', uid, 'pendingImports', id);
// 支払い方法（クレジットカード／現金／PayPayなど）。カードとは別に、追加・編集・
// 無効化できる拡張可能なマスタとして持つ（コードに固定実装しない）。
export const getPaymentMethodsColRef = (uid) => collection(db, 'artifacts', APP_ID, 'users', uid, 'paymentMethods');
export const paymentMethodDocRef = (uid, id) => doc(db, 'artifacts', APP_ID, 'users', uid, 'paymentMethods', id);
// Gmail自動取り込み（Apps Script）の実行状況。アプリ側は読み取り専用で表示するだけ。
export const gmailImportStatusDocRef = (uid) => doc(db, 'artifacts', APP_ID, 'users', uid, 'settings', 'gmailImportStatus');

export {
  onAuthStateChanged,
  signInAnonymously,
  signInWithEmailAndPassword,
  signOut,
  EmailAuthProvider,
  linkWithCredential,
  setDoc,
  deleteDoc,
  onSnapshot,
  writeBatch,
  getDocs,
};
