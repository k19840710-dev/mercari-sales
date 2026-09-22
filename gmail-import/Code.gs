/**
 * カード家計簿 — 即時利用通知メールからの自動取り込み (Google Apps Script)
 * ============================================================
 *
 * Gmail に届く「ご利用のお知らせ」「利用速報」等のメールを定期的にチェックし、
 * カード家計簿アプリの Firestore に直接、明細として書き込みます。
 * アプリを開かなくても自動で明細が増えます。
 *
 * カード会社ごとの解析ロジックをコードで用意する必要はありません。件名によるキーワード
 * 絞り込みもしていないので、新しいカード会社が増えてもコードを直す必要は一切ありません
 * （直近7日・未処理のメールは全部AIに判定させています）。
 *
 * 【設計方針】
 * AI（Gemini）の役割は「メールからの情報抽出」だけに限定し、実際に家計簿へ
 * 自動登録してよいかどうかの最終判断は、このコード側（evaluateForImport_）が
 * 複数のルールをすべて満たした場合のみ行います。
 *   1. 利用確定の通知だと十分な根拠がある（AIの確信度が high、かつ金額・日付・
 *      利用先・カード番号下4桁のうち複数が確認でき、「ご利用」等の通知特有の
 *      文言が本文にある）
 *   2. すでにアプリに登録されているカード（カード番号下4桁、またはカード名が
 *      完全一致）だと判定できる ―― 一致しない場合、新しいカードを勝手に
 *      作成することは絶対にしません
 *   3. 同一の明細がまだ登録されていない（重複ではない）
 * これらを1つでも満たせない場合は、「多少取りこぼす」方を選び、自動登録は
 * せず「確認待ち（pendingImports）」としてFirestoreに保存します。ユーザーは
 * アプリ側の確認待ち画面から、既存カードに紐付ける／新しいカードとして追加する／
 * 無視する、のいずれかを選べます。
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

// アプリ側の支払い方法マスタ（paymentMethodsコレクション）で「クレジットカード」を
// 表す固定id（src/App.jsxのPAYMENT_METHOD_CREDIT_CARD_IDと同じ値。変更不要）。
// Gmail取込は常にクレジットカードの明細を扱うため、書き込む明細には常にこれを付ける。
const PAYMENT_METHOD_CREDIT_CARD_ID = 'pm-credit-card';

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
  let pendingCount = 0;
  let lastError = null;
  let timeUp = false;

  try {
    const accessToken = getFirestoreAccessToken_();
    const geminiKey = getGeminiApiKey_();
    const label = getOrCreateLabel_(PROCESSED_LABEL_NAME);
    // 登録済みカード一覧（id・名前・カード番号下4桁）。新しいカードはここには
    // 絶対に追加しない ―― AIの抽出結果がこの一覧のどれかと一致した場合だけ、
    // その明細として自動登録する（一致しなければ確認待ちへ）。
    const existingCards = getExistingCards_(accessToken);
    console.log(`登録済みカード: ${existingCards.map((c) => `${c.name}(下4桁:${c.last4 || '不明'})`).join('、') || '(なし)'}`);

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
          // AIの役割は抽出だけ。登録してよいかどうかは evaluateForImport_ が判断する。
          const extracted = extractEmailInfo_(geminiKey, subject, body, existingCards, message.getDate());
          // 無料枠のレート制限（1分あたり◯リクエスト）に極力引っかからないよう、
          // 判定1回ごとに少し間隔を空ける。
          Utilities.sleep(3200);

          if (extracted.status === 'not_purchase') {
            console.log(`AI判定: 利用確定通知ではない → スキップ: "${subject}"`);
            return; // このメール自体は「処理済み」として扱ってよい（threadHadFailureにはしない）
          }
          if (extracted.status === 'error') {
            console.warn(`AI解析エラー: "${subject}" → ${extracted.error}`);
            threadHadFailure = true; // 次回また拾い直す
            return;
          }

          const decision = evaluateForImport_(extracted.data, subject, body, existingCards);
          const messageDate = message.getDate();

          if (decision.action === 'pending') {
            // 自動登録の条件を満たさなかった（確信度不足／必須項目不足／登録済み
            // カードと一致しない、のいずれか）。削除はせず確認待ちに保存し、
            // アプリ側でユーザーに判断してもらう。
            upsertPendingImport_(accessToken, `p-gmail-${message.getId()}`, {
              subject,
              from: message.getFrom() || '',
              receivedAt: messageDate.toISOString(),
              amount: signedAmount_(extracted.data.amount, extracted.data.isRefund),
              date: extracted.data.date,
              merchant: extracted.data.merchant,
              issuerNameGuess: extracted.data.issuerName,
              last4Guess: extracted.data.last4,
              category: extracted.data.category,
              reason: decision.reason,
              status: 'pending',
              createdAt: new Date().toISOString(),
            });
            console.log(`確認待ちに追加: "${subject}" → ${decision.reason}`);
            pendingCount += 1;
            return;
          }

          // ここに来るのは decision.action === 'register'（自動登録OK）の場合のみ。
          // decision.card は、AIの抽出結果（カード番号下4桁 or カード名の完全一致）が
          // 実際に登録済みのカードと一致した結果であり、新規作成されたものではない。
          const { issuerName, merchant, amount, date, isRefund } = extracted.data;
          const cardId = decision.card.id;
          // 返品・返金の通知は、家計簿上は支出のマイナス（入金）として扱う。
          // 見た目のUIや合計計算はamountの符号だけで判定するので、ここで符号を
          // 決めてしまえば以降のコードは通常の購入と同じロジックで良い。
          const signedAmount = signedAmount_(amount, isRefund);

          // 「コミックシーモア　サクヒン　ポイント」のような余計な文字を削り、知っている
          // 店名なら正式名称＋カテゴリに寄せる（src/App.jsxのOCR取込と同じ表記に揃うので、
          // ここを優先する）。知らない店名だけ、AI自身が返した店名・カテゴリを使う。
          const known = findKnownMerchant_(merchant);
          const finalName = known ? known.name : (merchant || issuerName || decision.card.name);
          const finalCategory = known ? known.category : (extracted.data.category || guessCategory_(merchant));

          // 同じ支払いについて、メルペイ経由の通知とEXIMBAY/PayPalのような決済代行
          // 会社自体からの通知のように、別々のサービスから2通メールが来ることがある。
          // どちらも内容として正しいため通常のメッセージID単位の重複防止（同じメールを
          // 2回処理しない）では防げない。ただし「金額・日付が一致」というだけで弾くと、
          // 同じカードで同額の買い物をたまたま同じ日に2回した場合まで片方が消えてしまう
          // ので、実際に受信時刻がほぼ同時（数分以内）かどうかで見分ける。同じ決済
          // イベントから同時に発生する別チャネル通知は受信がほぼ同時になるが、別々の
          // 買い物は数分以上ずれることが多いため。符号付き金額で照合するので、通常の
          // 購入とその後の返品（符号が逆）を誤って同一視することもない。
          const duplicate = findDuplicateTransaction_(accessToken, signedAmount, date);
          const messageTime = messageDate.getTime();
          const existingTime = duplicate && duplicate.gmailReceivedAt ? new Date(duplicate.gmailReceivedAt).getTime() : null;
          // 受信時刻の記録が無い明細（手動入力・アプリ内OCR取込・確認待ちからの
          // 手動登録・本機能追加前のGmail取込）は比較しようがないので、既に
          // 記録済みとみなして安全側に倒す（重複作成はしない）。
          const isSameEvent = !!duplicate && (existingTime === null || Math.abs(messageTime - existingTime) <= SAME_EVENT_WINDOW_MS);

          if (isSameEvent) {
            // 店名・カテゴリは、知っている店名リスト（KNOWN_MERCHANTS_）に一致する、
            // より具体的な方を採用する（例: 決済代行会社の領収書にしか店名が書かれて
            // いないことがあるため、先に処理された方を丸ごと勝ちにはしない）。
            const existingIsKnownMerchant = !!(duplicate.merchant && findKnownMerchant_(duplicate.merchant));
            const useExisting = existingIsKnownMerchant && !known;
            const patchMerchant = useExisting ? duplicate.merchant : finalName;
            const patchCategory = useExisting ? (duplicate.category || finalCategory) : finalCategory;
            const patchReceivedAt = existingTime !== null
              ? new Date(Math.min(existingTime, messageTime)).toISOString()
              : new Date(messageTime).toISOString();

            // カードは、今回・既存どちらも「登録済みカードと一致」した結果なので、
            // 一致しない場合に無理に付け替えると誤りのリスクがある。カードは既存の
            // ままにし、店名・カテゴリの補完だけ行う。
            if (duplicate.cardId && duplicate.cardId !== cardId) {
              console.warn(`重複通知だがカードの判定が一致しません（既存: ${duplicate.cardId} / 今回: ${cardId}）。カードはそのままに、店名・カテゴリのみ補完します。`);
            }

            if (patchMerchant === duplicate.merchant && patchCategory === duplicate.category) {
              console.log(`重複のためスキップ: ${date} ¥${signedAmount} (${issuerName}/${merchant})`);
            } else {
              console.log(`重複を補完: ${date} ¥${signedAmount} → 店名「${patchMerchant}」`);
              firestoreRequest_(accessToken, 'patch', duplicate.url, {
                fields: toFirestoreFields_({
                  cardId: duplicate.cardId || cardId,
                  amount: signedAmount,
                  date,
                  category: patchCategory,
                  merchant: patchMerchant,
                  memo: '',
                  gmailReceivedAt: patchReceivedAt,
                  paymentMethodId: PAYMENT_METHOD_CREDIT_CARD_ID,
                  source: 'email',
                }),
              });
            }
            return;
          }

          // メールのメッセージIDから決まる固定IDにしておくことで、同じメールを
          // 何度処理しても重複した明細ができない（既存ドキュメントを上書きするだけ）。
          createTransaction_(accessToken, `t-gmail-${message.getId()}`, {
            cardId,
            amount: signedAmount,
            date,
            category: finalCategory,
            merchant: finalName,
            memo: '',
            gmailReceivedAt: new Date(messageTime).toISOString(),
            paymentMethodId: PAYMENT_METHOD_CREDIT_CARD_ID,
            source: 'email',
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
      pendingLastRun: pendingCount,
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
        pendingLastRun: pendingCount,
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
 * メール本文をAIに渡し、「利用確定の通知メールかどうか」と、そうであれば
 * 関連情報（カード会社名・カード番号下4桁・店名・金額・利用日・確信度）を
 * 抽出してもらう。ここでは抽出だけを行い、実際に家計簿へ登録してよいかどうかの
 * 判断は一切しない（evaluateForImport_ に分離している）。
 * 戻り値: { status: 'ok', data: {...} } / { status: 'not_purchase' } / { status: 'error', error }
 */
