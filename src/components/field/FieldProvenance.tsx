/**
 * FieldProvenance.tsx — the foot of the glass. One block, every method, once.
 *
 * There is no state and no logic here: `./fieldProvenance.ts` is the pure list
 * and this is the mark that draws it. The split is the same one `ink.ts` made
 * out of `Instrument.tsx` — a component file exports components, and a list of
 * sentences derived from readings is not a mark on the glass.
 *
 * IT IS A REAL SLOT, NOT A FOOTER. `<section>`, in the flow, last, never
 * `aria-hidden`, never inside a `<details>`, never behind a tap. It is the last
 * thing on the surface because it is the last thing a hunter needs, and it is
 * the smallest thing on the surface because it is the least urgent — hierarchy
 * by size and position, which is the only hierarchy this product has.
 */

import { Provenance, RailLabel } from "./Instrument";
import { HAIRLINE } from "./ink";
import { provenanceSegments, type ProvenanceInputs } from "./provenance";

export function FieldProvenance(props: ProvenanceInputs) {
  const items = provenanceSegments(props);
  if (items.length === 0) return null;
  return (
    <section className={`border-t ${HAIRLINE} px-4 pb-2 pt-1`} aria-label="How these numbers were made">
      <RailLabel>how these numbers were made</RailLabel>
      <Provenance items={items} className="mt-0.5" />
    </section>
  );
}
