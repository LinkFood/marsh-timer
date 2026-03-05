import { useEffect, useRef, useState, useCallback } from "react";
import { motion } from "framer-motion";
import * as d3 from "d3";
import * as topojson from "topojson-client";
import { duckSeasons, fipsToAbbr } from "@/data/seasonData";
import { getSeasonStatus, getStatusColor, getStatusLabel, formatDate, getCompactCountdown, SeasonStatus } from "@/lib/seasonUtils";
import type { Topology, GeometryCollection } from "topojson-specification";

interface USMapProps {
  selectedState: string | null;
  onSelectState: (abbr: string) => void;
}

const seasonByAbbr = new Map(duckSeasons.map(s => [s.abbreviation, s]));

const STATUS_COLORS: Record<SeasonStatus | "selected", string> = {
  open: "#22c55e",
  soon: "#f59e0b",
  upcoming: "#2d5a2d",
  closed: "#1a2e1a",
  selected: "#f5c842",
};

const USMap = ({ selectedState, onSelectState }: USMapProps) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const dataRef = useRef<{ topology: Topology | null }>({ topology: null });

  const getStateColor = useCallback((abbr: string) => {
    if (abbr === selectedState) return STATUS_COLORS.selected;
    const season = seasonByAbbr.get(abbr);
    if (!season) return STATUS_COLORS.closed;
    return getStatusColor(getSeasonStatus(season));
  }, [selectedState]);

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    const tooltip = d3.select(tooltipRef.current);

    d3.json<Topology>("https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json")
      .then(us => {
        if (!us) { setError(true); return; }
        dataRef.current.topology = us;

        const states = topojson.feature(us, us.objects.states as GeometryCollection);
        const projection = d3.geoAlbersUsa().fitSize([960, 600], states);
        const path = d3.geoPath().projection(projection);

        svg.selectAll("*").remove();

        const g = svg.append("g");

        g.selectAll<SVGPathElement, any>("path")
          .data(states.features)
          .join("path")
          .attr("d", path as any)
          .attr("fill", d => {
            const fips = String(d.id).padStart(2, "0");
            const abbr = fipsToAbbr[fips];
            return abbr ? getStateColor(abbr) : STATUS_COLORS.closed;
          })
          .attr("stroke", "#0a1a0a")
          .attr("stroke-width", 0.5)
          .attr("cursor", d => {
            const fips = String(d.id).padStart(2, "0");
            return seasonByAbbr.has(fipsToAbbr[fips]) ? "pointer" : "default";
          })
          .on("mouseenter", function(event, d) {
            const fips = String(d.id).padStart(2, "0");
            const abbr = fipsToAbbr[fips];
            const season = seasonByAbbr.get(abbr);
            if (!season) return;

            d3.select(this).attr("fill", d3.color(getStateColor(abbr))?.brighter(0.5)?.toString() || getStateColor(abbr));

            const status = getSeasonStatus(season);
            tooltip
              .style("opacity", "1")
              .html(`
                <div class="font-display text-sm font-bold" style="color: #f5c842">${season.state}</div>
                <div class="flex items-center gap-1 mt-1">
                  <span class="w-2 h-2 rounded-full" style="background: ${getStatusColor(status)}"></span>
                  <span class="text-xs" style="color: ${getStatusColor(status)}">${getStatusLabel(status)}</span>
                </div>
                <div class="text-xs mt-1 opacity-80">${formatDate(season.seasonOpen)} — ${formatDate(season.seasonClose)}</div>
                <div class="text-xs mt-0.5 opacity-80">${getCompactCountdown(season)}</div>
                <div class="text-xs mt-0.5 opacity-60">${season.flyway} Flyway · Bag: ${season.bagLimit}</div>
              `);
          })
          .on("mousemove", function(event) {
            const svgRect = svgRef.current?.getBoundingClientRect();
            if (!svgRect) return;
            const x = event.clientX - svgRect.left;
            const y = event.clientY - svgRect.top;
            tooltip
              .style("left", `${x + 12}px`)
              .style("top", `${y - 10}px`);
          })
          .on("mouseleave", function(_, d) {
            const fips = String(d.id).padStart(2, "0");
            const abbr = fipsToAbbr[fips];
            d3.select(this).attr("fill", abbr ? getStateColor(abbr) : STATUS_COLORS.closed);
            tooltip.style("opacity", "0");
          })
          .on("click", function(_, d) {
            const fips = String(d.id).padStart(2, "0");
            const abbr = fipsToAbbr[fips];
            if (seasonByAbbr.has(abbr)) onSelectState(abbr);
          });

        // State labels
        g.selectAll<SVGTextElement, any>("text")
          .data(states.features)
          .join("text")
          .attr("x", d => {
            const c = path.centroid(d as any);
            return c[0] || 0;
          })
          .attr("y", d => {
            const c = path.centroid(d as any);
            return c[1] || 0;
          })
          .attr("text-anchor", "middle")
          .attr("dominant-baseline", "central")
          .attr("font-size", "7px")
          .attr("fill", "rgba(200,216,184,0.4)")
          .attr("pointer-events", "none")
          .attr("font-family", "Lora, serif")
          .text(d => {
            const fips = String(d.id).padStart(2, "0");
            const abbr = fipsToAbbr[fips];
            return seasonByAbbr.has(abbr) ? abbr : "";
          });

        setLoaded(true);
      })
      .catch(() => setError(true));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Update colors when selection changes
  useEffect(() => {
    if (!loaded || !svgRef.current) return;
    d3.select(svgRef.current)
      .selectAll<SVGPathElement, any>("path")
      .attr("fill", d => {
        const fips = String(d.id).padStart(2, "0");
        const abbr = fipsToAbbr[fips];
        return abbr ? getStateColor(abbr) : STATUS_COLORS.closed;
      });
  }, [selectedState, getStateColor, loaded]);

  if (error) {
    return (
      <div className="text-center py-12 text-muted-foreground font-body">
        <p>Map failed to load. Use the state list below to browse seasons.</p>
      </div>
    );
  }

  return (
    <motion.div
      className="relative w-full max-w-4xl mx-auto px-4 mt-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.45, duration: 0.6 }}
    >
      <svg
        ref={svgRef}
        viewBox="0 0 960 600"
        className="w-full h-auto"
        style={{ maxHeight: "70vh" }}
      />
      <div
        ref={tooltipRef}
        className="absolute pointer-events-none z-50 bg-card border border-border rounded-lg px-3 py-2 shadow-xl font-body transition-opacity duration-150"
        style={{ opacity: 0 }}
      />

      {/* Legend */}
      <div className="flex flex-wrap justify-center gap-4 mt-4 text-xs font-body text-muted-foreground">
        {([
          ["Open Now", STATUS_COLORS.open],
          ["< 30 Days", STATUS_COLORS.soon],
          ["Upcoming", STATUS_COLORS.upcoming],
          ["Closed", STATUS_COLORS.closed],
          ["Selected", STATUS_COLORS.selected],
        ] as [string, string][]).map(([label, color]) => (
          <div key={label} className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm" style={{ background: color }} />
            <span>{label}</span>
          </div>
        ))}
      </div>
    </motion.div>
  );
};

export default USMap;
