import { AGENT_SERVICE_URL } from "@/lib/agent-config";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.text();
    const response = await fetch(`${AGENT_SERVICE_URL}/session`, {
      method: "POST",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body || undefined,
    });

    const responseBody = await response.json();
    return Response.json(responseBody, { status: response.status });
  } catch {
    return Response.json({ error: "Unable to reach agent service" }, { status: 502 });
  }
}
