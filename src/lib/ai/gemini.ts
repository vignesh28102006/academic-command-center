import { AIProvider, AIParseContext } from "./provider";
import {
  AIExtractionOutput,
  AIMultiEventExtractionOutput,
  validateAndSanitizeAIMultiExtraction
} from "./schema";

export interface GeminiConfig {
  apiKey?: string;
  model?: string;
}

export class GeminiProvider implements AIProvider {
  name = "gemini";
  private apiKey: string;
  private model: string;

  constructor(config?: GeminiConfig) {
    this.apiKey = config?.apiKey || process.env.GEMINI_API_KEY || "";
    this.model = config?.model || process.env.GEMINI_MODEL || "gemini-1.5-flash";
  }

  isAvailable(): boolean {
    return Boolean(this.apiKey && this.apiKey.trim().length > 5);
  }

  async extract(message: string, context: AIParseContext): Promise<AIMultiEventExtractionOutput> {
    if (!this.isAvailable()) {
      throw new Error("GEMINI_API_KEY is not configured.");
    }

    const systemPrompt = `You are an expert academic message parser for a college student command center.
Your task is to analyze natural language messages from faculty and college WhatsApp groups and extract structured academic events.

CRITICAL RULES:
1. Output JSON strictly matching the envelope schema:
   {
     "events": [
       {
         "action": "CREATED" | "UPDATED" | "CANCELLED" | "POSTPONED" | "IGNORED_DUPLICATE" | "NON_ACADEMIC" | "NEEDS_CONFIRMATION",
         "type": "ASSIGNMENT" | "EXAM" | "SLIP_TEST" | "QUIZ" | "LAB" | "PROJECT" | "PRESENTATION" | "COURSE" | "ANNOUNCEMENT" | "OTHER",
         "title": string | null,
         "subject": string | null,
         "eventDate": "YYYY-MM-DD" | null,
         "eventTime": string | null,
         "deadline": string | null,
         "deadlineTime": string | null,
         "submissionUrl": string | null,
         "resourceUrls": string[],
         "attachmentNames": string[],
         "description": string | null,
         "requirements": string[],
         "changeDescription": string | null,
         "targetEventTitle": string | null,
         "confidence": number,
         "needsConfirmation": boolean,
         "confirmationReason": string | null
       }
     ]
   }
2. MULTIPLE EVENTS / MULTIPLE DATES HANDLING:
   - If a message contains multiple academic events or multiple dates (e.g. "Exams are next Tuesday and next Thursday", "OS exam next Tuesday and DBMS exam next Thursday", "Internal exams next Tuesday, Thursday and Saturday", "Lab exams are on Tuesday at 10 AM and Thursday at 2 PM"):
     - You MUST output an array in "events" containing one entry for EACH event occurrence.
     - DO NOT merge them into one event with an ambiguous date.
     - DO NOT discard any date.
     - If the title or subject is shared (e.g. "Exams are next Tuesday and next Thursday"), preserve the shared title context across all occurrences while keeping the dates separate (e.g. "Exam — Tuesday", "Exam — Thursday").
     - If different subjects or tasks are mentioned (e.g. "Quiz 2 on Monday and Assignment 3 due Wednesday"), generate separate events for each subject/task.
   - For a single-event message, simply output an "events" array containing 1 event item.
3. RELATIVE DATE RESOLUTION:
   - For relative dates, compute concrete YYYY-MM-DD calendar dates strictly relative to:
     - Current Date: ${context.currentDate}
     - Current DateTime: ${context.currentDateTime}
     - Timezone: ${context.timezone}
   - DO NOT guess or hallucinate the current date.
   - "today" = ${context.currentDate}
   - "tomorrow" = calendar date + 1 day
   - "Monday" / "next Monday" / "next Tuesday" / "next Thursday" = compute exact YYYY-MM-DD calendar date.
4. DO NOT HALLUCINATE OR INVENT missing dates, times, subjects, or deadlines.
5. If subject is not explicitly mentioned or clearly identifiable, return null.
6. If a calendar date or deadline time is not specified in the message, return null.
7. If an assignment says "Submit this soon" or has an ambiguous deadline without a date/time, set "needsConfirmation": true and "confirmationReason": "Deadline is not specified.".
8. If the message is casual chatter (e.g. "Good morning sir", "ok", "thank you", "Happy birthday", stickers/greetings) without academic content, set "action": "NON_ACADEMIC".
9. If the message updates, postpones, or cancels an existing event from the provided existing events list:
   - Set "action": "POSTPONED" | "UPDATED" | "CANCELLED"
   - Match targetEventTitle with existing item
   - Provide "changeDescription" describing what changed (e.g., "Event date changed from 2026-09-30 to 2026-10-03")
   - Do NOT duplicate the event.
10. Provide a realistic "confidence" score between 0.0 and 1.0 based on clarity and completeness.`;

    const userPrompt = JSON.stringify({
      context: {
        currentDate: context.currentDate,
        currentDateTime: context.currentDateTime,
        timezone: context.timezone,
        sourceGroup: context.sourceGroup ?? null,
        sourceSender: context.sourceSender ?? null,
        existingEvents: context.existingEvents ?? []
      },
      message: message.trim()
    });

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: systemPrompt }]
        },
        contents: [
          {
            role: "user",
            parts: [{ text: userPrompt }]
          }
        ],
        generationConfig: {
          response_mime_type: "application/json",
          temperature: 0.1
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(`Gemini API error (${response.status}): ${errorText.slice(0, 200)}`);
    }

    const data = await response.json();
    const candidateText = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!candidateText) {
      throw new Error("Gemini returned empty candidate response.");
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(candidateText);
    } catch {
      throw new Error("Failed to parse Gemini candidate text as JSON.");
    }

    const validated = validateAndSanitizeAIMultiExtraction(parsedJson);
    return validated.data;
  }
}
