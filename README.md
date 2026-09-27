# Vera — Merchant AI Assistant for magicpin AI Challenge

Vera is a stateful WhatsApp-style AI assistant for local merchants in India.
She synthesises Category × Merchant × Trigger × Customer context to compose
highly specific, high-converting proactive messages and handles multi-turn
conversations with auto-reply detection, intent transition, and opt-out guards.

---

## Project Structure

```
magicpin/
├── bot.py               # FastAPI server — all 5 endpoints
├── requirements.txt     # Python dependencies
├── Dockerfile           # Multi-stage production container
├── .env                 # Optional local LLM configuration; never commit
├── judge_simulator.py   # External judge harness; not included in this checkout
├── frontend/            # React + TypeScript merchant workspace
└── dataset/             # Context seeds; pushed by the judge at runtime
  ├── categories/      # dentists, gyms, pharmacies, restaurants, salons
  ├── customers_seed.json
  ├── merchants_seed.json
  ├── triggers_seed.json
  └── generate_dataset.py
```

---

## 1. Local Setup & Run

### Prerequisites

- Python 3.11+
- pip
- Node.js 18+ and npm (for the merchant workspace)

### Install dependencies

```bash
pip install -r requirements.txt
```

### Configure your LLM key

Create a `.env` file in the project root:

```env
LLM_PROVIDER=openai          # openai | anthropic | gemini | deepseek | groq | openrouter | ollama
LLM_API_KEY=sk-...           # your API key
LLM_MODEL=                   # leave blank for provider default, or e.g. gpt-4o
OPENAI_BASE_URL=https://api.openai.com/v1   # only needed for custom OpenAI-compatible endpoints
```

Provider default models:

| Provider    | Default model               |
|-------------|-----------------------------|
| openai      | gpt-4o-mini                 |
| anthropic   | claude-3-5-sonnet-20241022  |
| gemini      | gemini-1.5-flash            |
| deepseek    | deepseek-chat               |
| groq        | llama-3.1-70b-versatile     |
| openrouter  | anthropic/claude-3-haiku    |
| ollama      | llama3 (local)              |

### Start the server

```bash
uvicorn bot:app --host 0.0.0.0 --port 8080
```

Verify it is running:

```bash
curl http://localhost:8080/v1/healthz
```

Expected response:

```json
{
  "status": "ok",
  "uptime_seconds": 3.2,
  "contexts": { "category": 0, "merchant": 0, "customer": 0, "trigger": 0 },
  "version": "1.0.0"
}
```

Interactive API docs are available at `http://localhost:8080/docs`.

## Merchant Workspace

The React merchant workspace is in `frontend/`. It uses the bundled seed data
and the existing FastAPI endpoints; it does not expose LLM credentials.

Start the API from the repository root in one terminal:

```bash
uvicorn bot:app --host 0.0.0.0 --port 8080
```

Start the frontend from `frontend/` in a second terminal:

```bash
npm install
npm run dev
```

Open `http://localhost:5173`. The API URL defaults to `http://localhost:8080`.
To override it, copy `frontend/.env.example` to `frontend/.env.local` and set
`VITE_API_BASE_URL` before starting Vite. The API permits browser requests from
the local Vite origins only.

Choose a business type, outlet, and one of that outlet's real updates, then
select **Create message**. Vera pushes the exact category, merchant, trigger,
and linked customer seed contexts with incrementing versions before requesting
the message. **Try another update** selects a different real trigger because
the API suppresses already-used trigger keys. Approving a draft is a local
review state; use **Copy text** to paste it into WhatsApp. WhatsApp delivery is
not connected to this project. Merchant replies in the conversation panel are
sent to the existing `/v1/reply` endpoint.

Build-check the frontend with:

```bash
cd frontend
npm run build
```

---

## 2. Testing with judge_simulator.py

### Run the judge

The challenge harness is distributed separately and is not present in this
repository. Place the supplied `judge_simulator.py` in the project root, start
the bot in one terminal, configure its `BOT_URL` as documented in the harness,
then run the harness in another terminal:

```bash
python judge_simulator.py
```

The harness should push category, merchant, trigger, and customer contexts
through `/v1/context` before running ticks and reply scenarios. The bot uses a
deterministic local composer when no LLM key is configured; the judge's scoring
provider is configured in the judge script, not in this bot.

### Available scenarios

| Scenario          | What it tests                                      |
|-------------------|----------------------------------------------------|
| `warmup`          | healthz, metadata, context push                    |
| `phase2_short`    | warmup + tick with LLM scoring of 3 triggers       |
| `auto_reply_hell` | auto-reply detection (must return `end`)           |
| `intent_transition` | YES/commit detection (must switch to action mode)|
| `hostile`         | opt-out / hostility handling                       |
| `all`             | warmup + auto_reply + intent + hostile             |
| `full_evaluation` | all contexts + full tick scoring                   |

### Dataset files

The judge expects:

```
dataset/
  categories/        ← one .json per category slug
  merchants_seed.json
  customers_seed.json
  triggers_seed.json
```

The seed dataset is already in this repository. The challenge harness normally
pushes the active contexts over HTTP; the server does not preload the seeds.
For local data expansion, run the generator from the dataset directory:

```bash
python dataset/generate_dataset.py --seed-dir dataset --out dataset/expanded
```

### Score interpretation

```
40-50 / 50  →  Excellent
30-39 / 50  →  Good
20-29 / 50  →  Needs improvement
< 20  / 50  →  Below expectations
```

---

## 3. Docker

### Build the image

```bash
docker build -t vera-bot .
```

### Run locally

