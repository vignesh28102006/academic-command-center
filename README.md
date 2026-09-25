# Academic Command Center

A high-fidelity college academic intelligence system that captures faculty & department announcements, assignments, tests, deadlines, and submission links from WhatsApp groups, extracts structured entities using Google Gemini AI, stores the authoritative state in Supabase PostgreSQL, and synchronizes with your personal Notion Academic Workspace.

> [!WARNING]
> **WhatsApp Web Implementation Disclaimer:**  
> WhatsApp Web + Tampermonkey is the first collector implementation. It requires WhatsApp Web to remain open in Google Chrome. It is not an official WhatsApp Business API integration.

---

## Architecture Flow

```
WhatsApp Web (Chrome + Tampermonkey)
    ↓
Local Academic Message Pre-Filter (Userscript)
    ↓
Authenticated POST /api/collector/messages (Bearer COLLECTOR_SECRET)
    ↓
Gemini AI Structured Parser (with Deterministic Fallback)
    ↓
Event Intelligence & Modification Engine (Postponements, Link Updates, Cancellations)
    ↓
Supabase / PostgreSQL  ← SOURCE OF TRUTH (Primary Database)
    ↓
Notion API (In-place updates by Database Event ID)
    ↓
My Notion Academic Workspace
```

---

## Features

- **9-View Student Dashboard**: Today, Upcoming, Assignments, Exams & Tests, Projects, Submissions, Announcements, Completed, and Missed/Overdue.
- **AI Extraction & Inspection**: Google Gemini 1.5/2.0 Flash schema validation with confidence thresholds (`HIGH`, `MEDIUM`, `NEEDS_CONFIRMATION`).
- **Audit Change History**: Full before-and-after audit logs for postponed exams, updated submission forms, extended deadlines, and cancellations.
- **Authoritative Database**: Supabase PostgreSQL tables (`academic_events`, `change_history`, `raw_messages`, `subject_mappings`).
- **Live Notion Sync**: Updates Notion database pages in-place without generating duplicates; appends change history blocks.
- **WhatsApp Web Collector (Phase 4A)**: Read-only Tampermonkey userscript observing allowlisted college groups.

---

## WhatsApp Web Collector (Phase 4A) Setup

