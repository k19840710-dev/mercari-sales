import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  CreditCard,
  Plus,
  Calendar,
  ChevronLeft,
  ChevronRight,
  PieChart,
  List,
  Trash2,
  Wallet,
  Tag,
  TrendingUp,
  X,
  Filter,
  Search,
  Utensils,
  Car,
  HelpCircle,
  Sparkles,
  Package,
  Boxes,
  Users,
  Plane,
  Smartphone,
  Tv,
  Repeat,
  Eye,
  EyeOff,
  User,
  Download,
  Upload,
  Pencil,
  Copy,
  Check,
  Cloud,
  LogOut,
  Loader2,
  Inbox,
  BarChart3,
} from 'lucide-react';
import TrendChart from './components/TrendChart.jsx';
import DonutChart from './components/DonutChart.jsx';
import {
  auth,
  db,
  onAuthStateChanged,
  signInAnonymously,
  signInWithEmailAndPassword,
  signOut,
  EmailAuthProvider,
  linkWithCredential,
  getCardsColRef,
  getTransactionsColRef,
  cardDocRef,
  transactionDocRef,
  getPendingImportsColRef,
  pendingImportDocRef,
  getPaymentMethodsColRef,
  paymentMethodDocRef,
  gmailImportStatusDocRef,
  setDoc,
  deleteDoc,
  onSnapshot,
  writeBatch,
  getDocs,
} from './firebase.js';

// ---------- localStorage ----------

const STORAGE_KEYS = {
  cards: 'cardTracker.cards',
  transactions: 'cardTracker.transactions',
};

function loadList(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length ? parsed : fallback;
  } catch (e) {
    console.error('保存データの読み込みに失敗しました', e);
    return fallback;
  }
}

// カードのデザインスタイル定義
const CARD_THEMES = {
  purple: {
    bg: 'bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-500',
    border: 'border-purple-400/30',
    text: 'text-white',
    badge: 'bg-purple-900/40 text-purple-200',
  },
  dark: {
    bg: 'bg-gradient-to-br from-gray-900 via-slate-800 to-black',
    border: 'border-gray-700',
    text: 'text-white',
    badge: 'bg-gray-800 text-gray-300',
  },
  emerald: {
    bg: 'bg-gradient-to-br from-emerald-600 via-teal-600 to-cyan-700',
    border: 'border-teal-400/30',
    text: 'text-white',
    badge: 'bg-teal-900/40 text-teal-200',
  },
  blue: {
    bg: 'bg-gradient-to-br from-blue-600 via-cyan-600 to-indigo-700',
    border: 'border-blue-400/30',
    text: 'text-white',
    badge: 'bg-blue-900/40 text-blue-200',
  },
  sunset: {
    bg: 'bg-gradient-to-br from-amber-500 via-orange-600 to-red-600',
    border: 'border-orange-400/30',
    text: 'text-white',
    badge: 'bg-orange-900/40 text-orange-200',
  },
};

// カテゴリ定義
const CATEGORIES = [
  { id: 'food', name: '食費', icon: Utensils, color: 'bg-amber-500 text-amber-500' },
  { id: 'daily', name: '日用品', icon: Package, color: 'bg-lime-500 text-lime-500' },
  { id: 'procurement', name: '仕入れ', icon: Boxes, color: 'bg-indigo-500 text-indigo-500' },
  { id: 'beauty', name: '美容', icon: Sparkles, color: 'bg-rose-500 text-rose-500' },
  { id: 'social', name: '交際費', icon: Users, color: 'bg-orange-500 text-orange-500' },
  { id: 'entertainment', name: '娯楽・趣味', icon: Tv, color: 'bg-pink-500 text-pink-500' },
  { id: 'transport', name: '交通費', icon: Car, color: 'bg-emerald-500 text-emerald-500' },
  { id: 'travel', name: '旅行', icon: Plane, color: 'bg-sky-500 text-sky-500' },
  { id: 'communication', name: '通信費', icon: Smartphone, color: 'bg-violet-500 text-violet-500' },
  { id: 'subscription', name: 'サブスク', icon: Repeat, color: 'bg-cyan-500 text-cyan-500' },
  { id: 'investment', name: '投資', icon: TrendingUp, color: 'bg-teal-500 text-teal-500' },
  { id: 'other', name: 'その他', icon: HelpCircle, color: 'bg-gray-500 text-gray-500' },
];

// カテゴリの色定義（例: 'bg-amber-500 text-amber-500'）から色名（'amber'）だけ取り出す。
// ドーナツグラフはTailwindのクラス名を解釈できないSVGなので、実際の色に変換して渡す。
function categoryColorName(cat) {
  const m = cat.color.match(/bg-([a-z]+)-/);
  return m ? m[1] : 'gray';
}

// 店名・利用先の文字列に含まれるキーワードから、カテゴリを推測するための対応表。
// スクリーンショット読み取り（OCR）・Gmail自動取り込み（gmail-import/Code.gs）共通で使う。
// gmail-import/Code.gs の guessCategory_ も同じ内容にしてあるので、キーワードを
// 追加・変更したら両方のファイルに反映すること。優先度は上から順。
const CATEGORY_KEYWORDS = [
  ['food', ['スーパー', 'マルエツ', 'イオン', '成城石井', 'コンビニ', 'セブン', 'ローソン', 'ファミリーマート', 'ファミマ', 'マクドナルド', 'モスバーガー', 'スターバックス', 'ドトール', 'カフェ', 'コーヒー', 'レストラン', '食堂', '弁当', '居酒屋', 'サイゼリヤ', '吉野家', 'すき家', '松屋', 'ラーメン', '寿司', '焼肉']],
  ['daily', ['無印良品', 'ドンキ', 'ドン・キホーテ', 'ロフト', 'ダイソー', 'セリア', 'キャンドゥ', '100円ショップ', 'ドラッグストア', 'マツモトキヨシ', 'マツキヨ', 'ウエルシア', 'ツルハ', 'サンドラッグ', 'ニトリ', '東急ハンズ', 'ホームセンター', 'カインズ', 'コーナン']],
  ['procurement', ['アリエクスプレス', 'AliExpress', 'Ali Express', 'タオバオ', 'Taobao', '1688', 'Pinduoduo', '拼多多', 'Temu', 'SHEIN', '速卖通']],
  ['beauty', ['美容院', 'ヘアサロン', '理容', 'ネイル', 'エステ', 'まつげ', 'コスメ', '化粧品', '資生堂', 'Shiseido', 'アットコスメ', '脱毛']],
  ['social', ['ギフト', '贈り物', '贈答', 'ご祝儀', 'お祝い', 'プレゼント', '冠婚葬祭', '香典']],
  ['entertainment', ['映画', '遊園地', 'ゲーム', 'カラオケ', 'ライブ', 'ジム', 'シネマ', 'ディズニー', 'USJ', 'Switch', 'PlayStation', 'Steam', 'コミック', '漫画', 'シーモア', '電子書籍', 'Kindle', 'ebookjapan', 'DMM', 'FANZA', 'ニコニコ']],
  ['travel', ['JTB', 'HIS', 'エイチ・アイ・エス', '楽天トラベル', 'じゃらん', 'Booking', 'Expedia', 'Airbnb', 'エアビーアンドビー', 'ホテル', '旅館', '民宿']],
  ['communication', ['povo', 'ｐｏｖｏ', 'ドコモ', 'ａｕ', 'ソフトバンク', 'モバイル', 'ﾓﾊﾞｲﾙ', 'ワイモバイル', 'UQ', 'NHK', 'Wi-Fi', 'ネット', '楽天モバイル']],
  ['subscription', ['サブスク', '月額', 'Netflix', 'Spotify', 'プライム', 'Amazon Prime', 'Hulu', 'U-NEXT', 'ユーネクスト', 'Abema', 'Disney', 'ディズニープラス', 'Apple Music', 'Apple One', 'iCloud', 'Adobe', 'YouTube Premium', 'ユーチューブプレミアム']],
  ['investment', ['SBI証券', '楽天証券', '松井証券', 'マネックス証券', 'auカブコム', 'カブコム証券', 'NISA', 'ｉＤｅＣｏ', 'iDeCo', '積立', '投信', '投資信託', '株式', 'FX', '暗号資産', 'ビットコイン', 'Bitcoin', 'Coincheck', 'コインチェック', 'bitFlyer', 'ビットフライヤー', 'GMOコイン']],
  ['transport', ['Suica', 'PASMO', 'ETC', '新幹線', 'ＪＲ', 'JR', '電車', 'バス', 'タクシー', 'Cycling', 'サイクリング', 'ガソリン', 'ＥＮＥＯＳ', '駐車場', 'メトロ', 'タイムズ', 'ANA', 'JAL', '航空', 'チャージ']],
];

// 全角英数字（ＳＢＩ、ｐｏｖｏ など）を半角に正規化してから比較するためのヘルパー。
// カード明細アプリは全角で表示することが多く、単純な toLowerCase() だけでは
// 半角キーワードと一致しないため。
function toComparableText(str) {
  return (str || '').normalize('NFKC').toLowerCase();
}

function guessCategoryFromMemo(memo) {
  if (!memo) return 'other';
  const normalized = toComparableText(memo).replace(/\s+/g, '');
  for (const [categoryId, keywords] of CATEGORY_KEYWORDS) {
    if (keywords.some((kw) => normalized.includes(toComparableText(kw)))) return categoryId;
  }
  return 'other';
}

// よく見かける店名・サービス名。OCRで多少崩れて読まれても（余分な文字・
// 半角全角の揺れなど）表記ゆれを吸収して、正式名称＋カテゴリに寄せるための対応表。
const KNOWN_MERCHANTS = [
  { match: 'パルコ', name: 'パルコ', category: 'other' },
  { match: 'ユニクロ', name: 'ユニクロ', category: 'other' },
  { match: 'gu', name: 'GU', category: 'other' },
  { match: '無印良品', name: '無印良品', category: 'daily' },
  { match: 'ヨドバシ', name: 'ヨドバシカメラ', category: 'other' },
  { match: 'ビックカメラ', name: 'ビックカメラ', category: 'other' },
  { match: 'aliexpress', name: 'AliExpress', category: 'procurement' },
  { match: 'ali express', name: 'AliExpress', category: 'procurement' },
  { match: 'taobao', name: 'Taobao', category: 'procurement' },
  { match: 'temu', name: 'Temu', category: 'procurement' },
  { match: 'シーモア', name: 'コミックシーモア', category: 'entertainment' },
  { match: 'kindle', name: 'Kindle', category: 'entertainment' },
  { match: 'ebookjapan', name: 'ebookJapan', category: 'entertainment' },
  { match: 'cycling', name: 'Hello Cycling', category: 'transport' },
  { match: 'chargespot', name: 'ChargeSPOT', category: 'other' },
  { match: 'suica', name: 'Suica', category: 'transport' },
  { match: 'pasmo', name: 'PASMO', category: 'transport' },
  { match: 'povo', name: 'povo', category: 'communication' },
  { match: 'docomo', name: 'ドコモ', category: 'communication' },
  { match: 'ソフトバンク', name: 'ソフトバンク', category: 'communication' },
  { match: 'ラクテンモバイル', name: '楽天モバイル', category: 'communication' },
  { match: '楽天モバイル', name: '楽天モバイル', category: 'communication' },
  { match: 'netflix', name: 'Netflix', category: 'subscription' },
  { match: 'spotify', name: 'Spotify', category: 'subscription' },
  { match: 'sbi証券', name: 'SBI証券', category: 'investment' },
  { match: 'スターバックス', name: 'スターバックス', category: 'food' },
  { match: 'ドトール', name: 'ドトール', category: 'food' },
  { match: 'マクドナルド', name: 'マクドナルド', category: 'food' },
  { match: 'セブン', name: 'セブン-イレブン', category: 'food' },
  { match: 'ローソン', name: 'ローソン', category: 'food' },
  { match: 'ファミマ', name: 'ファミリーマート', category: 'food' },
  { match: 'ファミリーマート', name: 'ファミリーマート', category: 'food' },
];

/**
 * OCRで読み取った店名の表記ゆれ・ノイズ（アンダースコア、孤立した1文字、
 * 全角半角の揺れなど）を軽く整えつつ、既知の店名リストに近ければ
 * 正式名称＋カテゴリに置き換える。
 */
function cleanMerchantName(rawMemo) {
  const base = (rawMemo || '').replace(/[_＿]/g, ' ').replace(/\s+/g, ' ').trim();
  const compact = toComparableText(base).replace(/\s+/g, '');

  for (const merchant of KNOWN_MERCHANTS) {
    if (compact.includes(toComparableText(merchant.match).replace(/\s+/g, ''))) {
      return { name: merchant.name, category: merchant.category };
    }
  }

  // 一致しない場合も、行末に紛れ込みがちな孤立した1文字（アイコンの誤読など）だけ除く
  const trimmed = base.replace(/\s+[ぁ-んァ-ヶ]$/u, '').trim() || base;
  return { name: trimmed, category: guessCategoryFromMemo(trimmed) };
}

// 初回起動時のサンプルデータ（保存データが無いときのみ使われる）
const DEFAULT_CARDS = [
  {
    id: 'card-1',
    name: 'メインゴールドカード',
    brand: 'VISA',
    last4: '4821',
    number: '4532 0151 1283 4821',
    holderName: 'TARO YAMADA',
    expiry: '08/29',
    cvv: '412',
    theme: 'purple',
    limit: 300000,
    billingDay: '15',
    paymentDay: '10',
    weekendAdjustment: 'none',
    bankAccount: '三井住友銀行',
  },
  {
    id: 'card-2',
    name: '楽天カード',
    brand: 'Mastercard',
    last4: '9102',
    number: '5412 7534 8890 9102',
    holderName: 'TARO YAMADA',
    expiry: '11/28',
    cvv: '256',
    theme: 'sunset',
    limit: 200000,
    billingDay: '末日',
    paymentDay: '27',
    weekendAdjustment: 'none',
    bankAccount: '楽天銀行',
  },
  {
    id: 'card-3',
    name: '交通系JCBカード',
    brand: 'JCB',
    last4: '3310',
    number: '3528 1147 9902 3310',
    holderName: 'TARO YAMADA',
    expiry: '03/27',
    cvv: '789',
    theme: 'blue',
    limit: 100000,
    billingDay: '末日',
    paymentDay: '10',
    weekendAdjustment: 'none',
    bankAccount: '',
  },
];

const DEFAULT_TRANSACTIONS = [
  // 4月〜6月（月別推移のサンプル用）
  { id: 't-101', cardId: 'card-1', amount: 68000, date: '2026-04-10', category: 'daily', memo: '新生活用品' },
  { id: 't-102', cardId: 'card-2', amount: 21000, date: '2026-04-20', category: 'food', memo: '' },
  { id: 't-103', cardId: 'card-1', amount: 74000, date: '2026-05-08', category: 'other', memo: '' },
  { id: 't-104', cardId: 'card-2', amount: 26000, date: '2026-05-24', category: 'other', memo: '' },
  { id: 't-105', cardId: 'card-1', amount: 61000, date: '2026-06-12', category: 'food', memo: '' },
  { id: 't-106', cardId: 'card-3', amount: 15000, date: '2026-06-18', category: 'transport', memo: '' },
  // 7月
  { id: 't-7', cardId: 'card-1', amount: 28000, date: '2026-07-18', category: 'other', memo: '夏服購入' },
  { id: 't-8', cardId: 'card-2', amount: 15000, date: '2026-07-22', category: 'food', memo: '外食・飲み会' },
  // 8月
  { id: 't-1', cardId: 'card-1', amount: 14800, date: '2026-08-02', category: 'food', memo: '週末スーパー買い物' },
  { id: 't-2', cardId: 'card-2', amount: 32000, date: '2026-08-05', category: 'other', memo: 'スニーカー新調' },
  { id: 't-3', cardId: 'card-3', amount: 8500, date: '2026-08-08', category: 'transport', memo: 'チャージ＆新幹線チケット' },
  { id: 't-4', cardId: 'card-1', amount: 9800, date: '2026-08-10', category: 'communication', memo: '通信費・サブスク' },
  { id: 't-5', cardId: 'card-2', amount: 12400, date: '2026-08-12', category: 'social', memo: '友人とのディナー' },
  { id: 't-6', cardId: 'card-1', amount: 4500, date: '2026-08-15', category: 'food', memo: 'カフェ・ランチ' },
];

// クレジットカード以外の支払い方法（現金・PayPay等）を、カードとは別の
// 拡張可能なマスタとして持つ。コードに個別の決済サービスを固定実装するのではなく、
// 「支払い方法」というデータとして追加・編集・無効化できるようにするための土台。
// id は固定値にしておくことで、既存の明細（cardIdのみを持つ）を後方互換で
// 「クレジットカード」として扱う際の参照先にできる。
// type は画面には出さず、将来カテゴリ分け（QRコード決済まとめ表示等）が必要に
// なったときのための内部区分。
const PAYMENT_METHOD_CREDIT_CARD_ID = 'pm-credit-card';
const DEFAULT_PAYMENT_METHODS = [
  { id: PAYMENT_METHOD_CREDIT_CARD_ID, name: 'クレジットカード', type: 'credit_card', icon: 'credit-card', displayOrder: 0, isActive: true },
  { id: 'pm-cash', name: '現金', type: 'cash', icon: 'wallet', displayOrder: 1, isActive: true },
  { id: 'pm-paypay', name: 'PayPay', type: 'qr_payment', icon: 'qr-code', displayOrder: 2, isActive: true },
  { id: 'pm-paidy', name: 'Paidy', type: 'deferred_payment', icon: 'clock', displayOrder: 3, isActive: true },
  { id: 'pm-rakuten-pay', name: '楽天ペイ', type: 'qr_payment', icon: 'qr-code', displayOrder: 4, isActive: true },
  { id: 'pm-d-payment', name: 'd払い', type: 'qr_payment', icon: 'qr-code', displayOrder: 5, isActive: true },
  { id: 'pm-au-pay', name: 'au PAY', type: 'qr_payment', icon: 'qr-code', displayOrder: 6, isActive: true },
  { id: 'pm-merpay', name: 'メルペイ', type: 'qr_payment', icon: 'qr-code', displayOrder: 7, isActive: true },
  { id: 'pm-other', name: 'その他', type: 'other', icon: 'more-horizontal', displayOrder: 8, isActive: true },
];

function currentMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ---------- 請求サイクル・支払いスケジュール計算 ----------
// 「毎月○日締め・毎月○日払い」というカードの規則から、実際のカレンダー日付・
// 請求対象期間・未払い分の合計額を求めるための純粋関数群。

/** 「27」「末日」などの表記を日番号(1-31)または 'last' に変換。パースできなければ null。 */
function parseDayNumber(text) {
  if (!text) return null;
  if (/末/.test(text)) return 'last';
  const m = String(text).match(/\d+/);
  if (!m) return null;
  const n = parseInt(m[0], 10);
  return n >= 1 && n <= 31 ? n : null;
}

/** 指定した年月（monthは0始まり、範囲外もOK＝自動でその前後の月に繰り上がる）の実日付を返す。 */
function dateForDayInMonth(year, month, dayNum) {
  if (dayNum === 'last') return new Date(year, month + 1, 0); // その月の最終日
  const lastDayOfMonth = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(dayNum, lastDayOfMonth));
}

function isWeekend(date) {
  const day = date.getDay();
  return day === 0 || day === 6;
}

/**
 * 支払日が土日にあたる場合の調整（'next'=翌営業日 / 'prev'=前営業日 / 'none'=調整しない）。
 * 祝日は正確に判定できないため対象外（誤った日付を生成しないための意図的な仕様）。
 */
