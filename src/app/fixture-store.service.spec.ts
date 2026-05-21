import { TestBed } from '@angular/core/testing';

import { FixtureRecord, FixtureStoreService } from './fixture-store.service';

function fixtureRecord(name: string, raw: Record<string, unknown> = {}): FixtureRecord {
  return {
    fixture_name: name,
    plan_name: 'TEST_PLAN',
    raw,
    lastUpdatedAt: '2026-05-21T12:00:00.000Z',
    source: 'fixture_query',
  };
}

describe('FixtureStoreService offline state', () => {
  let service: FixtureStoreService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
    service = TestBed.inject(FixtureStoreService);
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('marks one fixture offline after an authoritative commander signal', () => {
    service.upsertFixtures([fixtureRecord('FIXTURE_A'), fixtureRecord('FIXTURE_B')]);

    service.staleFixture('FIXTURE_A');

    expect(service.fixturesByName()['FIXTURE_A']?.stale).toBeTrue();
    expect(typeof service.fixturesByName()['FIXTURE_A']?.staleAt).toBe('number');
    expect(service.fixturesByName()['FIXTURE_B']?.stale).toBeUndefined();
  });

  it('clears offline only when a live fixture_seen path calls unstaleFixture', () => {
    service.upsertFixtures([fixtureRecord('FIXTURE_A')]);
    service.staleFixture('FIXTURE_A');

    service.upsertFixtures([fixtureRecord('FIXTURE_A', { online: true, last_seen_ms: 1234 })]);

    expect(service.fixturesByName()['FIXTURE_A']?.stale).toBeTrue();

    service.unstaleFixture('FIXTURE_A');

    expect(service.fixturesByName()['FIXTURE_A']?.stale).toBeFalse();
    expect(service.fixturesByName()['FIXTURE_A']?.staleAt).toBeUndefined();
  });

  it('keeps offline fixtures visible until an explicit remove action', () => {
    service.upsertFixtures([fixtureRecord('FIXTURE_A')]);
    service.staleFixture('FIXTURE_A');

    expect(service.fixtureCount()).toBe(1);
    expect(service.fixturesByName()['FIXTURE_A']?.stale).toBeTrue();
  });
});