function extractEmailInfo_(apiKey, subject, body, existingCards, messageDate) {
  const truncatedBody = String(body || '').slice(0, 4000);
  const currentYear = (messageDate instanceof Date) ? messageDate.getFullYear() : new Date().getFullYear();

  const cardHint = (existingCards && existingCards.length)
    ? [
      '',
      '参考: すでに登録されているカード（このメールがどれと一致するかはシステム側で',
      '別途判定するので、ここでは参考情報として使ってください）:',
      existingCards.map((c) => `- ${c.name}${c.last4 ? `（下4桁: ${c.last4}）` : ''}`).join('\n'),
      'このメールの決済が、上のどれかと実体として同じカード・決済アカウントであれば',
      '（例えば同じ○○ペイのアカウントから、メルカード決済・iD決済・バーチャルカード決済など',
      '複数の見た目で通知が来ている場合は全部同じ実体）、issuer_nameは必ずその登録済みの',
      '名前をそのまま（一字一句）使ってください。どれとも異なる場合は、メールに書かれている',
      'カード会社・決済サービス名をそのまま抽出してください（新しいカードを作る必要はありません）。',
    ].join('\n')
    : '';

  const prompt = [
    'あなたはメールを解析するアシスタントです。抽出だけを行い、実際に家計簿へ',
    '登録するかどうかの判断はこの後システム側で行うので、あなたは判断しません。',
    '少しでも自信が持てない場合は、無理に決めつけず confidence を low にしてください。',
    '',
    '以下のメールが「カードで買い物・決済をした際に届く、利用確定の通知メール」かどうか判定してください。',
    '次のようなメールは is_purchase_notification を false にしてください:',
    '本人確認（ワンタイムパスワード等）、ポイント付与・失効案内、キャンペーン・広告、',
    '請求額確定・引き落とし案内（月次まとめ）、カード更新案内、メンテナンス案内、ログイン通知、',
    'その他「今この場でカードを使って買い物をした」ことの通知ではないメール。',
    '',
    '注意: カード会社によっては「返品」「返金」による入金も、通常の利用通知と全く同じ',
    '件名・テンプレート（例:「ご利用のお知らせ」）で届きます。店舗名の欄に「（返品）」等の',
    '記載がある、または金額の前に返金・返品・キャンセル・取消であることを示す記載がある',
    '場合は、is_purchase_notification は true のまま、is_refund を true にしてください',
    '（このメール自体をスキップしないこと。amountには符号なしの金額をそのまま入れてください）。',
    '',
    '利用確定の通知メールだと判断した場合は、以下も抽出してください（わからない項目はnull）:',
    '- confidence: 判定・抽出内容にどれだけ自信があるか（high/medium/lowのいずれか）',
    '- issuer_name: カード会社・決済サービス名（例: 「メルカード」「三井住友カード」「楽天カード」など。件名や本文、署名から判断）',
    '- last4: カード番号の下4桁（半角数字4桁。本文に記載が無ければnull。「＊＊＊＊1234」等の末尾4桁も対象）',
    '- merchant: 利用した店舗・サービス名。決済代行会社の識別子（「SQ*」「AMZ*」等）や余計な記号、',
    '  「（返品）」等の返金を示す注記は除いて、一般的な店名にしてください',
    '  （例:「ＳＱ＊スターバックスコーヒー」→「スターバックス」、「PAYPAL *ALIPAY EUR（返品）」→「PAYPAL *ALIPAY EUR」）',
    '- category: 利用内容から最も適したものを1つ選択（food/daily/entertainment/transport/communication/subscription/investment/travel/beauty/procurement/social/otherのいずれか。Netflix・Spotify等の定額サービスはsubscription、証券会社・積立・暗号資産などはinvestment）',
    '- amount: 利用金額（円。数字のみ、カンマなし、符号なし）',
    `- date: 利用日（YYYY-MM-DD形式）。本文に年の記載が無ければ ${currentYear} 年として補完してください`,
    '- is_refund: 返品・返金・キャンセル・取消による入金なら true、通常の購入なら false',
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
          confidence: { type: 'STRING', enum: ['high', 'medium', 'low'] },
          issuer_name: { type: 'STRING' },
          last4: { type: 'STRING' },
          merchant: { type: 'STRING' },
          category: {
            type: 'STRING',
            enum: ['food', 'daily', 'entertainment', 'transport', 'communication', 'subscription', 'investment', 'travel', 'beauty', 'procurement', 'social', 'other'],
          },
          amount: { type: 'INTEGER' },
          date: { type: 'STRING' },
          is_refund: { type: 'BOOLEAN' },
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

  // ここでは緩く受け取るだけで、登録可否の厳密な判定はしない
  // （必須項目が欠けていても、そのまま確認待ちに回るだけで済むようにするため）。
  const amount = Number(parsed.amount);
  const last4 = String(parsed.last4 || '').trim();

  return {
    status: 'ok',
    data: {
      isPurchaseNotification: true,
      confidence: ['high', 'medium', 'low'].includes(parsed.confidence) ? parsed.confidence : 'low',
      issuerName: parsed.issuer_name ? String(parsed.issuer_name).trim() : null,
      last4: /^\d{4}$/.test(last4) ? last4 : null,
      merchant: parsed.merchant ? String(parsed.merchant).trim() : null,
      category: parsed.category || null,
      amount: Number.isFinite(amount) && amount > 0 ? amount : null,
      date: /^\d{4}-\d{2}-\d{2}$/.test(String(parsed.date || '')) ? parsed.date : null,
      isRefund: !!parsed.is_refund,
    },
  };
}

// メール本文に「利用確定の通知」特有の言い回しが含まれているかを、AIに頼らず
// コード側で機械的にチェックする。AIの is_purchase_notification 判定への
// 二重チェックとして使う（「複数の情報が確認できた場合のみ自動登録する」の一部）。
const USAGE_PHRASE_PATTERN = /(ご利用がありました|ご利用のお知らせ|利用速報|ご利用いただき|ご利用金額|カードのご利用|(の|で)(お)?支払いが?ありました|決済されました|決済が完了|お支払い(の)?確認|ショッピング利用)/;

/**
 * AIの抽出結果・本文の文言・登録済みカード一覧から、「自動登録してよいか／
 * 確認待ちに回すか」を判定する（is_purchase_notification=falseの完全な
 * スキップは、この関数を呼ぶ前に checkCardEmails 側で処理済み）。
 * 登録するかどうかの最終判断はAIではなく、必ずこの関数（＝コード側）が行う。
 *
 * 登録してよいのは、次を "すべて" 満たした場合のみ:
 *  - AIの確信度が high
 *  - 金額・日付・利用先・カード番号下4桁のうち複数（3つ以上）が確認できる
 *  - 本文に「ご利用」等の利用通知特有の文言がある
 *  - カード番号下4桁、またはカード名が、登録済みのカードと完全に一致する
 *    （一致しなければ絶対に新しいカードを作らない）
 * 1つでも満たさなければ pending（確認待ち）。
 */
function evaluateForImport_(extracted, subject, body, existingCards) {
  const { confidence, issuerName, last4, merchant, amount, date } = extracted;

  const hasUsagePhrase = USAGE_PHRASE_PATTERN.test(`${subject}\n${body}`);
  const signalsPresent = [amount, date, merchant, last4].filter((v) => v !== null && v !== undefined && v !== '').length;
  const requiredFieldsOk = !!amount && !!date && signalsPresent >= 3 && hasUsagePhrase;
  const confidenceOk = confidence === 'high';

  // last4が'0000'などのプレースホルダーのカード（アプリ側でカード番号未入力のまま
  // 登録した場合の初期値）は、誤って一致してしまわないよう突合の対象から除く。
  const matchableCards = existingCards.filter((c) => c.last4 && c.last4 !== '0000');
  let matchedCard = null;
  if (last4) {
    matchedCard = matchableCards.find((c) => c.last4 === last4) || null;
  }
  if (!matchedCard && issuerName) {
    const normalizedIssuer = toComparableText_(issuerName);
    matchedCard = existingCards.find((c) => toComparableText_(c.name) === normalizedIssuer) || null;
  }

  const reasons = [];
  if (!requiredFieldsOk) reasons.push('金額・日付・利用先・カード番号などの情報が十分に確認できませんでした');
  if (!confidenceOk) reasons.push('AIの確信度が十分ではありません');
  if (!matchedCard) {
    reasons.push(last4 ? `末尾4桁「${last4}」に一致する登録済みカードが見つかりません` : '登録済みカードのどれと一致するか判断できません');
  }

  if (reasons.length === 0) {
    return { action: 'register', card: matchedCard };
  }
  return { action: 'pending', reason: reasons.join('。') };
}

// ============================================================
// 解析共通ヘルパー
// ============================================================

// 全角英数字・半角カナなどの表記ゆれを吸収してから比較するためのヘルパー
// （アプリ側 src/App.jsx の toComparableText と同じ考え方）。
function toComparableText_(str) {
  return String(str || '').normalize('NFKC').toLowerCase();
}

// 返品・返金の通知はamountをマイナスにして保存する（アプリ側は符号だけで
// 支出／返金を区別しており、専用のフィールドは持たない。src/App.jsxの
// formatSignedYenと同じ考え方）。amountがnullの場合はnullのまま返す。
function signedAmount_(amount, isRefund) {
  if (amount === null || amount === undefined) return amount;
  return isRefund ? -Math.abs(amount) : amount;
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
      // merchant（店舗名）が本来の項目。merchant追加前に書き込まれた明細は
      // 店舗名がmemoに入っているので、無ければそちらにフォールバックする。
      merchant: (fields.merchant && fields.merchant.stringValue) || (fields.memo && fields.memo.stringValue) || null,
      category: (fields.category && fields.category.stringValue) || null,
      gmailReceivedAt: (fields.gmailReceivedAt && fields.gmailReceivedAt.stringValue) || null,
    };
  } catch (e) {
    console.warn('重複チェックに失敗しました（チェックなしで続行します）: ' + e);
    return null;
  }
}

