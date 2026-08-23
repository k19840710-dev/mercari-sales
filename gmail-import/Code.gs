/**
 * カード家計簿 — 即時利用通知メールからの自動取り込み (Google Apps Script)
 * ============================================================
 *
 * Gmail に届く「ご利用のお知らせ」「利用速報」等のメールを定期的にチェックし、
 * AI（Gemini）にメール本文を解析させて、カード家計簿アプリの Firestore に
 * 直接、明細として書き込みます。アプリを開かなくても自動で明細が増えます。
 *
 * カード会社ごとの解析ロジックをコードで用意する必要はありません。件名によるキーワード
 * 絞り込みもしていないので、新しいカード会社が増えてもコードを直す必要は一切ありません
 * （直近7日・未処理のメールは全部AIに「購入確定通知かどうか」を判定させています）。
 *
 * セットアップ手順は README.md を参照してください。
 * このファイルの中で編集が必要な箇所は「▼設定」の見出しがついた部分だけです。
 */

// ============================================================
// ▼設定1: このスクリプトから見た「あなたのアプリのアカウント」
// アプリのヘッダー → 雲アイコン → アカウント・同期 モーダルに表示されている
// 「アカウントID」をそのまま貼り付けてください。
// ============================================================
const FIRESTORE_USER_ID = 'ここにアプリのアカウントIDを貼り付け';

// このアプリ専用の Firestore 名前空間（アプリ側と同じ値。通常は変更不要）
const FIRESTORE_APP_ID = 'card-tracker';
const FIRESTORE_PROJECT_ID = 'sai-4d708';

// 二重取り込み防止・処理済みの目印として付けるGmailラベル名（変更不要）
const PROCESSED_LABEL_NAME = 'カード家計簿-取込済み';

// AIモデル名。将来このモデルが使えなくなった場合は、Google AI Studio
// (https://aistudio.google.com/) で使えるモデル名に差し替えてください。
const GEMINI_MODEL = 'gemini-3.5-flash-lite';

// 件名によるキーワード絞り込みはしない。カード会社ごとに表現がバラバラ
// （「ご利用」「お支払い」「Mastercardで」「iD決済で」等）なので、キーワードで
// 絞ろうとすると必ずどこかで漏れる。「これが購入確定通知かどうか」の判定は
// 直近7日・未処理の全メールをAIにそのまま判定させることで解決する。
// 個人的なメールも含めて内容がAI（Gemini API）に送られる点は理解した上で
// 使うこと（同じGoogleアカウント内での処理だが、外部APIへの送信ではある）。

// ============================================================
// メイン処理（このプロジェクトの「トリガー」から checkCardEmails を呼ぶよう設定してください）
// ============================================================

// Apps Scriptの実行上限（6分）に強制終了される前に、余裕をもって自分で
// 切り上げるための時間予算。バックログが多い最初の数回は1回で処理しきれない
// こともあるが、未処理分はラベルが付かないので次回のトリガー実行時に
// 続きから処理される（強制終了で中途半端に切れるより、綺麗に切り上げる方が安全）。
const MAX_RUNTIME_MS = 4.5 * 60 * 1000;

// 同じ金額・日付の明細が既にあるとき、「同じ購入の別チャネル通知」（例: メルペイ
// 自身の通知とPayPal/EXIMBAYのような決済代行会社からの通知）と「たまたま同額・
// 同日になった別々の購入」を見分けるための時間窓。カード会社をまたぐ二重通知は
// 同じ決済イベントから同時に発生するのでメールの受信時刻がほぼ同時になる一方、
// 別々の買い物は数分以上ずれることが多い（実測: 同一購入の2通は0分差、別々の
// 購入は4分差だった）ので、その間を取って2分以内を「同一購入」とみなす。
const SAME_EVENT_WINDOW_MS = 2 * 60 * 1000;

