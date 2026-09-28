/**
 * Academic Command Center - Academic Relevance & Pre-AI Filtering Engine.
 * 
 * Strict Relevance Gates:
 * 1. Categorizes messages into:
 *    - ACADEMIC_EVENT
 *    - ACADEMIC_ANNOUNCEMENT
 *    - ACADEMIC_RESOURCE
 *    - ACADEMIC_CHANGE
 *    - NON_ACADEMIC
 *    - CHATTER
 *    - PROMOTIONAL
 *    - ATTENDANCE_ONLY
 *    - UNKNOWN
 * 
 * 2. Only ACADEMIC_EVENT, ACADEMIC_ANNOUNCEMENT, and ACADEMIC_CHANGE proceed
 *    to the Gemini AI / Event Intelligence Engine.
 * 3. NON_ACADEMIC, CHATTER, PROMOTIONAL, and ATTENDANCE_ONLY are dropped.
 * 4. A URL alone does NOT make a message academic.
 * 5. Attendance-only messages (e.g. "Attendance will be taken tomorrow") are dropped,
 *    UNLESS the message also contains an academic event (e.g. "DBMS Assignment 3 is due...").
 */

export type MessageRelevanceClass =
  | "ACADEMIC_EVENT"
  | "ACADEMIC_ANNOUNCEMENT"
  | "ACADEMIC_RESOURCE"
  | "ACADEMIC_CHANGE"
  | "NON_ACADEMIC"
  | "CHATTER"
  | "PROMOTIONAL"
  | "ATTENDANCE_ONLY"
  | "UNKNOWN";

export interface RelevanceFilterResult {
  category: MessageRelevanceClass;
  shouldProcess: boolean;
  reason: string;
  cleanedText?: string;
}

// Strong academic event signals
const ACADEMIC_EVENT_SIGNALS = [
  /\b(assignment|assignments)\b/i,
  /\b(submit|submission|submitting|submitted)\b/i,
  /\b(deadline|due\s+date|due\s+by|due\s+on|due\s+tomorrow|due\s+today|due\s+at)\b/i,
  /\b(exam|exams|examination|examinations)\b/i,
  /\b(internal|internals|end\s*sem|end\s*semester|mid\s*term|midterm)\b/i,
  /\b(slip\s*test\d*|unit\s*test\d*|cat[- ]?\d+)\b/i,
  /\b(quiz\d*|quizzes)\b/i,
  /\b(lab\d*|laboratory|practical|practicals|viva|viva\s*voce)\b/i,
  /\b(project|projects|mini\s*project|capstone)\b/i,
  /\b(presentation|seminar|slides|ppt)\b/i,
  /\b(certification|course|assessment|test)\b/i,
  /\b(postponed|rescheduled|extended|scheduled|cancelled|canceled)\b/i,
  /\b(forms\.gle|classroom\.google\.com|moodle|submission\s*link)\b/i,
  /\b(announcement|announcements|notice|circular)\b/i,
  /\b(schedule|schedules|timetable|time\s*table)\b/i,
  /\b(mid\s*sem|midsem)\b/i,
  /\b(lecture|lectures|tutorial|tutorials|class|classes|session|sessions)\b/i,
  /\b(workshop|webinar|conference|symposium)\b/i,
  /\b(syllabus|curriculum|module\d*|unit\d*)\b/i,
  /\b(hall\s*ticket|hall\s*\d+|room\s*\d+|audi\s*\d+)\b/i,
  /\b(toc|nlp|ml|cn|fods|cse[- ]?c|cse)\b/i
];

// Promotional / Advertisement indicators
const PROMOTIONAL_PATTERNS = [
  // Price / EMI / Interest offers (e.g. "Your Land. Your Legacy. Now with 0% Interest EMI...")
  /\b(0%\s*(?:interest|emi)|zero\s*%?\s*interest)\b/i,
  /\b(?:emi|down\s*payment|monthly\s*installments?)\b/i,
  /\b(?:plots?\s+for\s+sale|villas?\s+for\s+sale|flats?\s+for\s+sale|apartments?\s+for\s+sale)\b/i,
  /\b(?:real\s*estate|gated\s*community|open\s*plots?|acres?\s+of\s+land)\b/i,
  /\b(?:your\s+land\b.*?\byour\s+legacy\b|commercial\s+space\s+for\s+sale)\b/i,
  // Commercial marketing slogans & sales pitches
  /\b(?:exclusive\s*offer|limited\s*period\s*offer|special\s*discount|discount\s*\d+%)\b/i,
  /\b(?:enquire\s*(?:now|today)|contact\s*us|call\s*us\s+at|visit\s*our\s*(?:site|store|office))\b/i,
  /\b(?:book\s*your\s*(?:site\s*visit|flat|plot|slot|free\s*demo))\b/i,
  /\b(?:cashback|coupon\s*code|invest\s*now|guaranteed\s*returns?)\b/i,
  /\b(?:residential\s*plots?|commercial\s*properties?|luxury\s*living)\b/i
];

// Pure attendance statements without assignments or exams
const ATTENDANCE_PATTERNS = [
  /\battendance\s+(?:will\s+be\s+taken|percentage|shortage|today|update|list|shortage\s+list|rules?|criteria)\b/i,
  /\bstudents?\s+with\s+low\s+attendance\b/i,
  /\b(?:mark|record)\s+your\s+attendance\b/i,
  /\btoday'?s?\s+attendance\s+is\s+\d+%\b/i,
  /\battendance\s+shortage\b/i,
  /\battendance\s+is\s+mandatory\b/i
];

