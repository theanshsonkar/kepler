import { AGENT_SERVICE_URL } from "@/lib/agent-config";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let payload: { session_id?: string; message?: string };

  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!payload.session_id || typeof payload.message !== "string") {
    return Response.json({ error: "session_id and message are required" }, { status: 400 });
  }

  try {
    const response = await fetch(`${AGENT_SERVICE_URL}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: payload.session_id, message: payload.message }),
    });

    if (!response.ok) {
      let body: unknown = { error: "Agent service returned an error" };
      try {
        body = await response.json();
      } catch {
        // Keep the relay error small when the upstream response is not JSON.
      }
      return Response.json(body, { status: response.status });
    }

    return new Response(response.body, {
      status: response.status,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch {
    return Response.json({ error: "Unable to reach agent service" }, { status: 502 });
  }
}
