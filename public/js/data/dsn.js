// NASA Deep Space Network: parser and simulated fleet.
// STUB, implemented in Phase 2 (Agent A). The interface is fixed:
//
//   parseDsn(xmlText) -> Array<DsnLink>
//   class SimulatedDsn { constructor({ seed }); step(dtReal) -> Array<DsnLink> }
//
//   DsnLink = { id, name, station, dish, rangeKm, rtlt, dataRate, power, band }

export function parseDsn(_xml) {
  return [];
}

export class SimulatedDsn {
  constructor() {}
  step() {
    return [];
  }
}
