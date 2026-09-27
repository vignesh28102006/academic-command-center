import {
  AIExtractionOutput,
  AIMultiEventExtractionOutput,
  validateAndSanitizeAIExtraction,
  validateAndSanitizeAIMultiExtraction
} from "./schema";
import { parseAcademicMessage, parseMultipleAcademicMessages, isNonAcademicMessage } from "../parser";
import { formatCalendarDate } from "../dateUtils";

export interface ExistingEventSummary {
  id: string;
  title: string;
  subject: string;
  type: string;
  eventDate?: string;
  eventTime?: string;
  deadline?: string;
  submissionUrl?: string;
  status: string;
}

export interface AIParseContext {
  currentDate: string; // YYYY-MM-DD
  currentDateTime: string; // ISO string with timezone offset
  timezone: string; // e.g. "Asia/Kolkata"
  sourceGroup?: string;
  sourceSender?: string;
  sourceMessageTimestamp?: string;
  sourceMessageDate?: string;
  existingEvents?: ExistingEventSummary[];
}

export interface AIProvider {
  name: string;
  isAvailable(): boolean;
  extract(message: string, context: AIParseContext): Promise<AIMultiEventExtractionOutput | AIExtractionOutput>;
}

/**
 * Fallback parser using Phase 1 deterministic engine if AI provider is not configured or errors out.
 * Supports multiple events / multiple dates per message.
 */
export class DeterministicFallbackProvider implements AIProvider {
  name = "deterministic-fallback";

  isAvailable(): boolean {
    return true;
  }

  async extract(message: string, context: AIParseContext): Promise<AIMultiEventExtractionOutput> {
    const trimmed = message.trim();

    // Check non-academic
    if (isNonAcademicMessage(trimmed)) {
      return {
        events: [
          {
            action: "NON_ACADEMIC",
            type: "OTHER",
            title: null,
            subject: null,
            eventDate: null,
            eventTime: null,
            deadline: null,
            deadlineTime: null,
            submissionUrl: null,
            resourceUrls: [],
            attachmentNames: [],
            description: trimmed,
            requirements: [],
            changeDescription: null,
            targetEventTitle: null,
            confidence: 0.95,
            needsConfirmation: false,
            confirmationReason: null
          }
        ]
      };
    }

    // Relative dates anchor on sourceMessageTimestamp when available, falling back to currentDateTime
    const refDate = context.sourceMessageTimestamp
      ? new Date(context.sourceMessageTimestamp)
      : new Date(context.currentDateTime);
    const validRefDate = isNaN(refDate.getTime()) ? new Date() : refDate;

    const parsedList = parseMultipleAcademicMessages(trimmed, {
      sourceGroup: context.sourceGroup,
      sourceSender: context.sourceSender,
      referenceDate: validRefDate
    });

    const events: AIExtractionOutput[] = parsedList.map(parsed => {
      let action: AIExtractionOutput["action"] = "CREATED";
      let changeDesc: string | null = null;
      let targetTitle: string | null = null;

      if (parsed.modificationIntent.isModification) {
        if (parsed.modificationIntent.type === "POSTPONEMENT") {
          action = "POSTPONED";
        } else if (parsed.modificationIntent.type === "CANCELLATION") {
          action = "CANCELLED";
        } else {
          action = "UPDATED";
        }
        changeDesc = parsed.modificationIntent.summary ?? null;
        targetTitle = parsed.modificationIntent.targetTitleSnippet ?? null;
      }

      // Check ambiguous message like "Submit this soon.", "Please submit project soon."
      const isAmbiguous = /\b(submit\s+[^.!?]*\bsoon|do\s+it\s+quickly)\b/i.test(trimmed) && !parsed.deadline && !parsed.eventDate;
      const needsConfirmation = isAmbiguous || parsed.subject === "NEEDS_CONFIRMATION" || parsed.confidence === "NEEDS_CONFIRMATION";
      const confirmationReason = isAmbiguous
        ? "Deadline is not specified."
        : parsed.subject === "NEEDS_CONFIRMATION"
          ? "Subject could not be determined with confidence."
          : null;

      const confidence = isAmbiguous
        ? 0.55
        : parsed.confidence === "HIGH"
          ? 0.92
          : parsed.confidence === "MEDIUM"
            ? 0.78
            : 0.65;

      return {
        action,
        type: parsed.type,
        title: parsed.title,
        subject: parsed.subject === "NEEDS_CONFIRMATION" ? null : parsed.subject,
        eventDate: parsed.modificationIntent.newDate ?? parsed.eventDate ?? null,
        eventTime: parsed.modificationIntent.newTime ?? parsed.eventTime ?? null,
        deadline: parsed.deadline ?? null,
        deadlineTime: parsed.eventTime ?? null,
        submissionUrl: parsed.submissionUrl ?? null,
        resourceUrls: parsed.resourceUrls,
        attachmentNames: parsed.attachmentNames,
        description: parsed.description,
        requirements: [],
        changeDescription: changeDesc,
        targetEventTitle: targetTitle,
        confidence,
        needsConfirmation,
        confirmationReason
      };
    });

    return { events };
  }
}

/**
 * Registry of available providers
 */
let registeredGeminiProvider: AIProvider | null = null;

export function registerGeminiProvider(provider: AIProvider) {
  registeredGeminiProvider = provider;
}

export function getActiveAIProvider(): AIProvider {
  if (registeredGeminiProvider && registeredGeminiProvider.isAvailable()) {
    return registeredGeminiProvider;
  }
  return new DeterministicFallbackProvider();
}

export interface AIParseResult {
  extraction: AIExtractionOutput;
  extractions: AIExtractionOutput[];
  providerUsed: string;
  fallbackOccurred: boolean;
  rawAIResponse?: string;
}

/**
 * Main application interface for parsing academic messages with AI.
 * The rest of the application calls this rather than directly calling Gemini.
 */
export async function parseAcademicMessageWithAI(
  message: string,
  context: AIParseContext,
  customProvider?: AIProvider
): Promise<AIParseResult> {
  const provider = customProvider ?? getActiveAIProvider();
  let fallbackOccurred = false;
  let providerUsed = provider.name;

  try {
    const rawResult = await provider.extract(message, context);
    const validated = validateAndSanitizeAIMultiExtraction(rawResult);
    return {
      extraction: validated.data.events[0],
      extractions: validated.data.events,
      providerUsed,
      fallbackOccurred
    };
  } catch (err) {
    // If external AI provider fails, safely fall back to deterministic parser
    if (provider.name !== "deterministic-fallback") {
      const fallbackProvider = new DeterministicFallbackProvider();
      const fallbackResult = await fallbackProvider.extract(message, context);
      const validated = validateAndSanitizeAIMultiExtraction(fallbackResult);
      return {
        extraction: validated.data.events[0],
        extractions: validated.data.events,
        providerUsed: fallbackProvider.name,
        fallbackOccurred: true
      };
    }
    throw err;
  }
}
