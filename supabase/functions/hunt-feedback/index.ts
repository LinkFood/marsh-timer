import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.84.0";
import { handleCors, getCorsHeaders } from "../_shared/cors.ts";

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const corsHeaders = getCorsHeaders(req);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Extract user from auth header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    if (req.method === "POST") {
      const { feedback_type, target_date, state_abbr, rating, comment } = await req.json();

      if (!feedback_type || !target_date || rating === undefined) {
        return new Response(JSON.stringify({ error: "Missing required fields" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const { data, error } = await supabase
        .from("hunt_feedback")
        .upsert({
          user_id: user.id,
          feedback_type,
          target_date,
          state_abbr: state_abbr || null,
          rating,
          comment: comment || null,
        }, { onConflict: "user_id,feedback_type,target_date,state_abbr" })
        .select()
        .single();

      if (error) throw error;
      return new Response(JSON.stringify({ success: true, feedback: data }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (req.method === "GET") {
      const url = new URL(req.url);
      const feedback_type = url.searchParams.get("feedback_type");
      const target_date = url.searchParams.get("target_date");
      const state_abbr = url.searchParams.get("state_abbr");

      let query = supabase
        .from("hunt_feedback")
        .select("*")
        .eq("user_id", user.id);

      if (feedback_type) query = query.eq("feedback_type", feedback_type);
      if (target_date) query = query.eq("target_date", target_date);
      if (state_abbr) query = query.eq("state_abbr", state_abbr);

      const { data, error } = await query;
      if (error) throw error;
      return new Response(JSON.stringify({ feedback: data }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
