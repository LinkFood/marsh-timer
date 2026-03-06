import { useEffect, useRef, useState, useCallback } from "react";
import { motion } from "framer-motion";
import * as d3 from "d3";
import * as topojson from "topojson-client";
import type { Species } from "@/data/types";
import { speciesConfig } from "@/data/speciesConfig";
import { fipsToAbbr } from "@/data/fips";
import { getPrimarySeasonForState, getStatesForSpecies } from "@/data/seasons";
import { getSeasonStatus, getStatusColor, getStatusLabel, getDateDisplay, getCompactCountdown, SeasonStatus } from "@/lib/seasonUtils";
import type { Topology, GeometryCollection } from "topojson-specification";

interface USMapProps {
  species: Species;
  selectedState: string | null;
  onSelectState: (abbr: string) => void;
}

const USMap = ({ species, selectedState, onSelectState }: USMapProps) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const dataRef = useRef<{ topology: Topology | null }>({ topology: null });

  const config = speciesConfig[species];
  const statesWithData = getStatesForSpecies(species);

  const getStateColor = useCallback((abbr: string) => {
    if (abbr === selectedState) return config.colors.selected;
    if (!statesWithData.has(abbr)) return config.colors.closed;
    const season = getPrimarySeasonForState(species, abbr);
    if (!season) return config.colors.closed;
    const status = getSeasonStatus(season);
    return config.colors[status];
  }, [selectedState, species, config, statesWithData]);

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
        const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

        const paths = g.selectAll<SVGPathElement, any>("path")
          .data(states.features)
          .join("path")
          .attr("d", path as any)
          .attr("fill", d => {
            const fips = String(d.id).padStart(2, "0");
            const abbr = fipsToAbbr[fips];
            return abbr ? getStateColor(abbr) : config.colors.closed;
          })
          .attr("stroke", "#0a1a0a")
          .attr("stroke-width", 0.5)
          .attr("cursor", d => {
            const fips = String(d.id).padStart(2, "0");
            const abbr = fipsToAbbr[fips];
            return statesWithData.has(abbr) ? "pointer" : "default";
          });

        if (!isTouchDevice) {
          paths
            .on("mouseenter", function(event, d) {
              const fips = String(d.id).padStart(2, "0");
              const abbr = fipsToAbbr[fips];
              const season = getPrimarySeasonForState(species, abbr);
              if (!season) return;

              d3.select(this).attr("fill", d3.color(getStateColor(abbr))?.brighter(0.5)?.toString() || getStateColor(abbr));

              const status = getSeasonStatus(season);
              tooltip
                .style("opacity", "1")
                .html(`
                  <div class="font-display text-sm font-bold" style="color: ${config.colors.selected}">${season.state}</div>
                  <div class="flex items-center gap-1 mt-1">
                    <span class="w-2 h-2 rounded-full" style="background: ${getStatusColor(status)}"></span>
                    <span class="text-xs" style="color: ${getStatusColor(status)}">${getStatusLabel(status)}</span>
                  </div>
                  <div class="text-xs mt-1 opacity-80">${getDateDisplay(season)}</div>
                  <div class="text-xs mt-0.5 opacity-80">${getCompactCountdown(season)}</div>
                  <div class="text-xs mt-0.5 opacity-60">${season.flyway ? season.flyway + " Flyway · " : ""}Bag: ${season.bagLimit}</div>
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
              d3.select(this).attr("fill", abbr ? getStateColor(abbr) : config.colors.closed);
              tooltip.style("opacity", "0");
            });
        }

        paths.on("click", function(_, d) {
          const fips = String(d.id).padStart(2, "0");
          const abbr = fipsToAbbr[fips];
          if (statesWithData.has(abbr)) onSelectState(abbr);
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
            return statesWithData.has(abbr) ? abbr : "";
          });

        setLoaded(true);
      })
      .catch(() => setError(true));
  }, [species]); // eslint-disable-line react-hooks/exhaustive-deps

  // Update colors when selection or species changes
  useEffect(() => {
    if (!loaded || !svgRef.current) return;
    d3.select(svgRef.current)
      .selectAll<SVGPathElement, any>("path")
      .attr("fill", d => {
        const fips = String(d.id).padStart(2, "0");
        const abbr = fipsToAbbr[fips];
        return abbr ? getStateColor(abbr) : config.colors.closed;
      });
  }, [selectedState, getStateColor, loaded, config]);

  if (error) {
    return (
      <div className="text-center py-12 text-muted-foreground font-body">
        <p>Map failed to load. Use the state list below to browse seasons.</p>
      </div>
    );
  }

  // Build legend from species colors
  const legendItems: [string, string][] = [
    ["Open Now", config.colors.open],
    ["< 30 Days", config.colors.soon],
    ["Upcoming", config.colors.upcoming],
    ["Closed / No Data", config.colors.closed],
    ["Selected", config.colors.selected],
  ];

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
        style={{ maxHeight: "70vh", touchAction: "manipulation" }}
      />
      <div
        ref={tooltipRef}
        className="absolute pointer-events-none z-50 bg-card border border-border rounded-lg px-3 py-2 shadow-xl font-body transition-opacity duration-150"
        style={{ opacity: 0 }}
      />

      {/* Legend */}
      <div className="flex flex-wrap justify-center gap-4 mt-4 text-xs font-body text-muted-foreground">
        {legendItems.map(([label, color]) => (
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
