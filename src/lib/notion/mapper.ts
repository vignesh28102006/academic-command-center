import { AcademicItem } from "../types";

/**
 * Maps an AcademicItem to Notion database properties.
 * Designed to conform to the Notion API database schema.
 */
export function mapAcademicItemToNotionProperties(item: AcademicItem): Record<string, any> {
  const properties: Record<string, any> = {
    Title: {
      title: [
        {
          text: {
            content: (item.title || "Academic Event").slice(0, 100)
          }
        }
      ]
    },
    Subject: {
      select: {
        name: (item.subject || "NEEDS_CONFIRMATION").slice(0, 50)
      }
    },
    Type: {
      select: {
        name: item.type
      }
    },
    Status: {
      select: {
        name: item.status
      }
    },
    Description: {
      rich_text: [
        {
          text: {
            content: (item.description || "").slice(0, 2000)
          }
        }
      ]
    },
    Priority: {
      select: {
        name: item.confidence === "HIGH" ? "Normal" : "Review"
      }
    },
    "Needs Confirmation": {
      checkbox: Boolean(item.needsConfirmation || item.confidence === "NEEDS_CONFIRMATION")
    },
    "Database Event ID": {
      rich_text: [
        {
          text: {
            content: item.id
          }
        }
      ]
    }
  };

  // Event Date
  if (item.eventDate && /^\d{4}-\d{2}-\d{2}$/.test(item.eventDate)) {
    properties["Event Date"] = {
      date: {
        start: item.eventDate
      }
    };
  }

  // Event Time
  if (item.eventTime) {
    properties["Event Time"] = {
      rich_text: [
        {
          text: {
            content: item.eventTime.slice(0, 50)
          }
        }
      ]
    };
  }

  // Posted Date (WhatsApp message date)
  const postedDate = item.sourceMessageDate || (item.sourceMessageTimestamp ? item.sourceMessageTimestamp.slice(0, 10) : undefined);
  if (postedDate && /^\d{4}-\d{2}-\d{2}$/.test(postedDate)) {
    properties["Posted Date"] = {
      date: {
        start: postedDate
      }
    };
  }

  // Deadline
  if (item.deadline) {
    const cleanDeadline = item.deadline.slice(0, 19);
    properties["Deadline"] = {
      date: {
        start: cleanDeadline
      }
    };

    if (item.deadline.includes("T")) {
      const timePart = item.deadline.split("T")[1]?.slice(0, 5);
      if (timePart) {
        properties["Deadline Time"] = {
          rich_text: [
            {
              text: {
                content: timePart
              }
            }
          ]
        };
      }
    }
  }

  // Submission Link (prominent URL)
  if (item.submissionUrl) {
    properties["Submission Link"] = {
      url: item.submissionUrl
    };
  }

  // Source Group
  if (item.sourceGroup) {
    properties["Source Group"] = {
      rich_text: [
        {
          text: {
            content: item.sourceGroup.slice(0, 100)
          }
        }
      ]
    };
  }

  // Updated At
  properties["Updated At"] = {
    date: {
      start: (item.updatedAt || new Date().toISOString()).slice(0, 19)
    }
  };

  return properties;
}

/**
 * Creates page content blocks (e.g. Change History callout block) for the Notion page body
 */
export function buildNotionPageBlocks(item: AcademicItem): any[] {
  const blocks: any[] = [];

  // Description block
  if (item.description) {
    blocks.push({
      object: "block",
      type: "paragraph",
      paragraph: {
        rich_text: [
          {
            type: "text",
            text: {
              content: item.description
            }
          }
        ]
      }
    });
  }

  // Submission link callout
  if (item.submissionUrl) {
    blocks.push({
      object: "block",
      type: "callout",
      callout: {
        rich_text: [
          {
            type: "text",
            text: {
              content: `🔗 Open Submission Portal: ${item.submissionUrl}`
            }
          }
        ],
        icon: {
          emoji: "🚀"
        }
      }
    });
  }

  // Change History section inside the page body
  if (item.changeHistory && item.changeHistory.length > 0) {
    blocks.push({
      object: "block",
      type: "heading_3",
      heading_3: {
        rich_text: [
          {
            type: "text",
            text: {
              content: "Audit & Change History"
            }
          }
        ]
      }
    });

    for (const change of item.changeHistory) {
      blocks.push({
        object: "block",
        type: "bulleted_list_item",
        bulleted_list_item: {
          rich_text: [
            {
              type: "text",
              text: {
                content: `[${new Date(change.timestamp).toLocaleDateString()}]: ${change.summary}`
              }
            }
          ]
        }
      });
    }
  }

  return blocks;
}
