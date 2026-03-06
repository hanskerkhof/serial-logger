import { Injectable, computed, signal } from '@angular/core';

export type FixtureSource = 'fixture_query' | 'plan_query' | 'plan_group_query';

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

interface FixtureStoreSnapshot {
  version: 1;
  fixturesByName: Record<string, FixtureRecord>;
  selectedFixtureName: string | null;
}

const fixtureStoreStorageKey = 'cmdr.fixtureStore.v1';

@Injectable({ providedIn: 'root' })
export class FixtureStoreService {
  readonly fixturesByName = signal<Record<string, FixtureRecord>>({});
  readonly selectedFixtureName = signal<string | null>(null);
  readonly storageWarning = signal<string | null>(null);

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

  constructor() {
    this.hydrateFromStorage();
  }

  upsertFixtures(fixtures: FixtureRecord[]): void {
    this.fixturesByName.update((current) => {
      const next = { ...current };
      for (const fixture of fixtures) {
        next[fixture.fixture_name] = fixture;
      }
      return next;
    });
    this.persistToStorage();
  }

  setSelectedFixture(fixture_name: string | null): void {
    this.selectedFixtureName.set(fixture_name);
    this.persistToStorage();
  }

  removeFixture(fixtureName: string): void {
    this.fixturesByName.update((current) => {
      if (!(fixtureName in current)) return current;
      const next = { ...current };
      delete next[fixtureName];
      return next;
    });

    if (this.selectedFixtureName() === fixtureName) {
      this.selectedFixtureName.set(null);
    }
    this.persistToStorage();
  }

  removePlan(planName: string): void {
    const selected = this.selectedFixture();

    this.fixturesByName.update((current) => {
      const next: Record<string, FixtureRecord> = {};
      for (const [fixtureName, fixture] of Object.entries(current)) {
        if (fixture.plan_name !== planName) {
          next[fixtureName] = fixture;
        }
      }
      return next;
    });

    if (selected?.plan_name === planName) {
      this.selectedFixtureName.set(null);
    }
    this.persistToStorage();
  }

  clearAllFixtures(): void {
    this.fixturesByName.set({});
    this.selectedFixtureName.set(null);
    this.persistToStorage();
  }

  hydrateFromStorage(): void {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(fixtureStoreStorageKey);
    } catch {
      this.storageWarning.set('Fixture cache unavailable: browser storage is not accessible.');
      return;
    }

    if (!raw) {
      this.storageWarning.set(null);
      return;
    }

    try {
      const parsed = JSON.parse(raw) as Partial<FixtureStoreSnapshot>;
      const validated = this.validateSnapshot(parsed);
      if (!validated) {
        this.fixturesByName.set({});
        this.selectedFixtureName.set(null);
        this.storageWarning.set('Stored fixture cache was invalid and has been reset.');
        return;
      }

      this.fixturesByName.set(validated.fixturesByName);
      const selected = validated.selectedFixtureName;
      this.selectedFixtureName.set(selected && validated.fixturesByName[selected] ? selected : null);
      this.storageWarning.set(null);
    } catch {
      this.fixturesByName.set({});
      this.selectedFixtureName.set(null);
      this.storageWarning.set('Stored fixture cache could not be parsed and has been reset.');
    }
  }

  private persistToStorage(): void {
    try {
      const snapshot: FixtureStoreSnapshot = {
        version: 1,
        fixturesByName: this.fixturesByName(),
        selectedFixtureName: this.selectedFixtureName(),
      };
      localStorage.setItem(fixtureStoreStorageKey, JSON.stringify(snapshot));
      this.storageWarning.set(null);
    } catch {
      this.storageWarning.set('Could not save fixture cache (storage quota or browser restriction).');
    }
  }

  private validateSnapshot(snapshot: Partial<FixtureStoreSnapshot>): FixtureStoreSnapshot | null {
    if (!snapshot || snapshot.version !== 1) return null;
    if (typeof snapshot.fixturesByName !== 'object' || snapshot.fixturesByName === null) return null;

    const fixturesByName: Record<string, FixtureRecord> = {};
    for (const [name, candidate] of Object.entries(snapshot.fixturesByName)) {
      if (!candidate || typeof candidate !== 'object') return null;
      const record = candidate as Partial<FixtureRecord>;
      if (typeof record.fixture_name !== 'string' || !record.fixture_name.trim()) return null;
      if (record.fixture_name !== name) return null;
      if (typeof record.plan_name !== 'string' || !record.plan_name.trim()) return null;
      if (typeof record.lastUpdatedAt !== 'string' || !record.lastUpdatedAt.trim()) return null;
      if (
        record.source !== 'fixture_query' &&
        record.source !== 'plan_query' &&
        record.source !== 'plan_group_query'
      ) {
        return null;
      }
      if (typeof record.raw !== 'object' || record.raw === null) return null;

      fixturesByName[name] = {
        fixture_name: record.fixture_name,
        plan_name: record.plan_name,
        raw: record.raw as Record<string, unknown>,
        lastUpdatedAt: record.lastUpdatedAt,
        source: record.source,
      };
    }

    const selectedFixtureName =
      typeof snapshot.selectedFixtureName === 'string' && snapshot.selectedFixtureName.trim()
        ? snapshot.selectedFixtureName
        : null;

    return {
      version: 1,
      fixturesByName,
      selectedFixtureName,
    };
  }
}