function checkCardEmails() {
  const startedAt = new Date();
  let importedCount = 0;
  let lastError = null;
  let timeUp = false;

  try {
    const accessToken = getFirestoreAccessToken_();
    const geminiKey = getGeminiApiKey_();
    const label = getOrCreateLabel_(PROCESSED_LABEL_NAME);
    // AIに「これは既存のどのカードと同じ実体か」を判断させるための材料。
    // 例: メルペイは「メルカード」「iD決済」「バーチャルMastercard」など
    // メール表現がバラバラでも実体は同じアカウントなので、既存名を渡すことで
    // AI自身に同一判定させ、毎回違う名前で重複登録されるのを防ぐ。
    // { カード名: カードID } のマップで持つことで、アプリ側でカード名を後から
    // 変更されても（例:「メルカード」→「マイカード」）正しいIDに追従できる
    // （名前からIDを毎回作り直す方式だと、リネームで紐付けが外れてしまう）。
    const cardCache = getExistingCardsCache_(accessToken);
    const existingCardNames = Object.keys(cardCache);
    console.log(`登録済みカード: ${existingCardNames.join('、') || '(なし)'}`);

    const query = `-label:"${PROCESSED_LABEL_NAME}" newer_than:7d`;
    const threads = GmailApp.search(query, 0, 50);
    console.log(`検索クエリ: ${query}`);
    console.log(`検索結果: ${threads.length}件のスレッド`);

    threads.forEach((thread) => {
      if (timeUp) return;
      const messages = thread.getMessages();
      let threadHadFailure = false;

      messages.forEach((message) => {
        if (timeUp) return;
        if (Date.now() - startedAt.getTime() > MAX_RUNTIME_MS) {
          console.warn('実行時間予算に到達したため、ここで打ち切ります（続きは次回実行）');
          timeUp = true;
          threadHadFailure = true; // このスレッドは未完了として次回また対象にする
          return;
        }

        const subject = message.getSubject() || '';
        try {
          const body = message.getPlainBody();
          const result = analyzeEmailWithAi_(geminiKey, subject, body, existingCardNames, message.getDate());
          // 無料枠のレート制限（1分あたり◯リクエスト）に極力引っかからないよう、
          // 判定1回ごとに少し間隔を空ける。
          Utilities.sleep(3200);

          if (result.status === 'not_purchase') {
            console.log(`AI判定: 購入確定通知ではない → スキップ: "${subject}"`);
            return; // このメール自体は「処理済み」として扱ってよい（threadHadFailureにはしない）
          }
          if (result.status === 'error') {
            console.warn(`AI解析エラー: "${subject}" → ${result.error}`);
            threadHadFailure = true; // 次回また拾い直す
            return;
          }

          const { issuerName, merchant, amount, date } = result.data;

          const cardId = ensureCardExists_(accessToken, cardCache, issuerName);

          // 「コミックシーモア　サクヒン　ポイント」のような余計な文字を削り、知っている
          // 店名なら正式名称＋カテゴリに寄せる（src/App.jsxのOCR取込と同じ表記に揃うので、
          // ここを優先する）。知らない店名だけ、AI自身が返した店名・カテゴリを使う。
          const known = findKnownMerchant_(merchant);
          const finalName = known ? known.name : (merchant || issuerName);
          const finalCategory = known ? known.category : (result.data.category || guessCategory_(merchant));

          // 同じ支払いについて、メルペイ経由の通知とEXIMBAY/PayPalのような決済代行
          // 会社自体からの通知のように、別々のサービスから2通メールが来ることがある。
          // どちらも内容として正しいため通常のメッセージID単位の重複防止（同じメールを
          // 2回処理しない）では防げない。ただし「金額・日付が一致」というだけで弾くと、
          // 同じカードで同額の買い物をたまたま同じ日に2回した場合まで片方が消えてしまう。
          // 「カードまで一致」も判断材料としては弱く（同じ購入の2通も、たまたまの別購入
          // も、どちらも同じカードに解決されうる）、実際に受信時刻がほぼ同時（数分以内）
          // かどうかで見分ける。同じ決済イベントから同時に発生する別チャネル通知は受信が
          // ほぼ同時になるが、別々の買い物は数分以上ずれることが多いため。
          const duplicate = findDuplicateTransaction_(accessToken, amount, date);
          const messageTime = message.getDate().getTime();
          const existingTime = duplicate && duplicate.gmailReceivedAt ? new Date(duplicate.gmailReceivedAt).getTime() : null;
          // 受信時刻の記録が無い明細（手動入力・スクリーンショット取込・本機能追加前の
          // Gmail取込）は比較しようがないので、既に記録済みとみなして安全側に倒す
          // （重複作成はしない）。記録があれば、時間窓内かどうかで判定する。
          const isSameEvent = !!duplicate && (existingTime === null || Math.abs(messageTime - existingTime) <= SAME_EVENT_WINDOW_MS);

          if (isSameEvent) {
            // カードと店名・カテゴリは別々に決める。2通のメールは「先に処理された方が
            // 勝ち」で丸ごと上書きすると、片方にしか無い有用な情報（例: 決済代行会社の
            // 領収書にしか店名が書かれていない）が消えてしまうことがあるため。
            //
            // カード: 今回の会社名が、このスクリプト実行前から登録済みの実在カードで
            // あれば、決済代行会社名などで先に作られた曖昧なカードより優先する。
            // そうでなければ（今回も既存も実在カードでない場合は）既存の割り当てを保つ。
            const isKnownRealCard = existingCardNames.includes(issuerName);
            const finalCardId = isKnownRealCard ? cardId : duplicate.cardId;

            // 店名・カテゴリ: 知っている店名リスト（KNOWN_MERCHANTS_）に一致する、
            // より具体的な方を採用する。今回・既存のどちらも一致しない/両方一致するなら
            // 今回の内容を使う（判断材料が無ければ最新の解析結果を信じる）。
            const existingIsKnownMerchant = !!(duplicate.memo && findKnownMerchant_(duplicate.memo));
            const useExisting = existingIsKnownMerchant && !known;
            const patchMemo = useExisting ? duplicate.memo : finalName;
            const patchCategory = useExisting ? (duplicate.category || finalCategory) : finalCategory;
            // 受信時刻は、次に3通目が来たときの比較の基準がぶれないよう、より早い方を残す。
            const patchReceivedAt = existingTime !== null
              ? new Date(Math.min(existingTime, messageTime)).toISOString()
              : new Date(messageTime).toISOString();

            if (finalCardId === duplicate.cardId && patchMemo === duplicate.memo && patchCategory === duplicate.category) {
              console.log(`重複のためスキップ: ${date} ¥${amount} (${issuerName}/${merchant})`);
            } else {
              console.log(`重複を修正: ${date} ¥${amount} → カード付け替え/店名補完（${patchMemo}）`);
              firestoreRequest_(accessToken, 'patch', duplicate.url, {
                fields: toFirestoreFields_({
                  cardId: finalCardId,
                  amount,
                  date,
                  category: patchCategory,
                  memo: patchMemo,
                  gmailReceivedAt: patchReceivedAt,
                }),
              });
            }
            return;
          }

          // メールのメッセージIDから決まる固定IDにしておくことで、同じメールを
          // 何度処理しても重複した明細ができない（既存ドキュメントを上書きするだけ）。
          createTransaction_(accessToken, `t-gmail-${message.getId()}`, {
            cardId,
            amount,
            date,
            category: finalCategory,
            memo: finalName,
            gmailReceivedAt: new Date(messageTime).toISOString(),
          });
          importedCount += 1;
        } catch (err) {
          lastError = String(err);
          threadHadFailure = true;
          console.error(`処理エラー: "${subject}" → ${err}`);
        }
      });

      // スレッド内の全メールがAI判定含めて処理できた場合だけ「処理済み」にする。
      // エラーが混ざっていたら次回また対象にして再挑戦させる。
      if (!threadHadFailure) {
        thread.addLabel(label);
      }
    });

    updateStatus_(accessToken, {
      lastCheckedAt: startedAt.toISOString(),
      importedLastRun: importedCount,
      ok: !lastError,
      error: lastError,
    });
  } catch (err) {
    console.error('致命的エラー: ' + err);
    try {
      const accessToken = getFirestoreAccessToken_();
      updateStatus_(accessToken, {
        lastCheckedAt: startedAt.toISOString(),
        importedLastRun: importedCount,
        ok: false,
        error: String(err),
      });
    } catch (e2) {
      // ステータス書き込みすら失敗した場合はログのみ
      console.error('ステータス書き込みにも失敗: ' + e2);
    }
    throw err;
  }
}

