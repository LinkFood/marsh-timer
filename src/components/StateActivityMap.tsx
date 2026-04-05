import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

// Approximate US grid positions for 50 states (row, col in a 11x8 grid)
const STATE_POSITIONS: Record<string, [number, number]> = {
  AK:[0,0], HI:[7,0],
  WA:[1,1], OR:[2,1], CA:[3,1], NV:[3,2], ID:[1,2], MT:[1,3], WY:[2,3], UT:[3,3],
  CO:[3,4], AZ:[4,2], NM:[4,3],
  ND:[1,4], SD:[2,4], NE:[2,5], KS:[3,5], OK:[4,5], TX:[5,4],
  MN:[1,5], IA:[2,6], MO:[3,6], AR:[4,6], LA:[5,5], MS:[5,6],
  WI:[1,6], IL:[2,7], IN:[2,8], MI:[1,7], OH:[2,9],
  KY:[3,7], TN:[4,7], AL:[5,7], GA:[5,8],
  FL:[6,8], SC:[5,9], NC:[4,8], VA:[3,8], WV:[3,9],
  PA:[2,10], NJ:[3,10], DE:[4,10], MD:[4,9],
  NY:[1,9], CT:[2,11], RI:[2,12], MA:[1,10],
  VT:[0,10], NH:[0,11], ME:[0,12],
};

interface StateScore {
  state_abbr: string;
  score: number;
}

export default function StateActivityMap({ onStateClick }: { onStateClick?: (abbr: string) => void }) {
  const [scores, setScores] = useState<StateScore[]>([]);

  useEffect(() => {
    if (!supabase) return;
    supabase
      .from('hunt_convergence_scores')
      .select('state_abbr,score')
      .order('score', { ascending: false })
      .limit(50)
      .then(({ data }) => {
        if (data) setScores(data.map(d => ({ state_abbr: d.state_abbr, score: d.score })));
      })
      .catch(() => {});
  }, []);

  if (scores.length === 0) return null;

  const scoreMap = new Map(scores.map(s => [s.state_abbr, s.score]));
  const maxScore = Math.max(...scores.map(s => s.score), 1);

  return (
    <div className="flex justify-center">
      <div className="relative" style={{ width: 200, height: 120 }}>
        {Object.entries(STATE_POSITIONS).map(([abbr, [row, col]]) => {
          const score = scoreMap.get(abbr) || 0;
          const intensity = score / maxScore;
          const size = 4 + intensity * 6; // 4-10px
          const opacity = 0.15 + intensity * 0.6;
          const color = intensity > 0.7 ? 'bg-cyan-400' : intensity > 0.4 ? 'bg-cyan-400/70' : 'bg-white/30';

          return (
            <button
              key={abbr}
              onClick={() => onStateClick?.(abbr)}
              className={`absolute rounded-full ${color} transition-all hover:scale-150 hover:opacity-100`}
              style={{
                left: col * 15 + 5,
                top: row * 14 + 5,
                width: size,
                height: size,
                opacity,
              }}
              title={`${abbr}: ${score}`}
            />
          );
        })}
      </div>
    </div>
  );
}
