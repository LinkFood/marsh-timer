# SitDeck → DuckCountdown Implementation Report

**Date:** 2026-03-20
**Purpose:** Detailed architecture and UX patterns extracted from SitDeck (app.sitdeck.com) that should be adopted by DuckCountdown (duckcountdown.com). This document is a Claude Code handoff spec — every section maps to implementable work.

**Context:** DuckCountdown is a wildlife intelligence platform with 304K+ brain entries, 18 panels, 45 edge functions, 14 crons, and 27 map layers. SitDeck is a geopolitical OSINT dashboard with 65+ widgets, 213 data feeds, AI analyst, and saved deck configurations. Both sites solve the same fundamental problem: presenting massive amounts of real-time intelligence data through a composable panel-based layout with a map.

---

## Executive Summary

DuckCountdown already has the core architecture right — map + panel dock + category filters + AI chat + layer picker. What SitDeck does better is **information density management**. SitDeck's key advantages:

1. **Deck Manager** — Saved panel configurations (like "presets" but for the entire layout)
2. **Widget Manager** — Rich, searchable, categorized panel catalog with metadata
3. **Grid Layout Presets** — Quick column/layout switches (Equal Grid, Map Focus, 2/3/4 col)
4. **Panel Fullscreen Mode** — Any panel can expand to fill the viewport
5. **AI Analyst Sidebar** — Dedicated AI chat with history, suggested prompts, model indicator
6. **Data Source Health Dashboard** — Transparent feed status showing all 213 data sources
7. **Alert Management System** — User-configurable alerts with conditions, schedules, and expiry
8. **News Ticker** — Scrolling headline strip at the top
9. **Rich Panel Internal Navigation** — Tabs, filters, badges, counts inside each panel
10. **Share Button on Every Panel** — Individual panel sharing

---

## 1. Deck Manager (HIGH PRIORITY)

### What SitDeck Does
SitDeck has a "Decks" dropdown in the header that contains:
- **Saved Decks**: Named configurations like "Command Center", "War & Conflict", "Master", "Aviation & Space". Each saves which widgets are active, their positions, and sizes.
- **"Create a New Deck"**: Opens a template picker with 11 pre-built templates (Command Center, OSINT & Social, Live TV & Media, Markets & Finance, War & Conflict, Nuclear & WMD, Aviation & Space, Maritime & Trade, Environment & Climate, Energy & Resources, Cyber & Technology). Each template activates ~7 relevant widgets.
- The Grid dropdown also has a **"Save Deck"** button that saves the current layout to the active deck name.

### What DuckCountdown Has Today
- A fixed set of default panels loaded on first visit
- Panel state saved to localStorage (positions, which panels are open)
- No ability to save/load named configurations
- No templates

### Implementation Plan

#### A. Data Model
```sql
CREATE TABLE hunt_deck_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  species TEXT DEFAULT 'duck',
  is_template BOOLEAN DEFAULT false,
  is_default BOOLEAN DEFAULT false,
  panels JSONB NOT NULL,        -- Array of {panelId, x, y, w, h, minimized}
  active_layers TEXT[],          -- Which map layers are toggled ON
  map_center JSONB,              -- {lng, lat, zoom}
  grid_preset TEXT DEFAULT '3col', -- 'equal', 'map-focus', '2col', '3col', '4col'
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, slug)
);
```

#### B. Built-in Templates (seed data, is_template = true, user_id = null)
| Template Name | Panels | Description |
|---------------|--------|-------------|
| Scout Mode | Convergence Scores, Scout Report, Weather Events, Brain Chat | Daily scouting briefing |
| Weather Watch | Weather Events, NWS Alerts, Weather Forecast, Solunar | Weather-focused |
| Migration Intel | Migration Index, eBird Feed, DU Reports, State Screener | Migration tracking |
| Full Command | All 5 default panels + State Profile + History Replay | Everything visible |
| Analytics Deep-Dive | Brain Activity, Convergence History, History Replay, Brain Search | Data analysis mode |

#### C. UI Components