// ============================================================
// AI（Gemini）によるメール解析
// ============================================================

function getGeminiApiKey_() {
  const key = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!key) throw new Error('Script Properties に GEMINI_API_KEY が設定されていません。README.md を参照してください。');
  return key;
}

/**
 * 無料枠のレート制限（例: 1分あたり20リクエスト）に達した(429)場合、
 * エラーメッセージ中の "retry in Xs" を読み取ってその分待ってから再試行する。
 * 件名で絞り込まず全メールをAI判定するようにしたため、1回の実行で
 * リクエストが増えやすく、429が普通に起こりうることを前提にしている。
 * 戻り値: { code, text }（ネットワーク自体の失敗は例外として呼び出し元に伝播する）
 */
function fetchGeminiWithRetry_(url, payload, attempt) {
  attempt = attempt || 1;
  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  const code = response.getResponseCode();
  const text = response.getContentText();

  // 1回あたりの待ちを短く抑える（長く待っても実行時間予算を圧迫するだけなので、
  // 待つのは最大1回・上限20秒まで。それでもダメならこのメールは今回諦めて
  // 次回のトリガー実行に回す）。
  if (code === 429 && attempt <= 1) {
    const m = text.match(/retry in ([\d.]+)s/i);
    const waitSec = Math.min(m ? Math.ceil(parseFloat(m[1])) : 15, 20);
    console.warn(`Gemini APIのレート制限(429)。${waitSec}秒待って再試行します（${attempt}回目）`);
    Utilities.sleep(waitSec * 1000);
    return fetchGeminiWithRetry_(url, payload, attempt + 1);
  }

  return { code, text };
}

