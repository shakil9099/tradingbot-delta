import { describe, expect, it } from 'vitest';
import { paramsFromEnv, parseEnv } from '../src/config/env.js';
import { buildParams, DEFAULT_PARAMS } from '../src/config/params.js';

const ENV = {
  DELTA_BASE_URL: 'https://api.india.delta.exchange',
  DASHBOARD_USER: 'u',
  DASHBOARD_PASSWORD_HASH: 'x'.repeat(30),
  SESSION_SECRET: 's'.repeat(32),
  CTL_TOKEN: 't'.repeat(32),
};

describe('strategy exit preset', () => {
  it('STRATEGY=reversal: no break-even, no trail, TP 2R by default', () => {
    expect(buildParams({ STRATEGY: 'reversal' })).toMatchObject({ BE_TRIG_R: 0, BE_TRIG_USD: 0, TRAIL_ATR_MULT: 0, TP_R: 2 });
  });
  it('STRATEGY=reversal honours a TP_R override, including 0', () => {
    expect(buildParams({ STRATEGY: 'reversal', TP_R: 3 }).TP_R).toBe(3);
    expect(buildParams({ STRATEGY: 'reversal', TP_R: 0 }).TP_R).toBe(0);
  });
  it('STRATEGY=hull keeps the Hull exits', () => {
    expect(buildParams({ STRATEGY: 'hull' })).toMatchObject({
      BE_TRIG_R: DEFAULT_PARAMS.BE_TRIG_R,
      TRAIL_ATR_MULT: DEFAULT_PARAMS.TRAIL_ATR_MULT,
      TP_R: DEFAULT_PARAMS.TP_R,
    });
  });
  it('.env: BE_TRIG_USD defaults to 15 and can be overridden', () => {
    expect(paramsFromEnv(parseEnv(ENV)).BE_TRIG_USD).toBe(15);
    expect(paramsFromEnv(parseEnv({ ...ENV, BE_TRIG_USD: '0' })).BE_TRIG_USD).toBe(0);
  });
  it('.env: REV_REENTRY defaults to false and parses true', () => {
    expect(paramsFromEnv(parseEnv(ENV)).REV_REENTRY).toBe(false);
    expect(paramsFromEnv(parseEnv({ ...ENV, REV_REENTRY: 'true' })).REV_REENTRY).toBe(true);
    expect(paramsFromEnv(parseEnv({ ...ENV, REV_REENTRY: 'false' })).REV_REENTRY).toBe(false);
  });
  it('.env: TP_R unset or empty uses the default; a value overrides it', () => {
    expect(paramsFromEnv(parseEnv({ ...ENV, STRATEGY: 'reversal' })).TP_R).toBe(2);
    expect(paramsFromEnv(parseEnv({ ...ENV, STRATEGY: 'reversal', TP_R: '' })).TP_R).toBe(2);
    expect(paramsFromEnv(parseEnv({ ...ENV, STRATEGY: 'reversal', TP_R: '1.5' })).TP_R).toBe(1.5);
    expect(() => parseEnv({ ...ENV, TP_R: '-1' })).toThrow();
  });
});