**DeckSelector.tsx** — Dropdown in the header (replaces or augments the "+" button area)
- Shows saved decks with radio selection
- "Save Current Layout" button
- "New Deck from Template" → opens template picker
- "Reset to Default" option

**DeckTemplateModal.tsx** — Grid of template cards
- Each card: icon, name, description, panel count
- Click → loads that template's panel config + layer config
- Species-aware (some templates make more sense for certain species)

#### D. Integration Points
- `useDeckLayout.ts` already manages panel state — extend it with `saveDeck(name)`, `loadDeck(id)`, `deleteDeck(id)`
- `LayerContext.tsx` — save/restore active layers per deck
- `DeckContext.tsx` — add `currentDeckId` and `currentDeckName` to context
- localStorage remains the fast cache, but Supabase persists for logged-in users

---

## 2. Widget Manager (HIGH PRIORITY)

### What SitDeck Does
A dedicated panel/modal for managing widgets with:
- **Header**: "WIDGET MANAGER" with widget count and active count
- **Search bar**: Filter widgets by name
- **Categorized sections**: Core, Markets & Finance, Geopolitical, Military & Defense, CBRN & WMD, Humanitarian — each collapsible
- **Widget cards**: Each shows icon, name, description, category badge, refresh interval, feed count, and an active/inactive toggle
- **Bulk actions**: "Select All" / "Clear All" / "Done" buttons
- **Badge counts**: Number of feeds per widget, refresh interval

### What DuckCountdown Has Today
- `PanelAddMenu.tsx` — A simple searchable dropdown triggered by the "+" button
- Shows panel name and a brief description
- No categories, no metadata (refresh rate, data source count), no bulk operations

### Implementation Plan

#### A. Enhance PanelRegistry.ts
```typescript
interface PanelDef {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
  category: 'intelligence' | 'migration' | 'weather' | 'analytics' | 'core';
  component: React.LazyExoticComponent<any>;
  defaultSize: { w: number; h: number };
  // NEW FIELDS:
  refreshInterval?: string;     // "15min", "3hr", "daily", "real-time"
  dataSourceCount?: number;      // How many data feeds power this panel
  dataSources?: string[];        // ["Open-Meteo", "ASOS", "NWS"]
  isPremium?: boolean;           // Future: gating for paid features
  tags?: string[];               // Searchable tags beyond category
}
```

#### B. WidgetManager.tsx (New Component)
Replace `PanelAddMenu.tsx` with a richer modal/slide-out:
- **Full-height slide-out from right** (similar to LayerPicker)
- **Search bar** at top with real-time filtering
- **Category sections** (Intelligence, Migration, Weather, Analytics) — collapsible
- **Panel cards** showing: icon, name, description, refresh interval badge, data source count, active/inactive toggle
- **Bulk controls**: "Add All in Category" / "Remove All" / "Done"
- **Active panel count** in header: "11 / 18 active"

#### C. Bottom Bar Enhancement
The existing bottom bar categories (All, Intel, Migration, Weather, Analytics) already filter panels. Enhance:
- Show **count badges** on each category: "Intel (3)" meaning 3 Intel panels active
- The "+" button should open the full WidgetManager, not the small dropdown

---

## 3. Grid Layout Presets (MEDIUM PRIORITY)

### What SitDeck Does
A "Grid" dropdown in the header with:
- **Equal Grid** — Even sizing for all widgets
- **Map Focus** — Large map with side panels
- **2 Columns** / **3 Columns** / **4 Columns** — Fixed column layouts
- **Save Deck** — Persist current layout
- **Reset Layout** — Return to defaults (red, destructive)

### What DuckCountdown Has Today
- `react-grid-layout` with 12-column grid
- Users can manually drag/resize panels
- No preset layouts
- Map height is adjustable via drag handle, but no "Map Focus" mode

### Implementation Plan