/**
 * メール本文をAIに渡し、「購入確定の利用通知かどうか」と、そうであれば
 * カード会社名・店名・金額・利用日を抽出してもらう。
 * 戻り値: { status: 'ok', data: {...} } / { status: 'not_purchase' } / { status: 'error', error }
 */
function analyzeEmailWithAi_(apiKey, subject, body, existingCardNames, messageDate) {
  const truncatedBody = String(body || '').slice(0, 4000);
  const currentYear = (messageDate instanceof Date) ? messageDate.getFullYear() : new Date().getFullYear();

  const cardHint = (existingCardNames && existingCardNames.length)
    ? [
      '',
      `既に登録されているカード名: ${existingCardNames.join('、')}`,
      'このメールの決済が、上のどれかと実体として同じカード・決済アカウントであれば',
      '（例えば同じ○○ペイのアカウントから、メルカード決済・iD決済・バーチャルカード決済など',
      '複数の見た目で通知が来ている場合は全部同じ実体）、issuer_nameは必ずその登録済みの',
      '名前をそのまま（一字一句）使ってください。表記が違うだけで実体が同じなら新しい名前を',
      '作らないこと。どれとも異なる、本当に初めて見るカード会社・決済サービスの場合だけ',
      '新しい名前をissuer_nameにしてください。',
    ].join('\n')
    : '';

  const prompt = [
    'あなたはクレジットカードの利用通知メールを解析するアシスタントです。',
    '以下のメールが「カードで買い物・決済をした際に届く、利用確定の通知メール」かどうか判定してください。',
    '本人確認（ワンタイムパスワード等）、ポイント失効案内、キャンペーン、広告、請求書（月次まとめ）、',
    'ログイン通知などは「利用確定の通知」ではないので is_purchase_notification は false にしてください。',
    '',
    '利用確定の通知メールであれば、以下も抽出してください:',
    '- issuer_name: カード会社・決済サービス名（例: 「メルカード」「三井住友カード」「楽天カード」など。件名や本文、署名から判断）',
    '- merchant: 利用した店舗・サービス名。決済代行会社の識別子（「SQ*」「AMZ*」等）や余計な記号は除いて、一般的な店名にしてください（例:「ＳＱ＊スターバックスコーヒー」→「スターバックス」）',
    '- category: 利用内容から最も適したものを1つ選択（food/daily/entertainment/transport/communication/subscription/investment/travel/beauty/procurement/social/otherのいずれか。Netflix・Spotify等の定額サービスはsubscription、証券会社・積立・暗号資産などはinvestment）',
    '- amount: 利用金額（円。数字のみ、カンマなし）',
    `- date: 利用日（YYYY-MM-DD形式）。本文に年の記載が無ければ ${currentYear} 年として補完してください`,
    cardHint,
    '',
    `件名: ${subject}`,
    '本文:',
    truncatedBody,
  ].join('\n');

  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          is_purchase_notification: { type: 'BOOLEAN' },
          issuer_name: { type: 'STRING' },
          merchant: { type: 'STRING' },
          category: {
            type: 'STRING',
            enum: ['food', 'daily', 'entertainment', 'transport', 'communication', 'subscription', 'investment', 'travel', 'beauty', 'procurement', 'social', 'other'],
          },
          amount: { type: 'INTEGER' },
          date: { type: 'STRING' },
        },
        required: ['is_purchase_notification'],
      },
    },
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const { code, text: responseText } = fetchGeminiWithRetry_(url, payload);
  if (code >= 300) {
    return { status: 'error', error: `Gemini API エラー (${code}): ${responseText.slice(0, 500)}` };
  }

  let parsed;
  try {
    const data = JSON.parse(responseText);
    // responseSchema指定時は基本的に素のJSONが返るが、念のため```json ... ```で
    // 囲まれていた場合にも対応しておく。
    const rawText = data.candidates[0].content.parts[0].text;
    const cleanText = String(rawText).replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
    parsed = JSON.parse(cleanText);
  } catch (e) {
    return { status: 'error', error: `AI応答の解析に失敗: ${e}` };
  }

  if (!parsed.is_purchase_notification) {
    return { status: 'not_purchase' };
  }

  const amount = Number(parsed.amount);
  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(String(parsed.date || ''));
  if (!parsed.issuer_name || !parsed.merchant || !Number.isFinite(amount) || amount <= 0 || !dateOk) {
    return { status: 'error', error: `AIが購入通知と判定したが値が不完全: ${JSON.stringify(parsed)}` };
  }

  return {
    status: 'ok',
    data: {
      issuerName: String(parsed.issuer_name).trim(),
      merchant: String(parsed.merchant).trim(),
      category: parsed.category || null,
      amount,
      date: parsed.date,
    },
  };
}