```bash
docker run -p 8080:8080 \
  -e LLM_PROVIDER=openai \
  -e LLM_API_KEY=sk-... \
  vera-bot
```

Or pass a `.env` file:

```bash
docker run -p 8080:8080 --env-file .env vera-bot
```

---

## 4. Free Deployment — Get a Public HTTPS URL

### Option A: Render (recommended — always-on free tier)

1. Push your project to a GitHub repository.
2. Go to [render.com](https://render.com) → **New** → **Web Service**.
3. Connect your GitHub repo.
4. Fill in the settings:
   - **Runtime**: Python 3
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `uvicorn bot:app --host 0.0.0.0 --port 8080`
   - **Port**: `8080`
5. Add Environment Variables under the **Environment** tab:
   - `LLM_PROVIDER` = `openai`
   - `LLM_API_KEY`  = `sk-...`
   - `LLM_MODEL`    = *(leave blank for default)*
6. Click **Create Web Service**.
7. Render gives you a URL like `https://vera-bot.onrender.com`.
8. Point the judge at it: `BOT_URL = "https://vera-bot.onrender.com"`.

> Free tier spins down after 15 min of inactivity. Hit `/v1/healthz` once to wake it before running the judge.

---

### Option B: Fly.io (Docker-native, always-on free allowance)

#### Install flyctl

```bash
# macOS / Linux
curl -L https://fly.io/install.sh | sh

# Windows (PowerShell)
iwr https://fly.io/install.ps1 -useb | iex
```

#### Deploy

```bash
fly auth login

# From your project directory:
fly launch --name vera-bot --region sin --port 8080 --no-deploy

# Set your LLM secrets
fly secrets set LLM_PROVIDER=openai LLM_API_KEY=sk-...

# Deploy
fly deploy
```

Your bot is live at `https://vera-bot.fly.dev`.

#### Update after code changes

```bash
fly deploy
```

---

### Option C: ngrok (instant tunnel for local testing)

Use this when you want to expose your local `localhost:8080` to the judge harness without deploying.

#### Install ngrok

Download from [ngrok.com/download](https://ngrok.com/download) or:

```bash
# macOS
brew install ngrok

# Windows (PowerShell, using winget)
winget install ngrok.ngrok
```

#### Start the tunnel

```bash
# 1. Start the bot locally
uvicorn bot:app --host 0.0.0.0 --port 8080

# 2. In a separate terminal, start ngrok
ngrok http 8080
```

ngrok prints a forwarding URL like:

```
Forwarding   https://a1b2c3d4.ngrok-free.app -> http://localhost:8080
```

#### Point the judge at it

```python
BOT_URL = "https://a1b2c3d4.ngrok-free.app"
```

> ngrok free tier URLs change every restart. Re-copy the URL each time.

---

## 5. API Reference

### GET /v1/healthz

Returns liveness status and loaded context counts.

```json
{
  "status": "ok",
  "uptime_seconds": 42.1,
  "contexts": { "category": 3, "merchant": 10, "customer": 5, "trigger": 8 }
}
```

### GET /v1/metadata

```json
{
  "team_name": "Team Vera",
  "bot_name": "Vera",
  "model": "openai/gpt-4o-mini",
  "approach": "...",
  "version": "1.0.0"
}
```

### POST /v1/context

```json
{
  "scope": "merchant",
  "context_id": "m_001",
  "version": 2,
  "payload": { ... },
  "delivered_at": "2024-01-01T00:00:00Z"
}
```

Response: `{ "accepted": true, "scope": "merchant", "context_id": "m_001", "version": 2 }`

Stale versions (version ≤ stored version) return `{ "accepted": false, "reason": "stale_version" }`.

### POST /v1/tick

```json
{
  "now": "2024-01-01T10:00:00Z",
  "available_triggers": ["trig_001", "trig_002"]
}
```

Response:

```json
{
  "actions": [
    {
      "conversation_id": "vera_trig_001_m_001",
      "trigger_id": "trig_001",
      "merchant_id": "m_001",
      "body": "Rahul, Heads Up Salon ka CTR 1.2% hai...",
      "cta": "Offer banao",
      "send_as": "vera",
      "suppression_key": "low_ctr_m_001",
      "rationale": "CTR below category average by 0.8pp"
    }
  ]
}
```

### POST /v1/reply

```json
{
  "conversation_id": "conv_abc",
  "merchant_id": "m_001",
  "from_role": "merchant",
  "message": "Ok lets do it, what next?",
  "turn_number": 2
}
```

Response:

```json
{
  "action": "send",
  "body": "On it, Rahul! Drafting 'Haircut @ ₹99' offer now — ready in 2 mins.",
  "cta": "Review draft",
  "rationale": "Intent confirmed — switched to action mode."
}
```

`action` is one of:
- `send` — Vera has a reply to deliver
- `wait` — Vera is processing, retry later
- `end`  — conversation closed (auto-reply / opt-out / hostility detected)

---

## 6. Scoring Dimensions (50 pts total)

| Dimension          | Points | Key signal                                      |
|--------------------|--------|-------------------------------------------------|
| Specificity        | 0–10   | Exact numbers, prices, CTR, offer titles        |
| Category Fit       | 0–10   | Tone matches vertical (dentist vs salon vs gym) |
| Merchant Fit       | 0–10   | Uses owner name, their data, language pref      |
| Decision Quality   | 0–10   | Clear WHY NOW linked to trigger payload         |
| Engagement         | 0–10   | Loss aversion, one CTA, low-friction ask        |

Penalties: fabricating data (−2), exposing internal jargon (−1).