#### A. GridPresets.ts
```typescript
type GridPreset = 'equal' | 'map-focus' | '2col' | '3col' | '4col';

const GRID_PRESETS: Record<GridPreset, {
  label: string;
  description: string;
  icon: LucideIcon;
  mapHeightPercent: number;  // 0-100, percentage of viewport
  cols: number;              // Override react-grid-layout cols
  generateLayout: (panels: PanelInstance[]) => Layout[];
}>;
```

#### B. Grid Preset Behaviors
| Preset | Map Height | Panel Cols | Behavior |
|--------|-----------|------------|----------|
| Equal Grid | 0% (hidden) | 4 | All panels same size, fill viewport |
| Map Focus | 65% | 3 (sidebar) | Map dominates, panels in right sidebar column |
| 2 Columns | 40% | 2 | Wide panels, 2-across |
| 3 Columns | 40% | 3 | Default (current behavior) |
| 4 Columns | 35% | 4 | Dense, more panels visible |

#### C. UI — GridPresetDropdown.tsx
- Dropdown button in header bar (right side, near existing icons)
- Shows preset options with icons
- "Save Layout" and "Reset Layout" at bottom
- Apply preset → recalculates all panel positions via `generateLayout()`

#### D. Map Focus Mode (Special Case)
This is the most impactful preset. When activated:
- Map expands to ~65% of viewport height
- Panels collapse to a scrollable sidebar on the right (~350px wide)
- Panels stack vertically in the sidebar (single column, no grid)
- Drag handle between map and sidebar (horizontal instead of vertical)
- Great for when the user is actively scouting on the map

---

## 4. Panel Fullscreen Mode (HIGH PRIORITY)

### What SitDeck Does
Every panel has an expand/fullscreen icon (↗) in the title bar. Clicking it:
- Panel expands to fill the **entire viewport** (covers map and all other panels)
- Header bar stays visible at top
- Panel gets a **back/close button** to return to grid view
- Content reflows to use the full space (more rows in tables, bigger charts, etc.)

### What DuckCountdown Has Today
- Panels have minimize (—) and close (×) in PanelWrapper.tsx
- No expand/fullscreen capability
- No way to give a single panel the full viewport

### Implementation Plan

#### A. Add to PanelWrapper.tsx
```tsx
// New button in title bar, between minimize and close
<button onClick={() => toggleFullscreen(panel.id)} title="Expand">
  {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
</button>
```

#### B. Fullscreen State Management
Add to `useDeckLayout.ts`:
```typescript
const [fullscreenPanelId, setFullscreenPanelId] = useState<string | null>(null);
```

When a panel is fullscreen:
- Render it as a **fixed overlay** (not position:fixed breaking out of panel — use a Portal to document.body)
- `z-index: 50` (above everything except modals)
- Full viewport width/height minus header bar height
- Panel content component receives `isFullscreen: boolean` prop so it can adapt layout
- ESC key closes fullscreen
- Animate with Framer Motion (scale from panel position to full viewport)

#### C. Panel-Specific Fullscreen Adaptations
Panels that benefit most from fullscreen:
| Panel | Fullscreen Behavior |
|-------|-------------------|
| Convergence Scores | Full 50-state table with all columns visible |
| Scout Report | Full-width reading experience |
| State Screener | Sortable table with all columns, pagination |
| Brain Search | Results list with full content previews |
| History Replay | Full-width timeline slider + large map preview |
| Brain Chat | Full conversation view (like a chat app) |
| Weather Forecast | 16-day forecast with detailed daily breakdowns |

---

## 5. AI Analyst Sidebar (MEDIUM PRIORITY)

### What SitDeck Does
- **Left-edge vertical tab**: "AI-POWERED ANALYST" rotated text, clickable
- **Slide-out sidebar** (~350px) from the left
- **Header**: "+ NEW CHAT" button, history icon (clock), clipboard icon
- **Welcome state**: Large chat bubble icon, description text, 8 suggested prompt cards
- **Chat input**: "Ask about the situation..." placeholder with send button
- **Model indicator**: "Claude Haiku 4.5" with green status dot
- **Usage counter**: "4 used / 10 total / 6 left" (tier-based rate limiting)
- **Chat history**: Previous conversations accessible via history icon