// ============================================================
// 解析共通ヘルパー
// ============================================================

// 全角英数字・半角カナなどの表記ゆれを吸収してから比較するためのヘルパー
// （アプリ側 src/App.jsx の toComparableText と同じ考え方）。
function toComparableText_(str) {
  return String(str || '').normalize('NFKC').toLowerCase();
}

// 以前（カード会社ごとに手書きのルールがあった時代）は固定のcardIdで
// 作成・管理していたカードたち。既にこのIDで実データが入っているユーザーの
// カードと紐付け続けるための移行マップ。新しいカード会社はここに無くても、
// 下のslugifyCardId_が自動でIDを作るので追記不要。
const LEGACY_ISSUER_CARD_IDS = {
  'メルカード': 'card-mercard',
  '三井住友カード': 'card-smbc-nl',
  'PayPayカード': 'card-paypay',
};

/** カード会社名からFirestoreの安全なドキュメントIDを作る（同じ会社名なら常に同じID） */
function slugifyCardId_(issuerName) {
  if (LEGACY_ISSUER_CARD_IDS[issuerName]) return LEGACY_ISSUER_CARD_IDS[issuerName];
  const base = String(issuerName || 'card').trim();
  const cleaned = base.replace(/[\/\s]+/g, '-').replace(/[^\p{L}\p{N}\-]/gu, '');
  return 'card-gmail-' + (cleaned || 'unknown');
}

/**
 * 店名からざっくりカテゴリを推測（アプリ側のカテゴリIDに合わせる）。
 * キーワード表は src/App.jsx の CATEGORY_KEYWORDS と揃えてある。
 * 精度を上げたいキーワードが見つかったら、両方のファイルに追記すること。
 */
function guessCategory_(merchant) {
  if (!merchant) return 'other';
  const text = toComparableText_(merchant);
  const table = [
    ['food', ['スーパー', 'マルエツ', 'イオン', '成城石井', 'コンビニ', 'セブン', 'ローソン', 'ファミリーマート', 'ファミマ', 'マクドナルド', 'モスバーガー', 'スターバックス', 'ドトール', 'カフェ', 'コーヒー', 'レストラン', '食堂', '弁当', '居酒屋', 'サイゼリヤ', '吉野家', 'すき家', '松屋', 'ラーメン', '寿司', '焼肉']],
    ['daily', ['無印良品', 'ドンキ', 'ドン・キホーテ', 'ロフト', 'ダイソー', 'セリア', 'キャンドゥ', '100円ショップ', 'ドラッグストア', 'マツモトキヨシ', 'マツキヨ', 'ウエルシア', 'ツルハ', 'サンドラッグ', 'ニトリ', '東急ハンズ', 'ホームセンター', 'カインズ', 'コーナン']],
    ['procurement', ['アリエクスプレス', 'aliexpress', 'ali express', 'タオバオ', 'taobao', '1688', 'pinduoduo', '拼多多', 'temu', 'shein', '速卖通']],
    ['beauty', ['美容院', 'ヘアサロン', '理容', 'ネイル', 'エステ', 'まつげ', 'コスメ', '化粧品', '資生堂', 'shiseido', 'アットコスメ', '脱毛']],
    ['social', ['ギフト', '贈り物', '贈答', 'ご祝儀', 'お祝い', 'プレゼント', '冠婚葬祭', '香典']],
    ['entertainment', ['映画', '遊園地', 'ゲーム', 'カラオケ', 'ライブ', 'ジム', 'シネマ', 'ディズニー', 'usj', 'switch', 'playstation', 'steam', 'コミック', '漫画', 'シーモア', '電子書籍', 'kindle', 'ebookjapan', 'dmm', 'fanza', 'ニコニコ']],
    ['travel', ['jtb', 'his', 'エイチ・アイ・エス', '楽天トラベル', 'じゃらん', 'booking', 'expedia', 'airbnb', 'エアビーアンドビー', 'ホテル', '旅館', '民宿']],
    ['communication', ['povo', 'ドコモ', 'au', 'ソフトバンク', 'モバイル', 'ワイモバイル', 'uq', 'nhk', 'wi-fi', 'ネット', '楽天モバイル']],
    ['subscription', ['サブスク', '月額', 'netflix', 'spotify', 'プライム', 'amazon prime', 'hulu', 'u-next', 'ユーネクスト', 'abema', 'disney', 'ディズニープラス', 'apple music', 'apple one', 'icloud', 'adobe', 'youtube premium', 'ユーチューブプレミアム']],
    ['investment', ['sbi証券', '楽天証券', '松井証券', 'マネックス証券', 'auカブコム', 'カブコム証券', 'nisa', 'ideco', '積立', '投信', '投資信託', '株式', 'fx', '暗号資産', 'ビットコイン', 'bitcoin', 'coincheck', 'コインチェック', 'bitflyer', 'ビットフライヤー', 'gmoコイン']],
    ['transport', ['suica', 'pasmo', 'etc', '新幹線', 'jr', '電車', 'バス', 'タクシー', 'ガソリン', 'eneos', '駐車場', 'メトロ', 'タイムズ', 'ana', 'jal', '航空', 'チャージ', '駅']],
  ];
  for (const [category, keywords] of table) {
    if (keywords.some((kw) => text.includes(toComparableText_(kw)))) return category;
  }
  return 'other';
}