function adjustPaymentDate(date, mode) {
  if (!mode || mode === 'none') return date;
  const result = new Date(date);
  if (mode === 'next') {
    while (isWeekend(result)) result.setDate(result.getDate() + 1);
  } else if (mode === 'prev') {
    while (isWeekend(result)) result.setDate(result.getDate() - 1);
  }
  return result;
}

/**
 * 締め日と支払日の日番号から、支払いが締め月と同じ月か翌月かを判定するヒューリスティック。
 * 一般的なカードの規則（締め日の直後に来る日番号なら翌月払い）に基づく。
 * 例: 締め日=末日, 支払日=27 → 27 <= 31.5 → 翌月払い（多くのカードの実態と一致）
 */
function isPaymentInNextMonth(billingDayNum, paymentDayNum) {
  const b = billingDayNum === 'last' ? 31.5 : billingDayNum;
  const p = paymentDayNum === 'last' ? 31.5 : paymentDayNum;
  return p <= b;
}

function toDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * カードの支払日が指定した年月（payMonthは0始まり）に来る場合の、支払日・対象請求期間を求める。
 * 締め日/支払日が未設定・不正な場合は null。
 */
function getCardCycleForPaymentMonth(card, payYear, payMonth) {
  const billingNum = parseDayNumber(card.billingDay);
  const paymentNum = parseDayNumber(card.paymentDay);
  if (!billingNum || !paymentNum) return null;

  const monthOffset = isPaymentInNextMonth(billingNum, paymentNum) ? 1 : 0;
  const closingDate = dateForDayInMonth(payYear, payMonth - monthOffset, billingNum);
  const prevClosingDate = dateForDayInMonth(payYear, payMonth - monthOffset - 1, billingNum);
  const rawPaymentDate = dateForDayInMonth(payYear, payMonth, paymentNum);
  const paymentDate = adjustPaymentDate(rawPaymentDate, card.weekendAdjustment);

  return {
    paymentDate,
    cycleEnd: toDateKey(closingDate),
    cycleStartExclusive: toDateKey(prevClosingDate),
  };
}

/** 今日から見て、まだ支払日が来ていない直近の請求サイクルを求める。 */
function findNextUnpaidCycle(card, today = new Date()) {
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  for (let offset = -1; offset <= 3; offset += 1) {
    const cycle = getCardCycleForPaymentMonth(card, today.getFullYear(), today.getMonth() + offset);
    if (cycle && cycle.paymentDate >= todayStart) return cycle;
  }
  return null;
}

/** 指定した請求サイクルに該当する明細の合計額。 */
function sumTransactionsInCycle(transactions, cardId, cycle) {
  if (!cycle) return 0;
  return transactions
    .filter((t) => t.cardId === cardId)
    .filter((t) => (!cycle.cycleStartExclusive || t.date > cycle.cycleStartExclusive) && t.date <= cycle.cycleEnd)
    .reduce((sum, t) => sum + Number(t.amount), 0);
}

function monthRange(startKey, endKey) {
  const [sy, sm] = startKey.split('-').map(Number);
  const [ey, em] = endKey.split('-').map(Number);
  const out = [];
  let y = sy;
  let m = sm;
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

/** Continuous, zero-filled monthly totals for a set of transactions. */
function buildMonthlySeries(txs) {
  if (!txs.length) return [];
  const sums = new Map();
  let min = null;
  let max = null;
  txs.forEach((t) => {
    const mk = t.date.slice(0, 7);
    sums.set(mk, (sums.get(mk) || 0) + Number(t.amount));
    if (!min || mk < min) min = mk;
    if (!max || mk > max) max = mk;
  });
  return monthRange(min, max).map((k) => ({
    key: k,
    xLabel: `${Number(k.slice(5, 7))}月`,
    fullLabel: `${k.slice(0, 4)}年${Number(k.slice(5, 7))}月`,
    value: sums.get(k) || 0,
  }));
}

function formatCardNumber(number) {
  const digits = (number || '').replace(/\D/g, '');
  if (!digits) return '未登録';
  return digits.replace(/(.{4})(?=.)/g, '$1 ');
}

function maskCardNumber(number, last4) {
  const digits = (number || '').replace(/\D/g, '');
  const tail = digits ? digits.slice(-4) : (last4 || '0000');
  return `•••• •••• •••• ${tail}`;
}

// 日本語カテゴリ名 → カテゴリID の対応表（インポート時に使用）
const CATEGORY_NAME_TO_ID = CATEGORIES.reduce((map, c) => {
  map[c.name] = c.id;
  return map;
}, {});

function resolveCategoryId(value) {
  if (!value) return 'other';
  if (CATEGORIES.some((c) => c.id === value)) return value;
  if (CATEGORY_NAME_TO_ID[value]) return CATEGORY_NAME_TO_ID[value];
  return 'other';
}

function resolveDate(value) {
  if (!value) return new Date().toISOString().split('T')[0];
  // "2026年8月10日" のような表記もざっくり受け付ける
  const m = String(value).match(/(\d{4})[/\-年](\d{1,2})[/\-月](\d{1,2})/);
  if (m) {
    const [, y, mo, d] = m;
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  return value;
}

// ---------- 画像（スクリーンショット）からの明細読み取り ----------

function parseAmountToken(str) {
  const digits = str.replace(/[^\d]/g, '');
  return digits ? Number(digits) : null;
}

function parseDateToken(token, fallbackYear) {
  // 2026/08/10, 2026-08-10, 2026年8月10日
  let m = token.match(/(\d{4})[/\-年](\d{1,2})[/\-月](\d{1,2})日?/);
  if (m) {
    const [, y, mo, d] = m;
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  // 26.07.01 のような西暦下2桁・ドット区切り（クレジットカード明細アプリでよく見る表記）
  m = token.match(/^(\d{2})\.(\d{1,2})\.(\d{1,2})$/);
  if (m) {
    const [, yy, mo, d] = m;
    return `${2000 + Number(yy)}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  // 8/10, 8月10日（年なし）
  m = token.match(/^(\d{1,2})[/月](\d{1,2})日?$/);
  if (m) {
    const [, mo, d] = m;
    return `${fallbackYear}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  return null;
}

const OCR_DATE_REGEX = /(\d{4}[/\-年]\d{1,2}[/\-月]\d{1,2}日?|\d{2}\.\d{1,2}\.\d{1,2}|\d{1,2}[/月]\d{1,2}日)/;
const OCR_AMOUNT_REGEX = /[¥￥]\s?[\d,]{2,}|[\d,]{3,}\s?円/;

/**
 * OCR前の画像前処理。スマホのスクリーンショットは見た目の解像度は高くても、
 * 実際の文字の高さ（ピクセル数）が小さく、Tesseractの認識精度が落ちやすい。
 * 十分な文字高さになるまで拡大し、グレースケール化＋コントラスト強調してから渡す。
 * 失敗した場合は元のファイルをそのまま使う（呼び出し側でフォールバック）。
 */
async function preprocessImageForOcr(file) {
  const img = await createImageBitmap(file);
  const targetWidth = 1800;
  const scale = Math.min(3, Math.max(1, targetWidth / img.width));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  // グレースケール化 + 簡易コントラスト強調
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { data } = imageData;
  const contrast = 1.35;
  for (let i = 0; i < data.length; i += 4) {
    const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    const adjusted = Math.min(255, Math.max(0, (gray - 128) * contrast + 128));
    data[i] = adjusted;
    data[i + 1] = adjusted;
    data[i + 2] = adjusted;
  }
  ctx.putImageData(imageData, 0, 0);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))), 'image/png');
  });
}

/**
 * OCRの単語＋座標から、画面上の「行」を再構成する。
 * カード明細アプリは店名／金額が同じ横位置、日付／回数がその下の行、
 * というレイアウトが多く、素の認識テキストの並び順だけでは崩れやすいため、
 * 単語の縦位置でグルーピングし直してから読む。
 */
function groupWordsIntoRows(words) {
  const clean = (words || [])
    .filter((w) => w.text && w.text.trim())
    .map((w) => ({
      text: w.text.trim(),
      x: w.bbox.x0,
      y: (w.bbox.y0 + w.bbox.y1) / 2,
      h: Math.max(w.bbox.y1 - w.bbox.y0, 1),
    }));
  if (!clean.length) return [];

  clean.sort((a, b) => a.y - b.y);
  const avgH = clean.reduce((s, w) => s + w.h, 0) / clean.length;
  const threshold = avgH * 0.6;

  const rows = [];
  let current = [clean[0]];
  let currentY = clean[0].y;
  for (let i = 1; i < clean.length; i++) {
    const w = clean[i];
    if (Math.abs(w.y - currentY) <= threshold) {
      current.push(w);
      currentY = current.reduce((s, x) => s + x.y, 0) / current.length;
    } else {
      rows.push(current);
      current = [w];
      currentY = w.y;
    }
  }
  rows.push(current);

  return rows.map((row) => row.sort((a, b) => a.x - b.x).map((w) => w.text).join(' '));
}

/**
 * 行の配列から、日付＋金額の組を推測して候補リストを作る。
 * あくまで「たたき台」— 呼び出し側で必ず確認・編集させる前提。
 * 店名＋金額が同じ行、日付が別行（前後どちらもありうる）というレイアウトに対応する。
 */
