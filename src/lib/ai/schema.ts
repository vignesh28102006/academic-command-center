import { z } from "zod";
import { AcademicType } from "../types";

export const AIAcademicTypeSchema = z.enum([
  "ASSIGNMENT",
  "EXAM",
  "SLIP_TEST",
  "QUIZ",
  "LAB",
  "PROJECT",
  "PRESENTATION",
  "COURSE",
  "ANNOUNCEMENT",
  "OTHER"
]);

export const AIActionSchema = z.enum([
  "CREATED",
  "UPDATED",
  "CANCELLED",
  "POSTPONED",
  "IGNORED_DUPLICATE",
  "NON_ACADEMIC",
  "NEEDS_CONFIRMATION"
]);

export type AIAcademicType = z.infer<typeof AIAcademicTypeSchema>;
export type AIAction = z.infer<typeof AIActionSchema>;

/**
 * Strict schema for the AI extraction response.
 * Sanitizes and validates every field to guarantee safety before reaching the event engine.
 */
export const AIExtractionOutputSchema = z.object({
  action: AIActionSchema.default("CREATED"),
  type: AIAcademicTypeSchema.default("OTHER"),
  title: z.string().trim().max(120).nullable().default(null),
  subject: z.string().trim().max(60).nullable().default(null),

  // Date and time fields
  eventDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD")
    .nullable()
    .default(null),
  eventTime: z.string().trim().max(50).nullable().default(null),

  deadline: z
    .string()
    .max(50)
    .nullable()
    .default(null),
  deadlineTime: z.string().trim().max(50).nullable().default(null),

  // Links and resources
  submissionUrl: z
    .string()
    .url()
    .max(500)
    .nullable()
    .default(null)
    .catch(null),
  resourceUrls: z
    .array(z.string().url().max(500).catch(""))
    .transform(urls => urls.filter(u => u.length > 0))
    .default([]),
  attachmentNames: z
    .array(z.string().trim().max(150))
    .default([]),

  // Content
  description: z.string().trim().max(2000).nullable().default(null),
  requirements: z.array(z.string().trim().max(300)).default([]),
  changeDescription: z.string().trim().max(500).nullable().default(null),

  // Target event hint for updates
  targetEventTitle: z.string().trim().max(120).nullable().default(null),

  // Confidence & Confirmation
  confidence: z
    .number()
    .min(0)
    .max(1)
    .default(0.8),
  needsConfirmation: z.boolean().default(false),
  confirmationReason: z.string().trim().max(300).nullable().default(null)
});

export type AIExtractionOutput = z.infer<typeof AIExtractionOutputSchema>;

/**
 * Configurable confidence thresholds
 */
export const CONFIDENCE_THRESHOLDS = {
  HIGH: 0.90,
  MEDIUM: 0.70
} as const;

export function evaluateConfidence(
  confidence: number,
  needsConfirmationExplicit: boolean
): "HIGH" | "MEDIUM" | "NEEDS_CONFIRMATION" {
  if (needsConfirmationExplicit || confidence < CONFIDENCE_THRESHOLDS.MEDIUM) {
    return "NEEDS_CONFIRMATION";
  }
  if (confidence >= CONFIDENCE_THRESHOLDS.HIGH) {
    return "HIGH";
  }
  return "MEDIUM";
}

/**
 * Validate and sanitize raw JSON output from the AI model
 */
export function validateAndSanitizeAIExtraction(raw: unknown): {
  success: boolean;
  data: AIExtractionOutput;
  errors?: string[];
} {
  const result = AIExtractionOutputSchema.safeParse(raw);
  if (result.success) {
    return {
      success: true,
      data: result.data
    };
  }

  // If parsing fails, extract error details
  const issues = result.error.issues || [];
  const errorMessages = issues.map(
    err => `${err.path.join(".")}: ${err.message}`
  );

  // Return a safe fallback with needsConfirmation set
  return {
    success: false,
    data: {
      action: "NEEDS_CONFIRMATION",
      type: "OTHER",
      title: "Unparsed Academic Item",
      subject: "NEEDS_CONFIRMATION",
      eventDate: null,
      eventTime: null,
      deadline: null,
      deadlineTime: null,
      submissionUrl: null,
      resourceUrls: [],
      attachmentNames: [],
      description: typeof raw === "string" ? raw : "Could not safely validate AI output.",
      requirements: [],
      changeDescription: null,
      targetEventTitle: null,
      confidence: 0.2,
      needsConfirmation: true,
      confirmationReason: `Schema validation failed: ${errorMessages.slice(0, 2).join("; ")}`
    },
    errors: errorMessages
  };
}