### What DuckCountdown Has Today
- Chat slide-out triggered from header chat icon (💬)
- `HuntChat.tsx` renders inside `ChatPanel` in the panel dock
- Also accessible as a slide-out
- Shows "FROM THE BRAIN" (cyan cards) + "AI INTERPRETATION" sections
- 4 suggested prompts on welcome
- No chat history persistence across sessions
- No model indicator
- No usage counter

### Implementation Plan

#### A. Enhance Chat Slide-Out (ChatSlideOut.tsx)

The existing chat slide-out should be upgraded to match SitDeck's pattern:

1. **Persistent left-edge tab** (like SitDeck): Add a vertical "BRAIN ANALYST" tab on the left edge of the viewport that's always visible. Clicking it opens the chat sidebar.
   - CSS: `position: fixed; left: 0; top: 50%; transform: rotate(-90deg) translateX(-50%);`
   - Dark glass background, subtle glow
   - Keeps chat discoverable without taking header space

2. **Chat history**: Add a history view showing previous conversations
   - Already stored in `hunt_conversations` table
   - Add a clock icon button that shows a list of past sessions
   - Click to load a previous conversation

3. **"+ New Chat"** button in chat header to clear current conversation and start fresh

4. **Model/Brain indicator**: Show "Duck Brain · 212K entries" with green status dot at bottom of chat sidebar

5. **Usage tracking**: If rate limiting exists (hunt_user_settings.daily_query_count), show "X / Y queries today" at bottom

6. **Enhanced suggested prompts**: Make them species-aware and seasonal:
   - Duck in March: "Where are mallards moving this week?", "Best cold front states right now?"
   - Deer in October: "Rut activity predictions?", "Which states have rifle season opening?"

---

## 6. Data Source Health Dashboard (HIGH PRIORITY)

### What SitDeck Does
A "Data" dropdown in the header showing:
- **"SOURCES & STATUS"** header with "213 data feeds from 169 providers"
- **Status dashboard**: Color-coded boxes for TOTAL, ONLINE, QUEUED, STALE, ERROR, MAINT, STATIC, ON DEMAND
- **Search bar**: Filter by feed name, provider, or category
- **Categorized feed list**: Each feed shows name, "Curated" badge, refresh interval, source provider, last-updated timestamp, edit icon
- **Categories**: Financial Markets (20), Geopolitical, etc.

### What DuckCountdown Has Today
- `BrainHeartbeat.tsx` shows EMB count and CRONS count (e.g., "8/14")
- `hunt-cron-health` endpoint returns per-cron status
- `Brain Activity` panel shows cron execution dots
- No comprehensive data source dashboard
- No way for users to see which feeds are healthy/errored/stale

### Implementation Plan

#### A. DataSourceDashboard.tsx (New Panel + Header Dropdown)

Create a comprehensive data health view accessible two ways:
1. As a **header dropdown** (click EMB/CRONS area in BrainHeartbeat)
2. As a **full panel** in the panel dock

#### B. Data Model — Catalog DuckCountdown's Data Sources
```typescript
interface DataSource {
  id: string;
  name: string;
  provider: string;
  category: 'weather' | 'migration' | 'environment' | 'intelligence' | 'government' | 'satellite';
  refreshInterval: string;       // "15min", "3hr", "daily", "weekly"
  cronFunction?: string;         // Edge function name
  status: 'online' | 'stale' | 'error' | 'maintenance' | 'static';
  lastUpdated: string;           // ISO timestamp
  entryCount: number;            // Entries in hunt_knowledge from this source
  description: string;
}
```

