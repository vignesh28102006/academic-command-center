import { NextResponse } from "next/server";

export function verifyCollectorAuth(request: Request): {
  authorized: boolean;
  response?: NextResponse;
} {
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return {
      authorized: false,
      response: NextResponse.json(
        { error: "Missing or malformed Authorization header. Expected 'Bearer <COLLECTOR_SECRET>'." },
        { status: 401 }
      )
    };
  }

  const providedSecret = authHeader.slice(7).trim();
  const serverSecret = process.env.COLLECTOR_SECRET;

  if (!serverSecret) {
    return {
      authorized: false,
      response: NextResponse.json(
        { error: "Server collector authentication is not configured." },
        { status: 503 }
      )
    };
  }

  if (providedSecret !== serverSecret) {
    return {
      authorized: false,
      response: NextResponse.json(
        { error: "Invalid collector secret." },
        { status: 403 }
      )
    };
  }

  return { authorized: true };
}
