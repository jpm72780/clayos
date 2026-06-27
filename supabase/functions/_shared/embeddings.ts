// Minimal embedding adapter — OpenAI text-embedding-3-small (1536-dim) to match
// the entities.embedding HNSW index. Simplified from counterpart's multi-provider
// version (BYOK resolution dropped; the POC uses a single platform key).
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") || "";
const MODEL = "text-embedding-3-small";

export async function embed(text: string): Promise<number[]> {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not set");
  const r = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { "Authorization": `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, input: text.slice(0, 8000) }),
  });
  if (!r.ok) throw new Error(`openai_embed_failed ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json() as { data: Array<{ embedding: number[] }> };
  return j.data[0].embedding;
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const r = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { "Authorization": `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, input: texts.map((t) => t.slice(0, 8000)) }),
  });
  if (!r.ok) throw new Error(`openai_embed_failed ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json() as { data: Array<{ embedding: number[] }> };
  return j.data.map((d) => d.embedding);
}

// pgvector wire literal: '[1,2,3,...]'
export function vectorToPgLiteral(vec: number[]): string {
  return "[" + vec.map((v) => (Number.isFinite(v) ? v : 0)).join(",") + "]";
}
