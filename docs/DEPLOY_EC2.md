# Deploying the ETH bot on AWS EC2

This guide takes you from no server to the bot running 24/7, with the dashboard on HTTPS. It is written for **Ubuntu 24.04 on EC2**. Commands marked **(Mac)** run on your laptop; all the others run on the server.

> **Before real money:** run the server with `DRY_RUN=true` for 1–2 weeks. Do the Delta **testnet check** in the [README](../README.md#operating) rollout checklist before going live. The bot sends stop-only orders, which have not been verified against Delta yet.

## 1. Launch the instance

In the AWS console, go to **EC2 → Launch instance**.

| Setting | Value | Why |
|---|---|---|
| Region | **ap-south-1 (Mumbai)** | close to Delta Exchange India, so requests are faster |
| AMI | Ubuntu Server 24.04 LTS (64-bit x86) | the guide's commands assume Ubuntu |
| Instance type | **t3.small** (2 GB RAM) | t3.micro (1 GB) can run out of memory during `npm ci` and the build |
| Key pair | create one, e.g. `eth-bot.pem`, and keep it safe | needed for SSH |
| Storage | 20 GB gp3 | enough room for logs and nightly database backups |

Under **Network settings → Security group**, create a new group with these inbound rules:

| Type | Port | Source |
|---|---|---|
| SSH | 22 | **My IP** only |
| HTTP | 80 | 0.0.0.0/0, needed for the HTTPS certificate |
| HTTPS | 443 | 0.0.0.0/0, or only your own IPs if you want the dashboard private |

Do **not** open port 3000. The bot listens on 127.0.0.1 only, and Caddy forwards to it.

## 2. Give it a fixed IP (Elastic IP)

Delta API keys must be IP-whitelisted, so the server's public IP must never change.

1. Go to **EC2 → Elastic IPs → Allocate**.
2. Select the new address → **Associate** → choose your instance.
3. Note the IP. You will whitelist it in Delta (step 8) and point your domain at it (step 3).

## 3. Point a domain at it

The dashboard login needs HTTPS, so you need a domain or subdomain.

1. At your DNS provider, add an **A record**, e.g. `bot.yourdomain.com`, pointing to the Elastic IP.
2. Check it **(Mac)**:

   ```bash
   dig +short bot.yourdomain.com
   ```

   It should print the Elastic IP.

## 4. Connect and prepare the server

**(Mac):**

```bash
chmod 400 ~/Downloads/eth-bot.pem
ssh -i ~/Downloads/eth-bot.pem ubuntu@<ELASTIC_IP>
```

On the server, update the system and install the basics:

```bash
sudo apt update && sudo apt -y upgrade
sudo apt -y install build-essential git chrony ufw rsync
sudo timedatectl set-timezone UTC
sudo systemctl enable --now chrony
chronyc tracking | grep -E "System time|Leap"   # the clock must be accurate, because Delta signatures expire in 5 s
```

Install Node.js 22, which `better-sqlite3` requires:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt -y install nodejs
node -v   # v22.x
sudo npm i -g pm2
pm2 install pm2-logrotate
```

Turn on the firewall. The AWS security group already filters traffic; this adds a second layer:

```bash
sudo ufw allow 22/tcp && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp
sudo ufw --force enable
```

## 5. Copy the bot to the server

The project is not a git repository, so copy it with `rsync`. Leave out installed packages, local data and your local `.env`.

**(Mac):**

```bash
cd ~/Desktop
rsync -av --exclude node_modules --exclude web/node_modules --exclude dist --exclude web/dist \
  --exclude data --exclude .env --exclude coverage \
  -e "ssh -i ~/Downloads/eth-bot.pem" \
  tradingbot-eth/ ubuntu@<ELASTIC_IP>:~/tradingbot-eth/
```

**Server:**

```bash
cd ~/tradingbot-eth
npm ci
(cd web && npm ci)
npm run build      # server → dist/, dashboard → web/dist/
npm test           # all tests should pass on the server too
```

If `npm ci` reports that `better-sqlite3` was built without its native module, run:

```bash
npm rebuild better-sqlite3
```

## 6. Create the server's `.env`

```bash
cd ~/tradingbot-eth
cp .env.example .env
chmod 600 .env
npm run hash-password            # type a strong dashboard password → copy the printed hash
openssl rand -hex 32             # → SESSION_SECRET
openssl rand -hex 32             # → CTL_TOKEN
openssl rand -hex 32             # → SECRETS_KEY (encrypts the API keys you save in the dashboard)
nano .env
```

Set at least the following:

```ini
DASHBOARD_USER=admin
DASHBOARD_PASSWORD_HASH=<hash from hash-password>
SESSION_SECRET=<first openssl value>
CTL_TOKEN=<second openssl value>
SECRETS_KEY=<third openssl value>   # keep a copy somewhere safe; if it changes, re-enter the API keys
DRY_RUN=true                 # LOCKS paper trading for the trial period (the dashboard's Go live is disabled)
COOKIE_SECURE=true           # required behind HTTPS
PORT=3000
DATA_DIR=data
# Leave DELTA_API_KEY / DELTA_API_SECRET empty: you will upload the keys in the dashboard (Settings).
# Optional alerts:
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
```

Keep the strategy defaults as they are in `.env.example` (`RISK_PER_TRADE=0.2`, `MIN_ATR=15`, `SKIP_WEEKEND_ENTRIES=true`).

Run the end-to-end check. It boots the bot and runs one real candle cycle against Delta in paper mode:

```bash
npm run smoke
```

## 7. HTTPS with Caddy

```bash
sudo apt -y install debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt -y install caddy
sudo cp ~/tradingbot-eth/Caddyfile.example /etc/caddy/Caddyfile
sudo sed -i 's/bot.example.com/bot.yourdomain.com/' /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Caddy gets the certificate automatically. This needs ports 80 and 443 open and the DNS record from step 3.

## 8. Start the bot under PM2

```bash
cd ~/tradingbot-eth
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup systemd -u ubuntu --hp /home/ubuntu   # copy and run the sudo command it prints
pm2 logs eth-bot --lines 30                       # look for "started (DRY_RUN, …)" and "dashboard listening"
```

Then:

1. Open `https://bot.yourdomain.com` and log in with the password from step 6.
2. Check that the Overview shows **paper trading**.
3. Run the control command and confirm it answers with the bot's status:

   ```bash
   npm run ctl -- status
   ```

## 9. Monitoring and backups

*   **Uptime check:**
    *   Point a free uptime monitor (e.g. UptimeRobot) at `https://bot.yourdomain.com/health`.
    *   It returns **503** when the bot is halted, has a position without a stop, missed a cycle, or Delta calls keep failing.
    *   Set it to alert you by email or phone.
*   **Logs:**
    *   Run `pm2 logs eth-bot`.
    *   They rotate automatically through `pm2-logrotate`.
*   **Backups:**
    *   The bot writes a nightly SQLite backup to `data/backups/`.
    *   To copy them to your Mac now and then **(Mac)**:

        ```bash
        rsync -av -e "ssh -i ~/Downloads/eth-bot.pem" ubuntu@<ELASTIC_IP>:~/tradingbot-eth/data/backups/ ~/eth-bot-backups/
        ```

*   **EBS snapshots:** optionally, enable daily snapshots in **EC2 → Lifecycle Manager**.

## 10. Going live (only after the paper period and the testnet check)

1. **Create the API key.** In the Delta Exchange India app, create an API key with **trading permission only**, no withdrawals, and whitelist the **Elastic IP**.
2. **Set isolated margin.** In the Delta app, set **isolated** margin for ETHUSD.
3. **Allow live trading on the server** (once), and cap the first trade. In `.env`:

   ```ini
   DRY_RUN=false            # allows live trading; it still starts only when you press Go live
   MAX_CONTRACTS=1          # first trade: 0.01 ETH only
   ```

   Then run `pm2 restart eth-bot`. The bot is **still in paper mode**.
4. **Upload the keys.** In the dashboard, go to **Settings → Delta API keys**:
   - paste the key and secret;
   - tick the permission box;
   - enter your dashboard password;
   - press **Save keys**.

   The bot tests them with Delta (balance and position) before storing them encrypted. If Delta rejects the key, for example because the IP is not whitelisted, its error is shown and nothing is saved.
5. **Go live.** In **Settings → Trading mode**, press **Go live…**, tick isolated margin, type `LIVE` and enter your password. The bot restarts itself in live mode under PM2, and the badge at the top turns red: **LIVE**.

   To stop live trading, press **Back to paper** (only with no open position), or set `DRY_RUN=true` in `.env` and restart.
6. **Check the first trade on Delta:**
   - the stop sits at entry ∓ R;
   - there is no take-profit;
   - the stop moves to break-even and then trails.
7. **Remove the size cap.** When you're satisfied, remove `MAX_CONTRACTS=1` (or set it to `100000`) and run `pm2 restart eth-bot`.

### If the bot refuses to start

The bot can refuse to start when it is in live mode but the stored keys can't be decrypted, for example because `SECRETS_KEY` changed. `pm2 logs eth-bot` says so, the dashboard is down, and `/health` alerts. **Any open position keeps its stop-loss on Delta.** Fix it one of two ways:

- put the original `SECRETS_KEY` back in `.env`, then run `pm2 restart eth-bot`; **or**
- put the keys in `.env` (`DELTA_API_KEY`, `DELTA_API_SECRET`) together with `CREDENTIALS_SOURCE=env`, then restart. Once it's running, re-save the keys from the dashboard and remove the override.

The bot also refuses to start **in paper mode** if your Delta account has an open ETHUSD position, because that position would go unmanaged. Go live, or close the position on Delta.

## 11. Updating the bot later

**(Mac):** use the same `rsync` command as step 5. It never touches the server's `.env` or `data/`.

**Server.** Update while the bot has **no open position**, or at least make sure the stop is on Delta, which it always should be:

```bash
cd ~/tradingbot-eth
npm ci && (cd web && npm ci) && npm run build && npm test
pm2 restart eth-bot
```

## Quick reference

| Task | Command |
|---|---|
| Status | `npm run ctl -- status` |
| Pause new entries | `npm run ctl -- pause` |
| Resume (also after the breaker) | `npm run ctl -- resume` |
| Close the open trade | `npm run ctl -- close` |
| Reset the risk peak after a deposit or withdrawal | `npm run ctl -- reset-peak` |
| Logs | `pm2 logs eth-bot` |
| Restart | `pm2 restart eth-bot` |
| Stop completely | `pm2 stop eth-bot` (the stop-loss stays on Delta) |
