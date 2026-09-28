# Academic Command Center

A high-fidelity college academic intelligence system that captures faculty & department announcements, assignments, tests, deadlines, and submission links from WhatsApp groups, extracts structured entities using Google Gemini AI, stores the authoritative state in Supabase PostgreSQL, and synchronizes with your personal Notion Academic Workspace.

> [!WARNING]
> **WhatsApp Web Implementation Disclaimer:**  
> WhatsApp Web + Tampermonkey is the primary collector implementation. It requires WhatsApp Web to remain open in Google Chrome. It is not an official WhatsApp Business API integration.

---

## Architecture Flow

```
WhatsApp Web (Chrome + Tampermonkey)
    ↓
Local Privacy & Allowed-Group Filter (Strict 6 Allowed Academic Groups)
    ↓
Announcement Channel & Group Detection ("Only admins can send messages", DOM heuristics)
    ↓
Authenticated Ingestion & Scan Cursors (POST /api/collector/messages, PATCH /cursor)
    ↓
Multi-Event & Deterministic / Gemini AI Structured Parser
    ↓
Event Intelligence & Modification Engine (Postponements, Link Updates, Cancellations)
    ↓
Supabase PostgreSQL  ← SOURCE OF TRUTH (Primary Database)
    ↓
├── Automated Reminders & Daily Morning Briefing Engine (Phase 4B)
│       ↓
│   Notification Providers (Console, HTML5 Browser Push)
│
└── Notion API (In-place updates by Database Event ID)
        ↓
    Notion Academic Workspace
```

---

## Key Features

- **Strict Academic Group Allowlist**: Monitored conversations are strictly restricted to the 6 configured academic groups:
  1. `Machine Learning CSE-C`
  2. `Computer Networks CSE-C`
  3. `TOC 23CSE303 - CSE-C`
  4. `NLP 2026 batch`
  5. `CSE-C Announcements`
  6. `23CSE351 FoDS G1`
  *Personal chats, embedded projects, and unallowed groups are never collected or sent to the backend.*
- **Announcement Channel & Group Detection Hierarchy**: 3-tier detection hierarchy accurately identifies restricted community announcement groups (`CSE-C Announcements`) via bottom composer notices (`"Only admins can send messages"`), header action labels, and exact allowed title matching without requiring ordinary participant subtitles or message author headers.
- **BiDi Unicode & Dash Normalization**: Transparently strips invisible directional formatting marks (`\u200E`, `\u200F`, `\u200B-\u200D`, `\uFEFF`) and normalizes all Unicode dash/hyphen variants (`[\u2010-\u2015\u2212]`, `"CSE - C"` $\rightarrow$ `"CSE-C"`), guaranteeing 100% exact equality matching against allowed groups in WhatsApp Web.
- **Academic Relevance & Pre-AI Filtering Engine**: Fast deterministic pre-AI gate that filters out commercial spam (real estate, 0% EMI), casual chatter, and pure attendance updates, while actively recognizing academic broadcasts: assignments, tests, exams, timetable updates, class notices, lectures, sessions, workshops, circulars, and venue allocations.
- **Announcement Channel Pass-Through**: In broadcast channels like `CSE-C Announcements`, messages sent by faculty/admins automatically bypass narrow keyword gates and are safely delivered to the backend Gemini AI parser.
- **Resilient Message Extraction**: Multi-tier DOM selectors with fallbacks for virtualized WhatsApp Web message containers, clean inner text extraction, and timestamp recovery (`[data-testid="msg-time"]`, `copyable-text`, `[data-pre-plain-text]`).
- **Separate Scan Cursor vs Academic Cursor**: Group state maintains `lastScannedMessageTimestamp` independently from `lastProcessedAcademicMessageTimestamp`. Ignored messages (casual chatter, attendance notifications, advertisements, duplicates) advance the scan cursor so reopening a completed group **never** rescans from September 10. Genuine processing errors hold the cursor for automatic retry.
- **Multi-Event Extraction**: Complex faculty messages announcing multiple deadlines or dates (e.g., *"Quiz 2 Oct 8th and tutorial Oct 15th. Case study Oct 21 and 22."*) are automatically split into distinct academic events, each with independent reminder schedules, database records, and Notion pages.
- **Source Timestamp vs Due Date Anchoring**: Preserves `sourceMessageTimestamp` and `sourceMessageDate` (when the message was posted) separate from the event date or submission deadline. Relative dates (*"next Tuesday"*, *"tomorrow"*) anchor strictly to the message arrival timestamp.
- **Tampermonkey Floating Status Badge UX (v3.2.1)**: Unobtrusive bottom-left pill on WhatsApp Web with an interactive popover detailing live scan progress, processed items, ignored chatter, created/updated events, error reasons, and saved cursors.
- **Automated Reminders & Morning Briefing (Phase 4B)**: Server-side reminder engine evaluating upcoming exams, assignments, overdue tasks, and ambiguous deadlines with configurable intervals (7d, 3d, 1d, 3h, 1h) and daily 07:30 AM morning briefings.
- **Interactive Reviewable Data Cleanup & Backfill Reset**: Admin tools in Dashboard allowing single-click backfill reset for any group, as well as a reviewable dry-run cleanup modal for purging spam or disallowed events.
- **Deterministic Date Formatting**: Server and client rendering use deterministic formatting to ensure 100% hydration consistency between Next.js SSR and browser runtimes.

