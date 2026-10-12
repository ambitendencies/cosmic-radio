// STUB, implemented in Phase 2 (Agent B).
import BaseLayer from './base.js';

export default class BellsLayer extends BaseLayer {
  static id = 'bells';
  static label = 'Flare Bells';
  static description = 'X-ray flux → chimes';

  constructor(engine) {
    super(engine, { gain: 0.3, reverb: 0.5 });
  }
}
