/**
 * WhatsApp Web Group vs Personal Chat Detection Heuristics.
 * 
 * Strategy documentation:
 * WhatsApp Web does not provide an explicit `isGroup` boolean in its DOM, but provides
 * several reliable, multi-tiered semantic signals that distinguish group/announcement conversations
 * from 1-to-1 personal chats without modifying the DOM or clicking around.
 * 
 * TIER 1 — Strong Positive Group / Announcement Evidence:
 *   - Header Action Label: "group info", "community info", "group details", "announcement"
 *   - Icons / Avatars: [data-icon*="group"], [data-icon="community"], [data-icon="announcement"], [data-icon="channel"]
 *   - Announcement UI: Bottom composer text contains "Only admins can send messages", "Only community admins can send messages"
 *   - Participant / Member Information: "participants", "members", comma-separated participants with "you" or multiple names
 *   - Author Headers: Message bubbles render author headers above incoming messages
 * 
 * TIER 2 — Allowed-Group-Name Match:
 *   - If the normalized current chat title EXACTLY matches one of the allowed groups:
 *     (Machine Learning CSE-C, Computer Networks CSE-C, TOC 23CSE303 - CSE-C, NLP 2026 batch, CSE-C Announcements, 23CSE351 FoDS G1)
 *     -> Classify as GROUP.
 * 
 * TIER 3 — Personal-Chat Evidence:
 *   - Header Action Label: "contact info", "profile info"
 *   - Status Subtitle: "online", "last seen...", "typing...", "recording audio..."
 *   - Avatar: "default-user"
 * 
 * CONFLICT RESOLUTION:
 *   - If there is positive group evidence AND weak personal evidence, GROUP MUST WIN.
 *   - Missing group evidence is NOT the same as evidence of a personal chat.
 */

export const ALLOWED_ACADEMIC_GROUPS: readonly string[] = [
  "Machine Learning CSE-C",
  "Computer Networks CSE-C",
  "TOC 23CSE303 - CSE-C",
  "NLP 2026 batch",
  "CSE-C Announcements",
  "23CSE351 FoDS G1"
];

export interface WhatsAppChatContext {
  chatName: string | null;
  subtitleText?: string | null;
  headerIcons?: string[];
  headerActionLabel?: string | null;
  hasAuthorHeadersOnMessages?: boolean;
  composerText?: string | null;
  footerText?: string | null;
  allowedGroups?: readonly string[] | string[];
}

export function detectIsGroupChat(context: WhatsAppChatContext): boolean {
  const {
    chatName,
    subtitleText,
    headerIcons = [],
    headerActionLabel,
    hasAuthorHeadersOnMessages,
    composerText,
    footerText,
    allowedGroups = ALLOWED_ACADEMIC_GROUPS
  } = context;

  if (!chatName) return false;

  const nameNormalized = chatName.toLowerCase().replace(/\s+/g, " ").trim();
  const subtitle = (subtitleText || "").toLowerCase().trim();
  const actionLabel = (headerActionLabel || "").toLowerCase().trim();
  const composer = (composerText || footerText || "").toLowerCase().trim();
  const icons = headerIcons.map(i => i.toLowerCase().trim());

  // =========================================================================
  // TIER 1 — Strong Positive Group / Announcement Evidence
  // =========================================================================

  // 1a: Header action label / conversation info button
  const hasGroupActionLabel =
    actionLabel.includes("group info") ||
    actionLabel.includes("community info") ||
    actionLabel.includes("group details") ||
    actionLabel.includes("community details") ||
    actionLabel.includes("announcement");

  // 1b: Header icons & avatars for group/community/announcement/channel
  const hasGroupIcon = icons.some(
    i => i.includes("group") || i.includes("community") || i.includes("announcement") || i.includes("channel")
  );

  // 1c: Announcement group UI ("Only admins can send messages")
  const hasAdminOnlyComposer =
    composer.includes("only admins can send messages") ||
    composer.includes("only community admins can send messages") ||
    composer.includes("admins only");

  // 1d: Subtitle group indicators & participant information
  const hasGroupSubtitle =
    subtitle.includes("participants") ||
    subtitle.includes("members") ||
    subtitle.includes("group info") ||
    subtitle.includes("tap here for group info") ||
    subtitle.includes("click here for group info") ||
    subtitle.includes("community") ||
    subtitle.includes("announcement") ||
    (subtitle.includes(",") && (subtitle.includes("you") || subtitle.split(",").length >= 2));

  // 1e: Message bubble author headers
  const hasAuthorHeaders = hasAuthorHeadersOnMessages === true;

  if (hasGroupActionLabel || hasGroupIcon || hasAdminOnlyComposer || hasGroupSubtitle || hasAuthorHeaders) {
    return true;
  }

  // =========================================================================
  // TIER 2 — Allowed-Group-Name Match
  // If normalized title matches any configured allowed group, classify as GROUP
  // =========================================================================
  const isAllowedGroupTitle = allowedGroups.some(
    g => g.toLowerCase().replace(/\s+/g, " ").trim() === nameNormalized
  );

  if (isAllowedGroupTitle) {
    return true;
  }

  // =========================================================================
  // TIER 3 — Personal-Chat Evidence
  // Only classify as PERSONAL when there is strong personal evidence
  // =========================================================================
  const hasPersonalActionLabel =
    actionLabel.includes("contact info") || actionLabel.includes("profile info");

  const hasPersonalStatusSubtitle =
    subtitle === "online" ||
    subtitle.startsWith("last seen") ||
    subtitle === "typing..." ||
    subtitle === "recording audio...";

  const hasPersonalIcon = icons.some(
    i => i === "default-user" || i.includes("user") || i.includes("contact")
  );

  if (hasPersonalActionLabel || hasPersonalStatusSubtitle || hasPersonalIcon) {
    return false;
  }

  // Default: Non-group chat with no group signals is classified as 1-to-1 personal chat
  return false;
}
