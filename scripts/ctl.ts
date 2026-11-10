// npm run ctl -- <pause|resume|close|status|reset-peak>
// Thin HTTP client for the running bot (over SSH on the VPS). Uses X-Ctl-Token on loopback,
// so commands run inside the bot process under the same mutex.
import 'dotenv/config';

const cmd = process.argv[2];
const port = process.env.PORT ?? '3000';
const token = process.env.CTL_TOKEN;
const routes: Record<string, { method: string; path: string }> = {
  pause: { method: 'POST', path: '/api/control/pause' },
  resume: { method: 'POST', path: '/api/control/resume' },
  close: { method: 'POST', path: '/api/control/close' },
  status: { method: 'GET', path: '/api/status' },
  'reset-peak': { method: 'POST', path: '/api/control/reset-peak' },
};

async function main() {
  const r = routes[cmd ?? ''];
  if (!r) {
    console.error('usage: npm run ctl -- <pause|resume|close|status|reset-peak>');
    process.exit(1);
  }
  if (!token) {
    console.error('CTL_TOKEN is not set in .env');
    process.exit(1);
  }
  const res = await fetch(`http://127.0.0.1:${port}${r.path}`, { method: r.method, headers: { 'X-Ctl-Token': token, 'Content-Type': 'application/json' } });
  const text = await res.text();
  try {
    console.log(JSON.stringify(JSON.parse(text), null, 2));
  } catch {
    console.log(text);
  }
  process.exit(res.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(`could not reach the bot on 127.0.0.1:${port}: ${(e as Error).message}`);
  process.exit(1);
});
