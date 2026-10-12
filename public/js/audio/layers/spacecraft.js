// STUB, implemented in Phase 2 (Agent A).
import BaseLayer from './base.js';

export default class SpacecraftLayer extends BaseLayer {
  static id = 'spacecraft';
  static label = 'Spacecraft';
  static description = 'Deep Space Network → voices';

  constructor(engine) {
    super(engine, { gain: 0.3, reverb: 0.5 });
  }
}
