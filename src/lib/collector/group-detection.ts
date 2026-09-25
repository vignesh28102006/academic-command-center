/**
 * WhatsApp Web Group vs Personal Chat Detection Heuristics.
 * 
 * Strategy documentation:
 * WhatsApp Web does not provide an explicit `isGroup` boolean in its DOM, but provides
 * several reliable, multi-tiered semantic signals that distinguish group conversations
 * from 1-to-1 personal chats without modifying the DOM or clicking around.
 * 
 * Tier 1: Header Subtitle / Participant Information
 *   - Groups: Subtitle displays comma-separated members ("Alice, Bob, Charlie, You" or "You, +91 98765..."),
 *     member count ("52 participants", "14 members"), or group info prompts ("click here for group info", "community", "announcement").
 *   - Personal: Subtitle displays "online", "last seen [date/time]...", "typing...", a standalone phone number without commas, or is empty.
 * 
 * Tier 2: Avatar & Profile Icons
 *   - Groups: Header or avatar contains [data-icon*="group"], [data-testid*="group"], [data-icon="community"],
 *     [data-testid="community"], [data-icon="announcement"], or aria-label containing "group" or "community".
 *   - Personal: Header avatar contains [data-icon="default-user"], [data-testid="default-user"].
 * 
 * Tier 3: Header Click Target / Action Label
 *   - Groups: Header conversation info button has aria-label / title containing "group info" or "community info".
 *   - Personal: Header conversation info button has aria-label / title containing "contact info" or "profile".
 * 
 * Tier 4: Message Bubble Author Headers
 *   - Groups: Incoming message bubbles render sender author names above each message (e.g. span[data-testid="author"],
 *     span[dir="auto"]._ahk_ / ._al4b).
 *   - Personal: Incoming message bubbles NEVER render an author name header above individual message bubbles.
 */

export interface WhatsAppChatContext {
  chatName: string | null;
  subtitleText?: string | null;
  headerIcons?: string[];
  headerActionLabel?: string | null;
  hasAuthorHeadersOnMessages?: boolean;
}

export function detectIsGroupChat(context: WhatsAppChatContext): boolean {
  const {
    chatName,
    subtitleText,
    headerIcons = [],
    headerActionLabel,
    hasAuthorHeadersOnMessages
  } = context;

  if (!chatName) return false;

  const subtitle = (subtitleText || "").toLowerCase().trim();
  const actionLabel = (headerActionLabel || "").toLowerCase().trim();

  // Tier 1: Check Header Action Label / Title (most direct semantic signal)
  if (actionLabel.includes("group info") || actionLabel.includes("community info") || actionLabel.includes("group details")) {
    return true;
  }
  if (actionLabel.includes("contact info") || actionLabel.includes("profile info")) {
    return false;
  }

  // Tier 2: Check Header Icons & Avatars
  for (const icon of headerIcons) {
    const lowerIcon = icon.toLowerCase();
    if (
      lowerIcon.includes("group") ||
      lowerIcon.includes("community") ||
      lowerIcon.includes("announcement")
    ) {
      return true;
    }
    if (lowerIcon.includes("user") || lowerIcon.includes("contact")) {
      return false;
    }
  }

  // Tier 3: Check Subtitle / Participant Information
  if (subtitle) {
    // Explicit negative check: Personal status indicators
    if (
      subtitle === "online" ||
      subtitle.startsWith("last seen") ||
      subtitle === "typing..." ||
      subtitle === "recording audio..."
    ) {
      return false;
    }

    // Explicit positive check: Group indicators
    if (
      subtitle.includes("participants") ||
      subtitle.includes("members") ||
      subtitle.includes("group info") ||
      subtitle.includes("tap here for group info") ||
      subtitle.includes("click here for group info") ||
      subtitle.includes("community") ||
      subtitle.includes("announcement")
    ) {
      return true;
    }

    // Participant list format: "Alice, Bob, You..." or contains commas with names
    if (subtitle.includes(",") && (subtitle.includes("you") || subtitle.split(",").length >= 2)) {
      return true;
    }
  }

  // Tier 4: Message Bubble Author Headers
  // In WhatsApp Web, group chats always display author headers above messages from others
  if (hasAuthorHeadersOnMessages === true) {
    return true;
  }
  if (hasAuthorHeadersOnMessages === false && subtitle) {
    return false;
  }

  // Fallback: If subtitle has no personal indicators and message bubbles contain author headers
  return false;
}