// Greetings and social chatter
const CHATTER_PATTERNS = [
  /^(?:hi|hello|hey|ok|okay|k|noted|yes|sure|fine|cool|thanks|thank\s*you|thx)(?:\s+(?:sir|mam|ma'am|all|team|very\s*much))?[\s.!👍🙏]*$/i,
  /^(?:good\s+(?:morning|afternoon|evening|night)|gm|ge|gn)(?:\s+(?:sir|mam|ma'am|all|everyone))?[\s.!🙏]*(?:thanks|thank\s*you(?:\s+(?:very\s*much|all|sir|mam))?)?[\s.!🙏]*$/i,
  /^(?:happy\s+(?:birthday|diwali|pongal|new\s*year|holi|eid|teachers?'?\s*day)|hbd)\b/i,
  /^congratulations?(?:\s+(?:all|team|sir))?[\s.!🎉👏]*$/i,
  /^[👍🙏🎉❤️👏😂👌🔥\s]+$/
];

/**
 * Checks if a message contains strong academic event signals.
 */
export function hasAcademicSignal(text: string): boolean {
  return ACADEMIC_EVENT_SIGNALS.some(pattern => pattern.test(text));
}

/**
 * Checks if a message is an advertisement or commercial promotion.
 */
export function isPromotionalMessage(text: string): boolean {
  return PROMOTIONAL_PATTERNS.some(pattern => pattern.test(text));
}

/**
 * Checks if a message is purely about attendance.
 */
export function isPureAttendanceMessage(text: string): boolean {
  const mentionsAttendance = ATTENDANCE_PATTERNS.some(pattern => pattern.test(text));
  if (!mentionsAttendance) return false;

  // If it ALSO contains an actual academic event/exam/assignment/deadline, it is NOT attendance-only!
  const hasAcademicEvent = /\b(assignment\d*|submit|deadline|due|exam|slip\s*test|quiz|lab|project|presentation|test)\b/i.test(text);
  return !hasAcademicEvent;
}

/**
 * Checks if a message is casual chatter / greetings.
 */
export function isChatterMessage(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 3) return true;
  return CHATTER_PATTERNS.some(pattern => pattern.test(trimmed));
}

/**
 * Classifies a WhatsApp message according to the strict Academic Command Center relevance gates.
 */
export function classifyAcademicMessage(text: string): RelevanceFilterResult {
  const trimmed = text.trim();

  if (!trimmed) {
    return {
      category: "NON_ACADEMIC",
      shouldProcess: false,
      reason: "Empty message text."
    };
  }

  // 1. Promotional / Advertisement Gate
  if (isPromotionalMessage(trimmed)) {
    return {
      category: "PROMOTIONAL",
      shouldProcess: false,
      reason: "Message classified as commercial advertisement, promotion, or real-estate spam."
    };
  }

  // 2. Chatter / Social Greeting Gate
  if (isChatterMessage(trimmed)) {
    return {
      category: "CHATTER",
      shouldProcess: false,
      reason: "Message classified as casual social chatter or greeting."
    };
  }

  // 3. Pure Attendance Gate (reject unless mixed with academic event)
  if (isPureAttendanceMessage(trimmed)) {
    return {
      category: "ATTENDANCE_ONLY",
      shouldProcess: false,
      reason: "Message contains attendance announcement/status without an academic deadline or exam."
    };
  }

  // 4. URL Check: A URL alone does NOT make a message academic!
  const hasUrl = /https?:\/\/[^\s)\]]+/i.test(trimmed);
  const hasAcademic = hasAcademicSignal(trimmed);

  if (hasUrl && !hasAcademic) {
    // Check if the URL is an academic tool like classroom, moodle, or forms.gle with academic intent
    const isAcademicUrl = /(?:classroom\.google\.com|forms\.gle|moodle|drive\.google\.com)/i.test(trimmed);
    if (!isAcademicUrl && trimmed.length < 50) {
      return {
        category: "NON_ACADEMIC",
        shouldProcess: false,
        reason: "Message contains a URL without any academic context or assignment signals."
      };
    }
  }

  // 5. Academic Modification / Postponement Gate
  if (/\b(postponed|rescheduled|cancelled|canceled|extended|new\s+schedule)\b/i.test(trimmed) && hasAcademic) {
    return {
      category: "ACADEMIC_CHANGE",
      shouldProcess: true,
      reason: "Message communicates an academic change, postponement, or rescheduling."
    };
  }

  // 6. Strong Academic Event Signals (assignments, exams, tests, quizzes, projects)
  if (hasAcademic) {
    const isEvent = /\b(due|deadline|tomorrow|today|on\s+[a-z]+|at\s+\d+|scheduled|conducted|submit\b|exam|test|quiz|lab|class|session|lecture|workshop|tutorial)\b/i.test(trimmed);
    if (isEvent) {
      return {
        category: "ACADEMIC_EVENT",
        shouldProcess: true,
        reason: "Message contains an actionable academic event with deadline or date signals."
      };
    }

    return {
      category: "ACADEMIC_ANNOUNCEMENT",
      shouldProcess: true,
      reason: "Message contains an academic announcement from course faculty."
    };
  }

  // 7. Academic Resource (e.g. "Here are the notes for Module 2: link")
  if (/\b(notes|syllabus|slm|textbook|reference|material|slides|drive\.google\.com)\b/i.test(trimmed)) {
    return {
      category: "ACADEMIC_RESOURCE",
      shouldProcess: false, // Stored as resource if needed, but not automatically an event/deadline
      reason: "Message contains academic study material/resource without a deadline."
    };
  }

  // 8. If none of the academic signals matched
  return {
    category: "NON_ACADEMIC",
    shouldProcess: false,
    reason: "Message lacks academic signals, deadline, or actionable course tasks."
  };
}