/**
 * 登録済みカード一覧を { id, name, last4 } の配列で取得する
 * （取得に失敗しても空配列にして続行 ―― その場合は何とも一致しなくなるので、
 * 結果的に全部が確認待ちに回るだけで、誤登録が起きるわけではない）。
 * このスクリプトはカードを絶対に自動作成しないので、ここで取れた一覧だけが
 * 「登録してよい」判定の唯一の根拠になる。
 */
function getExistingCards_(accessToken) {
  try {
    const url = firestoreDocPath_('artifacts', FIRESTORE_APP_ID, 'users', FIRESTORE_USER_ID, 'cards');
    const options = { method: 'get', headers: { Authorization: 'Bearer ' + accessToken }, muteHttpExceptions: true };
    const response = UrlFetchApp.fetch(url, options);
    if (response.getResponseCode() >= 300) return [];
    const data = JSON.parse(response.getContentText() || '{}');
    const docs = data.documents || [];
    return docs
      .map((d) => {
        const fields = d.fields || {};
        return {
          id: d.name.split('/').pop(), // dのnameはフルパスなので末尾がドキュメントID
          name: (fields.name && fields.name.stringValue) || '',
          last4: (fields.last4 && fields.last4.stringValue) || '',
        };
      })
      .filter((c) => c.name);
  } catch (e) {
    console.warn('カード一覧の取得に失敗しました（すべて確認待ちになります）: ' + e);
    return [];
  }
}

/**
 * 確認待ち（pendingImports）に1件保存する。idを固定にして PATCH（作成 or
 * 上書き）することで、同じメールを何度処理しても確認待ちが重複しない。
 */
function upsertPendingImport_(accessToken, id, data) {
  const url = firestoreDocPath_('artifacts', FIRESTORE_APP_ID, 'users', FIRESTORE_USER_ID, 'pendingImports', id);
  firestoreRequest_(accessToken, 'patch', url, { fields: toFirestoreFields_(data) });
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