### Requirements
1. **Google Chrome** (recommended for WhatsApp Web).
2. **Tampermonkey Extension** installed in Chrome ([tampermonkey.net](https://www.tampermonkey.net/)).
3. **Active WhatsApp Web Session** at [web.whatsapp.com](https://web.whatsapp.com).
4. Running **Academic Command Center Backend** (`http://localhost:3000`).

---

### Step 1: Configure Backend Environment

Copy `.env.example` to `.env.local` and define your secrets:

```bash
# AI Parser (Server-side only)
GEMINI_API_KEY=your-gemini-api-key

# Supabase PostgreSQL (Source of Truth)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Notion Workspace (User-facing sync)
NOTION_TOKEN=secret_your-notion-token
NOTION_DATABASE_ID=your-notion-database-id

# WhatsApp Collector Authentication Secret
COLLECTOR_SECRET=your-secure-collector-secret-here
```

Start the backend:
```bash
npm install
npm run dev
```

---

### Step 2: Install Tampermonkey Userscript

1. Open Chrome and click on the **Tampermonkey** extension icon → **Create a new script...**.
2. Open [`userscript/academic-command-center.user.js`](./userscript/academic-command-center.user.js) and copy its entire contents into the Tampermonkey editor.
3. Edit the `CONFIG` section at the top of the userscript:

```javascript
const CONFIG = {
  // Local backend URL (default is http://localhost:3000)
  backendUrl: "http://localhost:3000",

  // ALLOWLISTED ACADEMIC GROUPS
  // The collector will ONLY read messages from chats matching these names.
  allowedGroups: [
    "19CSE312 NLP Official",
    "CSE 2026 Announcements",
    "OS Lab Batch A",
    "DBMS Course Group"
  ],

  // Collector secret matching COLLECTOR_SECRET in your backend .env.local
  collectorSecret: "your-secure-collector-secret-here",

  cacheSize: 500,
  debug: true
};
```
4. Save the script in Tampermonkey (**Ctrl+S** or **File → Save**).

---

### Step 3: Verify Collector on WhatsApp Web

1. Open or refresh [web.whatsapp.com](https://web.whatsapp.com).
2. Look at the bottom-right corner of the page:
   - When viewing an allowlisted group: A non-intrusive green badge appears: `🟢 ACC Collector: Observing Group`.
   - When viewing personal or non-allowlisted chats: The badge stays inactive: `⚪ ACC Collector: Inactive (Non-academic)`.
3. Click the badge anytime to view real-time statistics (messages captured, filtered chatter, sent to backend).

---

## Privacy & Security Architecture

- **Strict Group Allowlist**: The collector only inspects messages if the active chat header matches an entry in `CONFIG.allowedGroups`. Personal chats, direct messages, and unrelated groups are strictly ignored.
- **Client-Side Pre-Filtering**: Casual greetings ("hi", "good morning", "ok", "thanks", "😂") are filtered locally in the browser and never sent over the network.
- **Zero Sensitive Credential Exposure**:
  - The userscript contains **no** Gemini API keys, **no** Supabase database keys, and **no** Notion tokens.
  - The userscript authenticates solely via `Authorization: Bearer <COLLECTOR_SECRET>`.
  - The backend verifies `COLLECTOR_SECRET` server-side and rejects unauthorized requests with HTTP 401/403.
- **Read-Only Operation**:
  - The collector **never** sends WhatsApp messages.
  - The collector **never** automatically opens chats or alters WhatsApp Web state.
  - The collector **never** automatically submits forms or assignments.
  - The collector only inspects newly rendered messages while running; it does not scrape historical message logs.
- **Backend Hash Deduplication**: Every message is SHA-256 hashed and recorded in `raw_messages`. Duplicate messages are ignored and produce zero database mutations.

---

## Testing & Verification

### Run Automated Test Suite
To run all 53 automated tests (deterministic engine, AI fixtures, Supabase/Notion layer, and collector):
```bash
npm test
```

### Run Production Build Check
```bash
npm run build
```

### Run Manual Collector Test Script
With your backend running on `http://localhost:3000`:
```bash
node scripts/test-collector.mjs
```
This script exercises:
- Authentication rejection (401 on missing token, 403 on invalid secret)
- Academic assignment ingestion & submission link parsing
- Postponement detection (e.g. 30 Sep → 3 Oct) updating the existing event
- Ambiguous message handling (`"Please submit this soon."` flags `needsConfirmation = true`)
- Message deduplication prevention
- Live collector status API verification (`GET /api/collector/status`)

---

## Project Structure

```
academic-command-center/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── collector/
│   │   │   │   ├── messages/route.ts   # Authenticated collector ingestion
│   │   │   │   └── status/route.ts     # Collector health & metrics
│   │   │   ├── events/route.ts         # GET / POST academic events
│   │   │   ├── events/[id]/route.ts    # GET / PATCH / DELETE event
│   │   │   └── messages/process/route.ts # Direct message processing
│   ├── components/
│   │   └── Dashboard.tsx               # 9-view dashboard + Collector Status Panel
│   ├── lib/
│   │   ├── ai/                         # Gemini provider & JSON schemas
│   │   ├── collector/
│   │   │   ├── stats.ts                # KPI metrics tracking
│   │   │   └── collector.test.ts       # Phase 4A test suite
│   │   ├── db/                         # Supabase data layer (CRUD + change history)
│   │   ├── messages/
│   │   │   └── processor.ts            # Shared processing pipeline
│   │   ├── notion/                     # Notion client, mapper & sync
│   │   ├── parser.ts                   # Deterministic parser & date normalizer
│   │   └── events.ts                   # Event intelligence engine
├── supabase/
│   └── schema.sql                      # PostgreSQL DDL
├── userscript/
│   └── academic-command-center.user.js # Tampermonkey WhatsApp Web collector
├── scripts/
│   ├── test-collector.mjs              # Collector manual test script
│   └── verify-api.mjs                  # API route verification
└── package.json
```