// よく見かける店名・サービス名。メール本文には「コミックシーモア　サクヒン　ポイント」の
// ように余計な文字が付くことがあるので、知っている店名なら正式名称＋カテゴリに寄せる。
// src/App.jsx の KNOWN_MERCHANTS と揃えてあるので、追加・変更したら両方に反映すること。
const KNOWN_MERCHANTS_ = [
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
 * メールから読み取った店名が、既知の店名リストに近ければ { name, category } を
 * 返す（src/App.jsx の cleanMerchantName と同じ考え方）。一致しなければ null。
 * 一致しない場合はAI自身が返した店名・カテゴリをそのまま使う（呼び出し元を参照）。
 */
function findKnownMerchant_(rawMerchant) {
  const base = String(rawMerchant || '').replace(/[_＿]/g, ' ').replace(/\s+/g, ' ').trim();
  const compact = toComparableText_(base).replace(/\s+/g, '');

  for (const merchant of KNOWN_MERCHANTS_) {
    if (compact.includes(toComparableText_(merchant.match).replace(/\s+/g, ''))) {
      return { name: merchant.name, category: merchant.category };
    }
  }
  return null;
}

// ============================================================
// Gmail ラベル
// ============================================================
function getOrCreateLabel_(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}

// ============================================================
// Firestore REST API 連携
// サービスアカウント（Script Properties に設定）で認証し、
// Firestore のセキュリティルールを介さず直接読み書きします。
// ============================================================

function getFirestoreAccessToken_() {
  const props = PropertiesService.getScriptProperties();
  const keyJson = props.getProperty('SERVICE_ACCOUNT_KEY');
  if (!keyJson) throw new Error('Script Properties に SERVICE_ACCOUNT_KEY が設定されていません。README.md を参照してください。');

  const key = JSON.parse(keyJson);
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claimSet = {
    iss: key.client_email,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };

  const encode = (obj) => Utilities.base64EncodeWebSafe(JSON.stringify(obj)).replace(/=+$/, '');
  const unsigned = `${encode(header)}.${encode(claimSet)}`;
  const signatureBytes = Utilities.computeRsaSha256Signature(unsigned, key.private_key);
  const signature = Utilities.base64EncodeWebSafe(signatureBytes).replace(/=+$/, '');
  const jwt = `${unsigned}.${signature}`;

  const response = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'post',
    payload: {
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    },
    muteHttpExceptions: true,
  });

  const data = JSON.parse(response.getContentText());
  if (!data.access_token) throw new Error('アクセストークン取得に失敗: ' + response.getContentText());
  return data.access_token;
}

function firestoreDocPath_(...segments) {
  return `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT_ID}/databases/(default)/documents/${segments.join('/')}`;
}