function parseTransactionsFromRows(rawLines) {
  const year = new Date().getFullYear();
  const lines = rawLines.map((l) => l.trim()).filter(Boolean);

  const candidates = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const dateMatch = line.match(OCR_DATE_REGEX);
    if (!dateMatch) continue;
    const date = parseDateToken(dateMatch[0], year);
    if (!date) continue;

    let amount = null;
    let memoSource = '';

    const sameLineAmt = line.match(OCR_AMOUNT_REGEX);
    if (sameLineAmt) {
      amount = parseAmountToken(sameLineAmt[0]);
      memoSource = line.replace(dateMatch[0], '').replace(sameLineAmt[0], '').trim();
    } else {
      // 店名＋金額は前の行にあることが多いレイアウトを優先しつつ、後ろの行も見る
      for (const j of [i - 1, i + 1, i - 2, i + 2]) {
        if (j < 0 || j >= lines.length) continue;
        const amtMatch = lines[j].match(OCR_AMOUNT_REGEX);
        if (amtMatch) {
          amount = parseAmountToken(amtMatch[0]);
          memoSource = lines[j].replace(amtMatch[0], '').trim();
          break;
        }
      }
    }
    if (!amount) continue;

    const rawMemo = memoSource.replace(/[|•·]/g, '').trim().slice(0, 40);
    const { name: memo, category } = cleanMerchantName(rawMemo);
    candidates.push({
      id: `ocr-${i}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      date,
      amount,
      category,
      memo,
    });
  }
  return candidates.slice(0, 50);
}

// 期間切替バー（月間タブ・年間分析タブで共有）。表示するラベルと前後ボタンの
// ハンドラだけを差し替え、見た目（幅・余白・背景・矢印位置）は常に同じにする。
function PeriodNavigator({ label, onPrev, onNext, prevTitle, nextTitle }) {
  return (
    <div className="bg-slate-800/50 border-b border-slate-800/80 px-4 py-2.5">
      <div className="max-w-6xl mx-auto flex items-center justify-between">
        <button
          onClick={onPrev}
          className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
          title={prevTitle}
        >
          <ChevronLeft className="w-5 h-5" />
        </button>

        <div className="flex items-center space-x-2">
          <Calendar className="w-5 h-5 text-indigo-400" />
          <span className="text-lg font-bold tracking-wide text-white">{label}</span>
        </div>

        <button
          onClick={onNext}
          className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
          title={nextTitle}
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}

export default function App() {
  // 現在選択されている年月 (YYYY-MM) — 実際の今日の日付から算出
  const [currentMonth, setCurrentMonth] = useState(currentMonthKey);
  const [activeTab, setActiveTab] = useState('dashboard'); // 'dashboard' | 'transactions' | 'calendar' | 'analysis' | 'cards'

  // モーダルの状態
  const [isAddTransactionOpen, setIsAddTransactionOpen] = useState(false);
  const [isAddCardOpen, setIsAddCardOpen] = useState(false);
  const [isPendingReviewOpen, setIsPendingReviewOpen] = useState(false);

  // 編集中のID（nullなら新規追加モード）
  const [editingTxId, setEditingTxId] = useState(null);
  const [editingCardId, setEditingCardId] = useState(null);
  // 確認待ちの利用通知から「このカードを追加する」で開いた場合、そのカード保存後に
  // 続けて明細を作成し、確認待ちから消すために覚えておくID
  const [resolvingPendingId, setResolvingPendingId] = useState(null);
  // 確認待ち一覧での支払い方法・カード選択state（明細id → { paymentMethodId, cardId }）
  const [pendingLinkChoice, setPendingLinkChoice] = useState({});

  // クレジットカードデータ（保存データがあればそれを、無ければサンプルを初期値に）
  const [cards, setCards] = useState(() => loadList(STORAGE_KEYS.cards, DEFAULT_CARDS));

  // 利用明細データ
  const [transactions, setTransactions] = useState(() => loadList(STORAGE_KEYS.transactions, DEFAULT_TRANSACTIONS));

  // データが変わるたびにブラウザにもキャッシュ保存（オフライン時の即時表示用）
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.cards, JSON.stringify(cards));
  }, [cards]);
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.transactions, JSON.stringify(transactions));
  }, [transactions]);

  // --- クラウド同期（Firebase） ---
  // authUser: undefined = 確認中 / null = 未ログイン(ゲート表示) / User = ログイン済み
  const [authUser, setAuthUser] = useState(undefined);
  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);
  const migratedUidRef = useRef(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => setAuthUser(user));
    return unsub;
  }, []);

  // 初回ログイン時、この端末のローカルデータをクラウドへ一度だけ移行する
  // （クラウド側が空の場合のみ。既にクラウドにデータがあれば何もしない）
  useEffect(() => {
    if (!authUser) return;
    if (migratedUidRef.current === authUser.uid) return;
    migratedUidRef.current = authUser.uid;

    (async () => {
      try {
        const existingCards = await getDocs(getCardsColRef(authUser.uid));
        if (!existingCards.empty) return; // 既にクラウドにデータあり。移行不要

        const localCardsRaw = localStorage.getItem(STORAGE_KEYS.cards);
        const localTxRaw = localStorage.getItem(STORAGE_KEYS.transactions);
        const seedCards = localCardsRaw ? JSON.parse(localCardsRaw) : DEFAULT_CARDS;
        const seedTx = localTxRaw ? JSON.parse(localTxRaw) : DEFAULT_TRANSACTIONS;

        const batch = writeBatch(db);
        seedCards.forEach((c) => batch.set(cardDocRef(authUser.uid, c.id), c));
        seedTx.forEach((t) => batch.set(transactionDocRef(authUser.uid, t.id), t));
        await batch.commit();
      } catch (err) {
        console.error('初回データ移行に失敗しました', err);
      }
    })();
  }, [authUser]);

  // クラウドのカード・明細データをリアルタイム購読し、ローカル状態へ反映する
  useEffect(() => {
    if (!authUser) return undefined;

    const unsubCards = onSnapshot(
      getCardsColRef(authUser.uid),
      (snap) => setCards(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) => console.error('カードの同期に失敗しました', err)
    );
    const unsubTx = onSnapshot(
      getTransactionsColRef(authUser.uid),
      (snap) => setTransactions(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) => console.error('明細の同期に失敗しました', err)
    );

    return () => {
      unsubCards();
      unsubTx();
    };
  }, [authUser]);

  // Gmail自動取り込み（Apps Script）の実行状況。設定していない場合は null のまま。
  const [gmailImportStatus, setGmailImportStatus] = useState(null);
  useEffect(() => {
    if (!authUser) return undefined;
    const unsub = onSnapshot(
      gmailImportStatusDocRef(authUser.uid),
      (snap) => setGmailImportStatus(snap.exists() ? snap.data() : null),
      () => setGmailImportStatus(null)
    );
    return unsub;
  }, [authUser]);

  // Gmail自動取り込みが「確信が持てなかった」ため保留した利用通知（確認待ち）
  const [pendingImports, setPendingImports] = useState([]);
  useEffect(() => {
    if (!authUser) return undefined;
    const unsub = onSnapshot(
      getPendingImportsColRef(authUser.uid),
      (snap) => setPendingImports(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) => console.error('確認待ち一覧の同期に失敗しました', err)
    );
    return unsub;
  }, [authUser]);

  // 支払い方法（クレジットカード／現金／PayPay等）のリアルタイム購読
  const [paymentMethods, setPaymentMethods] = useState([]);
  useEffect(() => {
    if (!authUser) return undefined;
    const unsub = onSnapshot(
      getPaymentMethodsColRef(authUser.uid),
      (snap) => setPaymentMethods(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) => console.error('支払い方法の同期に失敗しました', err)
    );
    return unsub;
  }, [authUser]);

  // 支払い方法マスタが1件も無ければ、初期セット（クレジットカード・現金・PayPay等）を
  // 1度だけ書き込む。既存ユーザー（カード・明細はあるが支払い方法コレクションは
  // まだ無い）でも動くよう、cards/transactionsの初回移行とは別に判定する。
  const paymentMethodsSeededRef = useRef(null);
  useEffect(() => {
    if (!authUser) return;
    if (paymentMethodsSeededRef.current === authUser.uid) return;
    paymentMethodsSeededRef.current = authUser.uid;

    (async () => {
      try {
        const existing = await getDocs(getPaymentMethodsColRef(authUser.uid));
        if (!existing.empty) return;
        const batch = writeBatch(db);
        DEFAULT_PAYMENT_METHODS.forEach((pm) => batch.set(paymentMethodDocRef(authUser.uid, pm.id), pm));
        await batch.commit();
      } catch (err) {
        console.error('支払い方法の初期登録に失敗しました', err);
      }
    })();
  }, [authUser]);

  // 認証ゲート（未ログイン端末向け）フォームのステート
  const [gateEmail, setGateEmail] = useState('');
  const [gatePassword, setGatePassword] = useState('');
  const [gateError, setGateError] = useState('');
  const [gateBusy, setGateBusy] = useState(false);

  const handleGateLogin = async (e) => {
    e.preventDefault();
    setGateError('');
    if (!gateEmail || !gatePassword) {
      setGateError('メールアドレスとパスワードを入力してください');
      return;
    }
    setGateBusy(true);
    try {
      await signInWithEmailAndPassword(auth, gateEmail.trim(), gatePassword);
    } catch (err) {
      console.error(err);
      setGateError('ログインに失敗しました。メールアドレスかパスワードが正しくありません');
    } finally {
      setGateBusy(false);
    }
  };

  const handleGateStartFresh = async () => {
    setGateBusy(true);
    try {
      await signInAnonymously(auth);
    } catch (err) {
      console.error(err);
      alert('開始に失敗しました。通信環境をご確認ください。');
    } finally {
      setGateBusy(false);
    }
  };

  // アカウント連携（匿名 → メール/パスワード）フォームのステート
  const [linkEmail, setLinkEmail] = useState('');
  const [linkPassword, setLinkPassword] = useState('');
  const [linkError, setLinkError] = useState('');
  const [linkBusy, setLinkBusy] = useState(false);

  const handleLinkEmailAccount = async (e) => {
    e.preventDefault();
    setLinkError('');
    if (!linkEmail || !linkPassword) {
      setLinkError('メールアドレスとパスワードを入力してください');
      return;
    }
    if (linkPassword.length < 6) {
      setLinkError('パスワードは6文字以上にしてください');
      return;
    }
    setLinkBusy(true);
    try {
      const cred = EmailAuthProvider.credential(linkEmail.trim(), linkPassword);
      await linkWithCredential(auth.currentUser, cred);
      setLinkEmail('');
      setLinkPassword('');
      alert('設定が完了しました。他の端末でもこのメールアドレスでログインできます。');
    } catch (err) {
      console.error(err);
      if (err.code === 'auth/email-already-in-use') {
        setLinkError('このメールアドレスは既に使われています');
      } else {
        setLinkError('設定に失敗しました。もう一度お試しください');
      }
    } finally {
      setLinkBusy(false);
    }
  };

  const handleLogout = async () => {
    if (confirm('ログアウトしますか？（この端末に保存されたキャッシュは残りますが、次回はログインが必要です）')) {
      await signOut(auth);
    }
  };

  // フィルター用ステート（明細タブ）
  const [filterCardId, setFilterCardId] = useState('all');
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterPaymentMethodId, setFilterPaymentMethodId] = useState('all');
  // 期間を指定した場合だけ、月切替（currentMonth）の範囲を超えて全期間から検索する。
  // 空欄なら今まで通り「表示中の月」の明細だけを対象にする。
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [filterAmountMin, setFilterAmountMin] = useState('');
  const [filterAmountMax, setFilterAmountMax] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  // 月別推移グラフのステート
  const [trendMode, setTrendMode] = useState('total'); // 'total' | 'paymentMethod' | 'category'
  const [trendPaymentMethodId, setTrendPaymentMethodId] = useState('');
  const [trendCategoryId, setTrendCategoryId] = useState('');
  // ダッシュボードのカテゴリ別支出をリスト/円グラフのどちらで見るか
  const [categoryViewMode, setCategoryViewMode] = useState('list'); // 'list' | 'donut'

  // 新規明細フォームのステート
  // merchant（店舗名）は検索・集計・店舗別分析に使う主表示名、memoは自由記述の補足メモ。
  const [newTx, setNewTx] = useState({
    paymentMethodId: PAYMENT_METHOD_CREDIT_CARD_ID,
    cardId: cards[0]?.id || '',
    amount: '',
    date: new Date().toISOString().split('T')[0],
    category: 'food',
    merchant: '',
    memo: '',
  });

  // 新規カードフォームのステート
  const [newCard, setNewCard] = useState({
    name: '',
    brand: 'VISA',
    number: '',
    holderName: '',
    expiry: '',
    cvv: '',
    theme: 'purple',
    limit: 200000,
    billingDay: '末日',
    paymentDay: '27',
    weekendAdjustment: 'none',
    bankAccount: '',
  });

  // カード番号・有効期限・セキュリティコードを表示中のカードID
  const [revealedCards, setRevealedCards] = useState(() => new Set());
  const toggleCardReveal = (cardId) => {
    setRevealedCards((prev) => {
      const next = new Set(prev);
      if (next.has(cardId)) next.delete(cardId);
      else next.add(cardId);
      return next;
    });
  };

  // カード番号・有効期限・セキュリティコードのコピーボタン用
  const [copiedField, setCopiedField] = useState(null);
  const handleCopyToClipboard = async (text, key) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(key);
      setTimeout(() => setCopiedField((prev) => (prev === key ? null : prev)), 1500);
    } catch (err) {
      console.error(err);
      alert('コピーに失敗しました。');
    }
  };

  // --- 月の切り替え処理 ---
  const handleMonthChange = (offset) => {
    const [year, month] = currentMonth.split('-').map(Number);
    const date = new Date(year, month - 1 + offset, 1);
    const newYear = date.getFullYear();
    const newMonth = String(date.getMonth() + 1).padStart(2, '0');
    setCurrentMonth(`${newYear}-${newMonth}`);
  };

  // 表示用の年月フォーマット（例: 2026年 8月）
  const formattedMonth = useMemo(() => {
    const [year, month] = currentMonth.split('-');
    return `${year}年 ${parseInt(month, 10)}月`;
  }, [currentMonth]);

  // --- 計算系ロジック ---
  // 当月の全明細
  const monthlyTransactions = useMemo(() => {
    return transactions.filter((t) => t.date.startsWith(currentMonth));
  }, [transactions, currentMonth]);

  // 当月の合計利用額
  const totalMonthlyAmount = useMemo(() => {
    return monthlyTransactions.reduce((sum, t) => sum + Number(t.amount), 0);
  }, [monthlyTransactions]);

  // --- 支出カレンダー用の集計 ---
  // 日付(YYYY-MM-DD)ごとの合計額・明細一覧
  const dailyTotals = useMemo(() => {
    const map = new Map();
    monthlyTransactions.forEach((t) => {
      const entry = map.get(t.date) || { total: 0, items: [] };
      entry.total += Number(t.amount);
      entry.items.push(t);
      map.set(t.date, entry);
    });
    return map;
  }, [monthlyTransactions]);

  // 支出の多い日を色の濃さで目立たせるための基準値
  const maxDailyTotal = useMemo(() => {
    let max = 0;
    dailyTotals.forEach((v) => { if (v.total > max) max = v.total; });
    return max;
  }, [dailyTotals]);

  // 月表示カレンダーのマス目（週ごとの配列。月初・月末の空白はnull）
  const calendarWeeks = useMemo(() => {
    const [year, month] = currentMonth.split('-').map(Number);
    const daysInMonth = new Date(year, month, 0).getDate();
    const startWeekday = new Date(year, month - 1, 1).getDay(); // 0=日曜
    const cells = [];
    for (let i = 0; i < startWeekday; i += 1) cells.push(null);
    for (let d = 1; d <= daysInMonth; d += 1) {
      cells.push({ day: d, dateKey: `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}` });
    }
    while (cells.length % 7 !== 0) cells.push(null);
    const weeks = [];
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
    return weeks;
  }, [currentMonth]);

  // カレンダーで選択中の日付。表示中の月が今日を含む月なら今日を初期選択、
  // それ以外の月では未選択（タップされるまで一覧を出さない）。
  const [selectedCalendarDate, setSelectedCalendarDate] = useState(null);
  useEffect(() => {
    const now = new Date();
    const nowMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    setSelectedCalendarDate(nowMonthKey === currentMonth ? toDateKey(now) : null);
  }, [currentMonth]);

  // 明細1件の「支払い方法」表示名（クレジットカードならカード名、それ以外は支払い方法名）
  const getPaymentLabel = (tx) => {
    const card = tx.cardId ? cards.find((c) => c.id === tx.cardId) : null;
    const method = paymentMethods.find((m) => m.id === tx.paymentMethodId);
    return tx.cardId ? (card?.name || '削除されたカード') : (method?.name || 'その他');
  };

  // カード別の当月利用額集計
  const cardMonthlyStats = useMemo(() => {
    return cards.map((card) => {
      const cardTxs = monthlyTransactions.filter((t) => t.cardId === card.id);
      const spent = cardTxs.reduce((sum, t) => sum + Number(t.amount), 0);
      const percentage = card.limit ? Math.min(Math.round((spent / card.limit) * 100), 100) : 0;
      return { ...card, spent, percentage };
    });
  }, [cards, monthlyTransactions]);

  // カードごとの「今年の累計・月平均」（カード管理タブの詳細表示用）
  const cardYearlyStats = useMemo(() => {
    const year = new Date().getFullYear();
    const map = {};
    cards.forEach((card) => {
      const relevant = transactions.filter((t) => t.cardId === card.id && t.date.startsWith(String(year)));
      const total = relevant.reduce((sum, t) => sum + Number(t.amount), 0);
      const monthsWithData = new Set(relevant.map((t) => t.date.slice(0, 7))).size;
      map[card.id] = { total, average: monthsWithData ? total / monthsWithData : 0 };
    });
    return map;
  }, [cards, transactions]);

  // カードごとの「通常より高め/少なめ」の控えめな注記（直近3ヶ月平均との比較、±20%以上のみ）
  const cardVarianceNotes = useMemo(() => {
    const [y, m] = currentMonth.split('-').map(Number);
    const map = {};
    cards.forEach((card) => {
      const thisMonthSpent = monthlyTransactions
        .filter((t) => t.cardId === card.id)
        .reduce((sum, t) => sum + Number(t.amount), 0);
      if (!thisMonthSpent) return;

      let total = 0;
      let count = 0;
      for (let i = 1; i <= 3; i += 1) {
        const d = new Date(y, m - 1 - i, 1);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const sum = transactions
          .filter((t) => t.cardId === card.id && t.date.startsWith(key))
          .reduce((s, t) => s + Number(t.amount), 0);
        if (sum > 0) { total += sum; count += 1; }
      }
      if (!count) return;

      const avg = total / count;
      const diffPct = ((thisMonthSpent - avg) / avg) * 100;
      if (Math.abs(diffPct) >= 20) {
        map[card.id] = { diffPct, higher: diffPct > 0 };
      }
    });
    return map;
  }, [cards, monthlyTransactions, transactions, currentMonth]);

  // カテゴリ別支出集計
  const categoryStats = useMemo(() => {
    const map = {};
    CATEGORIES.forEach((c) => { map[c.id] = 0; });

    monthlyTransactions.forEach((t) => {
      if (map[t.category] !== undefined) {
        map[t.category] += Number(t.amount);
      } else {
        map.other = (map.other || 0) + Number(t.amount);
      }
    });

    return CATEGORIES.map((cat) => ({
      ...cat,
      amount: map[cat.id] || 0,
      percentage: totalMonthlyAmount > 0 ? Math.round(((map[cat.id] || 0) / totalMonthlyAmount) * 100) : 0,
    })).sort((a, b) => b.amount - a.amount);
  }, [monthlyTransactions, totalMonthlyAmount]);

  // --- 分析タブ（月間・年間・カテゴリ）用の集計 ---
  const [analysisMode, setAnalysisMode] = useState('monthly'); // 'monthly' | 'yearly' | 'category'
  // 年間分析で見る年。月切替（currentMonth）とは独立させ、専用の前年/翌年ボタンで動かす。
  const [analysisYear, setAnalysisYear] = useState(() => Number(currentMonth.split('-')[0]));
  // カテゴリの推移で「どれを見るか」（ダッシュボードの月別推移とは別に持つ。
  // 同じ選択肢を共有すると、片方の画面を触ると他方の表示も変わってしまうため）
  const [analysisCategoryId, setAnalysisCategoryId] = useState('');
  // カテゴリ分析: 月単位（選択中のanalysisYearの1〜12月）で見るか、年単位（全期間の年ごと）で見るか
  const [categoryPeriodMode, setCategoryPeriodMode] = useState('monthly'); // 'monthly' | 'yearly'
  // 月間/年間分析のカテゴリ別支出の行をタップした時に開く詳細ドリルダウンモーダル
  const [isCategoryDrilldownOpen, setIsCategoryDrilldownOpen] = useState(false);
  const openCategoryDrilldown = (catId) => {
    setAnalysisCategoryId(catId);
    setIsCategoryDrilldownOpen(true);
  };

  // 月間分析: 1日平均（その月の日数で割る。カレンダーの日数ベースで、記録が
  // あった日数ではない）
  const dailyAverageThisMonth = useMemo(() => {
    const [year, month] = currentMonth.split('-').map(Number);
    const daysInMonth = new Date(year, month, 0).getDate();
    return daysInMonth > 0 ? totalMonthlyAmount / daysInMonth : 0;
  }, [currentMonth, totalMonthlyAmount]);

  // 月間分析: 最も支出が多かった日（カレンダータブのdailyTotalsを流用）
  const maxSpendingDay = useMemo(() => {
    let best = null;
    dailyTotals.forEach((v, date) => {
      if (!best || v.total > best.total) best = { date, total: v.total };
    });
    return best;
  }, [dailyTotals]);

  // 年間分析: 選択中の年の全明細
  const yearlyTransactions = useMemo(() => {
    return transactions.filter((t) => t.date.startsWith(String(analysisYear)));
  }, [transactions, analysisYear]);

  const yearlyTotal = useMemo(
    () => yearlyTransactions.reduce((sum, t) => sum + Number(t.amount), 0),
    [yearlyTransactions]
  );

  // 1〜12月を必ず埋めた推移（データが無い月も0円のバーとして出す）
  const yearlyMonthlySeries = useMemo(() => {
    return Array.from({ length: 12 }, (_, i) => {
      const m = i + 1;
      const key = `${analysisYear}-${String(m).padStart(2, '0')}`;
      const value = yearlyTransactions
        .filter((t) => t.date.startsWith(key))
        .reduce((sum, t) => sum + Number(t.amount), 0);
      return { key, xLabel: `${m}月`, fullLabel: `${analysisYear}年${m}月`, value };
    });
  }, [yearlyTransactions, analysisYear]);

  const topSpendingMonth = useMemo(() => {
    if (!yearlyMonthlySeries.some((m) => m.value > 0)) return null;
    return yearlyMonthlySeries.reduce((max, m) => (m.value > max.value ? m : max), yearlyMonthlySeries[0]);
  }, [yearlyMonthlySeries]);

  const yearlyCategoryStats = useMemo(() => {
    const map = {};
    CATEGORIES.forEach((c) => { map[c.id] = 0; });
    yearlyTransactions.forEach((t) => {
      if (map[t.category] !== undefined) {
        map[t.category] += Number(t.amount);
      } else {
        map.other = (map.other || 0) + Number(t.amount);
      }
    });
    return CATEGORIES.map((cat) => ({
      ...cat,
      amount: map[cat.id] || 0,
      percentage: yearlyTotal > 0 ? Math.round(((map[cat.id] || 0) / yearlyTotal) * 100) : 0,
    })).sort((a, b) => b.amount - a.amount);
  }, [yearlyTransactions, yearlyTotal]);

  // 年間分析: 支払い方法別（月間の集計と同じロジックを年間明細に適用）
  const yearlyPaymentMethodStats = useMemo(() => {
    const totals = new Map();
    yearlyTransactions.forEach((t) => {
      const pmId = t.cardId ? PAYMENT_METHOD_CREDIT_CARD_ID : (t.paymentMethodId || 'pm-other');
      totals.set(pmId, (totals.get(pmId) || 0) + Number(t.amount));
    });
    return [...totals.entries()]
      .map(([id, amount]) => ({
        id,
        name: paymentMethods.find((m) => m.id === id)?.name || 'その他',
        amount,
        percentage: yearlyTotal > 0 ? Math.round((amount / yearlyTotal) * 100) : 0,
      }))
      .sort((a, b) => b.amount - a.amount);
  }, [yearlyTransactions, paymentMethods, yearlyTotal]);

  // カテゴリ分析（月別）: 選んだカテゴリ1つの、選択中の年（analysisYear）1〜12月の推移。
  // データが無い月も0円として必ず12点そろえる（買った月しか出ない年間推移とは違う軸）。
  const categoryMonthlySeries = useMemo(() => {
    const catId = analysisCategoryId || CATEGORIES[0]?.id || '';
    const sums = new Map();
    transactions.forEach((t) => {
      if (t.category !== catId || !t.date.startsWith(String(analysisYear))) return;
      const m = Number(t.date.slice(5, 7));
      sums.set(m, (sums.get(m) || 0) + Number(t.amount));
    });
    return Array.from({ length: 12 }, (_, i) => {
      const m = i + 1;
      return {
        key: `${analysisYear}-${String(m).padStart(2, '0')}`,
        xLabel: `${m}月`,
        fullLabel: `${analysisYear}年${m}月`,
        value: sums.get(m) || 0,
      };
    });
  }, [transactions, analysisCategoryId, analysisYear]);

  // カテゴリ分析（年別）: 選んだカテゴリ1つの、データがある最初の年〜最後の年の推移
  const categoryYearlySeries = useMemo(() => {
    const catId = analysisCategoryId || CATEGORIES[0]?.id || '';
    const sums = new Map();
    let minYear = null;
    let maxYear = null;
    transactions.forEach((t) => {
      if (t.category !== catId) return;
      const y = Number(t.date.slice(0, 4));
      sums.set(y, (sums.get(y) || 0) + Number(t.amount));
      if (minYear === null || y < minYear) minYear = y;
      if (maxYear === null || y > maxYear) maxYear = y;
    });
    if (minYear === null) return [];
    const out = [];
    for (let y = minYear; y <= maxYear; y += 1) {
      out.push({ key: String(y), xLabel: `${y}`, fullLabel: `${y}年`, value: sums.get(y) || 0 });
    }
    return out;
  }, [transactions, analysisCategoryId]);

  // カテゴリ分析: 表示中の期間モード（月別/年別）に応じたseriesと、その要約統計
  // （直近ポイントの金額・前期間比・平均・最大の期間）。平均は年間分析の「月平均」と
  // 同じ考え方で、データが無い期間も含めた固定件数（12ヶ月 or 年数）で割る。
  const categoryPeriodSeries = categoryPeriodMode === 'yearly' ? categoryYearlySeries : categoryMonthlySeries;
  const categoryPeriodSummary = useMemo(() => {
    if (!categoryPeriodSeries.length) return null;
    const lastIdx = categoryPeriodSeries.length - 1;
    const current = categoryPeriodSeries[lastIdx];
    const previous = lastIdx > 0 ? categoryPeriodSeries[lastIdx - 1] : null;
    const total = categoryPeriodSeries.reduce((sum, p) => sum + p.value, 0);
    const average = total / categoryPeriodSeries.length;
    const max = categoryPeriodSeries.reduce((m, p) => (p.value > m.value ? p : m), categoryPeriodSeries[0]);
    const diff = previous ? current.value - previous.value : null;
    const diffPct = previous && previous.value > 0 ? (diff / previous.value) * 100 : null;
    return { current, average, max: max.value > 0 ? max : null, diff, diffPct };
  }, [categoryPeriodSeries]);

  // 支払い方法別の当月集計（クレジットカードはカードIDの有無で判定し、
  // 現金・PayPay等はpaymentMethodIdをそのまま使う）
  const paymentMethodMonthlyStats = useMemo(() => {
    const totals = new Map();
    monthlyTransactions.forEach((t) => {
      const pmId = t.cardId ? PAYMENT_METHOD_CREDIT_CARD_ID : (t.paymentMethodId || 'pm-other');
      totals.set(pmId, (totals.get(pmId) || 0) + Number(t.amount));
    });
    return [...totals.entries()]
      .map(([id, amount]) => ({
        id,
        name: paymentMethods.find((m) => m.id === id)?.name || 'その他',
        amount,
        percentage: totalMonthlyAmount > 0 ? Math.round((amount / totalMonthlyAmount) * 100) : 0,
      }))
      .sort((a, b) => b.amount - a.amount);
  }, [monthlyTransactions, paymentMethods, totalMonthlyAmount]);

  // 月別支出推移（全体 / 特定の支払い方法1つ / 特定のカテゴリ1つ）
  const trendSeries = useMemo(() => {
    if (trendMode === 'paymentMethod') {
      const pmId = trendPaymentMethodId || paymentMethods[0]?.id || '';
      const relevant = transactions.filter((t) => {
        const tPmId = t.cardId ? PAYMENT_METHOD_CREDIT_CARD_ID : (t.paymentMethodId || 'pm-other');
        return tPmId === pmId;
      });
      return buildMonthlySeries(relevant);
    }
    if (trendMode === 'category') {
      const catId = trendCategoryId || CATEGORIES[0]?.id || '';
      const relevant = transactions.filter((t) => t.category === catId);
      return buildMonthlySeries(relevant);
    }
    return buildMonthlySeries(transactions);
  }, [transactions, trendMode, trendPaymentMethodId, trendCategoryId, paymentMethods]);

  // 前月比（月別推移カードのすぐ下で使う簡易サマリー）
  const monthOverMonth = useMemo(() => {
    const lastKey = (() => {
      const [y, m] = currentMonth.split('-').map(Number);
      const d = new Date(y, m - 2, 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    })();
    const lastTotal = transactions
      .filter((t) => t.date.startsWith(lastKey))
      .reduce((sum, t) => sum + Number(t.amount), 0);
    if (lastTotal === 0) return null;
    const diff = totalMonthlyAmount - lastTotal;
    return { lastTotal, diff, pct: (diff / lastTotal) * 100 };
  }, [transactions, currentMonth, totalMonthlyAmount]);

  // カードごとの「次の未払い請求」一覧（支払日が近い順）。
  // ブラウズ中の月（currentMonth）ではなく、実際の「今日」基準で判定する。
  // ダッシュボードの「次回の支払い」「支払予定一覧」「引落口座別必要額」の元データ。
  const paymentSchedule = useMemo(() => {
    const today = new Date();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    return cards
      .map((card) => {
        const cycle = findNextUnpaidCycle(card, today);
        if (!cycle) return null;
        const daysUntil = Math.round((cycle.paymentDate - todayStart) / 86400000);
        const amount = sumTransactionsInCycle(transactions, card.id, cycle);
        return { card, paymentDate: cycle.paymentDate, daysUntil, amount };
      })
      .filter(Boolean)
      .sort((a, b) => a.paymentDate - b.paymentDate);
  }, [cards, transactions]);

  // 次回の支払い（最も近いもの1件）
  const nextPayment = paymentSchedule[0] || null;

  // 今月残りの支払予定額（支払日が今月かつ未来のものだけ合計）
  const remainingThisMonthTotal = useMemo(() => {
    const today = new Date();
    return paymentSchedule
      .filter((p) => p.paymentDate.getFullYear() === today.getFullYear() && p.paymentDate.getMonth() === today.getMonth())
      .reduce((sum, p) => sum + p.amount, 0);
  }, [paymentSchedule]);

  // 引落口座ごとの必要額（今月分・銀行口座を設定しているカードのみ）
  const bankAccountTotals = useMemo(() => {
    const today = new Date();
    const map = new Map();
    paymentSchedule
      .filter((p) => p.paymentDate.getFullYear() === today.getFullYear() && p.paymentDate.getMonth() === today.getMonth())
      .filter((p) => p.card.bankAccount)
      .forEach((p) => {
        map.set(p.card.bankAccount, (map.get(p.card.bankAccount) || 0) + p.amount);
      });
    return Array.from(map.entries()).map(([bankAccount, amount]) => ({ bankAccount, amount }));
  }, [paymentSchedule]);

  // 支払いカレンダー用: ブラウズ中の月（currentMonth）に支払日が来るカードを日付順に
  const scheduleCalendarDays = useMemo(() => {
    const [y, m] = currentMonth.split('-').map(Number);
    const entries = cards
      .map((card) => {
        const cycle = getCardCycleForPaymentMonth(card, y, m - 1);
        if (!cycle) return null;
        // 土日調整で月をまたぐ場合はこの月の対象から外す（誤表示を避ける）
        if (cycle.paymentDate.getFullYear() !== y || cycle.paymentDate.getMonth() !== m - 1) return null;
        const amount = sumTransactionsInCycle(transactions, card.id, cycle);
        return { card, day: cycle.paymentDate.getDate(), amount };
      })
      .filter(Boolean)
      .sort((a, b) => a.day - b.day);

    const byDay = [];
    entries.forEach((entry) => {
      const last = byDay[byDay.length - 1];
      if (last && last.day === entry.day) {
        last.items.push(entry);
      } else {
        byDay.push({ day: entry.day, items: [entry] });
      }
    });
    return byDay;
  }, [cards, transactions, currentMonth]);

  // 明細一覧フィルター適用
  const filteredTransactions = useMemo(() => {
    // 期間（開始日・終了日）を指定した場合だけ、表示中の月の外まで検索対象にする。
    const base = (filterDateFrom || filterDateTo) ? transactions : monthlyTransactions;
    const query = searchQuery.trim().toLowerCase();
    const min = filterAmountMin !== '' ? Number(filterAmountMin) : null;
    const max = filterAmountMax !== '' ? Number(filterAmountMax) : null;

    return base.filter((t) => {
      const matchCard = filterCardId === 'all' || t.cardId === filterCardId;
      const matchCat = filterCategory === 'all' || t.category === filterCategory;
      const tPmId = t.cardId ? PAYMENT_METHOD_CREDIT_CARD_ID : (t.paymentMethodId || 'pm-other');
      const matchPm = filterPaymentMethodId === 'all' || tPmId === filterPaymentMethodId;
      const matchFrom = !filterDateFrom || t.date >= filterDateFrom;
      const matchTo = !filterDateTo || t.date <= filterDateTo;
      const amount = Number(t.amount);
      const matchMin = min === null || amount >= min;
      const matchMax = max === null || amount <= max;
      const haystack = `${t.merchant || ''} ${t.memo || ''}`.toLowerCase();
      const matchQuery = !query || haystack.includes(query);
      return matchCard && matchCat && matchPm && matchFrom && matchTo && matchMin && matchMax && matchQuery;
    }).sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [
    monthlyTransactions, transactions, filterCardId, filterCategory, filterPaymentMethodId,
    filterDateFrom, filterDateTo, filterAmountMin, filterAmountMax, searchQuery,
  ]);

  // --- アクションハンドラー ---
  const resetNewTxForm = () => {
    setNewTx({
      paymentMethodId: PAYMENT_METHOD_CREDIT_CARD_ID,
      cardId: cards[0]?.id || '',
      amount: '',
      date: new Date().toISOString().split('T')[0],
      category: 'food',
      merchant: '',
      memo: '',
    });
  };

  const resetNewCardForm = () => {
    setNewCard({
      name: '',
      brand: 'VISA',
      number: '',
      holderName: '',
      expiry: '',
      cvv: '',
      theme: 'purple',
      limit: 200000,
      billingDay: '末日',
      paymentDay: '27',
      weekendAdjustment: 'none',
      bankAccount: '',
    });
  };

  const handleCloseTransactionModal = () => {
    setIsAddTransactionOpen(false);
    setEditingTxId(null);
    resetNewTxForm();
  };

  const handleCloseCardModal = () => {
    setIsAddCardOpen(false);
    setEditingCardId(null);
    setResolvingPendingId(null);
    resetNewCardForm();
  };

  const handleOpenEditTransaction = (tx) => {
    // merchantフィールド追加前の明細は、店舗名がmemoに入っている。編集画面では
    // それを店舗名欄に出し、メモ欄は空にする（元々別々の情報ではなかったため）。
    setNewTx({
      paymentMethodId: tx.paymentMethodId || PAYMENT_METHOD_CREDIT_CARD_ID,
      cardId: tx.cardId || cards[0]?.id || '',
      amount: String(tx.amount),
      date: tx.date,
      category: tx.category,
      merchant: tx.merchant || tx.memo || '',
      memo: tx.merchant ? (tx.memo || '') : '',
    });
    setEditingTxId(tx.id);
    setIsAddTransactionOpen(true);
  };

  const handleOpenEditCard = (card) => {
    setNewCard({
      name: card.name || '',
      brand: card.brand || 'VISA',
      number: card.number || '',
      holderName: card.holderName || '',
      expiry: card.expiry || '',
      cvv: card.cvv || '',
      theme: card.theme || 'purple',
      limit: card.limit || 0,
      billingDay: card.billingDay || '末日',
      paymentDay: card.paymentDay || '27',
      weekendAdjustment: card.weekendAdjustment || 'none',
      bankAccount: card.bankAccount || '',
    });
    setEditingCardId(card.id);
    setIsAddCardOpen(true);
  };

  const handleSaveTransaction = async (e) => {
    e.preventDefault();
    // 選択中の支払い方法が「クレジットカード」タイプの場合だけ、カードの
    // 選択が必須（現金・PayPay等はcardId不要）。
    const selectedMethod = paymentMethods.find((m) => m.id === newTx.paymentMethodId);
    const isCreditCard = selectedMethod ? selectedMethod.type === 'credit_card' : newTx.paymentMethodId === PAYMENT_METHOD_CREDIT_CARD_ID;
    if (!newTx.amount || !newTx.paymentMethodId || (isCreditCard && !newTx.cardId) || !authUser) return;

    const cardId = isCreditCard ? newTx.cardId : null;

    try {
      if (editingTxId) {
        const existing = transactions.find((t) => t.id === editingTxId);
        const updated = {
          ...existing,
          paymentMethodId: newTx.paymentMethodId,
          cardId,
          amount: Number(newTx.amount),
          date: newTx.date,
          category: newTx.category,
          merchant: newTx.merchant.trim() || '利用明細',
          memo: newTx.memo.trim(),
        };
        delete updated.id;
        await setDoc(transactionDocRef(authUser.uid, editingTxId), updated);
      } else {
        const id = `t-${Date.now()}`;
        const newEntry = {
          paymentMethodId: newTx.paymentMethodId,
          cardId,
          amount: Number(newTx.amount),
          date: newTx.date,
          category: newTx.category,
          merchant: newTx.merchant.trim() || '利用明細',
          memo: newTx.memo.trim(),
          source: 'manual',
        };
        await setDoc(transactionDocRef(authUser.uid, id), newEntry);
      }
    } catch (err) {
      console.error(err);
      alert('明細の保存に失敗しました。通信環境をご確認ください。');
    }

    handleCloseTransactionModal();
  };

  const handleDeleteTransaction = async (id) => {
    if (!authUser) return;
    if (confirm('この利用明細を削除しますか？')) {
      try {
        await deleteDoc(transactionDocRef(authUser.uid, id));
      } catch (err) {
        console.error(err);
        alert('明細の削除に失敗しました。');
      }
    }
  };

  const handleSaveCard = async (e) => {
    e.preventDefault();
    if (!newCard.name || !authUser) return;

    const digits = newCard.number.replace(/\D/g, '');
    const pendingItem = resolvingPendingId ? pendingImports.find((p) => p.id === resolvingPendingId) : null;

    try {
      if (editingCardId) {
        const existing = cards.find((c) => c.id === editingCardId);
        const updated = { ...existing, ...newCard, limit: Number(newCard.limit) || 0, last4: digits ? digits.slice(-4) : existing?.last4 };
        delete updated.id;
        await setDoc(cardDocRef(authUser.uid, editingCardId), updated);
      } else {
        const id = `card-${Date.now()}`;
        const createdCard = {
          ...newCard,
          limit: Number(newCard.limit) || 0,
          last4: digits ? digits.slice(-4) : '0000',
        };
        await setDoc(cardDocRef(authUser.uid, id), createdCard);

        // 確認待ちの利用通知から「このカードを追加する」で来た場合は、新しく
        // 作ったカードの明細として登録し、確認待ちからは消す。
        if (pendingItem) {
          await handleResolvePendingToTransaction(pendingItem, PAYMENT_METHOD_CREDIT_CARD_ID, id);
        }
      }
    } catch (err) {
      console.error(err);
      alert('カードの保存に失敗しました。通信環境をご確認ください。');
    }

    handleCloseCardModal();
  };

  // 確認待ちの利用通知を、指定したカードの明細として登録し、確認待ちからは削除する
  // paymentMethodIdが「クレジットカード」タイプの場合だけcardIdを使う。
  // それ以外（現金・PayPay等）はcardIdをnullで保存する。
  const handleResolvePendingToTransaction = async (item, paymentMethodId, cardId = null) => {
    if (!authUser || !paymentMethodId) return;
    // Gmail取込側の確認待ちドキュメントは `p-gmail-<messageId>` というidで作られているので、
    // 明細側も同じmessageIdから作る（万一同じメールが将来また処理されても上書きで済む）。
    const messageId = item.id.startsWith('p-gmail-') ? item.id.slice('p-gmail-'.length) : item.id;
    await setDoc(transactionDocRef(authUser.uid, `t-gmail-${messageId}`), {
      cardId: cardId || null,
      paymentMethodId,
      amount: Number(item.amount) || 0,
      date: item.date || new Date().toISOString().split('T')[0],
      category: item.category || 'other',
      merchant: item.merchant || item.issuerNameGuess || '利用明細',
      memo: '',
      source: 'email',
    });
    await deleteDoc(pendingImportDocRef(authUser.uid, item.id));
  };

  // 確認待ち1件ごとの「支払い方法」選択のデフォルト値（クレジットカードと推定して開始）
  const getPendingChoice = (item) => pendingLinkChoice[item.id] || { paymentMethodId: PAYMENT_METHOD_CREDIT_CARD_ID, cardId: cards[0]?.id || '' };

  const handleRegisterPending = async (item) => {
    if (!authUser) return;
    const choice = getPendingChoice(item);
    const selectedMethod = paymentMethods.find((m) => m.id === choice.paymentMethodId);
    const isCreditCard = selectedMethod ? selectedMethod.type === 'credit_card' : choice.paymentMethodId === PAYMENT_METHOD_CREDIT_CARD_ID;
    if (isCreditCard && !choice.cardId) {
      alert('カードを選択してください。');
      return;
    }
    try {
      await handleResolvePendingToTransaction(item, choice.paymentMethodId, isCreditCard ? choice.cardId : null);
    } catch (err) {
      console.error(err);
      alert('明細の登録に失敗しました。通信環境をご確認ください。');
    }
  };

  const handleIgnorePendingImport = async (item) => {
    if (!authUser) return;
    try {
      await deleteDoc(pendingImportDocRef(authUser.uid, item.id));
    } catch (err) {
      console.error(err);
      alert('削除に失敗しました。');
    }
  };

  const handleOpenAddCardFromPending = (item) => {
    resetNewCardForm();
    setNewCard((prev) => ({
      ...prev,
      name: item.issuerNameGuess || item.merchant || '新しいカード',
      number: item.last4Guess || '',
    }));
    setEditingCardId(null);
    setResolvingPendingId(item.id);
    setIsPendingReviewOpen(false);
    setIsAddCardOpen(true);
  };

  const handleDeleteCard = async (cardId) => {
    if (!authUser) return;
    if (cards.length <= 1) {
      alert('最低1枚のカードが必要です。');
      return;
    }
    if (confirm('このカードを削除すると、関連する明細も確認できなくなる可能性があります。削除しますか？')) {
      try {
        const batch = writeBatch(db);
        batch.delete(cardDocRef(authUser.uid, cardId));
        transactions
          .filter((t) => t.cardId === cardId)
          .forEach((t) => batch.delete(transactionDocRef(authUser.uid, t.id)));
        await batch.commit();
      } catch (err) {
        console.error(err);
        alert('カードの削除に失敗しました。');
      }
    }
  };

  // --- 書き出し / 読み込み ---
  // Claude Artifact の中で開かれている場合は外部ネットワークが遮断されるため、
  // 画像OCR（Tesseract.js を CDN から取得）は使えない。JSONの読み込みのみ提供する。
  const inCapabilityHost = !!(window.claude && typeof window.claude.use === 'function');

  const importFileRef = useRef(null);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrReview, setOcrReview] = useState(null); // { candidates: [...], cardId }
  const [ocrRawText, setOcrRawText] = useState(null); // 自動検出できなかった時、読み取れた生テキストを見せる

  const handleExport = async () => {
    const data = { exportedAt: new Date().toISOString(), cards, transactions };
    const json = JSON.stringify(data, null, 2);
    const filename = `cardmanager-backup-${new Date().toISOString().slice(0, 10)}.json`;

    if (inCapabilityHost) {
      try {
        const downloads = await window.claude.use('downloads');
        if (downloads) {
          await downloads.save({ filename, data: json });
        } else {
          alert('この環境では書き出し機能を利用できません。');
        }
      } catch (err) {
        if (err && err.code !== 'declined') {
          console.error(err);
          alert('書き出しに失敗しました。');
        }
      }
      return;
    }

    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportClick = () => importFileRef.current?.click();

  // カードは「名前」で既存カードと突き合わせる。無ければ新規作成して cards に足す。
  const buildCardResolver = (baseCards) => {
    const nextCards = [...baseCards];
    const findOrCreateCardId = (nameOrId, extra = {}) => {
      if (!nameOrId) return nextCards[0]?.id || null;
      const byId = nextCards.find((c) => c.id === nameOrId);
      if (byId) return byId.id;
      const byName = nextCards.find((c) => c.name === nameOrId);
      if (byName) return byName.id;
      const created = {
        id: `card-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: nameOrId,
        brand: extra.brand || 'VISA',
        last4: extra.last4 || (extra.number || '').replace(/\D/g, '').slice(-4) || '0000',
        number: extra.number || '',
        holderName: extra.holderName || '',
        expiry: extra.expiry || '',
        cvv: extra.cvv || '',
        theme: extra.theme && CARD_THEMES[extra.theme] ? extra.theme : 'purple',
        limit: Number(extra.limit) || 0,
        billingDay: extra.billingDay || '末日',
        paymentDay: extra.paymentDay || '27',
        weekendAdjustment: extra.weekendAdjustment || 'none',
        bankAccount: extra.bankAccount || '',
      };
      nextCards.push(created);
      return created.id;
    };
    return { nextCards, findOrCreateCardId };
  };

  const handleImportJsonFile = (file) => {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        if (!authUser) throw new Error('not-authenticated');
        const data = JSON.parse(reader.result);
        const incomingCards = Array.isArray(data.cards) ? data.cards : [];
        const incomingTxs = Array.isArray(data.transactions) ? data.transactions : [];
        if (!incomingCards.length && !incomingTxs.length) throw new Error('empty');

        const { nextCards, findOrCreateCardId } = buildCardResolver(cards);
        incomingCards.forEach((c) => findOrCreateCardId(c.name || c.cardName, c));
        const newCardsOnly = nextCards.filter((c) => !cards.some((existing) => existing.id === c.id));

        const newTxs = incomingTxs
          .map((t) => {
            const cardId = findOrCreateCardId(t.cardId || t.cardName || t.card);
            if (!cardId || !t.amount) return null;
            return {
              id: `t-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              cardId,
              amount: Number(t.amount),
              date: resolveDate(t.date),
              category: resolveCategoryId(t.category),
              memo: t.memo || '',
            };
          })
          .filter(Boolean);

        const batch = writeBatch(db);
        newCardsOnly.forEach((c) => {
          const { id, ...rest } = c;
          batch.set(cardDocRef(authUser.uid, id), rest);
        });
        newTxs.forEach((t) => {
          const { id, ...rest } = t;
          batch.set(transactionDocRef(authUser.uid, id), rest);
        });
        await batch.commit();

        alert(`${newTxs.length}件の明細を読み込みました。`);
      } catch (err) {
        console.error(err);
        alert('ファイルの読み込みに失敗しました。正しいバックアップ／インポート用ファイルか確認してください。');
      }
    };
    reader.readAsText(file);
  };

  const handleImportImageFile = async (file) => {
    setOcrLoading(true);
    try {
      let ocrInput = file;
      try {
        ocrInput = await preprocessImageForOcr(file);
      } catch (preErr) {
        console.warn('画像の前処理に失敗したため、元の画像のまま読み取ります', preErr);
      }

      const { createWorker, PSM } = await import('tesseract.js');
      const worker = await createWorker('jpn');
      // カード明細は縦一列のリスト状レイアウトなので、単一段組みを仮定するPSMの方が
      // デフォルト（自動レイアウト解析）より安定して読めることが多い。
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_COLUMN });
      const { data } = await worker.recognize(ocrInput, {}, { text: true, blocks: true });
      await worker.terminate();

      // 単語の座標から画面上の行を再構成して読む（店名と金額が横並び、日付は
      // その下の行、というカード明細アプリのレイアウト崩れに強くするため）。
      // 座標データの形が想定と違っても、素の認識テキストの行分割に必ずフォールバックする。
      let candidates = [];
      try {
        const words = (data.blocks || [])
          .flatMap((b) => b.paragraphs || [])
          .flatMap((p) => p.lines || [])
          .flatMap((l) => l.words || []);
        const rows = groupWordsIntoRows(words);
        if (rows.length) candidates = parseTransactionsFromRows(rows);
      } catch (rowErr) {
        console.warn('行の再構成に失敗したため、通常のテキスト分割にフォールバックします', rowErr);
      }
      if (!candidates.length) {
        candidates = parseTransactionsFromRows((data.text || '').split('\n'));
      }
      if (!candidates.length) {
        setOcrRawText(data.text || '（文字を読み取れませんでした）');
        return;
      }
      setOcrReview({ candidates, cardId: cards[0]?.id || '' });
    } catch (err) {
      console.error(err);
      alert('画像の読み取りに失敗しました。通信環境をご確認のうえ、もう一度お試しください。');
    } finally {
      setOcrLoading(false);
    }
  };

  const handleImportFile = (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (file.type.startsWith('image/')) {
      handleImportImageFile(file);
    } else {
      handleImportJsonFile(file);
    }
  };

  const updateOcrCandidate = (idx, patch) => {
    setOcrReview((prev) => (prev ? {
      ...prev,
      candidates: prev.candidates.map((c, i) => (i === idx ? { ...c, ...patch } : c)),
    } : prev));
  };
  const removeOcrCandidate = (idx) => {
    setOcrReview((prev) => (prev ? {
      ...prev,
      candidates: prev.candidates.filter((_, i) => i !== idx),
    } : prev));
  };
  const handleConfirmOcrImport = async () => {
    if (!ocrReview || !authUser) return;
    const newTxs = ocrReview.candidates
      .filter((c) => c.amount && c.date)
      .map((c) => ({
        id: `t-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        cardId: ocrReview.cardId,
        amount: Number(c.amount),
        date: c.date,
        category: c.category,
        memo: c.memo,
        paymentMethodId: PAYMENT_METHOD_CREDIT_CARD_ID,
        source: 'ocr',
      }));

    try {
      const batch = writeBatch(db);
      newTxs.forEach((t) => {
        const { id, ...rest } = t;
        batch.set(transactionDocRef(authUser.uid, id), rest);
      });
      await batch.commit();
      alert(`${newTxs.length}件の明細を追加しました。`);
    } catch (err) {
      console.error(err);
      alert('明細の保存に失敗しました。通信環境をご確認ください。');
    }
    setOcrReview(null);
  };

  // --- 認証確認中: ローディング表示 ---
  if (authUser === undefined) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
      </div>
    );
  }

  // --- 未ログイン: この端末に保存済みセッションが無い ---
  if (authUser === null) {
    return (
      <div className="min-h-screen bg-slate-900 text-slate-100 flex items-center justify-center p-4">
        <div className="max-w-sm w-full bg-slate-800 border border-slate-700 rounded-3xl shadow-2xl p-6 space-y-5">
          <div className="text-center space-y-1">
            <div className="inline-flex p-2.5 bg-gradient-to-tr from-indigo-500 to-purple-500 rounded-xl shadow-lg shadow-indigo-500/20">
              <CreditCard className="w-6 h-6 text-white" />
            </div>
            <h1 className="font-bold text-base text-white mt-2">CardManager Pro</h1>
            <p className="text-xs text-slate-400">この端末には保存されたセッションがありません</p>
          </div>

          <form onSubmit={handleGateLogin} className="space-y-3">
            <h2 className="text-xs font-bold text-slate-400">他の端末で設定済みのメールアドレスがあればログイン</h2>
            <input
              type="email"
              placeholder="メールアドレス"
              value={gateEmail}
              onChange={(e) => setGateEmail(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-slate-200 text-sm focus:outline-none focus:border-indigo-500"
            />
            <input
              type="password"
              placeholder="パスワード"
              value={gatePassword}
              onChange={(e) => setGatePassword(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-slate-200 text-sm focus:outline-none focus:border-indigo-500"
            />
            {gateError && <p className="text-xs text-red-400">{gateError}</p>}
            <button
              type="submit"
              disabled={gateBusy}
              className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white font-bold py-2.5 rounded-xl text-sm transition-colors"
            >
              ログイン
            </button>
          </form>

          <div className="relative py-1 text-center">
            <span className="text-[10px] text-slate-500 bg-slate-800 px-2 relative z-10">または</span>
            <div className="absolute left-0 right-0 top-1/2 border-t border-slate-700" />
          </div>

          <button
            type="button"
            onClick={handleGateStartFresh}
            disabled={gateBusy}
            className="w-full border border-slate-700 hover:bg-slate-700/50 disabled:opacity-60 text-slate-200 font-bold py-2.5 rounded-xl text-sm transition-colors"
          >
            この端末で新しく始める
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col antialiased selection:bg-indigo-500 selection:text-white">

      {/* 1. トップヘッダー */}
      <header className="sticky top-0 z-30 bg-slate-900/80 backdrop-blur-md border-b border-slate-800 px-4 py-3 sm:px-8">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-gradient-to-tr from-indigo-500 to-purple-500 rounded-xl shadow-lg shadow-indigo-500/20">
              <CreditCard className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-lg sm:text-xl tracking-tight text-white flex items-center gap-2">
                CardManager <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-400 font-medium">Pro</span>
              </h1>
              <p className="text-xs text-slate-400 hidden sm:block">クレジットカード利用額・月別管理</p>
            </div>
          </div>

          {/* 確認待ち・記録・同期。優先度順（確認待ち→記録→同期）に並べ、
              同期は場所を取らないようアイコンのみにしてある。 */}
          <div className="flex items-center gap-2">
            {pendingImports.length > 0 && (
              <button
                onClick={() => setIsPendingReviewOpen(true)}
                className="relative p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
                title={`確認待ち ${pendingImports.length}件`}
              >
                <Inbox className="w-4 h-4" />
                <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-amber-500 text-[10px] font-bold text-slate-900 flex items-center justify-center">
                  {pendingImports.length}
                </span>
              </button>
            )}
            <button
              onClick={() => {
                setEditingTxId(null);
                resetNewTxForm();
                setIsAddTransactionOpen(true);
              }}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-sm transition-all duration-200 shadow-lg shadow-indigo-600/30 active:scale-95 whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              <span>記録</span>
            </button>
            <button
              onClick={() => setIsAccountModalOpen(true)}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
              title={authUser.isAnonymous ? 'この端末専用（未ログイン）' : `ログイン中: ${authUser.email}`}
            >
              <Cloud className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* 2. 期間切替バー（月間タブ・年間分析タブで同じPeriodNavigatorを常時共有し、
          ラベルとハンドラだけ差し替える。画面切り替え時に表示/非表示が切り替わって
          ガタつくことがないよう、常にどちらかを表示する） */}
      {activeTab === 'analysis' && analysisMode === 'yearly' ? (
        <PeriodNavigator
          label={`${analysisYear}年`}
          onPrev={() => setAnalysisYear((y) => y - 1)}
          onNext={() => setAnalysisYear((y) => y + 1)}
          prevTitle="前年"
          nextTitle="翌年"
        />
      ) : (
        <PeriodNavigator
          label={formattedMonth}
          onPrev={() => handleMonthChange(-1)}
          onNext={() => handleMonthChange(1)}
          prevTitle="前月"
          nextTitle="次月"
        />
      )}

      {/* 3. メインコンテンツ領域（モバイルは下部固定タブバーの分だけ下に余白を確保） */}
      <main className={`flex-1 max-w-6xl w-full mx-auto px-4 pb-24 sm:pb-6 ${activeTab === 'analysis' ? 'pt-4 space-y-5' : 'py-6 space-y-6'}`}>

        {/* ナビゲーションタブ（sm以上でのみ表示。モバイルは下部固定タブバーに切り替え） */}
        <div className="hidden sm:flex gap-0 bg-slate-800/80 p-1.5 rounded-2xl border border-slate-700/50">
          <button
            onClick={() => setActiveTab('dashboard')}
            className={`min-w-0 sm:flex-1 py-2 px-1.5 sm:px-3 rounded-xl text-xs sm:text-sm font-medium transition-all flex items-center justify-center gap-1 sm:gap-2 ${
              activeTab === 'dashboard' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <PieChart className="w-4 h-4 shrink-0" />
            <span className="truncate">ダッシュボード</span>
          </button>
          <button
            onClick={() => setActiveTab('transactions')}
            className={`min-w-0 sm:flex-1 py-2 px-1.5 sm:px-3 rounded-xl text-xs sm:text-sm font-medium transition-all flex items-center justify-center gap-1 sm:gap-2 ${
              activeTab === 'transactions' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <List className="w-4 h-4 shrink-0" />
            <span className="truncate">明細 ({monthlyTransactions.length})</span>
          </button>
          <button
            onClick={() => setActiveTab('calendar')}
            className={`min-w-0 sm:flex-1 py-2 px-1.5 sm:px-3 rounded-xl text-xs sm:text-sm font-medium transition-all flex items-center justify-center gap-1 sm:gap-2 ${
              activeTab === 'calendar' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Calendar className="w-4 h-4 shrink-0" />
            <span className="truncate">カレンダー</span>
          </button>
          <button
            onClick={() => setActiveTab('analysis')}
            className={`min-w-0 sm:flex-1 py-2 px-1.5 sm:px-3 rounded-xl text-xs sm:text-sm font-medium transition-all flex items-center justify-center gap-1 sm:gap-2 ${
              activeTab === 'analysis' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <BarChart3 className="w-4 h-4 shrink-0" />
            <span className="truncate">分析</span>
          </button>
          <button
            onClick={() => setActiveTab('cards')}
            className={`min-w-0 sm:flex-1 py-2 px-1.5 sm:px-3 rounded-xl text-xs sm:text-sm font-medium transition-all flex items-center justify-center gap-1 sm:gap-2 ${
              activeTab === 'cards' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Wallet className="w-4 h-4 shrink-0" />
            <span className="truncate">カード ({cards.length})</span>
          </button>
        </div>

        {/* --- タブ 1: ダッシュボード --- */}
        {activeTab === 'dashboard' && (
          <div className="space-y-4 animate-fadeIn">

            {/* ① 今月の支出（最重要。先月比を添えて最も大きく表示） */}
            <div className="bg-gradient-to-br from-indigo-600/25 to-purple-600/10 border border-indigo-500/30 rounded-2xl p-5 sm:p-6 shadow-xl relative overflow-hidden">
              <div className="absolute top-0 right-0 p-4 opacity-10">
                <TrendingUp className="w-28 h-28 text-indigo-300" />
              </div>
              <p className="text-xs font-semibold text-indigo-300 uppercase tracking-wider">今月の支出</p>
              <div className="mt-1 text-4xl sm:text-5xl font-extrabold text-white">
                ¥{totalMonthlyAmount.toLocaleString()}
              </div>
              {monthOverMonth ? (
                <p className={`mt-3 text-sm font-semibold ${monthOverMonth.diff > 0 ? 'text-rose-400' : monthOverMonth.diff < 0 ? 'text-emerald-400' : 'text-slate-400'}`}>
                  {monthOverMonth.diff > 0 ? '▲' : monthOverMonth.diff < 0 ? '▼' : '―'}
                  {' '}
                  {monthOverMonth.diff >= 0 ? '+' : '−'}¥{Math.abs(monthOverMonth.diff).toLocaleString()}
                  {' '}
                  （{monthOverMonth.diff >= 0 ? '+' : '−'}{Math.abs(monthOverMonth.pct).toFixed(1)}%） 先月比
                </p>
              ) : (
                <p className="mt-3 text-sm text-slate-400">先月のデータがありません</p>
              )}
            </div>

            {/* ② 支払予定（クレジットカードの今月残り＋次回を1枚にまとめる） */}
            <div className="bg-slate-800/90 border border-slate-700/60 rounded-2xl p-4 shadow-xl">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">支払予定（クレジットカード）</p>
              {nextPayment ? (
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <span className="text-[11px] text-slate-500">今月残り</span>
                    <div className="text-xl font-bold text-white">¥{remainingThisMonthTotal.toLocaleString()}</div>
                  </div>
                  <div className="text-right min-w-0">
                    <span className="text-[11px] text-slate-500">
                      次回 {nextPayment.paymentDate.getMonth() + 1}/{nextPayment.paymentDate.getDate()}
                      {nextPayment.daysUntil <= 3 && (nextPayment.daysUntil === 0 ? '（今日）' : `（あと${nextPayment.daysUntil}日）`)}
                    </span>
                    <div className="text-sm font-semibold text-indigo-300 truncate">{nextPayment.card.name}</div>
                    <div className="text-lg font-bold text-white">¥{nextPayment.amount.toLocaleString()}</div>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-slate-500">予定なし（カードに締め日・支払日を設定してください）</p>
              )}
            </div>

            {/* ③ カテゴリ別支出（リスト/円グラフ切替） */}
            <div className="bg-slate-800/90 border border-slate-700/60 rounded-2xl p-4 shadow-xl">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <Tag className="w-4 h-4 text-indigo-400" />
                  カテゴリ別支出
                </h2>
                <div className="flex bg-slate-900/70 p-1 rounded-lg border border-slate-700/60">
                  <button
                    onClick={() => setCategoryViewMode('list')}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                      categoryViewMode === 'list' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    リスト
                  </button>
                  <button
                    onClick={() => setCategoryViewMode('donut')}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                      categoryViewMode === 'donut' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    円グラフ
                  </button>
                </div>
              </div>

              {totalMonthlyAmount === 0 ? (
                <p className="text-slate-400 text-sm text-center py-6">この月の利用明細はありません。</p>
              ) : categoryViewMode === 'donut' ? (
                <DonutChart
                  slices={categoryStats.map((cat) => ({ id: cat.id, label: cat.name, value: cat.amount, colorName: categoryColorName(cat) }))}
                  centerLabel="今月の支出"
                  centerValue={`¥${totalMonthlyAmount.toLocaleString()}`}
                />
              ) : (
                <div className="space-y-3">
                  {categoryStats.filter((c) => c.amount > 0).map((cat) => {
                    const IconComponent = cat.icon;
                    return (
                      <div key={cat.id} className="space-y-1">
                        <div className="flex items-center justify-between text-sm">
                          <div className="flex items-center space-x-2">
                            <div className={`p-1.5 rounded-lg bg-slate-700 ${cat.color.split(' ')[1]}`}>
                              <IconComponent className="w-4 h-4" />
                            </div>
                            <span className="font-medium text-slate-200">{cat.name}</span>
                          </div>
                          <div className="text-right">
                            <span className="font-bold text-white">¥{cat.amount.toLocaleString()}</span>
                            <span className="text-xs text-slate-400 ml-2">({cat.percentage}%)</span>
                          </div>
                        </div>
                        <div className="w-full bg-slate-700/50 rounded-full h-2 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${cat.color.split(' ')[0]}`}
                            style={{ width: `${cat.percentage}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* ④ 支払い方法別 */}
            <div className="bg-slate-800/90 border border-slate-700/60 rounded-2xl p-4 shadow-xl">
              <h2 className="text-base font-bold text-white mb-3 flex items-center gap-2">
                <Wallet className="w-4 h-4 text-indigo-400" />
                支払い方法別
              </h2>
              {paymentMethodMonthlyStats.length === 0 ? (
                <p className="text-slate-400 text-sm text-center py-6">この月の支出はありません。</p>
              ) : (
                <div className="space-y-3">
                  {paymentMethodMonthlyStats.map((pm) => (
                    <div key={pm.id} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium text-slate-200">{pm.name}</span>
                        <div className="text-right">
                          <span className="font-bold text-white">¥{pm.amount.toLocaleString()}</span>
                          <span className="text-xs text-slate-400 ml-2">({pm.percentage}%)</span>
                        </div>
                      </div>
                      <div className="w-full bg-slate-700/50 rounded-full h-2 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-indigo-500 transition-all duration-500"
                          style={{ width: `${pm.percentage}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ⑤ 月別支出推移（全体/支払い方法別/カテゴリ別） */}
            <div className="bg-slate-800/90 border border-slate-700/60 rounded-2xl p-4 shadow-xl">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-indigo-400" />
                  月別支出推移
                </h2>
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="flex bg-slate-900/70 p-1 rounded-lg border border-slate-700/60">
                    <button
                      onClick={() => setTrendMode('total')}
                      className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                        trendMode === 'total' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      全体
                    </button>
                    <button
                      onClick={() => setTrendMode('paymentMethod')}
                      className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                        trendMode === 'paymentMethod' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      支払い方法別
                    </button>
                    <button
                      onClick={() => setTrendMode('category')}
                      className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                        trendMode === 'category' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      カテゴリ別
                    </button>
                  </div>
                  {trendMode === 'paymentMethod' && (
                    <select
                      value={trendPaymentMethodId || paymentMethods[0]?.id || ''}
                      onChange={(e) => setTrendPaymentMethodId(e.target.value)}
                      className="bg-slate-900 border border-slate-700 rounded-lg text-xs px-2.5 py-2 text-slate-200 focus:outline-none focus:border-indigo-500"
                    >
                      {paymentMethods.map((m) => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                      ))}
                    </select>
                  )}
                  {trendMode === 'category' && (
                    <select
                      value={trendCategoryId || CATEGORIES[0]?.id || ''}
                      onChange={(e) => setTrendCategoryId(e.target.value)}
                      className="bg-slate-900 border border-slate-700 rounded-lg text-xs px-2.5 py-2 text-slate-200 focus:outline-none focus:border-indigo-500"
                    >
                      {CATEGORIES.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  )}
                </div>
              </div>
              <TrendChart series={trendSeries} />
            </div>

            {/* ⑥ カード利用状況（簡易表示。詳細はカードタブへ） */}
            <div className="bg-slate-800/90 border border-slate-700/60 rounded-2xl p-4 shadow-xl">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <CreditCard className="w-4 h-4 text-indigo-400" />
                  カード利用状況
                </h2>
                <button
                  onClick={() => setActiveTab('cards')}
                  className="text-xs text-indigo-400 hover:text-indigo-300 font-medium flex items-center gap-0.5"
                >
                  カード管理を見る <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>

              {cardMonthlyStats.length === 0 ? (
                <p className="text-slate-400 text-sm text-center py-4">クレジットカードが登録されていません</p>
              ) : (
                <div className="divide-y divide-slate-700/50">
                  {cardMonthlyStats.map((card) => (
                    <div key={card.id} className="py-2.5 flex items-center justify-between gap-3">
                      <span className="text-sm text-slate-300 truncate">{card.name}</span>
                      <span className="text-sm font-bold text-white shrink-0">¥{card.spent.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>
        )}

        {/* --- タブ 2: 利用明細一覧 --- */}
        {activeTab === 'transactions' && (
          <div className="space-y-4 animate-fadeIn">

            {/* 検索・フィルターバー */}
            <div className="bg-slate-800/90 border border-slate-700/60 rounded-2xl p-4 space-y-3">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="店舗名・メモで検索"
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl text-sm pl-9 pr-3 py-2.5 text-slate-200 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1.5 text-xs text-slate-400 mr-1">
                  <Filter className="w-3.5 h-3.5 text-indigo-400" />
                  絞り込み:
                </div>

                <select
                  value={filterPaymentMethodId}
                  onChange={(e) => setFilterPaymentMethodId(e.target.value)}
                  className="bg-slate-900 border border-slate-700 rounded-xl text-xs sm:text-sm px-3 py-2 text-slate-200 focus:outline-none focus:border-indigo-500"
                >
                  <option value="all">すべての支払い方法</option>
                  {paymentMethods.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>

                <select
                  value={filterCardId}
                  onChange={(e) => setFilterCardId(e.target.value)}
                  className="bg-slate-900 border border-slate-700 rounded-xl text-xs sm:text-sm px-3 py-2 text-slate-200 focus:outline-none focus:border-indigo-500"
                >
                  <option value="all">すべてのカード</option>
                  {cards.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>

                <select
                  value={filterCategory}
                  onChange={(e) => setFilterCategory(e.target.value)}
                  className="bg-slate-900 border border-slate-700 rounded-xl text-xs sm:text-sm px-3 py-2 text-slate-200 focus:outline-none focus:border-indigo-500"
                >
                  <option value="all">すべてのカテゴリ</option>
                  {CATEGORIES.map((cat) => (
                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                  ))}
                </select>

                <div className="flex items-center gap-1.5">
                  <input
                    type="date"
                    value={filterDateFrom}
                    onChange={(e) => setFilterDateFrom(e.target.value)}
                    className="min-w-0 bg-slate-900 border border-slate-700 rounded-xl text-xs sm:text-sm px-2 py-2 text-slate-200 focus:outline-none focus:border-indigo-500"
                    title="期間（開始日）。指定すると表示中の月に関わらず全期間から検索します"
                  />
                  <span className="text-slate-500 text-xs">〜</span>
                  <input
                    type="date"
                    value={filterDateTo}
                    onChange={(e) => setFilterDateTo(e.target.value)}
                    className="min-w-0 bg-slate-900 border border-slate-700 rounded-xl text-xs sm:text-sm px-2 py-2 text-slate-200 focus:outline-none focus:border-indigo-500"
                    title="期間（終了日）"
                  />
                </div>

                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    value={filterAmountMin}
                    onChange={(e) => setFilterAmountMin(e.target.value)}
                    placeholder="金額 下限"
                    className="w-24 bg-slate-900 border border-slate-700 rounded-xl text-xs sm:text-sm px-2.5 py-2 text-slate-200 focus:outline-none focus:border-indigo-500"
                  />
                  <span className="text-slate-500 text-xs">〜</span>
                  <input
                    type="number"
                    value={filterAmountMax}
                    onChange={(e) => setFilterAmountMax(e.target.value)}
                    placeholder="上限"
                    className="w-24 bg-slate-900 border border-slate-700 rounded-xl text-xs sm:text-sm px-2.5 py-2 text-slate-200 focus:outline-none focus:border-indigo-500"
                  />
                </div>

                {(filterPaymentMethodId !== 'all' || filterCardId !== 'all' || filterCategory !== 'all' || filterDateFrom || filterDateTo || filterAmountMin || filterAmountMax || searchQuery) && (
                  <button
                    type="button"
                    onClick={() => {
                      setFilterPaymentMethodId('all');
                      setFilterCardId('all');
                      setFilterCategory('all');
                      setFilterDateFrom('');
                      setFilterDateTo('');
                      setFilterAmountMin('');
                      setFilterAmountMax('');
                      setSearchQuery('');
                    }}
                    className="text-xs text-slate-400 hover:text-white underline underline-offset-2"
                  >
                    リセット
                  </button>
                )}
              </div>

              {(filterDateFrom || filterDateTo) && (
                <p className="text-[11px] text-amber-300">期間を指定しているため、表示中の月に関わらず全期間から検索しています。</p>
              )}
            </div>

            {/* 書き出し・読み込み */}
            <div className="bg-slate-800/90 border border-slate-700/60 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-slate-400">
                {inCapabilityHost
                  ? 'データのバックアップ、またはバックアップ用JSONファイルの読み込み'
                  : 'データのバックアップ、または明細のスクリーンショットを直接読み込めます'}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleExport}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-slate-200 text-xs sm:text-sm font-medium hover:bg-slate-700/60 transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  書き出し
                </button>
                <button
                  type="button"
                  onClick={handleImportClick}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-slate-200 text-xs sm:text-sm font-medium hover:bg-slate-700/60 transition-colors"
                >
                  <Upload className="w-3.5 h-3.5" />
                  読み込み
                </button>
              </div>
            </div>

            {/* 明細リスト */}
            <div className="bg-slate-800/90 border border-slate-700/60 rounded-2xl overflow-hidden shadow-xl">
              {filteredTransactions.length === 0 ? (
                <div className="p-8 text-center text-slate-400">
                  該当する明細がありません。
                </div>
              ) : (
                <div className="divide-y divide-slate-700/50">
                  {filteredTransactions.map((tx) => {
                    const paymentLabel = getPaymentLabel(tx);
                    const categoryObj = CATEGORIES.find((c) => c.id === tx.category) || CATEGORIES[CATEGORIES.length - 1];
                    const IconComponent = categoryObj.icon;
                    // Gmail取込みの明細だけ、受信時刻（gmailReceivedAt）から時刻を出せる。
                    // 手動入力等は時刻を持たないので日付だけ表示する。
                    const receivedTime = tx.gmailReceivedAt ? new Date(tx.gmailReceivedAt) : null;
                    const timeLabel = receivedTime
                      ? ` ${String(receivedTime.getHours()).padStart(2, '0')}:${String(receivedTime.getMinutes()).padStart(2, '0')}`
                      : '';

                    return (
                      <div
                        key={tx.id}
                        className="p-4 hover:bg-slate-700/30 transition-colors flex items-center justify-between gap-3"
                      >
                        <div className="flex items-center space-x-3.5 min-w-0">
                          <div className={`p-2.5 rounded-xl bg-slate-700 ${categoryObj.color.split(' ')[1]} shrink-0`}>
                            <IconComponent className="w-5 h-5" />
                          </div>
                          <div className="min-w-0">
                            <p className="font-semibold text-white text-sm sm:text-base truncate">
                              {tx.merchant || tx.memo}
                            </p>
                            <div className="text-xs text-slate-400 mt-0.5 leading-relaxed">
                              <div>{tx.date}{timeLabel}</div>
                              <div className="text-slate-300 font-medium truncate">{paymentLabel} ・ {categoryObj.name}</div>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center space-x-3 shrink-0">
                          <span className="font-bold text-white text-base sm:text-lg">
                            ¥{Number(tx.amount).toLocaleString()}
                          </span>
                          <button
                            onClick={() => handleOpenEditTransaction(tx)}
                            className="p-1.5 text-slate-400 hover:text-indigo-400 hover:bg-slate-700 rounded-lg transition-colors"
                            title="編集"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDeleteTransaction(tx.id)}
                            className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-slate-700 rounded-lg transition-colors"
                            title="削除"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

          </div>
        )}

        {/* --- タブ 3: カレンダー（支出カレンダー） --- */}
        {activeTab === 'calendar' && (
          <div className="space-y-6 animate-fadeIn">
            <div className="bg-slate-800/90 border border-slate-700/60 rounded-2xl p-4 sm:p-5 shadow-xl">
              <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                <Calendar className="w-5 h-5 text-indigo-400" />
                支出カレンダー（{formattedMonth}）
              </h2>

              <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-slate-500 mb-1">
                {['日', '月', '火', '水', '木', '金', '土'].map((w) => (
                  <div key={w}>{w}</div>
                ))}
              </div>

              <div className="space-y-1">
                {calendarWeeks.map((week, wi) => (
                  <div key={wi} className="grid grid-cols-7 gap-1">
                    {week.map((cell, di) => {
                      if (!cell) return <div key={di} />;
                      const entry = dailyTotals.get(cell.dateKey);
                      const ratio = maxDailyTotal > 0 && entry ? entry.total / maxDailyTotal : 0;
                      const isSelected = selectedCalendarDate === cell.dateKey;
                      // 支出が多い日ほど濃い色にして、視覚的に目立たせる
                      const heat = ratio >= 0.8
                        ? 'bg-amber-500/20 border-amber-500/40'
                        : ratio >= 0.4
                          ? 'bg-indigo-500/20 border-indigo-500/30'
                          : ratio > 0
                            ? 'bg-indigo-500/10 border-indigo-500/20'
                            : 'border-transparent hover:bg-slate-700/40';
                      return (
                        <button
                          key={di}
                          type="button"
                          onClick={() => setSelectedCalendarDate(cell.dateKey)}
                          className={`aspect-square rounded-lg border p-0.5 flex flex-col items-center justify-center gap-0.5 transition-colors ${heat} ${
                            isSelected ? 'ring-2 ring-indigo-400' : ''
                          }`}
                        >
                          <span className="text-[11px] sm:text-xs font-semibold text-slate-200">{cell.day}</span>
                          {entry && (
                            <span className="text-[8px] sm:text-[9px] font-medium text-slate-300 leading-none">
                              ¥{entry.total.toLocaleString()}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>

            {/* 選択した日の支出一覧 */}
            <div className="bg-slate-800/90 border border-slate-700/60 rounded-2xl p-5 shadow-xl">
              {selectedCalendarDate ? (
                <>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-base font-bold text-white">
                      {Number(selectedCalendarDate.slice(5, 7))}月{Number(selectedCalendarDate.slice(8, 10))}日
                    </h3>
                    <span className="text-lg font-bold text-white">
                      合計 ¥{(dailyTotals.get(selectedCalendarDate)?.total || 0).toLocaleString()}
                    </span>
                  </div>
                  {(dailyTotals.get(selectedCalendarDate)?.items || []).length === 0 ? (
                    <p className="text-sm text-slate-500 text-center py-4">この日の支出はありません。</p>
                  ) : (
                    <div className="divide-y divide-slate-700/50">
                      {dailyTotals.get(selectedCalendarDate).items.map((tx) => {
                        const categoryObj = CATEGORIES.find((c) => c.id === tx.category) || CATEGORIES[CATEGORIES.length - 1];
                        const IconComponent = categoryObj.icon;
                        return (
                          <div key={tx.id} className="py-3 flex items-center justify-between gap-3">
                            <div className="flex items-center gap-3 min-w-0">
                              <div className={`p-2 rounded-lg bg-slate-700 ${categoryObj.color.split(' ')[1]} shrink-0`}>
                                <IconComponent className="w-4 h-4" />
                              </div>
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-white truncate">{tx.merchant || tx.memo}</p>
                                <p className="text-xs text-slate-400 truncate">{getPaymentLabel(tx)}</p>
                              </div>
                            </div>
                            <span className="text-sm font-bold text-white shrink-0">¥{Number(tx.amount).toLocaleString()}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              ) : (
                <p className="text-sm text-slate-500 text-center py-4">カレンダーの日付をタップすると、その日の支出明細が表示されます。</p>
              )}
            </div>
          </div>
        )}

        {/* --- タブ 4: 分析（月間・年間） --- */}
        {activeTab === 'analysis' && (
          <div className="space-y-4 animate-fadeIn">

            {/* 月間/年間 切り替え（支払い方法別・カテゴリ別は月間・年間の中に統合済み。
                カテゴリの行をタップすると詳細モーダルが開く） */}
            <div className="grid grid-cols-2 bg-slate-800/80 p-1.5 rounded-2xl border border-slate-700/50 max-w-xs gap-1">
              {[
                { id: 'monthly', label: '月間' },
                { id: 'yearly', label: '年間' },
              ].map(({ id, label }) => (
                <button
                  key={id}
                  onClick={() => setAnalysisMode(id)}
                  className={`py-2 px-3 rounded-xl text-sm font-medium text-center transition-all ${
                    analysisMode === id ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {analysisMode === 'monthly' ? (
              <>
                <h2 className="text-lg font-bold text-white">{formattedMonth}の分析</h2>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="bg-slate-800/90 border border-slate-700/60 rounded-2xl p-4 shadow-xl">
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">総支出</p>
                    <div className="mt-2 text-xl font-extrabold text-white">¥{totalMonthlyAmount.toLocaleString()}</div>
                    {monthOverMonth && (
                      <p className={`mt-1 text-[11px] font-semibold ${monthOverMonth.diff > 0 ? 'text-rose-400' : monthOverMonth.diff < 0 ? 'text-emerald-400' : 'text-slate-400'}`}>
                        {monthOverMonth.diff > 0 ? '▲' : monthOverMonth.diff < 0 ? '▼' : '―'}
                        {' '}{Math.abs(monthOverMonth.pct).toFixed(1)}% 先月比
                      </p>
                    )}
                  </div>
                  <div className="bg-slate-800/90 border border-slate-700/60 rounded-2xl p-4 shadow-xl">
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">支出件数</p>
                    <div className="mt-2 text-xl font-extrabold text-white">{monthlyTransactions.length}<span className="text-sm text-slate-400 ml-1">件</span></div>
                  </div>
                  <div className="bg-slate-800/90 border border-slate-700/60 rounded-2xl p-4 shadow-xl">
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">1日平均</p>
                    <div className="mt-2 text-xl font-extrabold text-white">¥{Math.round(dailyAverageThisMonth).toLocaleString()}</div>
                  </div>
                  <div className="bg-slate-800/90 border border-slate-700/60 rounded-2xl p-4 shadow-xl">
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">最大支出日</p>
                    {maxSpendingDay ? (
                      <>
                        <div className="mt-2 text-xl font-extrabold text-white">{Number(maxSpendingDay.date.slice(8, 10))}日</div>
                        <p className="mt-1 text-[11px] text-slate-400">¥{maxSpendingDay.total.toLocaleString()}</p>
                      </>
                    ) : (
                      <p className="mt-2 text-slate-500 text-sm">データなし</p>
                    )}
                  </div>
                </div>

                <div className="bg-slate-800/90 border border-slate-700/60 rounded-2xl p-5 shadow-xl">
                  <h3 className="text-base font-bold text-white mb-4 flex items-center gap-2">
                    <Tag className="w-4 h-4 text-indigo-400" />
                    カテゴリ別
                  </h3>
                  {totalMonthlyAmount === 0 ? (
                    <p className="text-sm text-slate-400 text-center py-6">この月の支出はありません。</p>
                  ) : (
                    <div className="space-y-3">
                      {categoryStats.filter((c) => c.amount > 0).map((cat) => {
                        const IconComponent = cat.icon;
                        return (
                          <button
                            key={cat.id}
                            type="button"
                            onClick={() => openCategoryDrilldown(cat.id)}
                            className="w-full text-left space-y-1 -mx-2 px-2 py-1 rounded-lg hover:bg-slate-700/40 transition-colors"
                          >
                            <div className="flex items-center justify-between text-sm">
                              <div className="flex items-center space-x-2">
                                <div className={`p-1.5 rounded-lg bg-slate-700 ${cat.color.split(' ')[1]}`}>
                                  <IconComponent className="w-4 h-4" />
                                </div>
                                <span className="font-medium text-slate-200">{cat.name}</span>
                              </div>
                              <div className="text-right">
                                <span className="font-bold text-white">¥{cat.amount.toLocaleString()}</span>
                                <span className="text-xs text-slate-400 ml-2">({cat.percentage}%)</span>
                              </div>
                            </div>
                            <div className="w-full bg-slate-700/50 rounded-full h-2 overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all duration-500 ${cat.color.split(' ')[0]}`}
                                style={{ width: `${cat.percentage}%` }}
                              />
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="bg-slate-800/90 border border-slate-700/60 rounded-2xl p-5 shadow-xl">
                  <h3 className="text-base font-bold text-white mb-4 flex items-center gap-2">
                    <Wallet className="w-4 h-4 text-indigo-400" />
                    支払い方法別
                  </h3>
                  {paymentMethodMonthlyStats.length === 0 ? (
                    <p className="text-sm text-slate-400 text-center py-6">この月の支出はありません。</p>
                  ) : (
                    <div className="space-y-2">
                      {paymentMethodMonthlyStats.map((pm) => (
                        <div key={pm.id} className="flex items-center justify-between text-sm">
                          <span className="text-slate-300">{pm.name}</span>
                          <div className="text-right">
                            <span className="font-bold text-white">¥{pm.amount.toLocaleString()}</span>
                            <span className="text-xs text-slate-400 ml-2">({pm.percentage}%)</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="bg-slate-800/90 border border-slate-700/60 rounded-2xl p-5 shadow-xl">
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">年間支出</p>
                    <div className="mt-2 text-2xl font-extrabold text-white">¥{yearlyTotal.toLocaleString()}</div>
                  </div>
                  <div className="bg-slate-800/90 border border-slate-700/60 rounded-2xl p-5 shadow-xl">
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">月平均</p>
                    <div className="mt-2 text-2xl font-extrabold text-white">¥{Math.round(yearlyTotal / 12).toLocaleString()}</div>
                  </div>
                  <div className="bg-slate-800/90 border border-slate-700/60 rounded-2xl p-5 shadow-xl">
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">最も支出が多かった月</p>
                    {topSpendingMonth ? (
                      <div className="mt-2">
                        <div className="text-lg font-bold text-white">{topSpendingMonth.xLabel}</div>
                        <div className="text-indigo-400 font-semibold mt-0.5">¥{topSpendingMonth.value.toLocaleString()}</div>
                      </div>
                    ) : (
                      <p className="mt-2 text-slate-500 text-sm">データがありません</p>
                    )}
                  </div>
                </div>

                <div className="bg-slate-800/90 border border-slate-700/60 rounded-2xl p-5 shadow-xl">
                  <h3 className="text-base font-bold text-white mb-1 flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-indigo-400" />
                    月別推移
                  </h3>
                  <TrendChart series={yearlyMonthlySeries} />
                </div>

                <div className="bg-slate-800/90 border border-slate-700/60 rounded-2xl p-5 shadow-xl">
                  <h3 className="text-base font-bold text-white mb-4 flex items-center gap-2">
                    <Tag className="w-4 h-4 text-indigo-400" />
                    カテゴリ別
                  </h3>
                  {yearlyTotal === 0 ? (
                    <p className="text-sm text-slate-400 text-center py-6">この年の支出はありません。</p>
                  ) : (
                    <div className="space-y-3">
                      {yearlyCategoryStats.filter((c) => c.amount > 0).map((cat) => {
                        const IconComponent = cat.icon;
                        return (
                          <button
                            key={cat.id}
                            type="button"
                            onClick={() => openCategoryDrilldown(cat.id)}
                            className="w-full text-left space-y-1 -mx-2 px-2 py-1 rounded-lg hover:bg-slate-700/40 transition-colors"
                          >
                            <div className="flex items-center justify-between text-sm">
                              <div className="flex items-center space-x-2">
                                <div className={`p-1.5 rounded-lg bg-slate-700 ${cat.color.split(' ')[1]}`}>
                                  <IconComponent className="w-4 h-4" />
                                </div>
                                <span className="font-medium text-slate-200">{cat.name}</span>
                              </div>
                              <div className="text-right">
                                <span className="font-bold text-white">¥{cat.amount.toLocaleString()}</span>
                                <span className="text-xs text-slate-400 ml-2">({cat.percentage}%)</span>
                              </div>
                            </div>
                            <div className="w-full bg-slate-700/50 rounded-full h-2 overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all duration-500 ${cat.color.split(' ')[0]}`}
                                style={{ width: `${cat.percentage}%` }}
                              />
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="bg-slate-800/90 border border-slate-700/60 rounded-2xl p-5 shadow-xl">
                  <h3 className="text-base font-bold text-white mb-4 flex items-center gap-2">
                    <Wallet className="w-4 h-4 text-indigo-400" />
                    支払い方法別
                  </h3>
                  {yearlyTotal === 0 ? (
                    <p className="text-sm text-slate-400 text-center py-6">この年の支出はありません。</p>
                  ) : (
                    <div className="space-y-2">
                      {yearlyPaymentMethodStats.map((pm) => (
                        <div key={pm.id} className="flex items-center justify-between text-sm">
                          <span className="text-slate-300">{pm.name}</span>
                          <div className="text-right">
                            <span className="font-bold text-white">¥{pm.amount.toLocaleString()}</span>
                            <span className="text-xs text-slate-400 ml-2">({pm.percentage}%)</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* --- タブ 5: カード管理（支払い予定を統合） --- */}
        {activeTab === 'cards' && (
          <div className="space-y-6 animate-fadeIn">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-lg font-bold text-white">登録クレジットカード一覧</h2>
                <p className="text-xs text-slate-400">カードの管理・追加・削除を行えます</p>
              </div>
              <button
                onClick={() => {
                    setEditingCardId(null);
                    resetNewCardForm();
                    setIsAddCardOpen(true);
                  }}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-medium flex items-center gap-1.5 shadow-lg shadow-indigo-600/30 transition-all"
              >
                <Plus className="w-4 h-4" />
                <span>新規カード追加</span>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {cards.map((card) => {
                const theme = CARD_THEMES[card.theme] || CARD_THEMES.purple;
                return (
                  <div
                    key={card.id}
                    className="bg-slate-800/90 border border-slate-700/60 rounded-2xl p-5 shadow-xl flex flex-col justify-between space-y-4"
                  >
                    {/* カード上部表示 */}
                    <div className="flex items-start justify-between">
                      <div className="flex items-center space-x-3">
                        <div className={`p-3 rounded-xl ${theme.bg} shadow-md`}>
                          <CreditCard className="w-6 h-6 text-white" />
                        </div>
                        <div>
                          <h3 className="font-bold text-white text-base">{card.name}</h3>
                          <p className="text-xs text-slate-400">{card.brand} •••• {card.last4}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleOpenEditCard(card)}
                          className="p-2 text-slate-400 hover:text-indigo-400 hover:bg-slate-700 rounded-xl transition-colors"
                          title="カード情報を編集"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteCard(card.id)}
                          className="p-2 text-slate-400 hover:text-red-400 hover:bg-slate-700 rounded-xl transition-colors"
                          title="カード削除"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {/* カード番号・有効期限・セキュリティコード・名義 */}
                    <div className="bg-slate-900/50 p-3.5 rounded-xl border border-slate-700/40 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                          <User className="w-3.5 h-3.5" />
                          {card.holderName || '名義未登録'}
                        </span>
                        <button
                          type="button"
                          onClick={() => toggleCardReveal(card.id)}
                          className="flex items-center gap-1 text-[11px] font-medium text-indigo-400 hover:text-indigo-300"
                        >
                          {revealedCards.has(card.id) ? (
                            <>
                              <EyeOff className="w-3.5 h-3.5" /> 隠す
                            </>
                          ) : (
                            <>
                              <Eye className="w-3.5 h-3.5" /> 詳細を表示
                            </>
                          )}
                        </button>
                      </div>

                      <div>
                        <span className="text-[10px] text-slate-500 block mb-0.5">カード番号</span>
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-sm text-slate-200 tracking-wider">
                            {revealedCards.has(card.id) ? formatCardNumber(card.number) : maskCardNumber(card.number, card.last4)}
                          </span>
                          {revealedCards.has(card.id) && card.number && (
                            <button
                              type="button"
                              onClick={() => handleCopyToClipboard(card.number.replace(/\D/g, ''), `${card.id}:number`)}
                              className="p-1 text-slate-500 hover:text-indigo-400 shrink-0"
                              title="カード番号をコピー"
                            >
                              {copiedField === `${card.id}:number` ? (
                                <Check className="w-3.5 h-3.5 text-emerald-400" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div className="min-w-0">
                          <span className="text-[10px] text-slate-500 block mb-0.5">有効期限</span>
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-sm text-slate-200">
                              {revealedCards.has(card.id) ? (card.expiry || '未登録') : '••/••'}
                            </span>
                            {revealedCards.has(card.id) && card.expiry && (
                              <button
                                type="button"
                                onClick={() => handleCopyToClipboard(card.expiry, `${card.id}:expiry`)}
                                className="p-1 text-slate-500 hover:text-indigo-400 shrink-0"
                                title="有効期限をコピー"
                              >
                                {copiedField === `${card.id}:expiry` ? (
                                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                                ) : (
                                  <Copy className="w-3.5 h-3.5" />
                                )}
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="min-w-0">
                          <span className="text-[10px] text-slate-500 block mb-0.5">セキュリティコード</span>
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-sm text-slate-200">
                              {revealedCards.has(card.id) ? (card.cvv || '未登録') : '•••'}
                            </span>
                            {revealedCards.has(card.id) && card.cvv && (
                              <button
                                type="button"
                                onClick={() => handleCopyToClipboard(card.cvv, `${card.id}:cvv`)}
                                className="p-1 text-slate-500 hover:text-indigo-400 shrink-0"
                                title="セキュリティコードをコピー"
                              >
                                {copiedField === `${card.id}:cvv` ? (
                                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                                ) : (
                                  <Copy className="w-3.5 h-3.5" />
                                )}
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* 詳細設定情報 */}
                    <div className="grid grid-cols-3 gap-2 bg-slate-900/50 p-3 rounded-xl text-xs border border-slate-700/40">
                      <div>
                        <span className="text-slate-400 block">利用限度額</span>
                        <span className="font-semibold text-slate-200">
                          {card.limit ? `¥${card.limit.toLocaleString()}` : '未設定'}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 block">締め日</span>
                        <span className="font-semibold text-slate-200">{card.billingDay}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block">支払日</span>
                        <span className="font-semibold text-slate-200">毎月{card.paymentDay}日</span>
                      </div>
                    </div>

                    {/* 補足情報: 引落口座・今年の累計/月平均・変化検知（控えめに1行ずつ） */}
                    <div className="text-[11px] text-slate-500 space-y-0.5">
                      {card.bankAccount && (
                        <p>引落口座: <span className="text-slate-400">{card.bankAccount}</span></p>
                      )}
                      <p>
                        今年の累計 ¥{(cardYearlyStats[card.id]?.total || 0).toLocaleString()}
                        {' '}・ 月平均 ¥{Math.round(cardYearlyStats[card.id]?.average || 0).toLocaleString()}
                      </p>
                      {cardVarianceNotes[card.id] && (
                        <p>
                          {cardVarianceNotes[card.id].higher ? '通常より高め' : '通常より少なめ'}
                          （平均{cardVarianceNotes[card.id].higher ? '+' : ''}{Math.round(cardVarianceNotes[card.id].diffPct)}%）
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* 支払い予定（旧・独立タブ。カード管理の一部として統合） */}
            {/* 支払予定一覧 */}
            <div className="bg-slate-800/90 border border-slate-700/60 rounded-2xl p-5 shadow-xl">
              <h2 className="text-lg font-bold text-white mb-4">支払予定一覧</h2>
              {paymentSchedule.length === 0 ? (
                <p className="text-sm text-slate-500">支払予定はありません。カードに締め日・支払日を設定してください。</p>
              ) : (
                <div className="divide-y divide-slate-700/50">
                  {paymentSchedule.map(({ card, paymentDate, amount, daysUntil }) => (
                    <div key={card.id} className="py-3 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-white">
                          {paymentDate.getMonth() + 1}/{paymentDate.getDate()}
                          <span className="ml-2 text-slate-300 font-normal truncate">{card.name}</span>
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          {daysUntil === 0 ? '今日' : `あと${daysUntil}日`}
                        </div>
                      </div>
                      <div className="text-base font-bold text-white shrink-0">¥{amount.toLocaleString()}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 支払いカレンダー */}
            <div className="bg-slate-800/90 border border-slate-700/60 rounded-2xl p-5 shadow-xl">
              <h2 className="text-lg font-bold text-white mb-4">支払いカレンダー（{formattedMonth}）</h2>
              {scheduleCalendarDays.length === 0 ? (
                <p className="text-sm text-slate-500">この月に支払日があるカードはありません。</p>
              ) : (
                <div className="space-y-4">
                  {scheduleCalendarDays.map(({ day, items }) => (
                    <div key={day} className="flex gap-4">
                      <div className="w-10 shrink-0 text-center">
                        <div className="text-lg font-bold text-white">{day}</div>
                        <div className="text-[10px] text-slate-500">日</div>
                      </div>
                      <div className="flex-1 space-y-1.5 min-w-0">
                        {items.map(({ card, amount }) => (
                          <div
                            key={card.id}
                            className="flex items-center justify-between gap-3 bg-slate-900/50 rounded-xl px-3 py-2 min-w-0"
                          >
                            <span className="text-sm text-slate-200 truncate">{card.name}</span>
                            <span className="text-sm font-bold text-white shrink-0">¥{amount.toLocaleString()}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 引落口座別必要額 */}
            {bankAccountTotals.length > 0 && (
              <div className="bg-slate-800/90 border border-slate-700/60 rounded-2xl p-5 shadow-xl">
                <h2 className="text-lg font-bold text-white mb-1">今月の引落口座別必要額</h2>
                <p className="text-xs text-slate-500 mb-4">引落口座を設定しているカードのみ集計しています</p>
                <div className="space-y-2">
                  {bankAccountTotals.map(({ bankAccount, amount }) => (
                    <div key={bankAccount} className="flex items-center justify-between gap-3">
                      <span className="text-sm text-slate-300 truncate">{bankAccount}</span>
                      <span className="text-base font-bold text-white shrink-0">¥{amount.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>
        )}

      </main>

      {/* モバイル専用: 画面下部に固定するタブバー（sm以上では上部の横並びタブを使うため非表示） */}
      <nav
        className="sm:hidden fixed bottom-0 inset-x-0 z-30 bg-slate-900/95 backdrop-blur-md border-t border-slate-800 pb-[env(safe-area-inset-bottom)]"
      >
        <div className="grid grid-cols-5">
          {[
            { id: 'dashboard', label: 'ホーム', Icon: PieChart },
            { id: 'transactions', label: '明細', Icon: List },
            { id: 'calendar', label: 'カレンダー', Icon: Calendar },
            { id: 'analysis', label: '分析', Icon: BarChart3 },
            { id: 'cards', label: 'カード', Icon: Wallet },
          ].map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              className={`flex flex-col items-center justify-center gap-0.5 py-2 min-w-0 min-h-[50px] transition-colors ${
                activeTab === id ? 'text-indigo-400' : 'text-slate-500'
              }`}
            >
              <Icon className="w-5 h-5 shrink-0" />
              <span className="text-[11px] font-medium truncate max-w-full">{label}</span>
            </button>
          ))}
        </div>
      </nav>

      {/* 書き出し・読み込み用の隠しファイル入力（どのタブからでも使えるよう常時マウント） */}
      <input
        ref={importFileRef}
        type="file"
        accept={inCapabilityHost ? 'application/json' : 'application/json,image/*'}
        onChange={handleImportFile}
        className="sr-only"
      />

      {/* 4. モーダル: 利用明細の記録 */}
      {isAddTransactionOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-800 border border-slate-700 rounded-3xl max-w-md w-full p-6 shadow-2xl relative space-y-4 max-h-[88vh] overflow-y-auto">
            <div className="flex justify-between items-center pb-2 border-b border-slate-700">
              <h3 className="font-bold text-lg text-white flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-indigo-400" />
                {editingTxId ? '利用明細の編集' : '利用明細の登録'}
              </h3>
              <button
                onClick={handleCloseTransactionModal}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {!editingTxId && !inCapabilityHost && (
              <button
                type="button"
                onClick={() => {
                  handleCloseTransactionModal();
                  handleImportClick();
                }}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-dashed border-slate-600 text-slate-300 text-sm font-medium hover:bg-slate-700/40 transition-colors"
              >
                <Upload className="w-4 h-4" />
                スクリーンショットから読み込む
              </button>
            )}

            <form onSubmit={handleSaveTransaction} className="space-y-5">
              {/* 利用金額 */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-2">利用金額 (円)</label>
                <input
                  type="number"
                  required
                  placeholder="例: 3500"
                  value={newTx.amount}
                  onChange={(e) => setNewTx({ ...newTx, amount: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-white font-bold text-lg focus:outline-none focus:border-indigo-500"
                />
              </div>

              {/* 支払い方法選択（クレジットカードの場合のみ、下にカード選択が出る） */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-2">支払い方法</label>
                <select
                  value={newTx.paymentMethodId}
                  onChange={(e) => setNewTx({ ...newTx, paymentMethodId: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-3 text-slate-200 text-sm focus:outline-none focus:border-indigo-500"
                >
                  {[...paymentMethods].filter((m) => m.isActive !== false).sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0)).map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              </div>

              {(paymentMethods.find((m) => m.id === newTx.paymentMethodId)?.type ?? 'credit_card') === 'credit_card' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-2">カード</label>
                  <select
                    value={newTx.cardId}
                    onChange={(e) => setNewTx({ ...newTx, cardId: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-3 text-slate-200 text-sm focus:outline-none focus:border-indigo-500"
                  >
                    {cards.map((c) => (
                      <option key={c.id} value={c.id}>{c.name} ({c.brand})</option>
                    ))}
                  </select>
                </div>
              )}

              {/* 利用日 & カテゴリ */}
              {/* iOS Safari の <input type="date"> は CSS で幅を縮められない内部レイアウトを
                  持つため、横並び(2カラム)にすると隣のカテゴリ欄に重なってしまう。
                  スマホでは縦積みにして回避する。 */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="min-w-0">
                  <label className="block text-xs font-semibold text-slate-300 mb-2">利用日</label>
                  <input
                    type="date"
                    required
                    value={newTx.date}
                    onChange={(e) => setNewTx({ ...newTx, date: e.target.value })}
                    className="w-full min-w-0 appearance-none bg-slate-900 border border-slate-700 rounded-xl px-3 py-3 text-slate-200 text-sm focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div className="min-w-0">
                  <label className="block text-xs font-semibold text-slate-300 mb-2">カテゴリ</label>
                  <select
                    value={newTx.category}
                    onChange={(e) => setNewTx({ ...newTx, category: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-3 text-slate-200 text-sm focus:outline-none focus:border-indigo-500"
                  >
                    {CATEGORIES.map((cat) => (
                      <option key={cat.id} value={cat.id}>{cat.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* 店舗名 */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-2">店舗名</label>
                <input
                  type="text"
                  placeholder="例: セブンイレブン、Amazonなど"
                  value={newTx.merchant}
                  onChange={(e) => setNewTx({ ...newTx, merchant: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-3 text-slate-200 text-sm focus:outline-none focus:border-indigo-500"
                />
              </div>

              {/* メモ（自由記述） */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-2">メモ（任意）</label>
                <input
                  type="text"
                  placeholder="例: 誕生日プレゼント"
                  value={newTx.memo}
                  onChange={(e) => setNewTx({ ...newTx, memo: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-3 text-slate-200 text-sm focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="pt-2 flex gap-3">
                <button
                  type="button"
                  onClick={handleCloseTransactionModal}
                  className="flex-1 py-2.5 rounded-xl border border-slate-700 text-slate-300 font-medium text-sm hover:bg-slate-700/50"
                >
                  キャンセル
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-sm shadow-lg shadow-indigo-600/30"
                >
                  {editingTxId ? '更新する' : '保存する'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 5. モーダル: カードの登録・編集 */}
      {isAddCardOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-800 border border-slate-700 rounded-3xl max-w-md w-full p-6 shadow-2xl relative space-y-4 max-h-[88vh] overflow-y-auto">
            <div className="flex justify-between items-center pb-2 border-b border-slate-700">
              <h3 className="font-bold text-lg text-white flex items-center gap-2">
                <CreditCard className="w-5 h-5 text-indigo-400" />
                {editingCardId ? 'カード情報を編集' : '新しいカードを追加'}
              </h3>
              <button
                onClick={handleCloseCardModal}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveCard} className="space-y-5">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-2">カード名</label>
                <input
                  type="text"
                  required
                  placeholder="例: 三井住友カード, 楽天ゴールドカード"
                  value={newCard.name}
                  onChange={(e) => setNewCard({ ...newCard, name: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-3 text-slate-200 text-sm focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-2">国際ブランド</label>
                <select
                  value={newCard.brand}
                  onChange={(e) => setNewCard({ ...newCard, brand: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-3 text-slate-200 text-sm focus:outline-none focus:border-indigo-500"
                >
                  <option value="VISA">VISA</option>
                  <option value="Mastercard">Mastercard</option>
                  <option value="JCB">JCB</option>
                  <option value="Amex">American Express</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-2">カード番号</label>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={19}
                  placeholder="1234 5678 9012 3456"
                  value={newCard.number}
                  onChange={(e) => setNewCard({ ...newCard, number: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-3 text-slate-200 text-sm font-mono tracking-wider focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-2">名義人</label>
                <input
                  type="text"
                  placeholder="例: TARO YAMADA"
                  value={newCard.holderName}
                  onChange={(e) => setNewCard({ ...newCard, holderName: e.target.value.toUpperCase() })}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-3 text-slate-200 text-sm focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="min-w-0">
                  <label className="block text-xs font-semibold text-slate-300 mb-2">有効期限</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={5}
                    placeholder="MM/YY"
                    value={newCard.expiry}
                    onChange={(e) => setNewCard({ ...newCard, expiry: e.target.value })}
                    className="w-full min-w-0 bg-slate-900 border border-slate-700 rounded-xl px-3 py-3 text-slate-200 text-sm font-mono focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div className="min-w-0">
                  <label className="block text-xs font-semibold text-slate-300 mb-2">セキュリティコード</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={4}
                    placeholder="123"
                    value={newCard.cvv}
                    onChange={(e) => setNewCard({ ...newCard, cvv: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-3 text-slate-200 text-sm font-mono focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              {/* カードテーマ色設定 */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-2">カードデザインカラー</label>
                <div className="grid grid-cols-5 gap-2">
                  {Object.keys(CARD_THEMES).map((key) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setNewCard({ ...newCard, theme: key })}
                      className={`h-10 rounded-xl ${CARD_THEMES[key].bg} border-2 transition-all ${
                        newCard.theme === key ? 'border-white scale-105' : 'border-transparent opacity-60'
                      }`}
                    />
                  ))}
                </div>
              </div>

              {/* 利用限度額 */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-2">月間利用限度額 (円)</label>
                <input
                  type="number"
                  placeholder="300000"
                  value={newCard.limit}
                  onChange={(e) => setNewCard({ ...newCard, limit: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-3 text-slate-200 text-sm focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="min-w-0">
                  <label className="block text-xs font-semibold text-slate-300 mb-2">締め日</label>
                  <input
                    type="text"
                    placeholder="例: 末日, 15日"
                    value={newCard.billingDay}
                    onChange={(e) => setNewCard({ ...newCard, billingDay: e.target.value })}
                    className="w-full min-w-0 bg-slate-900 border border-slate-700 rounded-xl px-3 py-3 text-slate-200 text-sm focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div className="min-w-0">
                  <label className="block text-xs font-semibold text-slate-300 mb-2">引き落とし日</label>
                  <input
                    type="text"
                    placeholder="例: 27日, 10日"
                    value={newCard.paymentDay}
                    onChange={(e) => setNewCard({ ...newCard, paymentDay: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-3 text-slate-200 text-sm focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              {/* 支払日が土日の場合の調整 */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-2">支払日が土日の場合</label>
                <select
                  value={newCard.weekendAdjustment}
                  onChange={(e) => setNewCard({ ...newCard, weekendAdjustment: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-3 text-slate-200 text-sm focus:outline-none focus:border-indigo-500"
                >
                  <option value="none">調整しない</option>
                  <option value="next">翌営業日にする</option>
                  <option value="prev">前営業日にする</option>
                </select>
              </div>

              {/* 引落口座（任意） */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-2">引落口座（任意）</label>
                <input
                  type="text"
                  placeholder="例: 三井住友銀行"
                  value={newCard.bankAccount}
                  onChange={(e) => setNewCard({ ...newCard, bankAccount: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-3 text-slate-200 text-sm focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="pt-2 flex gap-3">
                <button
                  type="button"
                  onClick={handleCloseCardModal}
                  className="flex-1 py-2.5 rounded-xl border border-slate-700 text-slate-300 font-medium text-sm hover:bg-slate-700/50"
                >
                  キャンセル
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-sm shadow-lg shadow-indigo-600/30"
                >
                  {editingCardId ? '更新する' : '登録する'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 6. 画像読み取り中のローディング */}
      {ocrLoading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl px-8 py-7 shadow-2xl flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-slate-200 font-medium">画像を読み取っています…</p>
            <p className="text-xs text-slate-500">初回は読み取りエンジンのダウンロードのため少し時間がかかります</p>
          </div>
        </div>
      )}

      {/* 7. モーダル: 自動検出できなかった時に、読み取れた生テキストを見せる */}
      {ocrRawText && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-800 border border-slate-700 rounded-3xl max-w-lg w-full p-6 shadow-2xl relative space-y-4 max-h-[88vh] overflow-y-auto">
            <div className="flex justify-between items-center pb-2 border-b border-slate-700">
              <h3 className="font-bold text-lg text-white flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-indigo-400" />
                明細を自動検出できませんでした
              </h3>
              <button
                onClick={() => setOcrRawText(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-slate-400">
              画像からは以下のテキストが読み取れましたが、日付・金額の組み合わせを自動判定できませんでした。
              このままJSONファイルの読み込みをご利用いただくか、下の内容を開発者へ共有してください。
            </p>
            <pre className="whitespace-pre-wrap break-words bg-slate-900 border border-slate-700 rounded-xl p-3 text-xs text-slate-300 max-h-64 overflow-y-auto">
{ocrRawText}
            </pre>
            <div className="pt-2">
              <button
                type="button"
                onClick={() => setOcrRawText(null)}
                className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-sm shadow-lg shadow-indigo-600/30"
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 8. モーダル: 画像読み取り結果の確認 */}
      {ocrReview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-800 border border-slate-700 rounded-3xl max-w-lg w-full p-6 shadow-2xl relative space-y-4 max-h-[88vh] overflow-y-auto">
            <div className="flex justify-between items-center pb-2 border-b border-slate-700">
              <h3 className="font-bold text-lg text-white flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-indigo-400" />
                読み取り結果を確認
              </h3>
              <button
                onClick={() => setOcrReview(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-amber-200 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2">
              画像から自動で読み取った内容です。日付・金額が正しいか確認してから追加してください。
            </p>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">追加先のカード</label>
              <select
                value={ocrReview.cardId}
                onChange={(e) => setOcrReview({ ...ocrReview, cardId: e.target.value })}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-slate-200 text-sm focus:outline-none focus:border-indigo-500"
              >
                {cards.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

            {ocrReview.candidates.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-6">すべての候補を削除しました。</p>
            ) : (
              <div className="space-y-3">
                {ocrReview.candidates.map((c, idx) => (
                  <div key={c.id} className="bg-slate-900/60 border border-slate-700/50 rounded-xl p-3 space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="date"
                        value={c.date}
                        onChange={(e) => updateOcrCandidate(idx, { date: e.target.value })}
                        className="w-full min-w-0 appearance-none bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-slate-200 text-xs focus:outline-none focus:border-indigo-500"
                      />
                      <input
                        type="number"
                        value={c.amount}
                        onChange={(e) => updateOcrCandidate(idx, { amount: e.target.value })}
                        className="w-full min-w-0 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-slate-200 text-xs font-mono focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={c.memo}
                        onChange={(e) => updateOcrCandidate(idx, { memo: e.target.value })}
                        placeholder="メモ"
                        className="flex-1 min-w-0 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-slate-200 text-xs focus:outline-none focus:border-indigo-500"
                      />
                      <button
                        type="button"
                        onClick={() => removeOcrCandidate(idx)}
                        className="flex-none p-1.5 text-slate-400 hover:text-red-400 hover:bg-slate-700 rounded-lg"
                        title="この候補を削除"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <select
                      value={c.category}
                      onChange={(e) => updateOcrCandidate(idx, { category: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-slate-200 text-xs focus:outline-none focus:border-indigo-500"
                    >
                      {CATEGORIES.map((cat) => (
                        <option key={cat.id} value={cat.id}>{cat.name}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            )}

            <div className="pt-2 flex gap-3">
              <button
                type="button"
                onClick={() => setOcrReview(null)}
                className="flex-1 py-2.5 rounded-xl border border-slate-700 text-slate-300 font-medium text-sm hover:bg-slate-700/50"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={handleConfirmOcrImport}
                disabled={ocrReview.candidates.length === 0}
                className="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-sm shadow-lg shadow-indigo-600/30 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {ocrReview.candidates.length}件を追加する
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 9. モーダル: 確認待ちの利用通知（Gmail自動取込みが確信を持てなかったもの） */}
      {isPendingReviewOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-800 border border-slate-700 rounded-3xl max-w-lg w-full p-6 shadow-2xl relative space-y-4 max-h-[88vh] overflow-y-auto">
            <div className="flex justify-between items-center pb-2 border-b border-slate-700">
              <h3 className="font-bold text-lg text-white flex items-center gap-2">
                <Inbox className="w-5 h-5 text-amber-400" />
                確認待ち（{pendingImports.length}件）
              </h3>
              <button
                onClick={() => setIsPendingReviewOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-amber-200 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2">
              Gmail自動取込みが「利用通知かどうか」「どのカードの明細か」を確信できなかったメールです。
              内容を確認して、登録するか無視するか選んでください。
            </p>

            {pendingImports.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-6">確認待ちはありません。</p>
            ) : (
              <div className="space-y-3">
                {pendingImports.map((item) => (
                  <div key={item.id} className="bg-slate-900/60 border border-slate-700/50 rounded-xl p-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-white truncate">{item.merchant || item.issuerNameGuess || '(店舗不明)'}</p>
                        <p className="text-xs text-slate-400 truncate" title={item.subject}>{item.subject}</p>
                        <p className="text-[11px] text-slate-500 truncate" title={item.from}>差出人: {item.from || '不明'}</p>
                      </div>
                      {item.amount ? (
                        <span className="flex-none text-sm font-mono font-bold text-white">¥{Number(item.amount).toLocaleString()}</span>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
                      <span>利用日: {item.date || '不明'}</span>
                      <span>
                        推定される支払い方法: {item.issuerNameGuess || '不明'}
                        {item.last4Guess ? `（下4桁: ${item.last4Guess}）` : ''}
                      </span>
                    </div>

                    <p className="text-[11px] text-slate-300 bg-slate-800/80 border border-slate-700/50 rounded-lg px-2 py-1.5">
                      判定理由: {item.reason || '不明'}
                    </p>

                    {(() => {
                      const choice = getPendingChoice(item);
                      const selectedMethod = paymentMethods.find((m) => m.id === choice.paymentMethodId);
                      const isCreditCard = selectedMethod ? selectedMethod.type === 'credit_card' : choice.paymentMethodId === PAYMENT_METHOD_CREDIT_CARD_ID;
                      const setChoice = (patch) => setPendingLinkChoice((prev) => ({ ...prev, [item.id]: { ...choice, ...patch } }));
                      return (
                        <div className="space-y-2 pt-1">
                          <select
                            value={choice.paymentMethodId}
                            onChange={(e) => setChoice({ paymentMethodId: e.target.value })}
                            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-slate-200 text-xs focus:outline-none focus:border-indigo-500"
                          >
                            {[...paymentMethods].filter((m) => m.isActive !== false).sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0)).map((m) => (
                              <option key={m.id} value={m.id}>{m.name}</option>
                            ))}
                          </select>

                          {isCreditCard && cards.length > 0 && (
                            <select
                              value={choice.cardId || cards[0]?.id || ''}
                              onChange={(e) => setChoice({ cardId: e.target.value })}
                              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-slate-200 text-xs focus:outline-none focus:border-indigo-500"
                            >
                              {cards.map((c) => (
                                <option key={c.id} value={c.id}>{c.name}</option>
                              ))}
                            </select>
                          )}

                          <button
                            type="button"
                            onClick={() => handleRegisterPending(item)}
                            className="w-full py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium"
                          >
                            この内容で登録
                          </button>

                          <div className="flex gap-2">
                            {isCreditCard && (
                              <button
                                type="button"
                                onClick={() => handleOpenAddCardFromPending(item)}
                                className="flex-1 py-1.5 rounded-lg border border-slate-700 hover:bg-slate-700/50 text-slate-300 text-xs font-medium"
                              >
                                新しいカードを追加
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleIgnorePendingImport(item)}
                              className="flex-1 py-1.5 rounded-lg border border-slate-700 hover:bg-slate-700/50 text-slate-400 hover:text-red-400 text-xs font-medium"
                            >
                              無視する
                            </button>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 10. モーダル: カテゴリ別支出の詳細（月間/年間分析のカテゴリ行タップで開く） */}
      {isCategoryDrilldownOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-800 border border-slate-700 rounded-3xl max-w-lg w-full p-6 shadow-2xl relative space-y-4 max-h-[88vh] overflow-y-auto">
            <div className="flex justify-between items-center pb-2 border-b border-slate-700">
              <h3 className="font-bold text-lg text-white flex items-center gap-2">
                {(() => {
                  const cat = CATEGORIES.find((c) => c.id === analysisCategoryId) || CATEGORIES[0];
                  const IconComponent = cat.icon;
                  return (
                    <>
                      <IconComponent className="w-5 h-5 text-indigo-400" />
                      {cat.name}の推移
                    </>
                  );
                })()}
              </h3>
              <button
                onClick={() => setIsCategoryDrilldownOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {/* 期間切り替え：月別／年別 */}
              <div className="grid grid-cols-2 bg-slate-900/70 p-1.5 rounded-2xl border border-slate-700/50 w-full max-w-[200px] gap-1">
                {[
                  { id: 'monthly', label: '月別' },
                  { id: 'yearly', label: '年別' },
                ].map(({ id, label }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setCategoryPeriodMode(id)}
                    className={`py-2 px-3 rounded-xl text-sm font-medium text-center transition-all ${
                      categoryPeriodMode === id ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* 年選択（月別のときだけ。年別は全期間をまとめて見るため不要） */}
              {categoryPeriodMode === 'monthly' && (
                <div className="flex items-center justify-between bg-slate-900/70 border border-slate-700/50 rounded-2xl px-1.5 py-1.5">
                  <button
                    type="button"
                    onClick={() => setAnalysisYear((y) => y - 1)}
                    className="shrink-0 p-1.5 rounded-lg hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
                    title="前年"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="text-sm font-bold text-white px-2">{analysisYear}年</span>
                  <button
                    type="button"
                    onClick={() => setAnalysisYear((y) => y + 1)}
                    className="shrink-0 p-1.5 rounded-lg hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
                    title="翌年"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>

            {/* カテゴリ切り替え（横スクロールのチップ。別カテゴリへそのまま切り替えられる） */}
            <div className="flex gap-2 overflow-x-auto -mx-6 px-6 pb-1">
              {CATEGORIES.map((c) => {
                const selected = (analysisCategoryId || CATEGORIES[0]?.id) === c.id;
                const IconComponent = c.icon;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setAnalysisCategoryId(c.id)}
                    className={`shrink-0 flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-colors ${
                      selected ? 'bg-indigo-600 text-white shadow-md' : 'bg-slate-900/70 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <IconComponent className="w-4 h-4 shrink-0" />
                    {c.name}
                  </button>
                );
              })}
            </div>

            {/* サマリー */}
            {categoryPeriodSummary && (
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-slate-900/70 border border-slate-700/60 rounded-2xl p-4">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                    {categoryPeriodMode === 'monthly' ? '今月の金額' : '今年の金額'}
                  </p>
                  <div className="mt-2 text-xl font-extrabold text-white">¥{categoryPeriodSummary.current.value.toLocaleString()}</div>
                  {categoryPeriodSummary.diffPct !== null && (
                    <p className={`mt-1 text-[11px] font-semibold ${categoryPeriodSummary.diff > 0 ? 'text-rose-400' : categoryPeriodSummary.diff < 0 ? 'text-emerald-400' : 'text-slate-400'}`}>
                      {categoryPeriodSummary.diff > 0 ? '▲' : categoryPeriodSummary.diff < 0 ? '▼' : '―'}
                      {' '}{Math.abs(categoryPeriodSummary.diffPct).toFixed(1)}% {categoryPeriodMode === 'monthly' ? '前月比' : '前年比'}
                    </p>
                  )}
                </div>
                <div className="bg-slate-900/70 border border-slate-700/60 rounded-2xl p-4">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                    {categoryPeriodMode === 'monthly' ? '月平均' : '年平均'}
                  </p>
                  <div className="mt-2 text-xl font-extrabold text-white">¥{Math.round(categoryPeriodSummary.average).toLocaleString()}</div>
                </div>
                <div className="bg-slate-900/70 border border-slate-700/60 rounded-2xl p-4 col-span-2">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                    {categoryPeriodMode === 'monthly' ? '最も支出が多かった月' : '最も支出が多かった年'}
                  </p>
                  {categoryPeriodSummary.max ? (
                    <div className="mt-2 flex items-baseline gap-2">
                      <span className="text-lg font-bold text-white">{categoryPeriodSummary.max.fullLabel}</span>
                      <span className="text-indigo-400 font-semibold">¥{categoryPeriodSummary.max.value.toLocaleString()}</span>
                    </div>
                  ) : (
                    <p className="mt-2 text-slate-500 text-sm">データがありません</p>
                  )}
                </div>
              </div>
            )}

            <div className="bg-slate-900/70 border border-slate-700/60 rounded-2xl p-4">
              <TrendChart series={categoryPeriodSeries} />
            </div>

            <div className="bg-slate-900/70 border border-slate-700/60 rounded-2xl p-4">
              {categoryPeriodSeries.filter((p) => p.value > 0).length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-6">データがありません。</p>
              ) : (
                <div className="divide-y divide-slate-700/50">
                  {categoryPeriodSeries.map((m) => (
                    <div key={m.key} className="py-2 flex items-center justify-between gap-3">
                      <span className="text-sm text-slate-300">{m.fullLabel}</span>
                      <span className="text-sm font-bold text-white">¥{m.value.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 11. モーダル: アカウント（クラウド同期） */}
      {isAccountModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-800 border border-slate-700 rounded-3xl max-w-sm w-full p-6 shadow-2xl relative space-y-4 max-h-[88vh] overflow-y-auto">
            <div className="flex justify-between items-center pb-2 border-b border-slate-700">
              <h3 className="font-bold text-lg text-white flex items-center gap-2">
                <Cloud className="w-5 h-5 text-indigo-400" />
                アカウント・同期
              </h3>
              <button
                onClick={() => setIsAccountModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="text-xs text-slate-400">
              {authUser.isAnonymous
                ? 'この端末専用のデータです（未ログイン）。他の端末と同期するには、下でメールアドレスを設定してください。'
                : `ログイン中: ${authUser.email}`}
            </div>

            <div className="bg-slate-900/50 border border-slate-700/40 rounded-xl p-3 space-y-1">
              <div className="text-[10px] text-slate-500 font-semibold">アカウントID</div>
              <code className="block text-xs font-mono text-slate-300 break-all select-all">{authUser.uid}</code>
            </div>

            {gmailImportStatus && (
              <div className="bg-slate-900/50 border border-slate-700/40 rounded-xl p-3 space-y-1.5">
                <div className="text-[10px] text-slate-500 font-semibold">Gmail自動取り込み</div>
                {(() => {
                  const lastCheckedAt = gmailImportStatus.lastCheckedAt ? new Date(gmailImportStatus.lastCheckedAt) : null;
                  const minutesAgo = lastCheckedAt ? Math.round((Date.now() - lastCheckedAt.getTime()) / 60000) : null;
                  const stale = minutesAgo !== null && minutesAgo >= 90;
                  const ok = gmailImportStatus.ok !== false && !stale;
                  return (
                    <>
                      <div className="flex items-center gap-1.5 text-xs">
                        <span className={`w-1.5 h-1.5 rounded-full ${ok ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                        <span className="text-slate-300">
                          {stale ? '止まっている可能性があります' : gmailImportStatus.ok === false ? 'エラーが発生しています' : '正常に動作中'}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500">
                        最終確認: {lastCheckedAt
                          ? `${lastCheckedAt.getMonth() + 1}/${lastCheckedAt.getDate()} ${String(lastCheckedAt.getHours()).padStart(2, '0')}:${String(lastCheckedAt.getMinutes()).padStart(2, '0')}（${minutesAgo}分前）`
                          : '不明'}
                        {' '}・ 前回の取り込み件数: {gmailImportStatus.importedLastRun ?? 0}件
                      </p>
                      {gmailImportStatus.error && (
                        <p className="text-[11px] text-red-400 break-all">{gmailImportStatus.error}</p>
                      )}
                    </>
                  );
                })()}
              </div>
            )}

            {authUser.isAnonymous ? (
              <form onSubmit={handleLinkEmailAccount} className="space-y-2 pt-2 border-t border-slate-700">
                <p className="text-[11px] text-slate-400">
                  メールアドレスとパスワードを設定すると、他の端末（スマホなど）からも同じデータにログインできるようになります。
                </p>
                <input
                  type="email"
                  placeholder="メールアドレス"
                  value={linkEmail}
                  onChange={(e) => setLinkEmail(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 text-sm focus:outline-none focus:border-indigo-500"
                />
                <input
                  type="password"
                  placeholder="パスワード（6文字以上）"
                  value={linkPassword}
                  onChange={(e) => setLinkPassword(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 text-sm focus:outline-none focus:border-indigo-500"
                />
                {linkError && <p className="text-xs text-red-400">{linkError}</p>}
                <button
                  type="submit"
                  disabled={linkBusy}
                  className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white text-xs font-bold py-2.5 rounded-xl"
                >
                  他の端末からもログインできるようにする
                </button>
              </form>
            ) : (
              <div className="pt-2 border-t border-slate-700">
                <button
                  type="button"
                  onClick={handleLogout}
                  className="w-full flex items-center justify-center gap-1.5 border border-slate-700 hover:bg-slate-700/50 text-slate-200 text-xs font-bold py-2.5 rounded-xl"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  ログアウト
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      <p className="text-center text-[11px] text-slate-600 pt-6 pb-24 sm:pb-6 px-4">
        {authUser.isAnonymous
          ? 'データはこの端末に保存されます。クラウドにも自動バックアップされますが、他の端末と同期するにはアカウント設定が必要です。'
          : `${authUser.email} としてログイン中。データは端末をまたいで自動同期されます。`}
      </p>

    </div>
  );
}
