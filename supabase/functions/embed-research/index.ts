// Embedding service: gte-small (384-dim) via the Supabase.ai session built
// into the Edge runtime — no external API, no key, no model weights in the
// gateway image. The gateway calls this with the service-role key; anon gets
// 401 because verify_jwt stays ON for this function.
//
// Contract: { texts: string[] } -> { embeddings: number[][], model: string }
// Anything else is a 400. A failed embed is the CALLER's problem to record as
// embedding_status='pending' — this function never fabricates a vector.

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore Supabase Edge runtime global
const session = new Supabase.ai.Session("gte-small");

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }
  let texts: unknown;
  try {
    ({ texts } = await req.json());
  } catch {
    return new Response(JSON.stringify({ error: "invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (
    !Array.isArray(texts) ||
    texts.length === 0 ||
    texts.length > 32 ||
    !texts.every((t) => typeof t === "string" && t.length > 0 && t.length <= 8000)
  ) {
    return new Response(
      JSON.stringify({ error: "texts must be 1–32 non-empty strings ≤ 8000 chars" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const embeddings: number[][] = [];
  for (const text of texts as string[]) {
    const vector = (await session.run(text, {
      mean_pool: true,
      normalize: true,
    })) as number[];
    embeddings.push(Array.from(vector));
  }

  return new Response(JSON.stringify({ embeddings, model: "gte-small" }), {
    headers: { "Content-Type": "application/json" },
  });
});
