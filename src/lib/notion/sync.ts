import { getNotionClient, getNotionDatabaseId, isNotionConfigured } from "./client";
import { mapAcademicItemToNotionProperties, buildNotionPageBlocks } from "./mapper";
import { AcademicItem, ChangeRecord } from "../types";
import { updateEventNotionPageId } from "../db/academicEvents";

export interface NotionSyncResult {
  notionPageId?: string;
  status: "CREATED" | "UPDATED" | "SKIPPED" | "FAILED";
  error?: string;
}

export async function syncEventToNotion(
  event: AcademicItem,
  newChanges?: ChangeRecord[]
): Promise<NotionSyncResult> {
  if (!isNotionConfigured()) {
    return {
      status: "SKIPPED",
      error: "Notion credentials (NOTION_TOKEN / NOTION_DATABASE_ID) are not configured."
    };
  }

  const notion = getNotionClient();
  const databaseId = getNotionDatabaseId();

  if (!notion || !databaseId) {
    return {
      status: "SKIPPED",
      error: "Notion client could not be instantiated."
    };
  }

  try {
    const properties = mapAcademicItemToNotionProperties(event);
    let targetPageId = event.notionPageId;

    // 1. If notionPageId is not yet known on the event, query the database by Database Event ID
    if (!targetPageId) {
      let results: any[] = [];
      if (typeof (notion as any).databases?.query === "function") {
        const response = await (notion as any).databases.query({
          database_id: databaseId,
          filter: {
            property: "Database Event ID",
            rich_text: {
              equals: event.id
            }
          },
          page_size: 1
        });
        results = response.results || [];
      } else if (typeof (notion as any).request === "function") {
        const response: any = await (notion as any).request({
          path: `databases/${databaseId}/query`,
          method: "post",
          body: {
            filter: {
              property: "Database Event ID",
              rich_text: {
                equals: event.id
              }
            },
            page_size: 1
          }
        });
        results = response.results || [];
      }

      if (results && results.length > 0) {
        targetPageId = results[0].id;
      }
    }

    // 2. Update existing page if found
    if (targetPageId) {
      await notion.pages.update({
        page_id: targetPageId,
        properties: properties as any
      });

      // If new changes occurred, append change record to page body
      if (newChanges && newChanges.length > 0) {
        const changeBlocks = newChanges.map(c => ({
          object: "block",
          type: "bulleted_list_item",
          bulleted_list_item: {
            rich_text: [
              {
                type: "text",
                text: {
                  content: `🔄 [${new Date(c.timestamp).toLocaleDateString()}]: ${c.summary}`
                }
              }
            ]
          }
        }));

        await notion.blocks.children.append({
          block_id: targetPageId,
          children: changeBlocks as any
        }).catch(err => {
          console.warn("Could not append change blocks to Notion page:", err?.message);
        });
      }

      await updateEventNotionPageId(event.id, targetPageId);

      return {
        notionPageId: targetPageId,
        status: "UPDATED"
      };
    }

    // 3. Create new page in Notion database
    const blocks = buildNotionPageBlocks(event);
    const newPage = await notion.pages.create({
      parent: {
        database_id: databaseId
      },
      properties: properties as any,
      children: blocks as any
    });

    const createdPageId = newPage.id;
    await updateEventNotionPageId(event.id, createdPageId);

    return {
      notionPageId: createdPageId,
      status: "CREATED"
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("Notion synchronization error:", errorMsg);
    return {
      status: "FAILED",
      error: errorMsg
    };
  }
}