function firestoreRequest_(accessToken, method, url, body) {
  const options = {
    method,
    headers: { Authorization: 'Bearer ' + accessToken },
    contentType: 'application/json',
    muteHttpExceptions: true,
  };
  if (body) options.payload = JSON.stringify(body);
  const response = UrlFetchApp.fetch(url, options);
  const code = response.getResponseCode();
  if (code >= 300) {
    throw new Error(`Firestore API エラー (${code}): ${response.getContentText()}`);
  }
  return JSON.parse(response.getContentText() || '{}');
}

/** JSのプレーンオブジェクトを Firestore REST の型付き fields 形式に変換 */
function toFirestoreFields_(obj) {
  const fields = {};
  Object.keys(obj).forEach((key) => {
    const value = obj[key];
    if (typeof value === 'number') {
      fields[key] = Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
    } else if (typeof value === 'boolean') {
      fields[key] = { booleanValue: value };
    } else if (value === null || value === undefined) {
      fields[key] = { nullValue: null };
    } else {
      fields[key] = { stringValue: String(value) };
    }
  });
  return fields;
}

/**
 * 明細を書き込む。id を固定にして PATCH（作成 or 上書き）することで、
 * 同じメールを誤って2回処理しても重複した明細ができないようにしている。
 */
function createTransaction_(accessToken, id, tx) {
  const url = firestoreDocPath_('artifacts', FIRESTORE_APP_ID, 'users', FIRESTORE_USER_ID, 'transactions', id);
  firestoreRequest_(accessToken, 'patch', url, { fields: toFirestoreFields_(tx) });
}

/**
 * 金額・日付が完全に一致する明細が既にあるか調べる。
 * 同じ支払いについて、メルペイ経由の通知とEXIMBAY/PayPalのような決済代行会社
 * 自体からの通知のように、別々のサービスから正しい内容の通知メールが2通届く
 * ことがあり、その場合はメッセージID単位の重複防止（同じメールを2回処理しない）
 * だけでは防げない。
 * 戻り値: 見つからなければ null。見つかれば { url, cardId, memo, category, gmailReceivedAt }
 * （urlはそのままPATCHで上書きできるドキュメントの完全なパス）。
 * 「同じ購入の別チャネル通知」か「同額・同日のたまたま別の購入」かは、
 * gmailReceivedAt（Gmail取込が書き込むメール受信時刻）を使って呼び出し元で判断する。
 */
function findDuplicateTransaction_(accessToken, amount, date) {
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT_ID}/databases/(default)/documents/artifacts/${FIRESTORE_APP_ID}/users/${FIRESTORE_USER_ID}:runQuery`;
    const body = {
      structuredQuery: {
        from: [{ collectionId: 'transactions' }],
        where: {
          compositeFilter: {
            op: 'AND',
            filters: [
              { fieldFilter: { field: { fieldPath: 'date' }, op: 'EQUAL', value: { stringValue: date } } },
              { fieldFilter: { field: { fieldPath: 'amount' }, op: 'EQUAL', value: { integerValue: String(amount) } } },
            ],
          },
        },
        limit: 1,
      },
    };
    const options = {
      method: 'post',
      headers: { Authorization: 'Bearer ' + accessToken },
      contentType: 'application/json',
      payload: JSON.stringify(body),
      muteHttpExceptions: true,
    };
    const response = UrlFetchApp.fetch(url, options);
    if (response.getResponseCode() >= 300) return null;
    const results = JSON.parse(response.getContentText() || '[]');
    const hit = results.find((r) => r.document);
    if (!hit) return null;
    const fields = hit.document.fields || {};
    return {
      // hit.document.name は "projects/.../documents/..." というリソースパスのみで、
      // スキーム＋ホストが付いていないので、そのままだと不正なURLになる。
      url: `https://firestore.googleapis.com/v1/${hit.document.name}`,
      cardId: (fields.cardId && fields.cardId.stringValue) || null,
      memo: (fields.memo && fields.memo.stringValue) || null,
      category: (fields.category && fields.category.stringValue) || null,
      gmailReceivedAt: (fields.gmailReceivedAt && fields.gmailReceivedAt.stringValue) || null,
    };
  } catch (e) {
    console.warn('重複チェックに失敗しました（チェックなしで続行します）: ' + e);
    return null;
  }
}

/**
 * 登録済みカードの { カード名: カードID } マップを取得する
 * （取得に失敗しても空オブジェクトにして続行）。
 * 名前からIDを毎回作り直す方式だと、アプリ側でカード名を後から変更された
 * 場合に紐付けが外れてしまうため、実際のドキュメントIDをそのまま使う。
 */