---

## WhatsApp Web Collector Setup

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
2. Open [`userscript/academic-command-center.user.js`](userscript/academic-command-center.user.js) and copy its entire contents into the Tampermonkey editor.
3. Verify the `CONFIG` section at the top of the userscript:

```javascript
const CONFIG = {
  // Local backend URL (default is http://localhost:3000)
  backendUrl: "http://localhost:3000",

  // Collector secret matching COLLECTOR_SECRET in your backend .env.local
  collectorSecret: "your-secure-collector-secret-here",

  // EXPLICIT ALLOWED GROUPS ONLY:
  // Strictly monitored WhatsApp academic groups
  allowedGroups: [
    "Machine Learning CSE-C",
    "Computer Networks CSE-C",
    "TOC 23CSE303 - CSE-C",
    "NLP 2026 batch",
    "CSE-C Announcements",
    "23CSE351 FoDS G1"
  ],

  // HISTORICAL BACKFILL BOUNDARY:
  // Messages prior to September 10, 2026 are strictly ignored
  backfillStartDate: "2026-09-10T00:00:00+05:30",

  maxScrollAttempts: 30,
  cacheSize: 500,
  scanCompleteAutoHideMs: 7000,
  debug: true
};
```
4. Save the script in Tampermonkey (**Ctrl+S** or **File → Save**).

---

### Step 3: Verify Collector on WhatsApp Web

