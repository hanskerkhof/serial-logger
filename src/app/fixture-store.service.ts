import { Injectable, computed, signal } from '@angular/core';

export type FixtureSource = 'fixture_query' | 'plan_query' | 'plan_group_query' | 'discovery_query';

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

  upsertFixtures(fixtures: FixtureRecord[]): { added: number; updated: number } {
    const current = this.fixturesByName();
    const currentByMac = new Map<string, string>();
    for (const existing of Object.values(current)) {
      const mac = this.readFixtureMac(existing);
      if (mac && !currentByMac.has(mac)) {
        currentByMac.set(mac, existing.fixture_name);
      }
    }
    const mergedByName = new Map<string, FixtureRecord>();

    for (const fixture of fixtures) {
      const incomingMac = this.readFixtureMac(fixture);
      const canonicalNameForMac = incomingMac ? currentByMac.get(incomingMac) : undefined;
      if (incomingMac && canonicalNameForMac && canonicalNameForMac !== fixture.fixture_name) {
        console.warn('[cmdr][fixture-store] mac_conflict_merge', {
          mac: incomingMac,
          incoming_fixture_name: fixture.fixture_name,
          canonical_fixture_name: canonicalNameForMac,
        });
        const canonicalCurrent = current[canonicalNameForMac];
        const canonicalIncoming = mergedByName.get(canonicalNameForMac);
        const canonicalBase = canonicalIncoming ?? canonicalCurrent;
        mergedByName.set(canonicalNameForMac, {
          ...fixture,
          fixture_name: canonicalNameForMac,
          plan_name: canonicalBase?.plan_name || fixture.plan_name,
          raw: {
            ...(canonicalBase?.raw ?? {}),
            ...(fixture.raw ?? {}),
            fixture_name: canonicalNameForMac,
            wifi_mac_address: incomingMac,
          },
        });
        continue;
      }
      if (incomingMac && !canonicalNameForMac) {
        currentByMac.set(incomingMac, fixture.fixture_name);
      }
      mergedByName.set(fixture.fixture_name, fixture);
    }

    let added = 0;
    let updated = 0;

    for (const fixture of mergedByName.values()) {
      if (fixture.fixture_name in current) {
        updated++;
      } else {
        added++;
      }
    }

    this.fixturesByName.update((cur) => {
      const next = { ...cur };
      for (const fixture of mergedByName.values()) {
        next[fixture.fixture_name] = fixture;
      }
      return next;
    });
    this.persistToStorage();
    return { added, updated };
  }

  private readFixtureMac(fixture: FixtureRecord): string | null {
    const raw = fixture.raw ?? {};
    const direct = this.normalizeMac(raw['wifi_mac_address']);
    if (direct) return direct;
    return this.normalizeMac(raw['target_wifi_mac']);
  }

  private normalizeMac(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const text = value.trim().toUpperCase().replaceAll('-', ':');
    if (!text) return null;
    const parts = text.split(':');
    if (parts.length !== 6) return null;
    const normalized: string[] = [];
    for (const part of parts) {
      if (!/^[0-9A-F]{1,2}$/.test(part)) return null;
      normalized.push(part.padStart(2, '0'));
    }
    return normalized.join(':');
  }

  setSelectedFixture(fixture_name: string | null): void {
    this.selectedFixtureName.set(fixture_name);
    this.persistToStorage();
  }

  /**
   * Merge a partial set of `raw` fields into an existing fixture record without
   * replacing the whole record. Silently no-ops when the fixture is not in the
   * store. Used by passive discovery to keep fw_version / build_date / build_time
   * up-to-date from heartbeat data without waiting for a full query.
   */
  patchFixtureRaw(fixtureName: string, fields: Record<string, unknown>): void {
    this.fixturesByName.update((current) => {
      if (!(fixtureName in current)) return current;
      const existing = current[fixtureName];
      return {
        ...current,
        [fixtureName]: {
          ...existing,
          raw: { ...existing.raw, ...fields },
        },
      };
    });
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
        record.source !== 'plan_group_query' &&
        record.source !== 'discovery_query'
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