function getExistingCardsCache_(accessToken) {
  try {
    const url = firestoreDocPath_('artifacts', FIRESTORE_APP_ID, 'users', FIRESTORE_USER_ID, 'cards');
    const options = { method: 'get', headers: { Authorization: 'Bearer ' + accessToken }, muteHttpExceptions: true };
    const response = UrlFetchApp.fetch(url, options);
    if (response.getResponseCode() >= 300) return {};
    const data = JSON.parse(response.getContentText() || '{}');
    const docs = data.documents || [];
    const cache = {};
    docs.forEach((d) => {
      const name = d.fields && d.fields.name && d.fields.name.stringValue;
      if (name) cache[name] = d.name.split('/').pop(); // dのnameはフルパスなので末尾がドキュメントID
    });
    return cache;
  } catch (e) {
    console.warn('カード一覧の取得に失敗しました（ヒント無しで続行します）: ' + e);
    return {};
  }
}

// 自動作成するカードのテーマ色（アプリ側のCARD_THEMESと同じキー）。
// カード会社名ごとに固定の色になるよう、名前から決定的に選ぶ。
const CARD_THEME_PALETTE = ['purple', 'dark', 'emerald', 'blue', 'sunset'];
function themeForIssuer_(issuerName) {
  let hash = 0;
  const s = String(issuerName || '');
  for (let i = 0; i < s.length; i += 1) {
    hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  }
  return CARD_THEME_PALETTE[hash % CARD_THEME_PALETTE.length];
}

/**
 * cardCache（{ カード名: カードID }）に issuerName が無ければ新規作成し、
 * カードIDを返す。1回の実行内で同じ新規カード名が複数回出てきても、
 * 2回目以降はキャッシュを見るだけでFirestoreへの問い合わせをしない。
 */
function ensureCardExists_(accessToken, cardCache, issuerName) {
  if (cardCache[issuerName]) return cardCache[issuerName];

  const cardId = slugifyCardId_(issuerName);
  const url = firestoreDocPath_('artifacts', FIRESTORE_APP_ID, 'users', FIRESTORE_USER_ID, 'cards', cardId);

  // キャッシュに無くても、実際にはもう存在することがある（例:
  // getExistingCardsCache_ が何らかの理由で取得に失敗し空になっていた場合）。
  // 既存カード（保有者名・限度額など実データ入り）を空の初期値で
  // 上書きしてしまわないよう、作成前に必ず存在確認する。
  const existing = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: { Authorization: 'Bearer ' + accessToken },
    muteHttpExceptions: true,
  });
  if (existing.getResponseCode() === 200) {
    cardCache[issuerName] = cardId;
    return cardId;
  }

  const card = {
    name: issuerName,
    brand: 'VISA',
    last4: '----',
    number: '',
    holderName: '',
    expiry: '',
    cvv: '',
    theme: themeForIssuer_(issuerName),
    limit: 0,
    billingDay: '末日',
    paymentDay: '27',
    weekendAdjustment: 'none',
    bankAccount: '',
  };
  firestoreRequest_(accessToken, 'patch', url, { fields: toFirestoreFields_(card) });
  cardCache[issuerName] = cardId;
  return cardId;
}

function updateStatus_(accessToken, status) {
  const url = firestoreDocPath_('artifacts', FIRESTORE_APP_ID, 'users', FIRESTORE_USER_ID, 'settings', 'gmailImportStatus');
  firestoreRequest_(accessToken, 'patch', url, { fields: toFirestoreFields_(status) });
}

// ============================================================
// 調査用: checkCardEmails が対象にするメール（未処理ラベル・直近7日）の
// 件名一覧をログに出す。件名だけで絞り込みはしていないので、ここに出てくる
// メールが次回 checkCardEmails 実行時にすべてAI判定の対象になる。
// 実行する時は、上のプルダウンで checkCardEmails ではなく debugSearch を選ぶこと。
// ============================================================
function debugSearch() {
  const query = `-label:"${PROCESSED_LABEL_NAME}" newer_than:7d`;
  const threads = GmailApp.search(query, 0, 50);
  console.log(`検索クエリ: ${query}`);
  console.log(`対象スレッド数: ${threads.length}件`);
  threads.forEach((thread) => {
    thread.getMessages().forEach((message) => {
      const subject = message.getSubject() || '';
      console.log(`対象: "${subject}"`);
    });
  });
}
