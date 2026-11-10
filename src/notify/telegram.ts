import { log } from '../log.js';

/** Returns a notifier for log.setNotifier, or null when Telegram is not configured. Max 1 message/second; never throws. */
export function telegramNotifier(token?: string, chatId?: string, fetchFn: typeof fetch = fetch): ((text: string) => Promise<void>) | null {
  if (!token || !chatId) return null;
  let chain: Promise<void> = Promise.resolve();
  let last = 0;
  return (text: string) => {
    chain = chain.then(async () => {
      const wait = Math.max(0, last + 1000 - Date.now());
      if (wait) await new Promise((r) => setTimeout(r, wait));
      last = Date.now();
      try {
        const res = await fetchFn(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text: `[eth-bot] ${text}`.slice(0, 4000) }),
        });
        if (!res.ok) log.warn({ status: res.status }, 'telegram send failed');
      } catch (err) {
        log.warn({ err }, 'telegram send failed');
      }
    });
    return chain;
  };
}
