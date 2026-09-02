import { advanceState, applyFollowerEvent, catchUpRealTime, createInitialState, toResponse } from './SyntheticCopyTradingEngine';
import { SyntheticCopyResponse, SyntheticCopyState, SyntheticFollowerEvent, SyntheticMode } from './types';

export interface SyntheticStateStore {
  load(): Promise<SyntheticCopyState | null>;
  save(state: SyntheticCopyState): Promise<void>;
}

export class MemorySyntheticStateStore implements SyntheticStateStore {
  constructor(private state: SyntheticCopyState | null = null) {}
  async load() { return this.state ? JSON.parse(JSON.stringify(this.state)) : null; }
  async save(state: SyntheticCopyState) { this.state = JSON.parse(JSON.stringify(state)); }
}

export class SyntheticCopyTradingService {
  constructor(private store: SyntheticStateStore, private now: () => Date = () => new Date()) {}

  private async current(): Promise<SyntheticCopyState> {
    const stored = await this.store.load();
    if (!stored) {
      const initial = createInitialState(this.now());
      await this.store.save(initial);
      return initial;
    }
    const caughtUp = catchUpRealTime(stored, this.now());
    if (caughtUp.simulatedAt !== stored.simulatedAt) await this.store.save(caughtUp);
    return caughtUp;
  }

  async get(): Promise<SyntheticCopyResponse> { return toResponse(await this.current()); }

  async advance(days: 1 | 7 | 30 | 90): Promise<SyntheticCopyResponse> {
    const advanced = advanceState(await this.current(), days);
    await this.store.save(advanced);
    return toResponse(advanced);
  }

  async reset(): Promise<SyntheticCopyResponse> {
    const reset = createInitialState(this.now());
    await this.store.save(reset);
    return toResponse(reset);
  }

  async setMode(mode: SyntheticMode): Promise<SyntheticCopyResponse> {
    const state = await this.current();
    state.mode = mode;
    await this.store.save(state);
    return toResponse(state);
  }

  async followerEvent(event: SyntheticFollowerEvent): Promise<SyntheticCopyResponse> {
    const state = applyFollowerEvent(await this.current(), event);
    await this.store.save(state);
    return toResponse(state);
  }
}
