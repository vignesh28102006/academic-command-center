import { Client } from "@notionhq/client";

/**
 * Server-side Notion client.
 * Credentials loaded strictly from server environment variables.
 */
let notionClient: Client | null = null;

export function isNotionConfigured(): boolean {
  const token = process.env.NOTION_TOKEN;
  const dbId = process.env.NOTION_DATABASE_ID;
  return Boolean(token && dbId && token.trim().length > 10 && dbId.trim().length > 10);
}

export function getNotionClient(): Client | null {
  if (!isNotionConfigured()) {
    return null;
  }

  if (!notionClient) {
    notionClient = new Client({
      auth: process.env.NOTION_TOKEN
    });
  }

  return notionClient;
}

export function getNotionDatabaseId(): string {
  return process.env.NOTION_DATABASE_ID || "";
}
