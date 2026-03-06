import { Injectable, computed, signal } from '@angular/core';

export type FixtureSource = 'fixture_query' | 'plan_query';

export interface FixtureRecord {
  fixture_name: string;
  plan_name: string;
  raw: Record<string, unknown>;
  lastUpdatedAt: string;
  source: FixtureSource;
}

export interface FixturePlanGroup {
  plan_name: string;
  fixtures: FixtureRecord[];
}

@Injectable({ providedIn: 'root' })
export class FixtureStoreService {
  readonly fixturesByName = signal<Record<string, FixtureRecord>>({});
  readonly selectedFixtureName = signal<string | null>(null);

  readonly fixtureCount = computed(() => Object.keys(this.fixturesByName()).length);

  readonly selectedFixture = computed(() => {
    const selectedName = this.selectedFixtureName();
    if (!selectedName) return null;
    return this.fixturesByName()[selectedName] ?? null;
  });

  readonly fixturesGroupedByPlanName = computed<FixturePlanGroup[]>(() => {
    const grouped = new Map<string, FixtureRecord[]>();

    for (const fixture of Object.values(this.fixturesByName())) {
      const existing = grouped.get(fixture.plan_name) ?? [];
      existing.push(fixture);
      grouped.set(fixture.plan_name, existing);
    }

    return Array.from(grouped.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([plan_name, fixtures]) => ({
        plan_name,
        fixtures: fixtures.slice().sort((a, b) => a.fixture_name.localeCompare(b.fixture_name)),
      }));
  });

  upsertFixtures(fixtures: FixtureRecord[]): void {
    this.fixturesByName.update((current) => {
      const next = { ...current };
      for (const fixture of fixtures) {
        next[fixture.fixture_name] = fixture;
      }
      return next;
    });
  }

  setSelectedFixture(fixture_name: string | null): void {
    this.selectedFixtureName.set(fixture_name);
  }
}
