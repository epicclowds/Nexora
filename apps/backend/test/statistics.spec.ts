import { describe, expect, it } from 'vitest';
import { dailySeries, rangeTotals, type Snapshot, sumByKey, truncateToHour } from '../src/statistics/aggregation';

const snap = (scope: string, statKey: string, value: number, iso: string): Snapshot => ({ scope, statKey, value: BigInt(value), capturedAt: new Date(iso) });
const K = 'mnm:blocks_mined';

describe('rangeTotals', () => {
  it('sums increments after the baseline, across servers', () => {
    const totals = rangeTotals(
      [
        snap('lobby', K, 100, '2026-11-20T10:00:00Z'), // baseline before range
        snap('lobby', K, 150, '2026-11-25T10:00:00Z'),
        snap('lobby', K, 180, '2026-11-26T10:00:00Z'),
        snap('survival', K, 10, '2026-11-25T12:00:00Z'), // first ever value on this server: no known start
        snap('survival', K, 40, '2026-11-26T12:00:00Z'),
      ],
      new Date('2026-11-24T00:00:00Z'),
      new Date('2026-11-27T00:00:00Z'),
    );
    expect(totals.get(K)).toBe(80n + 30n);
  });

  it('treats a decrease as a counter reset instead of a negative delta', () => {
    const totals = rangeTotals(
      [snap('lobby', K, 500, '2026-11-24T01:00:00Z'), snap('lobby', K, 20, '2026-11-25T01:00:00Z'), snap('lobby', K, 50, '2026-11-26T01:00:00Z')],
      new Date('2026-11-24T00:00:00Z'),
      new Date('2026-11-27T00:00:00Z'),
    );
    expect(totals.get(K)).toBe(20n + 30n);
  });

  it('ignores snapshots after the range end', () => {
    const totals = rangeTotals([snap('lobby', K, 1, '2026-11-24T01:00:00Z'), snap('lobby', K, 9, '2026-11-28T01:00:00Z')], new Date('2026-11-24T00:00:00Z'), new Date('2026-11-27T00:00:00Z'));
    expect(totals.get(K)).toBe(0n);
  });
});

describe('dailySeries', () => {
  it('attributes increments to the local day of the snapshot hour', () => {
    const series = dailySeries(
      [snap('lobby', K, 10, '2026-11-24T22:00:00Z'), snap('lobby', K, 25, '2026-11-24T23:00:00Z'), snap('lobby', K, 30, '2026-11-25T10:00:00Z')],
      [K],
      ['2026-11-24', '2026-11-25'],
      'Europe/Berlin',
    );
    // 23:00 UTC is already Nov 25 in Berlin.
    expect(series[K]).toEqual([0, 15 + 5]);
  });
});

describe('helpers', () => {
  it('truncates to the hour and sums values per key', () => {
    expect(truncateToHour(new Date('2026-11-25T10:59:59.999Z')).toISOString()).toBe('2026-11-25T10:00:00.000Z');
    expect(sumByKey([{ statKey: K, value: 2n }, { statKey: K, value: 3n }, { statKey: 'x', value: 1n }]).get(K)).toBe(5n);
  });
});
