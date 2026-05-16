# Telegram Bot 設定步驟（手把手）

完成後請把以下兩個值回傳給我：
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

我會幫你存到 Supabase Secrets。**Bot Token 切勿貼到 GitHub 或公開地方**。

---

## Step 1 — 建立 Bot

1. 開 Telegram App，搜尋使用者 `@BotFather`（藍勾官方帳號）
2. 點「START」開始對話
3. 輸入 `/newbot`
4. BotFather 問 **Bot 的「顯示名稱」**：輸入 `Stan 籌碼追蹤`（顯示在訊息抬頭，可改）
5. 問 **Bot 的「username」**：輸入結尾是 `_bot` 的英數字串，例如 `stan_stock_chip_bot`（必須全網唯一，被搶就換一個）
6. BotFather 會回一段訊息，裡面有：

   ```
   Use this token to access the HTTP API:
   1234567890:AAFm-AbCdEfGhIjKlMnOpQrStUvWxYz...
   ```

   **這串就是 `TELEGRAM_BOT_TOKEN`**，先複製存到備忘錄。

---

## Step 2 — 拿到 Chat ID

### 2a. 個人通知（先做這個）

1. 在 Telegram 搜尋你剛建立的 Bot username（例：`@stan_stock_chip_bot`）
2. 進入聊天室，點「START」或直接打一句「hi」
3. 在瀏覽器開（把 `<TOKEN>` 換成你的 token）：

   ```
   https://api.telegram.org/bot<TOKEN>/getUpdates
   ```

4. 會看到 JSON，找到：

   ```json
   "chat": {
     "id": 123456789,
     "first_name": "Stan",
     ...
   }
   ```

5. **那個 `id` 就是 `TELEGRAM_CHAT_ID`**（個人 id 是正數）

### 2b. 群組通知（之後想分享給朋友再做）

1. 在 Telegram 開新群組，加入朋友、加入你的 Bot
2. 在群組裡傳一句話（例：`/start@stan_stock_chip_bot`）
3. 一樣開 `getUpdates` URL
4. 找 `chat.id`，**群組 id 是負數**（例如 `-100123456789`）
5. 用這個負數取代個人 id

---

## Step 3 — 把兩個值回傳給我

把這兩個值貼給我（用任何方式，我會在你確認後幫你寫入 Supabase Secrets）：

```
TELEGRAM_BOT_TOKEN = 1234567890:AAFm-...
TELEGRAM_CHAT_ID   = 123456789
```

---

## 補充

- **要關閉通知**：Telegram 對話視窗右上角靜音
- **要換通知對象**：之後改 Supabase Secrets 的 `TELEGRAM_CHAT_ID` 即可
- **想分群組**：之後可加邏輯（紅燈推群組、黃燈只發給 Stan）
