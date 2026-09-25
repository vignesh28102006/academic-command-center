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
2. Open [`userscript/academic-command-center.user.js`](file:///C:/Users/Vasala%20Vignesh/academic-command-center/userscript/academic-command-center.user.js) and copy its entire contents into the Tampermonkey editor.
3. Edit the `CONFIG` section at the top of the userscript:

```javascript
const CONFIG = {
  // Local backend URL (default is http://localhost:3000)
  backendUrl: "http://localhost:3000",

  // Collector secret matching COLLECTOR_SECRET in your backend .env.local
  collectorSecret: "your-secure-collector-secret-here",

  // AUTOMATIC GROUP MONITORING:
  // Automatically detects and monitors ANY WhatsApp group conversation opened by the user.
  // Manual group-name allowlisting is NOT required.
  monitorAllGroups: true,

  // AUTOMATED 2-HOUR SCAN CYCLE:
  // Automatically initiates a backfill / incremental collection cycle every 2 hours
  scanIntervalMs: 2 * 60 * 60 * 1000,

  // AUTOMATED GROUP NAVIGATION:
  // If true, sequentially opens discovered groups to backfill messages up to Sept 10, 2026
  autoNavigateGroups: true,

  // HISTORICAL BACKFILL BOUNDARY:
  // Messages prior to September 10, 2026 are strictly ignored and not collected
  backfillBoundaryDate: "2026-09-10T00:00:00+05:30",

  // Monitored groups list (used if monitorAllGroups is set to false)
  monitoredGroups: [
    "CSE-C Announcements",
    "23cse351 FoDS G1",
    "NLP 2026 batch",
    "NLP 2026",
    "CSE-C Official 2024",
    "Machine Learning CSE-C",
    "Computer Networks CSE-C"
  ],

  cacheSize: 500,
  debug: true
};
```
4. Save the script in Tampermonkey (**Ctrl+S** or **File → Save**).

---

### Step 3: Verify Collector on WhatsApp Web

1. Open or refresh [web.whatsapp.com](https://web.whatsapp.com).
2. Look at the bottom-right corner of the page for the floating status badge:
   - **When viewing a Group Chat** (e.g. `NLP 2026 batch`, `CSE-C Official 2024`, `Machine Learning CSE-C`, `General`):
     `🟢 ACC Collector: Observing Group`
   - **When performing 2-Hour Backfill / Scan**:
     `🔄 ACC Collector: Scanning Groups`
   - **When viewing a Personal 1-to-1 Chat**:
     `⚪ ACC Collector: Personal Chat Ignored`
   - **When WhatsApp Web is Loading or Inactive**:
     `⚪ ACC Collector: Inactive`
   - **When Backend is Unreachable or Returns an Auth Error**:
     `🔴 ACC Collector: Backend Error`
3. Click the badge anytime to open the live statistics modal (active group, chat type, messages captured, filtered chatter, duplicates, sent to backend).

---

## 2-Hour Recurring Scan Cycle & Backfill Architecture

### 1. Initial Historical Backfill (Boundary: September 10, 2026)
- On first discovery of a WhatsApp group, the collector enters `BACKFILLING` mode.
- It leverages WhatsApp Web's virtual scroller (`#main div[data-tab="8"]` / chat panel) to load older messages back to **September 10, 2026**.
- Any messages timestamped prior to September 10, 2026 are strictly ignored and discarded.
- Once backfill reaches September 10 (or top of conversation history), the group state records `backfillComplete: true`.

### 2. Persistent Per-Group Collection Cursors (`collector_group_state`)
- Every group maintains its own independent collection cursor in the database (`last_processed_message_timestamp` and `last_processed_message_id`).
- When a new message is successfully processed, the group's cursor timestamp advances to that message's timestamp.
- **Failed Processing Protection**: If a message fails ingestion or an error occurs, the cursor is **held** at the last successful message and does **not** advance past failed items.

### 3. Incremental Scanning (Resuming from Cursor)
- On recurring 2-hour scan runs (or when switching groups), the collector queries the backend for the group's saved cursor.
- The collector scans only messages strictly newer than the saved cursor timestamp (`isMessageNewerThanCursor`).
- The collector **never** rescans from September 10, 2026 after the initial backfill is complete.

### 4. Strict Privacy Boundary (1-to-1 Personal Chats)
- Personal chats are identified locally in the browser via DOM heuristics (`[data-icon="default-user"]`, `"online"`, `"last seen"`, `"Contact info"`).
- Personal chats are **never** collected, monitored, or navigated into.
- Personal message contents never leave the browser.

### 5. WhatsApp Web Session Continuity
- The collector requires WhatsApp Web to remain open in the browser.
- If WhatsApp Web is closed or disconnected, the backend reports `whatsappStatus: "UNAVAILABLE"`.
- All cursors and group states remain preserved in Supabase PostgreSQL; collection automatically resumes from saved cursors when WhatsApp Web reconnects.

---

## Testing & Verification

### Run Automated Test Suite
To run all 67 automated tests across all 4 test suites:
```bash
npm test
```
Includes:
- Parser & Event Engine Self-Check (6 tests)
- AI Parser & Event Fixtures (22 tests)
- Supabase PostgreSQL & Notion Sync (13 tests)
- WhatsApp Collector Phase 4A/4B (26 tests)

### Run Production Build Check
```bash
npm run build
```

### Run Collector Integration Script
With the Next.js backend running on `http://localhost:3000`:
```bash
node scripts/test-collector.mjs
```
This script exercises:
- Authentication rejection (401 on missing token, 403 on invalid secret)
- Academic assignment ingestion & submission link parsing
- Postponement detection updating existing events without duplicates
- Casual chatter filtering (`NON_ACADEMIC`)
- Message deduplication prevention (`IGNORED_DUPLICATE`)
- Pre-September 10 message boundary filtering (`IGNORED_OUT_OF_RANGE`)
- Per-group registration & cursor advancement (`/api/collector/groups`)
- Scan history tracking lifecycle (`/api/collector/scans`)
- Live collector status reporting (`/api/collector/status`)

---

## Project Structure

```
academic-command-center/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── collector/
│   │   │   │   ├── groups/route.ts         # GET / POST collector groups
│   │   │   │   ├── groups/[id]/route.ts    # GET group by id or name
│   │   │   │   ├── groups/[id]/cursor/route.ts # PATCH cursor & metrics
│   │   │   │   ├── messages/route.ts       # Authenticated message ingestion
│   │   │   │   ├── scans/route.ts          # GET / POST 2-hour scan history
│   │   │   │   └── status/route.ts         # Collector health & aggregates
│   │   │   ├── events/route.ts             # GET / POST academic events
│   │   │   ├── events/[id]/route.ts        # GET / PATCH / DELETE event
│   │   │   └── messages/process/route.ts   # Direct message processing
│   ├── components/
│   │   └── Dashboard.tsx                   # 9-view dashboard + Collector Panel
│   ├── lib/
│   │   ├── ai/                             # Gemini provider & JSON schemas
│   │   ├── collector/
│   │   │   ├── auth.ts                     # Collector secret verification
│   │   │   ├── group-detection.ts          # DOM heuristic detectors
│   │   │   ├── stats.ts                    # KPI metrics tracking
│   │   │   └── collector.test.ts           # Phase 4A/4B test suite (26 tests)
│   │   ├── db/
│   │   │   ├── collectorState.ts           # Group state & scan persistence
│   │   │   ├── academicEvents.ts           # Event store & CRUD
│   │   │   ├── rawMessages.ts              # Hash deduplication & raw logs
│   │   │   └── subjectMappings.ts          # Subject alias resolution
│   │   ├── messages/
│   │   │   └── processor.ts                # Shared processing pipeline
│   │   ├── notion/                         # Notion client, mapper & sync
│   │   ├── parser.ts                       # Deterministic parser & normalizer
│   │   └── events.ts                       # Event intelligence engine
├── supabase/
│   └── schema.sql                          # PostgreSQL DDL
├── userscript/
│   └── academic-command-center.user.js     # Tampermonkey collector v3.0
├── scripts/
│   ├── test-collector.mjs                  # Collector integration test script
│   └── verify-api.mjs                      # API route verification
└── package.json
```
