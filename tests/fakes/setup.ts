import { DEFAULT_PARAMS, type Params } from '../../src/config/params.js';
import type { Ctx } from '../../src/engine/context.js';
import { Engine } from '../../src/engine/engine.js';
import { Halt } from '../../src/engine/halt.js';
import { openDb } from '../../src/store/db.js';
import { Repo } from '../../src/store/repo.js';
import { FakeExchange } from './fakeExchange.js';

export function makeEngine(over: Partial<Params> = {}) {
  const fx = new FakeExchange();
  const repo = new Repo(openDb(':memory:'));
  const halt = new Halt(repo);
  let clock = 1_699_999_200 + 10; // HH:00:10 (1_699_999_200 is an exact hour)
  const now = () => clock;
  fx.now = now;
  const c: Ctx = { port: fx, repo, params: { ...DEFAULT_PARAMS, ...over }, halt, configHash: 'test', sleep: async () => undefined, now };
  const engine = new Engine(c);
  return { fx, repo, halt, c, engine, exec: engine.exec, advance: (s: number) => (clock += s), setClock: (t: number) => (clock = t) };
}
