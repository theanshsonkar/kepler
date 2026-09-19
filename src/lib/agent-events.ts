export type StatusEventData = {
  state?: string;
  cloud_writes?: number;
  branch_name?: string;
  branch?: string;
  region?: string;
  account?: string;
  score?: number;
  security_score?: number;
  resources?: number;
};

export type KeplerEvent =
  | { type: "token"; data: unknown; ts: string }
  | { type: "activity"; data: unknown; ts: string }
  | { type: "finding"; data: unknown; ts: string }
  | { type: "diff"; data: unknown; ts: string }
  | { type: "decision"; data: unknown; ts: string }
  | { type: "attackpaths"; data: unknown; ts: string }
  | { type: "compliance"; data: unknown; ts: string }
  | { type: "beforeafter"; data: unknown; ts: string }
  | { type: "status"; data: StatusEventData; ts: string }
  | { type: "error"; data: unknown; ts: string };

export async function* parseSSE(response: Response): AsyncGenerator<KeplerEvent> {
  if (!response.body) return;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const emitFrames = function* (flush = false): Generator<KeplerEvent> {
    while (true) {
      const match = /\r?\n\r?\n/.exec(buffer);
      if (!match || match.index === undefined) break;
      const frame = buffer.slice(0, match.index);
      buffer = buffer.slice(match.index + match[0].length);
      const event = parseFrame(frame);
      if (event) yield event;
    }

    if (flush && buffer.trim()) {
      const event = parseFrame(buffer);
      buffer = "";
      if (event) yield event;
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    for (const event of emitFrames(done)) yield event;
    if (done) break;
  }
}

function parseFrame(frame: string): KeplerEvent | undefined {
  const data = frame
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.slice(6))
    .join("\n")
    .trim();

  if (!data) return undefined;

  try {
    return JSON.parse(data) as KeplerEvent;
  } catch {
    return undefined;
  }
}
