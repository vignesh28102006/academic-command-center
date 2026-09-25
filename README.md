# Academic Command Center

A personal college-assignment system that turns faculty/college WhatsApp messages into structured assignments, exams, submission links, announcements and reminders.

## Product direction

WhatsApp Web collector
→ academic-message filter
→ AI extraction + event matching
→ Supabase/PostgreSQL source of truth
→ Notion sync
→ phone access + desktop widget
→ optional Antigravity handoff for technical projects.

## Current MVP

This starter currently provides:
- Dashboard
- Academic item model
- Message capture textbox
- Basic local parser
- Assignment/exam/lab/project classification
- Submission/resource URL extraction
- Mark-complete workflow

It intentionally does NOT yet connect to WhatsApp, Notion, Supabase or an AI provider.

## Build order

1. Stabilize the message/event data model.
2. Add real AI extraction with strict JSON schema.
3. Add event identity + change detection:
   - new item
   - deadline changed
   - exam postponed
   - cancelled
   - submission link changed
   - requirements changed
4. Add Supabase/PostgreSQL persistence.
5. Add Notion database sync.
6. Build a Chrome/Tampermonkey collector restricted to selected WhatsApp Web groups.
7. Add reminders.
8. Add Antigravity handoff for project/code assignments.
9. Add Windows desktop mini-widget.

## Privacy rules

- Never put Notion tokens, Supabase service keys or AI API keys in the browser userscript.
- Collector should only process explicitly selected academic groups.
- Filter obvious non-academic messages locally before sending anything to an AI service.
- Store the original message for audit/change detection, but make retention configurable.
- Never auto-submit academic work without an explicit user review action.

## Run

```bash
npm install
npm run dev
```

Then open http://localhost:3000.

## Environment

Copy `.env.example` to `.env.local` later when integrations are added.
