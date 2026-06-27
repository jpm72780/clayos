// Edge Function: embed-entities
// Drains clayos.graph_embed_jobs: claims a batch, embeds each entity's text via
// OpenAI, writes entities.embedding, and removes the job. Invoke repeatedly (or
// on a pg_cron schedule) until the queue is empty. Used to power kg_search.
import { corsHeaders } from "../_shared/cors.ts";
import { adminClient } from "../_shared/db.ts";
import { embedBatch, vectorToPgLiteral } from "../_shared/embeddings.ts";

// deno-lint-ignore-file no-explicit-any
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const batchSize = (body.batch_size as number) || 100;
    const admin = adminClient();

    const { data: jobs, error } = await admin.rpc("claim_embed_jobs", { p_limit: batchSize });
    if (error) throw new Error(`claim_embed_jobs: ${error.message}`);
    if (!jobs || jobs.length === 0) {
      return new Response(JSON.stringify({ embedded: 0, remaining: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const vectors = await embedBatch(jobs.map((j: any) => j.content || ""));
    let embedded = 0;
    for (let i = 0; i < jobs.length; i++) {
      const { error: e2 } = await admin.rpc("set_entity_embedding", {
        p_entity: jobs[i].entity_id,
        p_vec: vectorToPgLiteral(vectors[i]),
      });
      if (!e2) embedded++;
    }

    const { count } = await admin.from("graph_embed_jobs").select("*", { count: "exact", head: true });
    return new Response(JSON.stringify({ embedded, remaining: count ?? null }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