1. Open or refresh [web.whatsapp.com](https://web.whatsapp.com).
2. Look at the bottom-left corner of the page for the floating status badge:
   - **Scanning an Allowed Group** (e.g. `CSE-C Announcements`):
     `🟡 ACC Collector: Scanning · CSE-C Announcements`
   - **Scan Complete**:
     `🟢 ACC Collector: Scan Complete · CSE-C Announcements` (displays processed count and auto-hides after 7 seconds to monitoring mode)
   - **Monitoring Active Group**:
     `🟢 ACC Collector: Monitoring · CSE-C Announcements`
   - **Viewing a Personal 1-to-1 Chat**:
     `⚪ ACC Collector: Personal Chat Ignored`
   - **Viewing an Unmonitored Group**:
     `⚪ ACC Collector: Group Not Monitored`
   - **Processing Error**:
     `🔴 ACC Collector: Scan Error · <group name>` (cursor is held safely at the last successful message)
   - **Backend Unavailable / Disconnected**:
     `🔴 ACC Collector: WhatsApp Unavailable`
3. Click the badge anytime to open the attached popover displaying live scan statistics, processed items, ignored chatter, created/updated events, and saved cursor timestamps.

---

## Cursor & Backfill Architecture

### 1. Initial Historical Backfill (Boundary: September 10, 2026)
- On first opening an allowed group, the collector scrolls up using WhatsApp Web's virtual scroller to load messages back to **September 10, 2026**.
- Messages sent prior to September 10, 2026 are strictly ignored (`IGNORED_OUT_OF_RANGE`).
- Once backfill completes, `backfillComplete: true` is saved in `collector_group_state`.

### 2. Dual Cursor Tracking (`collector_group_state`)
Every allowed group tracks two independent cursors:
- `last_scanned_message_timestamp`: Highest timestamp evaluated during scanning. Non-academic chatter, attendance notifications, advertisements, and duplicates advance this cursor.
- `last_processed_academic_message_timestamp`: Timestamp of the most recent academic event created or updated.

### 3. Resuming Without Old Message Rescans
- Reopening a backfilled group resumes directly from `lastScannedMessageTimestamp`.
- The collector **never** triggers another virtual scroll back to September 10 once `backfillComplete` is true.
- If a message processing error occurs, the cursor is held at the last successful item to allow automatic retries on the next cycle.

### 4. Admin Backfill Reset
If historical messages need to be completely rescanned for a group:
- Navigate to the **WhatsApp Collector** tab in the Dashboard.
- Click **"Reset Backfill"** for the target group (or trigger `POST /api/collector/groups/[id]/reset`).
- This resets the cursors and clears `backfillComplete`, allowing a clean backfill on the next group visit.

---

## WhatsApp Group & Announcement Detection Strategy

WhatsApp Web does not expose an explicit boolean property distinguishing group chats from 1-to-1 conversations. Furthermore, WhatsApp Community announcement channels (`CSE-C Announcements`) have restricted interfaces where only admins may post, lacking ordinary participant lists and incoming message author headers.

The Academic Command Center uses a deterministic 3-tier detection hierarchy with positive group evidence prioritization:

```
Active Chat Header & DOM Context
            ↓
[TIER 1] Positive Group & Announcement Evidence?
  - Bottom composer notice: "Only admins can send messages"
  - Header conversation action: "group info", "community info", "announcement", "channel"
  - Header / Avatar icons: [data-icon*="group"], [data-icon="community"], [data-icon="announcement"]
  - Subtitle indicators: "participants", "members", "community", comma-separated names
  - Message bubble author headers
  → YES: Classify as GROUP ✓
            ↓ NO
[TIER 2] Allowed Group Name Match?
  - Normalized chat name exactly matches one of the 6 allowed academic groups
  - Robust BiDi mark stripping (\u200E, \u200F) & Unicode dash normalization
  → YES: Classify as GROUP ✓
            ↓ NO
[TIER 3] True Personal Chat Evidence?
  - Header action: "contact info" (strictly excludes ambiguous "profile info")
  - Status subtitle: "online", "last seen...", "typing...", "recording audio..."
  - Contact avatar: "default-user"
  → YES: Classify as PERSONAL (Ignored)
            ↓ NO
[DEFAULT] Fallback for unclassified 1-to-1 conversations → PERSONAL (Ignored)
```

### Conflict Resolution Rule: Positive Group Signals Always Win
If positive group evidence or an allowed-group title match is present, it **strictly overrides** missing participant subtitles or weak indicators. For example:
- `CSE-C Announcements` with *"Only admins can send messages"* and no participant list $\rightarrow$ **`GROUP`** (Monitored).
- `Machine Learning CSE-C` with title match $\rightarrow$ **`GROUP`** (Monitored).
- `Vignesh` with *"online"* status and no group signals $\rightarrow$ **`PERSONAL`** (Ignored).
- `Weekend Friends Trip` (unallowed group) with group info button $\rightarrow$ **`GROUP_NOT_MONITORED`** (Ignored).

### Unicode BiDi & Dash Normalization
WhatsApp Web injects hidden directional formatting marks around title text (e.g. `\u200ECSE-C Announcements\u200E`) and may render dashes as Unicode en-dashes (`\u2013`) or spaced hyphens (`CSE - C`). `normalizeGroupName()` strips all invisible characters (`[\u200E\u200F\u200B-\u200D\u202A-\u202E\u2060\uFEFF]`), maps Unicode dashes to ASCII `-`, and collapses spaces around hyphens to ensure 100% reliable matching.

---

## Automated Reminders & Morning Briefing (Phase 4B)

Phase 4B provides a deterministic, server-side notification engine that reads authoritative academic events from Supabase and schedules alerts independently of the browser dashboard.

### Architecture Flow

```
Supabase (Source of Truth)
    ↓
Reminder Engine (Server-Side Interval Calculation & Pruning)
    ↓
Reminder Scheduler (Cron / Serverless Trigger / On-Demand)
    ↓
Notification Provider Abstraction (Console, Browser Push)
    ↓
User
```

### Configurable Reminder Intervals
Default alert intervals before deadlines and exam dates:
- **7 days before**
- **3 days before**
- **1 day before**
- **3 hours before**
- **1 hour before**

*Graceful Pruning:* Past intervals are automatically pruned so events added on short notice only trigger relevant upcoming notifications.

### Event Type Awareness & Priority
- **Assignments & Projects:** Primary trigger is `deadline`. Displays `"due tomorrow at 11:59 PM"` and includes `"Open Submission: [URL]"` when a form link is available.
- **Exams, Slip Tests & Quizzes:** Primary trigger is `eventDate` + `eventTime`. Displays `"[Subject] [Title] exam is tomorrow at 10:00 AM."`
- **Needs-Confirmation Events:** Emits `"Needs confirmation — deadline unclear. Please confirm the deadline."` without inventing arbitrary dates.
- **Overdue Events:** Detected when the deadline or event date has passed without completion (maximum 1 overdue alert per event per day).
- **Priority Scoring:** `URGENT` (overdue, exams within 24h, ≤3h remaining), `HIGH` (1d, 3d), `REVIEW` (needs confirmation), `NORMAL`.

### Invalidation on Postponements & Cancellations
When an exam or assignment is postponed:
1. All prior `SCHEDULED` reminders for earlier event versions are immediately marked `CANCELLED`.
2. Replacement reminders are scheduled reflecting the new target date and deadline.
3. Cancellations (`status = 'CANCELLED'`) or completions (`status = 'COMPLETED'`) cancel all future scheduled alerts.
4. Deduplication key `event_id + event_version + reminder_type + scheduled_for` ensures no duplicate alerts are delivered.

### Daily Morning Briefing
- **Default Schedule:** Daily at **07:30 AM (Asia/Kolkata)**.
- **Structured Sections:**
  1. Events due **Today**
  2. Events due **Tomorrow**
  3. **Upcoming** exams and milestones (next 7 days)
  4. Events **requiring confirmation**
  5. **Overdue** items
- **Preview Anytime:** Click **"Preview Morning Briefing"** in the Reminder Center or call `GET /api/briefing/preview`.

---

## Testing & Verification

### Run Automated Test Suite
To run all 9 automated test suites covering all phases:
```bash
npm test
```
The test runner executes:
1. **Core Self-Check** (`src/lib/self-check.ts`): Parser and state transition validation.
2. **AI Parser Tests** (`src/lib/ai/ai-parser.test.ts`): Gemini schema extraction and confidence scoring.
3. **Multi-Event Extraction** (`src/lib/ai/multi-events.test.ts`): Splitting compound messages into multiple events.
4. **Database & Notion Sync** (`src/lib/db/database-notion.test.ts`): Supabase CRUD, audit logs, and Notion mapping.
5. **Collector Unit Tests** (`src/lib/collector/collector.test.ts`): Secret authentication, rate limits, and live reporting.
6. **Group Filter & Relevance** (`src/lib/collector/group-filter.test.ts`):
   - Strict 6-group allowlist enforcement & rejection of disallowed/embedded-project groups
   - **Test 10A:** `CSE-C Announcements` with header & `"Only admins can send messages"` notice $\rightarrow$ `GROUP`
   - **Test 10B:** `CSE-C Announcements` with missing participant subtitle $\rightarrow$ `GROUP`
   - **Test 10C:** `CSE-C Announcements` without message author headers $\rightarrow$ `GROUP`
   - **Test 10D:** Standard allowed group `Machine Learning CSE-C` $\rightarrow$ `GROUP`
   - **Test 10E:** Genuine 1-to-1 personal chat `Vignesh` $\rightarrow$ `PERSONAL`
   - **Requirement 9:** Personal chat preservation (online status, contact info, last seen, default-user icon)
   - **Test 10F:** Unicode BiDi-wrapped `\u200ECSE-C Announcements\u200E` detection and canonicalization
   - **Test 10G:** Ingestion of faculty exam timetable announcements in `CSE-C Announcements`
   - **Test 10H:** Pure allowed group title match precedence (Tier 2)
   - **Test 10I:** Unicode dash and spaced hyphen variants (`CSE – C Announcements`)
   - **Test 10J:** Conflict resolution (positive announcement UI strictly wins over weak indicators)
7. **Manual Scan Engine** (`src/lib/collector/manual-scan.test.ts`): Scanning lifecycle and badge state transitions.
8. **Cursor Rescan Regression** (`src/lib/collector/cursor-rescan-regression.test.ts`): Verification that old messages are never rescanned from Sept 10.
9. **Automated Reminders & Briefing** (`src/lib/reminders/reminders.test.ts`): 30+ reminder engine, briefing, and invalidation scenarios.

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
- Authentication protection (401 on missing token, 403 on invalid secret)
- Ingestion of allowed groups (`CSE-C Announcements`, `Machine Learning CSE-C`)
- Rejection of personal chats (`PERSONAL_IGNORED`)
- Casual chatter filtering (`NON_ACADEMIC`)
- Duplicate message deduplication (`IGNORED_DUPLICATE`)
- Postponement updating existing events without duplicates
- Pre-September 10 message boundary filtering (`IGNORED_OUT_OF_RANGE`)
- Per-group registration and cursor advancement (`/api/collector/groups`)
- Scan history lifecycle tracking (`/api/collector/scans`)
- Collector health reporting (`/api/collector/status`)

### Run Live Reminder Test Script
```bash
node scripts/test-reminders.mjs
```

### Dry-Run Spam / Bad Data Cleanup
```bash
npm run cleanup:dry-run
```

---

## Project Structure

```
academic-command-center/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── briefing/
│   │   │   │   ├── preview/route.ts        # GET morning briefing preview
│   │   │   │   └── today/route.ts          # GET today's briefing
│   │   │   ├── collector/
│   │   │   │   ├── groups/route.ts         # GET / POST collector groups
│   │   │   │   ├── groups/[id]/route.ts    # GET group by id or name
│   │   │   │   ├── groups/[id]/cursor/route.ts # PATCH scan/academic cursor
│   │   │   │   ├── groups/[id]/reset/route.ts  # POST reset group backfill
│   │   │   │   ├── messages/route.ts       # Authenticated message ingestion
│   │   │   │   ├── scans/route.ts          # GET / POST 2-hour scan history
│   │   │   │   └── status/route.ts         # Collector health & aggregates
│   │   │   ├── events/
│   │   │   │   ├── route.ts                # GET / POST / DELETE academic events
│   │   │   │   ├── [id]/route.ts           # GET / PATCH / DELETE event by id
│   │   │   │   └── cleanup/route.ts        # POST reviewable bad data cleanup
│   │   │   ├── reminders/
│   │   │   │   ├── route.ts                # GET / POST reminders
│   │   │   │   ├── generate/route.ts       # POST generate reminders from events
│   │   │   │   ├── send-test/route.ts      # POST send test alert
│   │   │   │   └── settings/route.ts       # GET / PATCH reminder settings
│   │   │   ├── messages/process/route.ts   # Direct message processing pipeline
│   │   │   └── parse/route.ts              # Standalone AI parse endpoint
│   ├── components/
│   │   ├── Dashboard.tsx                   # 9-view dashboard, Collector Panel & Cleanup Modal
│   │   └── ReminderCenter.tsx              # Reminder settings, triggers & briefing preview
│   ├── lib/
│   │   ├── ai/                             # Gemini AI provider & structured schemas
│   │   ├── collector/
│   │   │   ├── allowedGroups.ts            # Strict 6-group allowlist definition
│   │   │   ├── auth.ts                     # Collector secret verification
│   │   │   ├── group-detection.ts          # 3-tier group & announcement detection
│   │   │   ├── manual-scan.ts              # Manual scan execution & cursor logic
│   │   │   ├── relevanceFilter.ts          # Fast local chatter & spam pre-filter
│   │   │   └── stats.ts                    # KPI metrics tracking
│   │   ├── db/
│   │   │   ├── academicEvents.ts           # Event store & CRUD operations
│   │   │   ├── cleanup.ts                  # Invalid/spam event cleanup engine
│   │   │   ├── collectorState.ts           # Group state, cursors & backfill reset
│   │   │   ├── rawMessages.ts              # Hash deduplication & raw message logs
│   │   │   ├── reminders.ts                # Reminder scheduling & state in DB
│   │   │   └── subjectMappings.ts          # Subject alias resolution & regex safety
│   │   ├── messages/
│   │   │   └── processor.ts                # Central pipeline (Relevance → AI → DB → Notion)
│   │   ├── notion/                         # Notion client, property mapper & sync
│   │   ├── reminders/
│   │   │   ├── notificationProvider.ts     # Console & browser push abstractions
│   │   │   ├── reminderEngine.ts           # Server-side reminder schedule calculation
│   │   │   ├── reminderScheduler.ts        # Periodic trigger & dispatch logic
│   │   │   └── reminderTypes.ts            # Reminder TypeScript definitions
│   │   ├── dateUtils.ts                    # Deterministic date & time formatters
│   │   ├── events.ts                       # Event intelligence & change tracking
│   │   ├── parser.ts                       # Multi-event & deterministic parser
│   │   └── types.ts                        # Core domain interfaces
├── supabase/
│   ├── migrations/
│   │   └── 20260927_cursor_and_source_timestamps.sql # Non-destructive schema migration
│   └── schema.sql                          # Authoritative PostgreSQL DDL
├── userscript/
│   └── academic-command-center.user.js     # Tampermonkey collector script
├── scripts/
│   ├── cleanup-events.mjs                  # CLI cleanup script (--dry-run supported)
│   ├── test-collector.mjs                  # Collector integration test suite
│   ├── test-reminders.mjs                  # Reminders API integration test suite
│   └── verify-api.mjs                      # Route verification
└── package.json
```
