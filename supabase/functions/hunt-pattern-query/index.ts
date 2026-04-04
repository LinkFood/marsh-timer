import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { successResponse, errorResponse } from '../_shared/response.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { callClaude, CLAUDE_MODELS } from '../_shared/anthropic.ts';

/**
 * Cross-domain conditional pattern query.
 *
 * Takes a natural language question like "every time AO was below -2 during La Nina,
 * what storms followed?" and:
 * 1. Uses Haiku to parse the conditions into structured filters
 * 2. Queries hunt_knowledge for dates matching ALL conditions
 * 3. For each matching date, queries other domains for what happened ±30 days
 * 4. Returns the structured cross-reference
 *
 * This answers questions Google literally cannot answer because the data
 * lives in separate databases that don't talk to each other.
 */

interface ParsedCondition {
  content_type: string;
  field: string;         // regex pattern to match in content
  operator: 'lt' | 'gt' | 'eq' | 'contains';
  value: number | string;
  label: string;         // human-readable description
}

interface PatternMatch {
  date: string;
  conditions_met: Array<{ label: string; value: string }>;
  followup_events: Array<{
    content_type: string;
    state_abbr: string | null;
    effective_date: string;
    title: string;
    content: string;
  }>;
}

const CONDITION_PARSE_TOOLS = [
  {
    name: 'parse_conditions',
    description: 'Parse a natural language pattern query into structured conditions to search the brain',
    input_schema: {
      type: 'object',
      properties: {
        conditions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              content_type: {
                type: 'string',
                description: 'The content_type to search in hunt_knowledge. Common types: climate-index, storm-event, drought-weekly, weather-event, nws-alert, geomagnetic-kp, birdcast-daily, usgs-water, noaa-tide, earthquake-event, soil-conditions, air-quality',
              },
              field_pattern: {
                type: 'string',
                description: 'A regex-compatible pattern to match in the content field. Examples: "AO.*value:" for Arctic Oscillation value, "type:Tornado" for tornado events, "D4" for exceptional drought',
              },
              value_pattern: {
                type: 'string',
                description: 'A regex to extract the numeric value. Example: "value:([-\\d.]+)" to capture the number after "value:"',
              },
              operator: {
                type: 'string',
                enum: ['lt', 'gt', 'eq', 'contains'],
                description: 'How to compare: lt (less than), gt (greater than), eq (equals), contains (text contains)',
              },
              threshold: {
                type: 'number',
                description: 'Numeric threshold for lt/gt/eq comparisons. Not needed for contains.',
              },
              label: {
                type: 'string',
                description: 'Human-readable label for this condition, e.g. "AO below -2.0" or "La Nina active"',
              },
            },
            required: ['content_type', 'field_pattern', 'label'],
          },
        },
        followup_content_types: {
          type: 'array',
          items: { type: 'string' },
          description: 'Content types to check for events following the matched dates. Default: storm-event, nws-alert, weather-event, drought-weekly',
        },
        followup_window_days: {
          type: 'number',
          description: 'How many days after each match to look for followup events. Default: 30.',
        },
        state_filter: {
          type: 'string',
          description: 'Optional state abbreviation to filter results. Null for all states.',
        },
      },
      required: ['conditions'],
    },
  },
];

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    if (req.method !== 'POST') return errorResponse(req, 'Method not allowed', 405);

    const { query, state_abbr } = await req.json();
    if (!query) return errorResponse(req, 'query required');

    const supabase = createSupabaseClient();

    // Step 1: Parse the natural language query into structured conditions
    const parseSystemPrompt = `You parse natural language pattern queries about environmental data into structured conditions.

The brain contains these data types indexed by date:
- climate-index: AO, NAO, PNA, ENSO, PDO values with format "value:X.XX | phase:positive/negative/neutral"
- storm-event: NOAA storms with "type:Tornado/Hurricane/Flood/etc | property_damage:XK | deaths:X"
- drought-weekly: drought severity with "D0:X% | D1:X% | D2:X% | D3:X% | D4:X%"
- weather-event: detected events like "pressure_drop", "cold_front", "high_wind", "first_freeze"
- nws-alert: NWS alerts with "type:Tornado Warning/Flood Warning/etc | severity:Severe/Extreme"
- geomagnetic-kp: "avg_kp:X.XX | max_kp:X.XX | level:active/storm"
- earthquake-event: "magnitude:X.X"
- birdcast-daily: "birds:XXXXX intensity:low/moderate/high"

Parse the user's question into conditions (what to search for) and followup types (what happened after).

Examples:
- "every time AO was below -2 during La Nina" → conditions: [AO content_type=climate-index field="AO" value<-2.0, ENSO content_type=climate-index field="ENSO" value<0]
- "major tornado outbreaks when drought was extreme" → conditions: [storm type:Tornado, drought D3 or D4 present], followup: storm-event
- "when geomagnetic storms coincided with earthquakes above 5.0" → conditions: [geomagnetic level:storm, earthquake magnitude>5.0]`;

    const parseResponse = await callClaude({
      model: CLAUDE_MODELS.haiku,
      system: parseSystemPrompt,
      messages: [{ role: 'user', content: query }],
      tools: CONDITION_PARSE_TOOLS,
      tool_choice: { type: 'tool', name: 'parse_conditions' },
      max_tokens: 1024,
      temperature: 0,
    });

    // Extract parsed conditions
    let conditions: any[] = [];
    let followupTypes = ['storm-event', 'nws-alert', 'weather-event'];
    let followupDays = 30;

    const toolContent = parseResponse.content?.find((c: any) => c.type === 'tool_use');
    if (toolContent?.input) {
      conditions = toolContent.input.conditions || [];
      if (toolContent.input.followup_content_types?.length) {
        followupTypes = toolContent.input.followup_content_types;
      }
      if (toolContent.input.followup_window_days) {
        followupDays = toolContent.input.followup_window_days;
      }
    }

    if (conditions.length === 0) {
      return successResponse(req, {
        query,
        error: 'Could not parse conditions from query',
        matches: [],
        summary: 'The brain could not understand the pattern query. Try being more specific about which data types and thresholds you want to cross-reference.',
      });
    }

    // Step 2: Query each condition independently, get matching dates
    // Climate index content format: "climate-index | AO (Arctic Oscillation) | Jan 2021 | value:-2.48 | phase:negative"
    // The value_pattern from Haiku often doesn't match, so we normalize parsing here.
    const dateSetsByCondition: Map<string, Set<string>> = new Map();

    for (const cond of conditions) {
      const dates = new Set<string>();

      // Build the query
      let q = supabase
        .from('hunt_knowledge')
        .select('content,effective_date')
        .eq('content_type', cond.content_type)
        .not('effective_date', 'is', null);

      if (state_abbr) {
        q = q.eq('state_abbr', state_abbr);
      }

      // For climate-index, use title-based filtering which is more reliable
      if (cond.content_type === 'climate-index') {
        // Map common names to actual index titles
        const labelLower = (cond.label + ' ' + (cond.field_pattern || '')).toLowerCase();
        let indexName: string | null = null;
        if (labelLower.includes('la ni') || labelLower.includes('el ni') || labelLower.includes('enso') || labelLower.includes('oni')) {
          indexName = 'ENSO';
        } else {
          const indexMatch = labelLower.match(/\b(ao|nao|pna|pdo)\b/i);
          if (indexMatch) indexName = indexMatch[1].toUpperCase();
        }
        if (indexName) {
          q = q.ilike('title', `${indexName}%`);
        }
      } else if (cond.field_pattern) {
        q = q.ilike('content', `%${cond.field_pattern}%`);
      }

      // Fetch in pages to handle large datasets
      let allData: any[] = [];
      for (let offset = 0; offset < 10000; offset += 1000) {
        const { data } = await q.order('effective_date', { ascending: true }).range(offset, offset + 999);
        if (!data || data.length === 0) break;
        allData = allData.concat(data);
        if (data.length < 1000) break;
      }

      for (const row of allData) {
        // Universal value extraction: look for "value:NUMBER" in content
        const valueMatch = /value:([-\d.]+)/.exec(row.content);
        const phaseMatch = /phase:(\w+)/.exec(row.content);

        if (cond.operator && cond.threshold !== undefined && valueMatch) {
          const val = parseFloat(valueMatch[1]);
          if (isNaN(val) || Math.abs(val) > 500) continue; // skip garbage values like -999
          if (cond.operator === 'lt' && val >= cond.threshold) continue;
          if (cond.operator === 'gt' && val <= cond.threshold) continue;
          if (cond.operator === 'eq' && Math.abs(val - cond.threshold) > 0.01) continue;
        } else if (cond.operator === 'contains' && cond.field_pattern) {
          if (!row.content.includes(cond.field_pattern)) continue;
        } else {
          // Smart label-based matching for common conditions
          const labelLower = cond.label.toLowerCase();
          const hasValue = valueMatch ? parseFloat(valueMatch[1]) : null;

          if ((labelLower.includes('la ni') || labelLower.includes('la nina')) && hasValue !== null) {
            // La Nina = ENSO value < -0.5 (standard threshold)
            if (hasValue >= -0.5 || Math.abs(hasValue) > 500) continue;
          } else if ((labelLower.includes('el ni') || labelLower.includes('el nino')) && hasValue !== null) {
            // El Nino = ENSO value > 0.5
            if (hasValue <= 0.5 || Math.abs(hasValue) > 500) continue;
          } else if (labelLower.includes('negative')) {
            if (phaseMatch && phaseMatch[1] !== 'negative') {
              // Also accept numeric < 0 if phase isn't explicitly negative
              if (hasValue === null || hasValue >= 0) continue;
            }
          } else if (labelLower.includes('positive')) {
            if (phaseMatch && phaseMatch[1] !== 'positive') {
              if (hasValue === null || hasValue <= 0) continue;
            }
          }
        }

        if (row.effective_date) {
          // Deduplicate by date (handle duplicate entries)
          dates.add(row.effective_date);
        }
      }

      dateSetsByCondition.set(cond.label, dates);
    }

    // Step 3: Find dates that match ALL conditions (intersection)
    const allDateSets = [...dateSetsByCondition.values()];
    if (allDateSets.length === 0) {
      return successResponse(req, {
        query,
        conditions: conditions.map((c: any) => c.label),
        matches: [],
        summary: 'No data found for the specified conditions.',
      });
    }

    let intersectedDates = new Set(allDateSets[0]);
    for (let i = 1; i < allDateSets.length; i++) {
      const next = allDateSets[i];
      intersectedDates = new Set([...intersectedDates].filter(d => next.has(d)));
    }

    const matchedDates = [...intersectedDates].sort();

    // Step 4: For each matched date, get followup events
    const matches: PatternMatch[] = [];
    const maxMatches = Math.min(matchedDates.length, 20); // cap at 20 for performance

    for (let i = 0; i < maxMatches; i++) {
      const date = matchedDates[i];
      const endDate = new Date(date);
      endDate.setDate(endDate.getDate() + followupDays);
      const endStr = endDate.toISOString().split('T')[0];

      // Get condition values for this date
      const conditionsMet: Array<{ label: string; value: string }> = [];
      for (const cond of conditions) {
        conditionsMet.push({ label: cond.label, value: `matched on ${date}` });
      }

      // Get followup events
      let followupQuery = supabase
        .from('hunt_knowledge')
        .select('content_type,state_abbr,effective_date,title,content')
        .in('content_type', followupTypes)
        .gte('effective_date', date)
        .lte('effective_date', endStr)
        .limit(50);

      if (state_abbr) {
        followupQuery = followupQuery.eq('state_abbr', state_abbr);
      }

      const { data: followups } = await followupQuery;

      matches.push({
        date,
        conditions_met: conditionsMet,
        followup_events: (followups || []).map(f => ({
          content_type: f.content_type,
          state_abbr: f.state_abbr,
          effective_date: f.effective_date,
          title: f.title,
          content: f.content?.slice(0, 300) || '',
        })),
      });
    }

    // Step 5: Build summary
    const conditionLabels = conditions.map((c: any) => c.label);
    const perConditionCounts: Record<string, number> = {};
    for (const [label, dates] of dateSetsByCondition) {
      perConditionCounts[label] = dates.size;
    }

    return successResponse(req, {
      query,
      conditions: conditionLabels,
      per_condition_matches: perConditionCounts,
      total_intersected: matchedDates.length,
      matches_shown: matches.length,
      all_matched_dates: matchedDates,
      matches,
      followup_window_days: followupDays,
      followup_types: followupTypes,
    });

  } catch (error) {
    console.error('[hunt-pattern-query]', error);
    return errorResponse(req, 'Internal error', 500);
  }
});