#### C. DuckCountdown's Actual Data Sources (seed this catalog)
| Source | Provider | Category | Refresh | Cron |
|--------|----------|----------|---------|------|
| Live Weather Forecasts | Open-Meteo | weather | daily | hunt-weather-watchdog |
| Real-Time Station Data | ASOS/METAR | weather | 15min | hunt-weather-realtime |
| NWS Severe Alerts | NWS API | weather | 3hr | hunt-nws-monitor |
| Weather Radar | RainViewer | weather | real-time | (frontend) |
| eBird Sightings | Cornell Lab | migration | daily | hunt-migration-monitor |
| BirdCast Radar | BirdCast | migration | daily | hunt-birdcast |
| DU Migration Map | Ducks Unlimited | migration | weekly | hunt-du-map |
| DU Alert Articles | Ducks Unlimited | migration | weekly | hunt-du-alerts |
| NASA POWER Satellite | NASA | satellite | daily | hunt-nasa-power |
| US Drought Monitor | USDA | environment | weekly | hunt-drought-monitor |
| iNaturalist Obs | iNaturalist | migration | on-demand | hunt-inaturalist |
| Solunar Calendar | Calculated | intelligence | weekly | hunt-solunar-precompute |
| Convergence Engine | Internal | intelligence | daily | hunt-convergence-engine |
| Scout Reports | Internal AI | intelligence | daily | hunt-scout-report |
| Photoperiod | Calculated | environment | static | (backfill) |
| USGS Water Levels | USGS | environment | on-demand | (backfill) |
| NOAA Tides | NOAA | environment | on-demand | (backfill) |
| Climate Normals | NOAA ACIS | environment | static | (backfill) |
| USDA Crop Progress | USDA | environment | static | (backfill) |
| Species Knowledge | Curated | intelligence | static | (seed) |
| State Regulations | State DNRs | government | static | (seed) |

#### D. Status Dashboard UI
```
┌─────────────────────────────────────────────────┐
│  BRAIN DATA SOURCES                             │
│  21 sources from 15 providers · 212K+ entries   │
├─────────────────────────────────────────────────┤
│ ■ 21 TOTAL  ■ 14 ONLINE  ■ 0 STALE  ■ 0 ERROR │
│ ■ 5 STATIC  ■ 2 ON-DEMAND                      │
├─────────────────────────────────────────────────┤
│ 🔍 Search sources...                            │
├─────────────────────────────────────────────────┤
│ ▼ WEATHER (5)                                   │
│   ● Live Forecasts    Open-Meteo    daily  14h  │
│   ● Station Data      ASOS/METAR   15min  2m   │
│   ● NWS Alerts        NWS API      3hr    1h   │
│   ...                                           │
│ ▼ MIGRATION (4)                                 │
│   ● eBird Sightings   Cornell Lab  daily   8h  │
│   ...                                           │
└─────────────────────────────────────────────────┘
```

#### E. Integration with BrainHeartbeat
Make the existing EMB/CRONS display clickable:
- Click → opens DataSourceDashboard as a dropdown overlay
- Show red indicator if any source is in ERROR state
- Tooltip on hover: "14/21 sources online · 6 errors"

---

## 7. Alert Management System (MEDIUM PRIORITY)

### What SitDeck Does
- **"Alerts" header dropdown**: Shows "ALERT MANAGEMENT" with count ("1 / 3 active alerts · Hobbyist")
- **"+ Create Alert" button**
- **Alert cards**: Name, active/paused badge, data source, trigger condition ("New data appears"), geographic filter ("Gulf States"), schedule (last checked / next check), expiry countdown
- **Per-alert actions**: Edit, pause/resume, delete

### What DuckCountdown Has Today
- `hunt-convergence-alerts` runs daily and generates score spike alerts automatically
- `hunt-alerts` does bulk pattern matching
- `Hunt Alerts` panel shows proactive alerts
- **No user-configurable alerts** — all alerts are system-generated
- Users can't say "alert me when cold front hits Arkansas"

### Implementation Plan

