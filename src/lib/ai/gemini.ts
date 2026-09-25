import { AIProvider, AIParseContext } from "./provider";
import { AIExtractionOutput, validateAndSanitizeAIExtraction } from "./schema";

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

  async extract(message: string, context: AIParseContext): Promise<AIExtractionOutput> {
    if (!this.isAvailable()) {
      throw new Error("GEMINI_API_KEY is not configured.");
    }

    const systemPrompt = `You are an expert academic message parser for a college student command center.
Your task is to analyze natural language messages from faculty and college WhatsApp groups and extract structured academic events.

CRITICAL RULES:
1. Output JSON strictly matching the specified fields.
2. DO NOT HALLUCINATE OR INVENT missing dates, times, subjects, or deadlines.
3. If subject is not explicitly mentioned or clearly identifiable, return null.
4. If a calendar date or deadline time is not specified in the message, return null.
5. If an assignment says "Submit this soon" or has an ambiguous deadline without a date/time, set "needsConfirmation": true and "confirmationReason": "Deadline is not specified.".
6. If the message is casual chatter (e.g., "Good morning sir", "ok", "thank you", "Happy birthday", stickers/greetings) without academic content, set "action": "NON_ACADEMIC".
7. For relative dates, compute them relative to:
   - Current Date: ${context.currentDate}
   - Current DateTime: ${context.currentDateTime}
   - Timezone: ${context.timezone}
   - "today" = ${context.currentDate}
   - "tomorrow" = calendar date + 1 day
   - "Monday" / "next Monday" = compute appropriate YYYY-MM-DD calendar date.
8. If the message updates, postpones, or cancels an existing event from the provided existing events list:
   - Set "action": "POSTPONED" | "UPDATED" | "CANCELLED"
   - Match targetEventTitle with existing item
   - Provide "changeDescription" describing what changed (e.g., "Event date changed from 2026-09-30 to 2026-10-03")
   - Do NOT duplicate the event.
9. Provide a realistic "confidence" score between 0.0 and 1.0 based on clarity and completeness.`;

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

    const validated = validateAndSanitizeAIExtraction(parsedJson);
    return validated.data;
  }
}
