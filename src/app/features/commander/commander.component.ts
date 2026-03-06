import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnInit,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import {
  CommanderApiService,
  CommanderHealthResponse,
  CommanderApiTarget,
  CommanderQueryResponse,
} from '../../commander-api.service';
import { FixtureRecord, FixtureSource, FixtureStoreService } from '../../fixture-store.service';

@Component({
  selector: 'app-commander',
  imports: [FormsModule],
  templateUrl: './commander.component.html',
  styleUrls: ['./commander.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommanderComponent implements OnInit {
  protected readonly loading = signal(true);
  protected readonly queryLoading = signal(false);
  protected readonly health = signal<CommanderHealthResponse | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly customUrl = signal('');
  protected readonly fixtureName = signal('CLIGNOTEUR1');
  protected readonly planName = signal('TRIPTYCH');
  protected readonly queryResult = signal<CommanderQueryResponse | null>(null);

  @ViewChild('fixtureDetailDialog') fixtureDetailDialog!: ElementRef<HTMLDialogElement>;

  private readonly commanderApi = inject(CommanderApiService);
  private readonly fixtureStore = inject(FixtureStoreService);

  protected readonly targets: readonly CommanderApiTarget[] = this.commanderApi.targets;
  protected readonly activeApiUrl = this.commanderApi.apiBaseUrl;
  protected readonly groupedFixtures = this.fixtureStore.fixturesGroupedByPlanName;
  protected readonly selectedFixtureName = this.fixtureStore.selectedFixtureName;
  protected readonly selectedFixture = this.fixtureStore.selectedFixture;
  protected readonly fixtureCount = this.fixtureStore.fixtureCount;
  protected readonly selectedFixtureJson = computed(() => {
    const selected = this.selectedFixture();
    return selected ? JSON.stringify(selected.raw, null, 2) : '';
  });

  ngOnInit(): void {
    this.customUrl.set(this.activeApiUrl());
    this.loadHealth();
  }

  protected reloadHealth(): void {
    this.loadHealth();
  }

  protected useTarget(url: string): void {
    this.commanderApi.setApiBaseUrl(url);
    this.customUrl.set(this.activeApiUrl());
    this.loadHealth();
  }

  protected applyCustomUrl(): void {
    const ok = this.commanderApi.setApiBaseUrl(this.customUrl());
    if (!ok) {
      this.error.set('Invalid API URL. Use host[:port] or http(s)://host[:port].');
      return;
    }

    this.customUrl.set(this.activeApiUrl());
    this.loadHealth();
  }

  protected runFixtureQuery(): void {
    const fixture = this.fixtureName().trim();
    if (!fixture) {
      this.error.set('Fixture name is required.');
      return;
    }

    this.queryLoading.set(true);
    this.error.set(null);
    this.commanderApi.getFixtureVersion(fixture).subscribe({
      next: (result) => {
        this.queryResult.set(result);
        this.ingestQueryResult(result, 'fixture_query');
        this.queryLoading.set(false);
      },
      error: (err: unknown) => {
        this.error.set(this.formatError(`Fixture query failed for ${fixture}`, err));
        this.queryResult.set(null);
        this.queryLoading.set(false);
      },
    });
  }

  protected runPlanQuery(): void {
    const plan = this.planName().trim();
    if (!plan) {
      this.error.set('Plan name is required.');
      return;
    }

    this.queryLoading.set(true);
    this.error.set(null);
    this.commanderApi.getPlanVersions(plan).subscribe({
      next: (result) => {
        this.queryResult.set(result);
        this.ingestQueryResult(result, 'plan_query');
        this.queryLoading.set(false);
      },
      error: (err: unknown) => {
        this.error.set(this.formatError(`Plan query failed for ${plan}`, err));
        this.queryResult.set(null);
        this.queryLoading.set(false);
      },
    });
  }

  protected queryResultJson(): string {
    const result = this.queryResult();
    return result ? JSON.stringify(result, null, 2) : '';
  }

  protected selectFixture(record: FixtureRecord): void {
    this.fixtureStore.setSelectedFixture(record.fixture_name);
    this.fixtureName.set(record.fixture_name);
    this.openFixtureModal();
  }

  protected closeFixtureModal(): void {
    this.fixtureDetailDialog?.nativeElement?.close();
  }

  private openFixtureModal(): void {
    const dialog = this.fixtureDetailDialog?.nativeElement;
    if (!dialog) return;
    if (!dialog.open) {
      dialog.showModal();
    }
  }

  private ingestQueryResult(result: CommanderQueryResponse, source: FixtureSource): void {
    const fixtures = this.extractFixtures(result, source);
    if (!fixtures.length) {
      return;
    }

    this.fixtureStore.upsertFixtures(fixtures);
  }

  private extractFixtures(result: CommanderQueryResponse, source: FixtureSource): FixtureRecord[] {
    const summary = this.getSummary(result);
    if (!summary || typeof summary !== 'object') {
      return [];
    }

    const extracted = this.extractFixturePayloads(summary);
    if (!extracted.length) {
      return [];
    }

    const now = new Date().toISOString();
    const records: FixtureRecord[] = [];

    for (const item of extracted) {
      const fixture_name = this.readString(item, 'fixture_name');
      const plan_name = this.readString(item, 'plan_name');

      if (!fixture_name) {
        this.error.set(`Fixture payload missing fixture_name: ${JSON.stringify(item)}`);
        continue;
      }
      if (!plan_name) {
        this.error.set(`Fixture payload missing plan_name for ${fixture_name}.`);
        continue;
      }

      records.push({
        fixture_name,
        plan_name,
        raw: item,
        lastUpdatedAt: now,
        source,
      });
    }

    return records;
  }

  private getSummary(result: CommanderQueryResponse): unknown {
    return typeof result === 'object' && result !== null && 'summary' in result
      ? (result as { summary?: unknown }).summary
      : null;
  }

  private extractFixturePayloads(summary: unknown): Record<string, unknown>[] {
    if (typeof summary !== 'object' || summary === null) {
      return [];
    }

    const asSummary = summary as { fixtures?: unknown; fixture_name?: unknown };

    if (Array.isArray(asSummary.fixtures)) {
      return asSummary.fixtures.filter((item): item is Record<string, unknown> => {
        return typeof item === 'object' && item !== null;
      });
    }

    if (typeof asSummary.fixture_name === 'string') {
      return [summary as Record<string, unknown>];
    }

    return [];
  }

  private readString(item: Record<string, unknown>, key: string): string | null {
    const value = item[key];
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }

  private loadHealth(): void {
    this.loading.set(true);
    this.error.set(null);

    this.commanderApi.getHealth().subscribe({
      next: (result) => {
        this.health.set(result);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.error.set(this.formatError(`Health check failed for ${this.activeApiUrl()}`, err));
        this.health.set(null);
        this.loading.set(false);
      },
    });
  }

  private formatError(prefix: string, err: unknown): string {
    if (err instanceof HttpErrorResponse) {
      const detail =
        typeof err.error === 'object' && err.error !== null && 'detail' in err.error
          ? (err.error as { detail?: unknown }).detail
          : err.error;
      const detailText =
        detail == null
          ? err.message
          : typeof detail === 'string'
            ? detail
            : JSON.stringify(detail, null, 2);

      if (err.status === 0) {
        return `${prefix} (Network/CORS): ${detailText}`;
      }

      return `${prefix} (HTTP ${err.status}): ${detailText}`;
    }

    if (err instanceof Error) {
      return `${prefix} (${err.name}: ${err.message})`;
    }

    if (typeof err === 'object' && err !== null) {
      return `${prefix}: ${JSON.stringify(err, null, 2)}`;
    }

    return `${prefix}: ${String(err)}`;
  }
}