#### A. Data Model
```sql
CREATE TABLE hunt_user_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  name TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  species TEXT DEFAULT 'duck',
  -- Trigger conditions
  trigger_type TEXT NOT NULL,  -- 'score_spike', 'weather_event', 'new_data', 'threshold'
  trigger_config JSONB NOT NULL,
  -- Filters
  states TEXT[],               -- State abbreviations to monitor (null = all)
  -- Schedule
  check_interval TEXT DEFAULT '3hr',
  last_checked_at TIMESTAMPTZ,
  next_check_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  -- Notification
  notify_method TEXT DEFAULT 'in_app', -- 'in_app', 'email', 'push'
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

#### B. Trigger Types
| Trigger | Config Example | Use Case |
|---------|---------------|----------|
| score_spike | `{min_change: 15, min_score: 60}` | "Alert when any state jumps 15+ points above 60" |
| weather_event | `{event_types: ['cold_front', 'pressure_drop']}` | "Alert on cold fronts" |
| threshold | `{field: 'convergence_score', operator: '>=', value: 75}` | "Alert when score hits 75+" |
| new_data | `{content_type: 'migration-spike'}` | "Alert on new migration spikes" |

#### C. UI — AlertManager.tsx
- Header dropdown (from Alerts icon, which currently doesn't exist — add bell icon)
- Shows active alerts with status cards
- "+ Create Alert" opens a form wizard:
  1. Name your alert
  2. Pick trigger type
  3. Configure conditions
  4. Select states (or "All")
  5. Set check interval and expiry
- Each alert card: name, status badge, condition summary, last/next check, edit/pause/delete

#### D. Edge Function — hunt-check-user-alerts
New cron (every 15min) that:
1. Queries `hunt_user_alerts` where `is_active = true AND next_check_at <= now()`
2. For each alert, evaluates trigger conditions against recent brain data
3. If triggered, inserts notification into `hunt_notifications` table
4. Updates `last_checked_at` and `next_check_at`

---

## 8. News/Event Ticker (LOW PRIORITY)

### What SitDeck Does
- Horizontal scrolling news strip at very top of page (above the panel grid)
- Shows latest headlines from monitored sources with category tags
- Each item: headline text, source attribution, time ago, colored category badges
- Auto-scrolls, clickable items expand to full article/source

### What DuckCountdown Has Today
- BrainHeartbeat bar at top (status indicators, not news)
- No scrolling news/event ticker
- Weather events and alerts are buried in panels

### Implementation Plan

#### A. EventTicker.tsx
Add a thin (~32px) scrolling ticker strip below BrainHeartbeat:
- Sources: Latest weather events + convergence alerts + NWS alerts + migration spikes
- Format: `"🌧 Cold front detected: AR, MO, OK · 2h ago"` | `"📈 ID convergence spike: 62→80 · 14h ago"` | `"⚠️ NWS: Winter Storm Warning — MT, WY · 1h ago"`
- Auto-scrolls left, pause on hover
- Click item → navigates to relevant panel or state

#### B. Data Source
Query the 3 most recent entries from:
- `hunt_weather_events` (type, states, timestamp)
- `hunt_convergence_alerts` (state, score change)
- `hunt_nws_alerts` (alert type, states)
- Merge and sort by timestamp, display top 10

---

## 9. Enhanced Panel Internal Navigation (MEDIUM PRIORITY)

### What SitDeck Does
Panels have rich internal navigation:
- **Tabs with counts**: "MIL (193) | BOMB (0) | VIP (11) | SQK (3) | HELI (3400)"
- **Filter icons**: Funnel icon for filtering within a panel
- **Sub-category tabs**: "Crises (20) | GDACS (25)" within Humanitarian panel
- **Color-coded badges**: Entries tagged with categories like "Israel", "Missile Strike" in colored pills
- **External link icons**: Each entry has a ↗ to open source
- **Status indicators**: Green/red/yellow dots on entries

### What DuckCountdown Has Today
- Most panels are flat lists or single-view components
- No internal tabs or sub-filters
- Limited use of badges/tags
- Weather Events panel has no type filtering
- Convergence Scores has no filtering

### Implementation Plan

#### A. Panels That Should Get Internal Tabs/Filters

**Weather Events Panel:**
- Add tabs: `ALL | COLD FRONT | PRESSURE | WIND | FREEZE | NWS`
- Each tab shows count
- Filter icon for state-specific filtering
- Add severity badge (colored pill)

**Convergence Scores Panel:**
- Add tabs: `ALL STATES | TOP 10 | RISERS | FALLERS`
- "RISERS" = states where score increased most in 24hr
- "FALLERS" = states where score dropped most
- Click state row → source link icon to navigate to state profile

**Migration Index Panel:**
- Add tabs: `OVERVIEW | SPIKES | TRENDS`
- Badge migration intensity per state

**Brain Search Panel:**
- Add tabs: `ALL | WEATHER | MIGRATION | PATTERNS | REGULATIONS`
- Filter by content_type
- Show similarity score as colored badge

**Cyber Intelligence equivalent → Brain Activity Panel:**
- Add tabs by cron function: `ALL | WEATHER | MIGRATION | SATELLITE | ALERTS`
- Show success/error counts per category

#### B. Shared PanelTabs Component
```tsx
interface PanelTabsProps {
  tabs: { id: string; label: string; count?: number }[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
}

function PanelTabs({ tabs, activeTab, onTabChange }: PanelTabsProps) {
  return (
    <div className="flex gap-1 px-2 py-1 border-b border-white/10 overflow-x-auto">
      {tabs.map(tab => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={cn(
            "px-2 py-0.5 text-xs font-mono rounded whitespace-nowrap",
            activeTab === tab.id
              ? "bg-cyan-500/20 text-cyan-400"
              : "text-gray-400 hover:text-white"
          )}
        >
          {tab.label}
          {tab.count !== undefined && (
            <span className="ml-1 text-gray-500">{tab.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}
```

---

## 10. Share Button on Every Panel (LOW PRIORITY)

### What SitDeck Does
Every panel title bar has a share icon (↗). Clicking generates a shareable link or screenshot of that specific panel's data.

### What DuckCountdown Has Today
- No per-panel sharing
- CLAUDE.md mentions "every interaction should be easy to screenshot or share" as a principle

### Implementation Plan
Add a share icon to PanelWrapper.tsx title bar:
- Click → generates a screenshot of the panel (html2canvas or similar)
- Copy shareable URL: `duckcountdown.com/duck?panel=convergence-scores&state=TX`
- Or: copy panel data as text to clipboard (for pasting into group chats)

---

## Implementation Priority Order

### Phase 1 — Core UX Wins (1-2 weeks)
1. **Panel Fullscreen Mode** — Easy win, huge UX improvement
2. **Data Source Health Dashboard** — BrainHeartbeat already shows cron status; make it clickable and comprehensive
3. **Enhanced Panel Internal Navigation** — Add PanelTabs component, then upgrade Weather Events and Convergence Scores panels first

### Phase 2 — Layout Intelligence (2-3 weeks)
4. **Grid Layout Presets** — Add Map Focus + Equal Grid + column presets
5. **Widget Manager** — Upgrade PanelAddMenu to full WidgetManager with categories, metadata, search
6. **Deck Manager** — Save/load named panel configurations

### Phase 3 — Intelligence Features (3-4 weeks)
7. **AI Analyst Sidebar Enhancement** — Left-edge tab, chat history, brain indicator
8. **Alert Management System** — User-configurable alerts with conditions and scheduling
9. **Event Ticker** — Scrolling alert/event strip below BrainHeartbeat

### Phase 4 — Polish (1 week)
10. **Panel Share Buttons** — Screenshot/link sharing per panel

---

## Architecture Notes for Claude Code

### Files to Create
```
src/
  components/
    DeckSelector.tsx             # Deck save/load/template dropdown
    DeckTemplateModal.tsx        # Template picker grid
    WidgetManager.tsx            # Full panel catalog slide-out
    GridPresetDropdown.tsx       # Layout preset dropdown
    DataSourceDashboard.tsx      # Feed health dashboard
    AlertManager.tsx             # User alert configuration
    EventTicker.tsx              # Scrolling news strip
    PanelTabs.tsx                # Shared panel tab component
  hooks/
    useDeckConfigs.ts            # Save/load deck configurations
    useDataSources.ts            # Data source health status
    useUserAlerts.ts             # User alert CRUD
supabase/
  functions/
    hunt-check-user-alerts/      # Cron: evaluate user alert conditions
  migrations/
    XXXX_add_deck_configs.sql
    XXXX_add_user_alerts.sql
    XXXX_add_data_source_catalog.sql
```

### Files to Modify
```
src/layout/PanelDock.tsx          # Fullscreen overlay portal
src/panels/PanelWrapper.tsx       # Add fullscreen + share buttons
src/panels/PanelRegistry.ts      # Add metadata fields (refreshInterval, dataSourceCount, etc.)
src/panels/PanelAddMenu.tsx       # Replace with WidgetManager import (or deprecate)
src/hooks/useDeckLayout.ts        # Add saveDeck/loadDeck, fullscreenPanelId, gridPreset
src/contexts/DeckContext.tsx       # Add currentDeckId, currentDeckName
src/contexts/LayerContext.tsx      # Save/restore layers per deck
src/layout/DeckLayout.tsx          # Add EventTicker, left-edge AI tab
src/components/HeaderBar.tsx       # Add Grid preset dropdown, Deck selector, Alert bell icon
src/components/BrainHeartbeat.tsx  # Make clickable → DataSourceDashboard
src/panels/WeatherEventsPanel.tsx  # Add PanelTabs for event type filtering
src/panels/ConvergenceScoresPanel.tsx # Add PanelTabs for ALL/TOP 10/RISERS/FALLERS
src/panels/BrainSearchPanel.tsx    # Add PanelTabs for content type filtering
src/panels/BrainActivityPanel.tsx  # Add PanelTabs for cron category filtering
src/components/HuntChat.tsx        # Chat history, model indicator, usage counter
```

### Key Constraints
- Mobile-first: Every new feature must work on 375px width
- No new npm dependencies if possible (use existing Framer Motion for animations, Lucide for icons)
- All new tables use `hunt_` prefix (shared Supabase project)
- All edge functions pin `supabase-js@2.84.0` and `std@0.168.0`
- Panel fullscreen must use React Portal, not position:fixed within panel (learned from StateProfilePanel regression)
- Grid preset changes must preserve panel order and not lose user's drag/resize customizations

---

## Side-by-Side Comparison Summary

| Feature | SitDeck | DuckCountdown | Gap |
|---------|---------|---------------|-----|
| Saved layouts | ✅ Deck Manager + templates | ❌ localStorage only | HIGH |
| Widget catalog | ✅ Rich manager with metadata | ⚠️ Simple dropdown | HIGH |
| Grid presets | ✅ Equal/MapFocus/2-4col | ❌ Manual only | MEDIUM |
| Panel fullscreen | ✅ Every panel | ❌ None | HIGH |
| AI sidebar | ✅ Left-edge tab + history | ⚠️ Header icon + slide-out | MEDIUM |
| Data health | ✅ 213 feeds dashboard | ⚠️ EMB/CRONS counter only | HIGH |
| User alerts | ✅ Configurable + scheduled | ❌ System-only | MEDIUM |
| News ticker | ✅ Scrolling headlines | ❌ None | LOW |
| Panel tabs/filters | ✅ Rich internal nav | ❌ Flat lists | MEDIUM |
| Panel sharing | ✅ Share icon per panel | ❌ None | LOW |
| Map | ✅ Global events | ✅ US hunting intelligence | PARITY |
| Panel drag/resize | ✅ Grid layout | ✅ react-grid-layout | PARITY |
| Layer picker | ✅ Category toggles | ✅ 27 layers + presets | PARITY |
| Category filters | ❌ No bottom bar | ✅ All/Intel/Migration/Weather/Analytics | DC AHEAD |
| Real-time status | ⚠️ Data dot | ✅ BrainHeartbeat with live cron stats | DC AHEAD |
| Species switching | ❌ N/A | ✅ Duck/Goose/Deer/Turkey/Dove | DC AHEAD |
