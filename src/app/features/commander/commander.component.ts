import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { SwUpdate } from '@angular/service-worker';
import { FormsModule } from '@angular/forms';
import { firstValueFrom, Subscription } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { ButtonModule } from 'primeng/button';
import { InputGroupModule } from 'primeng/inputgroup';
import { InputGroupAddonModule } from 'primeng/inputgroupaddon';
import { InputTextModule } from 'primeng/inputtext';
import { SelectChangeEvent, SelectModule } from 'primeng/select';
import { ToastModule } from 'primeng/toast';
import { PanelModule } from 'primeng/panel';
import { BadgeModule } from 'primeng/badge';
import { DialogModule } from 'primeng/dialog';
import { MessageService, MenuItem } from 'primeng/api';
import { SplitButtonModule } from 'primeng/splitbutton';
import { TabsModule } from 'primeng/tabs';
import { DrawerModule } from 'primeng/drawer';
import { NgTemplateOutlet } from '@angular/common';
import { APP_VERSION, BUILD_DATE } from '../../build-info';
import { FIXTURE_DETAIL_DRAWER } from '../../feature-flags';
import {
  CommanderApiService,
  CommanderExposedPlan,
  CommanderLanGroup,
  CommanderHealthResponse,
  CommanderApiTarget,
  CommanderQueryResponse,
  FixturePlanActionResponse,
  RawCommandResponse,
  OtaStreamEvent,
} from '../../commander-api.service';
import {
  CmdrCustomCommandUiArg,
  CmdrCustomCommandUiItem,
  CmdrFixtureCapabilities,
  CmdrFixtureConfig,
  CmdrFixtureConfigUi,
  CmdrFixtureRssiReport,
  CmdrPlanControls,
  CmdrPlayerCapabilities,
  CmdrRelayStateItem,
  CmdrVersionsResponse,
} from '../../api/cmdr-models';
import { FixturePlanGroup, FixtureRecord, FixtureSource, FixtureStoreService } from '../../fixture-store.service';
import { CommanderConsoleComponent } from './commander-console/commander-console.component';
import { FixturePlayerControlsComponent } from '../../shared/fixture-player-controls/fixture-player-controls.component';
import { FixturePlanControlComponent, PlanState } from '../../shared/fixture-plan-control/fixture-plan-control.component';
import {
  FixtureCustomArgChangedEvent,
  FixtureCustomControlComponent,
  FixtureCustomMasterReleasedEvent,
} from '../../shared/fixture-custom-control/fixture-custom-control.component';
import { FixtureConfigControlComponent } from '../../shared/fixture-config-control/fixture-config-control.component';
import { FixtureDocsComponent } from '../../shared/fixture-docs/fixture-docs.component';
import { CopyToClipboardComponent } from '../../shared/copy-to-clipboard/copy-to-clipboard.component';
import { HealthPollService } from '../../health-poll.service';

interface SelectOption {
  label: string;
  value: string;
}

type CustomCommandValue = string | number | boolean;
type FixtureModalFeedbackTone = 'info' | 'success' | 'warn' | 'error';
type SendCommandMode = 'default' | 'force_ack' | 'force_no_ack';

function compareVersions(a: string, b: string): number {
  const seg = (s: string) => s.replace(/^v/, '').split('.').map(Number);
  const [as_, bs_] = [seg(a), seg(b)];
  for (let i = 0; i < Math.max(as_.length, bs_.length); i++) {
    const diff = (as_[i] ?? 0) - (bs_[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

@Component({
  selector: 'app-commander',
  standalone: true,
  imports: [FormsModule, ButtonModule, SplitButtonModule, BadgeModule, InputGroupModule, InputGroupAddonModule, InputTextModule, SelectModule, ToastModule, PanelModule, DialogModule, DrawerModule, TabsModule, NgTemplateOutlet, CommanderConsoleComponent, FixturePlayerControlsComponent, FixturePlanControlComponent, FixtureCustomControlComponent, FixtureConfigControlComponent, FixtureDocsComponent, CopyToClipboardComponent],
  providers: [MessageService],
  templateUrl: './commander.component.html',
  styleUrls: ['./commander.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommanderComponent implements OnInit {
  protected readonly frontendVersion = APP_VERSION;
  protected readonly frontendBuildDate = BUILD_DATE;

  // Health service — injected early so signal aliases below can reference it at field-init time
  private readonly healthService = inject(HealthPollService);
  protected readonly health = this.healthService.health;
  protected readonly healthRefreshing = this.healthService.healthRefreshing;
  protected readonly healthError = this.healthService.healthError;
  protected readonly nextHealthPollCountdown = this.healthService.nextHealthPollCountdown;

  protected readonly loading = signal(true);
  protected readonly fixtureQueryLoading = signal(false);
  protected readonly planQueryLoading = signal(false);
  protected readonly planGroupQueryLoading = signal(false);
  protected readonly sidebarRefreshingFixture = signal<string | null>(null);
  protected readonly sidebarRefreshingPlan = signal<string | null>(null);
  protected readonly sidebarRefreshingPlanGroup = signal<string | null>(null);
  protected readonly discoveryLoading = signal(false);
  protected readonly discoverFixturesLoading = signal(false);
  protected readonly discoverFixturesCurrentFixture = signal<string | null>(null);
  protected readonly discoverFixturesElapsedS = signal<number>(0);
  protected readonly discoverFixturesLastDurationS = signal<number | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly customUrl = signal('');
  protected readonly fixtureName = signal(localStorage.getItem('cmdr.selectedFixture') ?? 'CLIGNOTEUR1');
  protected readonly planName = signal(localStorage.getItem('cmdr.selectedPlan') ?? 'TRIPTYCH');
  protected readonly planGroupName = signal(localStorage.getItem('cmdr.selectedPlanGroup') ?? '');
  protected readonly exposedPlans = signal<CommanderExposedPlan[]>([]);
  protected readonly lanGroups = signal<CommanderLanGroup[]>([]);
  protected readonly planListLoading = signal(false);
  protected readonly lanGroupListLoading = signal(false);
  protected readonly queryResult = signal<CommanderQueryResponse | null>(null);
  protected readonly fixtureActionLoading = signal(false);
  protected readonly fixtureActionResult = signal<FixturePlanActionResponse | null>(null);
  protected readonly fixtureActionMessage = signal<string | null>(null);
  protected readonly fixtureActionPastableCommand = computed(() =>
    this.extractPastableWireCommand(this.fixtureActionMessage()),
  );
  protected readonly fixtureActionTone = signal<FixtureModalFeedbackTone>('info');
  protected readonly fixtureActionDurationMs = signal<number | null>(null);
  protected readonly rebootConfirmPending = signal(false);
  protected readonly fixtureAckEnabled = signal(false);
  protected readonly fixtureModalTab = signal<string>('status');
  /** Tracks cached per plan name — persists across modal opens within the session. */
  private readonly planTracksCache = signal<Map<string, { index: number; name: string; duration_ms: number }[]>>(new Map());
  /** Tracks for the currently selected fixture's plan, null when not yet loaded. */
  protected readonly selectedFixtureTracks = computed(() => {
    const planName = this.selectedFixture()?.plan_name ?? null;
    return planName ? (this.planTracksCache().get(planName) ?? null) : null;
  });
  protected readonly rssiSessionLoading = signal(false);
  protected readonly rssiSessionCountdown = signal<number | null>(null);
  private rssiSessionTimer: ReturnType<typeof setInterval> | null = null;
  protected readonly otaInProgress = signal<Set<string>>(new Set());
  protected readonly selectedFixtureOtaInProgress = computed(() =>
    this.otaInProgress().has(this.selectedFixtureName() ?? ''),
  );
  protected readonly discoveryTimings = signal<number[]>(
    JSON.parse(localStorage.getItem('cmdr.discovery.timings') ?? '[]'),
  );
  protected readonly discoveryLastS = computed(() => {
    const t = this.discoveryTimings();
    return t.length > 0 ? t[t.length - 1] : null;
  });
  protected readonly discoveryAvgS = computed(() => {
    const t = this.discoveryTimings();
    return t.length > 0 ? t.reduce((s, v) => s + v, 0) / t.length : null;
  });
  protected readonly discoveryButtonLabel = computed(() => {
    const last = this.discoveryLastS();
    const avg = this.discoveryAvgS();
    const cnt = this.discoveryTimings().length;
    if (this.discoveryLoading()) {
      return avg !== null ? `Full Discovery · ~${avg.toFixed(1)}s` : 'Full Discovery';
    }
    if (last === null) return 'Full Discovery';
    if (cnt < 2) return `Full Discovery · ${last.toFixed(1)}s`;
    return `Full Discovery · ${last.toFixed(1)}s · avg ${avg!.toFixed(1)}s`;
  });
  protected readonly discoverFixturesButtonLabel = computed(() => {
    if (this.discoverFixturesLoading()) {
      const current = this.discoverFixturesCurrentFixture();
      const elapsed = this.discoverFixturesElapsedS().toFixed(1);
      return current
        ? `Query fixtures - ${current} - ${elapsed}s`
        : `Query fixtures - ${elapsed}s`;
    }
    const duration = this.discoverFixturesLastDurationS();
    if (duration === null) return 'Query fixtures';
    return `Query fixtures - DONE - ${duration.toFixed(2)}s`;
  });
  protected readonly manualCommand = signal('');
  protected readonly customCommandValues = signal<Record<string, Record<string, CustomCommandValue>>>({});
  protected readonly modalQueryLoading = signal(false);
  protected readonly modalQueryError = signal<string | null>(null);
  protected readonly fixtureModalVisible = signal(false);
  private modalQuerySub: Subscription | null = null;
  /** Fixture names that have been auto-queried on first modal open this session. */
  private readonly autoQueriedFixtures = new Set<string>();
  protected readonly rawCommand = signal('');
  protected readonly rawCommandLoading = signal(false);
  protected readonly rawCommandResult = signal<RawCommandResponse | null>(null);
  protected readonly rawCommandError = signal<string | null>(null);
  protected readonly backendBusy = computed(
    () => this.discoveryLoading() || this.fixtureQueryLoading() || this.planQueryLoading() || this.planGroupQueryLoading(),
  );
  protected readonly commanderUnavailable = computed(
    () => this.loading() || !!this.healthError() || this.health()?.commander?.detected !== true,
  );
  /** Human-readable reason shown in the fixture modal feedback strip when the commander is unavailable. */
  protected readonly commanderUnavailableReason = computed<string | null>(() => {
    if (!this.commanderUnavailable()) return null;
    if (this.loading()) return null;
    if (this.healthError()) return 'API unreachable';
    const commander = this.health()?.commander;
    if (!commander) return 'Commander not detected';
    if (commander['serial_hold_active'] === true) {
      const raw = String(commander['serial_hold_reason'] ?? '').trim();
      const label = raw ? raw.replace(/_/g, ' ') : 'serial hold';
      return `Serial port held (${label})`;
    }
    return 'Commander not detected';
  });
  /** True when the serial port was released via manual override (POST /commander/serial/release). */
  protected readonly commanderManualOverride = computed(
    () => this.health()?.commander?.['serial_hold_active'] === true &&
          this.health()?.commander?.['serial_hold_reason'] === 'manual_release',
  );
  /** True when the API reports the serial port is held for any reason. */
  protected readonly serialHoldActive = computed(
    () => this.health()?.commander?.['serial_hold_active'] === true,
  );
  /** True only when the API reports it can compile firmware (macOS only). Gates the OTA Update button. */
  protected readonly compileSupported = computed(() => this.health()?.compile_supported === true);
  protected readonly heartbeatState = computed<'healthy' | 'degraded' | 'offline'>(() => {
    if (this.healthError()) return 'offline';
    return this.health()?.commander?.detected === true ? 'healthy' : 'degraded';
  });
  // Tracks whether we've been through at least one unavailable state this session
  // so the "back online" toast only fires on recovery, never on initial load.
  private _wasUnavailable = false;
  private _unavailableToastTimer: ReturnType<typeof setTimeout> | null = null;

  // Ensures auto-discovery on empty store fires at most once per session.
  private _autoDiscoveryTriggered = false;

  private readonly commanderApi = inject(CommanderApiService);
  private readonly fixtureStore = inject(FixtureStoreService);
  private readonly messageService = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly swUpdate = inject(SwUpdate);

  protected readonly now = signal(Date.now());
  protected readonly heartbeatLabel = computed(() => {
    const h = this.health();
    return h ? this.relativeTime(h.utc) : null;
  });

  protected readonly proxyLastTransitionLabel = computed(() =>
    this.relativeTime(this.health()?.commander?.proxy?.last_transition_at_utc),
  );

  protected readonly proxyLastEventLabel = computed(() =>
    this.relativeTime(this.health()?.commander?.proxy?.last_event_at_utc),
  );

  protected readonly selectedFixtureLastSeen = computed(() => {
    const f = this.selectedFixture();
    if (!f) return null;
    return this.relativeTime(f.lastUpdatedAt);
  });

  protected relativeTime(ts: number | string | unknown): string | null {
    if (ts === null || ts === undefined) return null;
    let ms: number;
    if (typeof ts === 'number') {
      ms = ts * 1000;
    } else if (typeof ts === 'string') {
      // Handle "YYYY-MM-DD HH:MM:SS" (no timezone) by treating as UTC
      const normalized = ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z';
      ms = new Date(normalized).getTime();
    } else {
      return null;
    }
    if (isNaN(ms)) return null;
    const diffS = Math.max(0, Math.floor((this.now() - ms) / 1000));
    if (diffS < 60) return `${diffS}s ago`;
    const diffM = Math.floor(diffS / 60);
    if (diffM < 60) return `${diffM}m ago`;
    return `${Math.floor(diffM / 60)}h ago`;
  }

  protected formatDurationSeconds(totalSeconds: number | null | undefined): string | null {
    if (totalSeconds === null || totalSeconds === undefined || !Number.isFinite(totalSeconds)) {
      return null;
    }
    const whole = Math.max(0, Math.floor(totalSeconds));
    const hours = Math.floor(whole / 3600);
    const minutes = Math.floor((whole % 3600) / 60);
    const seconds = whole % 60;
    if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
  }

  constructor() {
    effect(() => localStorage.setItem('cmdr.selectedFixture', this.fixtureName()));
    effect(() => localStorage.setItem('cmdr.selectedPlan', this.planName()));
    effect(() => localStorage.setItem('cmdr.selectedPlanGroup', this.planGroupName()));
    effect(() =>
      localStorage.setItem('cmdr.discovery.timings', JSON.stringify(this.discoveryTimings())),
    );
    effect(() => {
      // Track only fixture identity so that re-queries (which update raw fixture data
      // including state_path-resolved defaults) don't overwrite the user's locally
      // edited slider values. Commands are read untracked so they don't create a
      // reactive dependency here — they will be current at the time the fixture changes.
      this.fixtureStore.selectedFixtureName();
      const commands = untracked(() => this.selectedFixtureCustomCommands());
      this.customCommandValues.set(this.buildInitialCustomCommandValues(commands));
      // Reset any optimistic plan state when switching fixtures.
      untracked(() => this.optimisticPlanState.set(null));
    });

    effect(() => {
      // On re-query updates for the selected fixture, sync only args that are backed
      // by plan_state via state_path. This keeps local edits for non-state-backed args.
      this.selectedFixture();
      const commands = this.selectedFixtureCustomCommands();
      this.syncStateBackedCustomCommandValues(commands);
    });

    effect(() => {
      const unavailable = this.commanderUnavailable();
      const stillLoading = this.loading();
      // Read healthRefreshing reactively: when _connect() fires after the backoff and sets
      // healthRefreshing = true, this effect re-evaluates and cancels the pending timer.
      const refreshing = this.healthRefreshing();
      // setTimeout: p-toast subscribes to MessageService during view init,
      // after this constructor effect fires — defer so the message isn't lost.
      setTimeout(() => {
        this.messageService.clear('cmdr-offline');
        if (unavailable && !stillLoading && !refreshing) {
          // Debounce: only alarm after persistent unavailability.
          // Brief WS reconnects (sleep/wake) resolve in ~3 s — 5 s grace avoids false positives.
          if (this._unavailableToastTimer === null) {
            this._unavailableToastTimer = setTimeout(() => {
              this._unavailableToastTimer = null;
              // Snapshot at fire time: skip if WS has already started reconnecting.
              if (this.commanderUnavailable() && !this.loading() && !this.healthRefreshing()) {
                this._wasUnavailable = true;
                this.messageService.add({ key: 'cmdr-offline', severity: 'warn', summary: 'Commander unavailable', sticky: true });
              }
            }, 5000);
          }
        } else {
          // Cancel pending timer — WS reconnecting (refreshing=true) or availability restored.
          if (this._unavailableToastTimer !== null) {
            clearTimeout(this._unavailableToastTimer);
            this._unavailableToastTimer = null;
          }
          if (!unavailable && this._wasUnavailable) {
            // Recovery: only toast if the 5 s timer actually fired and showed "unavailable".
            this._wasUnavailable = false;
            // Clear stale modal errors from the outage so the feedback strip resets.
            this.modalQueryError.set(null);
            this.fixtureActionMessage.set(null);
            this.fixtureActionResult.set(null);
            this.messageService.add({
              key: 'app',
              severity: 'success',
              summary: 'Commander available',
              detail: 'Connection restored.',
              life: 4000,
            });
          }
        }
      }, 0);
    });

    effect(() => {
      const isDiscovery = this.discoveryLoading();
      const isFixtureDiscovery = this.discoverFixturesLoading();
      const isFixtureQuery = this.fixtureQueryLoading();
      const isQuery = isFixtureQuery || this.planQueryLoading() || this.planGroupQueryLoading();
      // Only clear the progress channel — 'app' completion toasts manage their own lifetime via `life`.
      this.messageService.clear('app-progress');
      if (isDiscovery) {
        const avg = this.discoveryAvgS();
        const summary =
          avg !== null
            ? `Running full discovery… · ~${avg.toFixed(1)}s`
            : 'Running full discovery…';
        this.messageService.add({ key: 'app-progress', severity: 'warn', summary, sticky: true, closable: false, data: { cancellable: 'full' } });
      } else if (isFixtureDiscovery) {
        this.messageService.add({ key: 'app-progress', severity: 'warn', summary: 'Discovering fixtures…', sticky: true, closable: false, data: { cancellable: 'fixtures' } });
      } else if (isQuery) {
        const fixtureName = this.fixtureName().trim();
        const summary = isFixtureQuery && fixtureName
          ? `Running query for ${fixtureName}...`
          : 'Running query…';
        this.messageService.add({ key: 'app-progress', severity: 'warn', summary, sticky: true, closable: false });
      }
    });
  }

  protected readonly targets: readonly CommanderApiTarget[] = this.commanderApi.targets;
  protected readonly activeApiUrl = this.commanderApi.apiBaseUrl;
  protected readonly groupedFixtures = this.fixtureStore.fixturesGroupedByPlanName;

  private readonly PINNED_PLANS_KEY = 'cmdr.pinnedPlans.v1';
  protected readonly pinnedPlans = signal<ReadonlySet<string>>(this.loadPinnedPlans());

  private loadPinnedPlans(): ReadonlySet<string> {
    try {
      const stored = localStorage.getItem(this.PINNED_PLANS_KEY);
      const parsed = stored ? JSON.parse(stored) : [];
      return new Set(Array.isArray(parsed) ? parsed.filter((v: unknown) => typeof v === 'string') : []);
    } catch {
      return new Set();
    }
  }

  protected togglePinPlan(planName: string, event: Event): void {
    event.stopPropagation();
    const current = this.pinnedPlans();
    const next = new Set(current);
    if (next.has(planName)) {
      next.delete(planName);
    } else {
      next.add(planName);
    }
    this.pinnedPlans.set(next);
    try {
      localStorage.setItem(this.PINNED_PLANS_KEY, JSON.stringify([...next]));
    } catch {
      // localStorage unavailable — pin state lives in memory only
    }
  }

  /** Two-level sidebar tree: plan_group → [plan → [fixtures]], pinned plans/groups first */
  protected readonly groupedFixturesByPlanGroup = computed(() => {
    // Build plan_name → plan_group lookup from the exposed plans list
    const planToGroup = new Map<string, string>();
    for (const plan of this.exposedPlans()) {
      planToGroup.set(plan.plan_name, (plan.plan_group || plan.plan_name).trim() || plan.plan_name);
    }

    const outerMap = new Map<string, FixturePlanGroup[]>();
    for (const planGroup of this.groupedFixtures()) {
      const pgName = planToGroup.get(planGroup.plan_name) ?? planGroup.plan_name;
      const list = outerMap.get(pgName) ?? [];
      list.push(planGroup);
      outerMap.set(pgName, list);
    }

    const pinned = this.pinnedPlans();

    return Array.from(outerMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([plan_group, plans]) => ({
        plan_group,
        plans: [...plans].sort((a, b) => {
          const aPinned = pinned.has(a.plan_name) ? 0 : 1;
          const bPinned = pinned.has(b.plan_name) ? 0 : 1;
          if (aPinned !== bPinned) return aPinned - bPinned;
          return a.plan_name.localeCompare(b.plan_name);
        }),
      }))
      .sort((a, b) => {
        const aHasPinned = a.plans.some(p => pinned.has(p.plan_name)) ? 0 : 1;
        const bHasPinned = b.plans.some(p => pinned.has(p.plan_name)) ? 0 : 1;
        if (aHasPinned !== bHasPinned) return aHasPinned - bHasPinned;
        return a.plan_group.localeCompare(b.plan_group);
      });
  });
  protected readonly FIXTURE_DETAIL_DRAWER = FIXTURE_DETAIL_DRAWER;
  protected readonly selectedFixtureName = this.fixtureStore.selectedFixtureName;
  protected readonly selectedFixture = this.fixtureStore.selectedFixture;

  /** Tracks the current filter text in the fixture navigator p-select. */
  protected readonly dialogFixtureFilter = signal<string | null>(null);

  /** Flat ordered list of all fixtures, in plan-group display order (pinned groups first). */
  protected readonly allFixturesOrdered = computed<FixtureRecord[]>(() => {
    const result: FixtureRecord[] = [];
    for (const { plans } of this.groupedFixturesByPlanGroup()) {
      for (const plan of plans) {
        result.push(...plan.fixtures);
      }
    }
    return result;
  });

  /** Grouped options for the fixture select dropdown, mirroring sidebar plan-group structure. */
  protected readonly allFixtureSelectOptions = computed(() =>
    this.groupedFixturesByPlanGroup().map(({ plan_group, plans }) => ({
      label: plan_group,
      items: plans.flatMap((plan) =>
        plan.fixtures.map((f) => ({ label: f.fixture_name, value: f.fixture_name })),
      ),
    })),
  );
  protected readonly fixtureCount = this.fixtureStore.fixtureCount;
  protected readonly storageWarning = this.fixtureStore.storageWarning;

  /** Per-fixture fw version status keyed by fixture_name. Recomputes whenever health or store changes. */
  protected readonly fixtureFwStatusMap = computed(() => {
    const h = this.health();
    const release = h?.api?.release_version ?? null;
    const commanderFw = h?.commander?.fw_version ?? null;
    const commanderFixture = h?.commander?.detected_fixture_name ?? null;
    const map = new Map<string, { fw: string; outdated: boolean; release: string | null }>();
    for (const group of this.groupedFixtures()) {
      for (const fixture of group.fixtures) {
        const raw = fixture.raw['fw_version'];
        // Prefer the backend-reported fw_version for the connected commander (it probes itself via health).
        const v =
          commanderFw && commanderFixture && fixture.fixture_name === commanderFixture
            ? commanderFw
            : typeof raw === 'string'
              ? raw
              : null;
        if (v !== null) {
          const outdated = release !== null && compareVersions(v, release) < 0;
          map.set(fixture.fixture_name, { fw: v, outdated, release });
        }
      }
    }
    return map;
  });

  private readonly outdatedFixtureNames = computed(() =>
    Array.from(this.fixtureFwStatusMap().entries())
      .filter(([, status]) => status.outdated)
      .map(([name]) => name),
  );

  protected readonly fullDiscoveryMenuItems = computed<MenuItem[]>(() => [
    {
      label: 'Full discovery + fixtures',
      icon: 'pi pi-list',
      disabled: this.backendBusy() || this.commanderUnavailable() || this.discoveryLoading() || this.discoverFixturesLoading(),
      command: () => this.runFullDiscoveryThenFixtures(),
    },
  ]);

  protected readonly discoverFixturesMenuItems = computed<MenuItem[]>(() => {
    const outdatedCount = this.outdatedFixtureNames().length;
    return [
      {
        label: outdatedCount > 0 ? `Query outdated (${outdatedCount})` : 'Query outdated',
        icon: 'pi pi-exclamation-triangle',
        disabled: this.backendBusy() || this.commanderUnavailable() || outdatedCount === 0,
        command: () => this.runSidebarFixtureDiscoveryOutdated(),
      },
    ];
  });

  protected readonly exposedPlansByGroup = computed(() => {
    const grouped = new Map<string, CommanderExposedPlan[]>();
    for (const plan of this.exposedPlans()) {
      const groupName = (plan.plan_group || plan.plan_name).trim() || plan.plan_name;
      const list = grouped.get(groupName) ?? [];
      list.push(plan);
      grouped.set(groupName, list);
    }

    return Array.from(grouped.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([plan_group, plans]) => ({
        plan_group,
        plans: [...plans].sort((a, b) => a.plan_name.localeCompare(b.plan_name)),
      }));
  });
  protected readonly planOptions = computed<SelectOption[]>(() =>
    this.exposedPlans()
      .slice()
      .sort((a, b) => {
        const groupCompare = (a.plan_group || '').localeCompare(b.plan_group || '');
        return groupCompare !== 0 ? groupCompare : a.plan_name.localeCompare(b.plan_name);
      })
      .map((plan) => ({
        label: `${plan.plan_group} / ${plan.plan_name} (${plan.fixture_count})`,
        value: plan.plan_name,
      })),
  );
  protected readonly planGroupOptions = computed<SelectOption[]>(() =>
    this.lanGroups()
      .slice()
      .sort((a, b) => a.plan_group.localeCompare(b.plan_group))
      .map((group) => ({
        label: `${group.plan_group} (u${group.universe}, ${group.fixture_count})`,
        value: group.plan_group,
      })),
  );
  protected readonly fixtureOptions = computed<SelectOption[]>(() => {
    const names = new Set<string>();
    for (const group of this.lanGroups()) {
      for (const name of group.fixtures ?? []) {
        names.add(name);
      }
    }
    return Array.from(names)
      .sort()
      .map((name) => ({ label: name, value: name }));
  });
  protected readonly selectedFixtureJson = computed(() => {
    const selected = this.selectedFixture();
    return selected ? JSON.stringify(selected.raw, null, 2) : '';
  });

  protected readonly selectedFixturePlanControls = computed<CmdrPlanControls | null>(() => {
    const caps = this.selectedFixture()?.raw['capabilities'] as CmdrFixtureCapabilities | undefined | null;
    return caps?.plan_controls ?? null;
  });

  /** Optimistic plan state set immediately on a successful plan trigger/stop BE call. */
  private readonly optimisticPlanState = signal<PlanState | null>(null);

  protected readonly selectedFixturePlanState = computed<PlanState | null>(() => {
    const optimistic = this.optimisticPlanState();
    if (optimistic !== null) return optimistic;
    const ps = this.selectedFixture()?.raw['plan_state'] as Record<string, unknown> | null | undefined;
    return (ps?.['plan_state'] as string) || null;
  });

  protected readonly selectedFixturePlayer = computed<CmdrPlayerCapabilities | null>(() => {
    const caps = this.selectedFixture()?.raw['capabilities'] as CmdrFixtureCapabilities | undefined | null;
    return caps?.player ?? null;
  });

  protected readonly selectedFixturePlayerType = computed<string | null>(
    () => (this.selectedFixture()?.raw['player_type'] as string | null | undefined) ?? null,
  );

  protected readonly playerControlsDisabled = computed(
    () => this.fixtureActionLoading() || this.modalQueryLoading() || this.commanderUnavailable(),
  );

  protected readonly selectedFixtureConfig = computed<CmdrFixtureConfig | null>(() => {
    const raw = this.selectedFixture()?.raw['config'];
    return (raw as CmdrFixtureConfig | null | undefined) ?? null;
  });

  protected readonly selectedFixtureConfigUi = computed<CmdrFixtureConfigUi | null>(() => {
    const raw = this.selectedFixture()?.raw['config_ui'];
    return (raw as CmdrFixtureConfigUi | null | undefined) ?? null;
  });

  protected readonly selectedFixturePlayerState = computed<{
    volume?: number; eq?: number; trackIndex?: number; playerStatus?: string;
  } | null>(() => {
    const ps = this.selectedFixture()?.raw['plan_state'] as Record<string, unknown> | null | undefined;
    const s = ps?.['state'] as Record<string, unknown> | null | undefined;
    if (!s) return null;
    const volume = typeof s['volume'] === 'number' ? (s['volume'] as number) : undefined;
    const eq = typeof s['eq'] === 'number' ? (s['eq'] as number) : undefined;
    const trackIndex = typeof s['track_index'] === 'number' ? (s['track_index'] as number) : undefined;
    const playerStatus = typeof s['player_status'] === 'string' ? (s['player_status'] as string) : undefined;
    if (volume === undefined && eq === undefined && trackIndex === undefined && playerStatus === undefined) return null;
    return { volume, eq, trackIndex, playerStatus };
  });

  protected readonly selectedFixtureRelayStates = computed<CmdrRelayStateItem[] | null>(() => {
    const ps = this.selectedFixture()?.raw['plan_state'] as Record<string, unknown> | null | undefined;
    const s = ps?.['state'] as Record<string, unknown> | null | undefined;
    const relays = s?.['relays'];
    if (!Array.isArray(relays) || relays.length === 0) return null;
    return relays as CmdrRelayStateItem[];
  });

  protected readonly selectedFixtureCustomCommands = computed<CmdrCustomCommandUiItem[]>(() => {
    const raw = this.selectedFixture()?.raw['custom_command_ui'];
    if (!Array.isArray(raw)) return [];
    return raw as CmdrCustomCommandUiItem[];
  });

  /** MAC (upper-case, colon-separated) → fixture name, built from the store. */
  protected readonly macToFixtureName = computed<Record<string, string>>(() => {
    const byName = this.fixtureStore.fixturesByName();
    const map: Record<string, string> = {};
    for (const record of Object.values(byName)) {
      const mac = String(record.raw['wifi_mac_address'] ?? record.raw['target_wifi_mac'] ?? '')
        .trim()
        .toUpperCase();
      if (mac) map[mac] = record.fixture_name;
    }
    return map;
  });

  protected readonly selectedFixtureRssi = computed<CmdrFixtureRssiReport | null>(() => {
    const raw = this.selectedFixture()?.raw['rssi'];
    return raw != null ? (raw as CmdrFixtureRssiReport) : null;
  });

  protected readonly selectedFixtureRssiDbm = computed<number | null>(() => {
    const rssi = this.selectedFixtureRssi();
    if (rssi) {
      const first = rssi.peers?.[0];
      return first?.avg_rssi ?? null;
    }
    const raw = this.selectedFixture()?.raw;
    const dbm = raw?.['rssi_dbm'];
    return typeof dbm === 'number' ? dbm : null;
  });

  protected readonly selectedFixtureRssiQuality = computed<string | null>(() => {
    const rssi = this.selectedFixtureRssi();
    if (rssi) return rssi.peers?.[0]?.quality_label ?? null;
    const raw = this.selectedFixture()?.raw;
    const q = raw?.['rssi_quality'];
    return typeof q === 'string' ? q : null;
  });

  protected rssiQualityClass(qualityLabel: string | null | undefined): string {
    return (qualityLabel ?? 'UNKNOWN').toLowerCase().replace('_', '-');
  }

  protected rssiDurationLabel(rssi: CmdrFixtureRssiReport): string {
    const ms = rssi.session_duration_ms;
    return ms ? `${Math.round(ms / 1000)}s session` : '';
  }

  /** True when the selected fixture's FQBN is ESP8266-based (no RSSI session support). */
  protected readonly selectedFixtureIsEsp8266 = computed<boolean>(() => {
    const fqbn = String(this.selectedFixture()?.raw['fqbn'] ?? '').toUpperCase();
    return fqbn.includes('ESP8266') || fqbn.includes('D1_MINI') || fqbn.includes('ESP_01');
  });

  protected startRssiSession(durationMs = 20000): void {
    const fixture = this.selectedFixture()?.fixture_name?.trim();
    if (!fixture) return;

    if (this.rssiSessionTimer) {
      clearInterval(this.rssiSessionTimer);
      this.rssiSessionTimer = null;
    }

    this.rssiSessionLoading.set(true);
    this.rssiSessionCountdown.set(null);

    this.commanderApi.postFixtureRssiSession(fixture, durationMs).subscribe({
      next: () => {
        this.rssiSessionLoading.set(false);
        let remaining = Math.round(durationMs / 1000);
        this.rssiSessionCountdown.set(remaining);
        this.rssiSessionTimer = setInterval(() => {
          remaining -= 1;
          if (remaining <= 0) {
            clearInterval(this.rssiSessionTimer!);
            this.rssiSessionTimer = null;
            this.rssiSessionCountdown.set(null);
            // Auto-refresh the fixture data to pick up the new report.
            this.runModalFixtureQuery();
          } else {
            this.rssiSessionCountdown.set(remaining);
          }
        }, 1000);
      },
      error: (err: unknown) => {
        this.rssiSessionLoading.set(false);
        this.messageService.add({ key: 'app', severity: 'error', summary: 'RSSI session failed', detail: this.formatError('', err), life: 6000 });
      },
    });
  }

  protected startOtaUpdate(fixtureName: string): void {
    if (this.otaInProgress().has(fixtureName) || this.modalQueryLoading()) return;

    const releaseVersion = this.health()?.api?.release_version ?? null;

    // Phase 1: run the fixture query (same as "Run query" button) to get the live version
    this.runModalFixtureQuery((result) => {
      const fixtureVersion = result.summary?.fw_version ?? null;

      if (releaseVersion && fixtureVersion === releaseVersion) {
        this.messageService.add({
          key: 'app',
          severity: 'info',
          summary: 'Already up to date',
          detail: `${fixtureName} is already on v${fixtureVersion}`,
          life: 5000,
        });
        return;
      }

      // Phase 2: fixture confirmed outdated — start OTA
      this.otaInProgress.update((s) => new Set([...s, fixtureName]));
      this.commanderApi.postOtaUpdate(fixtureName).subscribe({
        error: (err: unknown) => {
          this.otaInProgress.update((s) => { const n = new Set(s); n.delete(fixtureName); return n; });
          const status = (err as { status?: number })?.status;
          const detail = status === 409
            ? 'An update is already running for this fixture'
            : `Failed to start update for ${fixtureName}`;
          this.messageService.add({ key: 'app', severity: 'error', summary: 'OTA error', detail, life: 6000 });
        },
        // 202 success — wait for ota_complete via commander stream
      });
    });
  }

  protected onOtaComplete(event: { fixture_name: string; fw_version?: string }): void {
    this.otaInProgress.update((s) => { const n = new Set(s); n.delete(event.fixture_name); return n; });
    this.messageService.add({
      key: 'app',
      severity: 'success',
      summary: 'Firmware updated',
      detail: `${event.fixture_name} updated to v${event.fw_version ?? '?'}`,
      life: 6000,
    });
    if (this.selectedFixtureName() === event.fixture_name) {
      this.runModalFixtureQuery();
    }
  }

  protected onOtaError(event: { fixture_name: string; message?: string }): void {
    this.otaInProgress.update((s) => { const n = new Set(s); n.delete(event.fixture_name); return n; });
    this.messageService.add({
      key: 'app',
      severity: 'error',
      summary: 'OTA update failed',
      detail: event.message ?? `Update failed for ${event.fixture_name}`,
      life: 8000,
    });
  }

  protected readonly selectedFixtureFwStatus = computed<{
    fw: string;
    release: string | null;
    upToDate: boolean;
    direction: 'up-to-date' | 'fixture-outdated' | 'fixture-ahead';
  } | null>(() => {
    const h = this.health();
    const release = h?.api?.release_version ?? null;
    const commanderFw = h?.commander?.fw_version ?? null;
    const commanderFixture = h?.commander?.detected_fixture_name ?? null;
    const selected = this.selectedFixture();
    const raw = selected?.raw['fw_version'];
    // Prefer the backend-reported fw_version for the connected commander (it probes itself via health).
    const v =
      commanderFw && commanderFixture && selected?.fixture_name === commanderFixture
        ? commanderFw
        : typeof raw === 'string'
          ? raw
          : null;
    if (v === null) return null;
    const cmp = release !== null ? compareVersions(v, release) : 0;
    const direction =
      release === null ? 'up-to-date'
      : cmp === 0      ? 'up-to-date'
      : cmp < 0        ? 'fixture-outdated'
      :                  'fixture-ahead';
    return { fw: v, release, upToDate: direction === 'up-to-date', direction };
  });

  // Callbacks run once when the API recovers from offline → online.
  // Add entries here to extend the recovery set.
  private readonly recoveryCallbacks: Array<() => void> = [];

  ngOnInit(): void {
    this.customUrl.set(this.activeApiUrl());

    // Register endpoints to re-fetch automatically on API recovery
    this.recoveryCallbacks.push(
      () => this.loadExposedPlans(),
      () => this.loadLanGroups(),
    );

    this.loadExposedPlans();
    this.loadLanGroups();
    const timer = setInterval(() => this.now.set(Date.now()), 1000);
    this.destroyRef.onDestroy(() => clearInterval(timer));

    // If health arrived before this component mounted (rare), clear loading immediately.
    if (this.healthService.health() !== null || this.healthService.healthError() !== null) {
      this.loading.set(false);
      // Also run auto-discovery check for the already-available health data.
      if (this.healthService.health() !== null) {
        this.handleFirstHealthSuccess(false);
      }
    }

    // React to health lifecycle events from the shared service.
    const successSub = this.healthService.healthSuccess$.subscribe(({ wasOffline }) => {
      this.loading.set(false);
      this.handleFirstHealthSuccess(wasOffline);
    });
    const failedSub = this.healthService.healthFailed$.subscribe(() => {
      this.loading.set(false);
    });
    // Subscribe to timed poll cycles for SW update checks.
    const pollSub = this.healthService.pollCycle$.subscribe(() => {
      if (!this.loading() && this.swUpdate.isEnabled) this.swUpdate.checkForUpdate();
    });
    this.destroyRef.onDestroy(() => {
      successSub.unsubscribe();
      failedSub.unsubscribe();
      pollSub.unsubscribe();
    });
  }

  private handleFirstHealthSuccess(wasOffline: boolean): void {
    if (wasOffline) this.runRecoveryCallbacks();
    if (!this._autoDiscoveryTriggered && this.fixtureStore.fixtureCount() === 0) {
      this._autoDiscoveryTriggered = true;
      setTimeout(() => {
        if (
          this.fixtureStore.fixtureCount() === 0 &&
          this.healthService.health()?.commander?.detected === true
        ) {
          this.runFullDiscoveryThenFixtures();
        }
      }, 3000);
    }
  }

  protected reloadHealth(): void {
    this.error.set(null);
    this.healthService.refresh();
  }

  protected retryHealth(): void {
    this.error.set(null);
    this.loading.set(true);
    this.healthService.retryHealth();
  }

  protected useTarget(url: string): void {
    this.commanderApi.setApiBaseUrl(url);
    this.customUrl.set(this.activeApiUrl());
    this.loading.set(true);
    this.healthService.retryHealth(); // reset backoff + clear stale data + force reload
    this.loadExposedPlans();
    this.loadLanGroups();
  }

  protected applyCustomUrl(): void {
    const ok = this.commanderApi.setApiBaseUrl(this.customUrl());
    if (!ok) {
      this.showErrorToast('Invalid API URL. Use host[:port] or http(s)://host[:port].');
      return;
    }

    this.customUrl.set(this.activeApiUrl());
    this.loading.set(true);
    this.healthService.retryHealth(); // reset backoff + clear stale data + force reload
    this.loadExposedPlans();
    this.loadLanGroups();
  }

  protected runFixtureQuery(): void {
    if (!this.checkApiReachable()) {
      this.sidebarRefreshingFixture.set(null);
      return;
    }
    const fixture = this.fixtureName().trim();
    if (!fixture) {
      this.error.set('Fixture name is required.');
      this.sidebarRefreshingFixture.set(null);
      return;
    }

    this.fixtureQueryLoading.set(true);
    this.error.set(null);
    const startedAt = performance.now();
    this.commanderApi.getFixtureVersion(fixture).subscribe({
      next: (result) => {
        this.queryResult.set(result);
        const stats = this.ingestQueryResult(result, 'fixture_query');
        const durationS = (performance.now() - startedAt) / 1000;
        this.fixtureQueryLoading.set(false);
        this.sidebarRefreshingFixture.set(null);
        this.showQueryResultToast(stats, durationS);
      },
      error: (err: unknown) => {
        this.showErrorToast(this.formatError(`Fixture query failed for ${fixture}`, err));
        this.queryResult.set(null);
        this.fixtureQueryLoading.set(false);
        this.sidebarRefreshingFixture.set(null);
      },
    });
  }

  protected clearList(): void {
    this.fixtureStore.clearAllFixtures();
    this.discoveryTimings.set([]);
  }

  protected runFullDiscovery(): void {
    this.doFullDiscovery();
  }

  protected runFullDiscoveryThenFixtures(): void {
    this.doFullDiscovery(() => this.runSidebarFixtureDiscovery());
  }

  private discoverySubscription: Subscription | null = null;
  private discoverFixturesCancelRequested = false;

  private doFullDiscovery(then?: () => void): void {
    if (!this.checkApiReachable()) return;
    this.discoveryLoading.set(true);
    this.error.set(null);
    const startedAt = performance.now();

    this.discoverySubscription = this.commanderApi.getFixtureDiscovery().subscribe({
      next: (result) => {
        this.discoverySubscription = null;
        const durationS = (performance.now() - startedAt) / 1000;
        this.addDiscoveryTiming(durationS);
        this.queryResult.set(result);
        const stats = this.ingestQueryResult(result, 'discovery_query');
        this.discoveryLoading.set(false);
        this.showQueryResultToast(stats, durationS, true);
        if (then) setTimeout(then, 0);
      },
      error: (err: unknown) => {
        this.discoverySubscription = null;
        this.showErrorToast(this.formatError('Full discovery failed', err));
        this.discoveryLoading.set(false);
      },
    });
  }

  protected cancelCurrentDiscovery(): void {
    if (this.discoverySubscription) {
      this.discoverySubscription.unsubscribe();
      this.discoverySubscription = null;
      this.discoveryLoading.set(false);
      this.messageService.add({ key: 'app', severity: 'info', summary: 'Full discovery cancelled', life: 3000 });
    } else if (this.discoverFixturesLoading()) {
      this.discoverFixturesCancelRequested = true;
    }
  }

  protected runSidebarFixtureDiscovery(): void {
    if (!this.checkApiReachable() || this.discoverFixturesLoading()) return;

    const fixtureNames = Array.from(
      new Set(
        this.groupedFixturesByPlanGroup().flatMap((outerGroup) =>
          outerGroup.plans.flatMap((plan) => plan.fixtures.map((fixture) => fixture.fixture_name)),
        ),
      ),
    );

    if (!fixtureNames.length) {
      this.messageService.add({
        key: 'app',
        severity: 'info',
        summary: 'No fixtures in the local list to query',
        life: 3000,
      });
      return;
    }

    this.error.set(null);
    this.discoverFixturesCancelRequested = false;
    this.discoverFixturesLoading.set(true);
    this.discoverFixturesCurrentFixture.set(null);
    this.discoverFixturesElapsedS.set(0);
    void this.runSidebarFixtureDiscoverySequential(fixtureNames);
  }

  protected runSidebarFixtureDiscoveryOutdated(): void {
    if (!this.checkApiReachable() || this.discoverFixturesLoading()) return;

    const fixtureNames = this.outdatedFixtureNames();

    if (!fixtureNames.length) {
      this.messageService.add({
        key: 'app',
        severity: 'info',
        summary: 'No outdated fixtures found',
        life: 3000,
      });
      return;
    }

    this.error.set(null);
    this.discoverFixturesCancelRequested = false;
    this.discoverFixturesLoading.set(true);
    this.discoverFixturesCurrentFixture.set(null);
    this.discoverFixturesElapsedS.set(0);
    void this.runSidebarFixtureDiscoverySequential(fixtureNames);
  }

  private async runSidebarFixtureDiscoverySequential(fixtureNames: string[]): Promise<void> {
    const startedAt = performance.now();
    let successCount = 0;
    const failures: string[] = [];

    let cancelled = false;
    try {
      for (const fixtureName of fixtureNames) {
        if (this.discoverFixturesCancelRequested) {
          cancelled = true;
          break;
        }
        this.discoverFixturesCurrentFixture.set(fixtureName);
        this.sidebarRefreshingFixture.set(fixtureName);
        try {
          const result = await firstValueFrom(this.commanderApi.getFixtureVersion(fixtureName));
          this.ingestQueryResult(result, 'fixture_query', fixtureName);
          this.autoQueriedFixtures.add(fixtureName);
          successCount += 1;
        } catch (err: unknown) {
          console.warn('[cmdr][discover-fixtures] fixture query failed', { fixtureName, err });
          failures.push(fixtureName);
        } finally {
          this.discoverFixturesElapsedS.set((performance.now() - startedAt) / 1000);
        }
      }
    } finally {
      this.sidebarRefreshingFixture.set(null);
      this.discoverFixturesCurrentFixture.set(null);
      this.discoverFixturesLoading.set(false);
      this.discoverFixturesLastDurationS.set((performance.now() - startedAt) / 1000);
    }

    if (cancelled) {
      this.messageService.add({ key: 'app', severity: 'info', summary: `Fixture discovery cancelled — ${successCount} queried before stopping`, life: 4000 });
      return;
    }

    const total = fixtureNames.length;
    const failedCount = failures.length;
    const severity = failedCount > 0 ? 'warn' : 'success';
    const elapsedS = this.discoverFixturesLastDurationS() ?? (performance.now() - startedAt) / 1000;
    const elapsedSuffix = ` - ${elapsedS.toFixed(1)}s`;
    const summary =
      failedCount > 0
        ? `Query fixtures finished: ${successCount}/${total} queried, ${failedCount} failed${elapsedSuffix}`
        : `Query fixtures finished: ${successCount}/${total} queried${elapsedSuffix}`;
    const detail =
      failedCount > 0
        ? `Failed: ${failures.slice(0, 5).join(', ')}${failedCount > 5 ? ', ...' : ''}`
        : undefined;

    this.messageService.add({ key: 'app', severity, summary, detail, life: 6000 });
  }

  protected runPlanQuery(): void {
    if (!this.checkApiReachable()) {
      this.sidebarRefreshingPlan.set(null);
      return;
    }
    const plan = this.planName().trim();
    if (!plan) {
      this.error.set('Plan name is required.');
      this.sidebarRefreshingPlan.set(null);
      return;
    }

    this.planQueryLoading.set(true);
    this.error.set(null);
    const startedAt = performance.now();
    this.commanderApi.getPlanVersions(plan).subscribe({
      next: (result) => {
        this.queryResult.set(result);
        const stats = this.ingestQueryResult(result, 'plan_query');
        const durationS = (performance.now() - startedAt) / 1000;
        this.planQueryLoading.set(false);
        this.sidebarRefreshingPlan.set(null);
        this.showQueryResultToast(stats, durationS);
      },
      error: (err: unknown) => {
        this.showErrorToast(this.formatError(`Plan query failed for ${plan}`, err));
        this.queryResult.set(null);
        this.planQueryLoading.set(false);
        this.sidebarRefreshingPlan.set(null);
      },
    });
  }

  protected readonly openDropdownCount = signal(0);
  protected readonly anyDropdownOpen = computed(() => this.openDropdownCount() > 0);

  protected onDropdownShow(): void {
    this.openDropdownCount.update((n) => n + 1);
  }

  protected onDropdownHide(): void {
    this.openDropdownCount.update((n) => Math.max(0, n - 1));
  }

  protected onFixtureSelected(value: string): void {
    this.fixtureName.set(value);
  }

  protected onPlanSelected(value: string): void {
    this.planName.set(value);
  }

  protected onPlanGroupSelected(value: string): void {
    this.planGroupName.set(value);
  }

  /** Auto-run when item selected via keyboard (Enter). Mouse selections require the Run button. */
  protected onFixtureSelectChange(event: SelectChangeEvent): void {
    if (!(event.originalEvent instanceof KeyboardEvent)) return;
    this.fixtureName.set(event.value);
    this.runFixtureQuery();
  }

  protected onPlanSelectChange(event: SelectChangeEvent): void {
    if (!(event.originalEvent instanceof KeyboardEvent)) return;
    this.planName.set(event.value);
    this.runPlanQuery();
  }

  protected onPlanGroupSelectChange(event: SelectChangeEvent): void {
    if (!(event.originalEvent instanceof KeyboardEvent)) return;
    this.planGroupName.set(event.value);
    this.runPlanGroupQuery();
  }

  /** Called from sidebar reload button — sets the dropdown and fires the plan query. */
  protected sidebarRefreshPlan(planName: string, event: Event): void {
    event.stopPropagation();
    this.planName.set(planName);
    this.sidebarRefreshingPlan.set(planName);
    this.runPlanQuery();
  }

  /** Called from sidebar reload button — sets the dropdown and fires the plan group query. */
  protected sidebarRefreshPlanGroup(planGroup: string, event: Event): void {
    event.stopPropagation();
    this.planGroupName.set(planGroup);
    this.sidebarRefreshingPlanGroup.set(planGroup);
    this.runPlanGroupQuery();
  }

  /** Called from sidebar fixture reload button — sets the dropdown and fires the fixture query. */
  protected sidebarRefreshFixture(fixtureName: string, event: Event): void {
    event.stopPropagation();
    this.fixtureName.set(fixtureName);
    this.sidebarRefreshingFixture.set(fixtureName);
    this.runFixtureQuery();
  }

  protected runPlanGroupQuery(): void {
    if (!this.checkApiReachable()) {
      this.sidebarRefreshingPlanGroup.set(null);
      return;
    }
    const planGroup = this.planGroupName().trim();
    if (!planGroup) {
      this.error.set('Plan group is required.');
      this.sidebarRefreshingPlanGroup.set(null);
      return;
    }

    this.planGroupQueryLoading.set(true);
    this.error.set(null);
    const startedAt = performance.now();
    this.commanderApi.getPlanGroupVersions(planGroup).subscribe({
      next: (result) => {
        this.queryResult.set(result);
        const stats = this.ingestQueryResult(result, 'plan_group_query');
        const durationS = (performance.now() - startedAt) / 1000;
        this.planGroupQueryLoading.set(false);
        this.sidebarRefreshingPlanGroup.set(null);
        this.showQueryResultToast(stats, durationS);
      },
      error: (err: unknown) => {
        this.showErrorToast(this.formatError(`Plan group query failed for ${planGroup}`, err));
        this.queryResult.set(null);
        this.planGroupQueryLoading.set(false);
        this.sidebarRefreshingPlanGroup.set(null);
      },
    });
  }

  protected navigateFixture(direction: 1 | -1): void {
    const all = this.allFixturesOrdered();
    if (all.length === 0) return;
    const current = this.selectedFixture();
    const idx = current ? all.findIndex((f) => f.fixture_name === current.fixture_name) : -1;
    const next = all[(idx + direction + all.length) % all.length];
    this.selectFixture(next);
  }

  protected onDialogFixtureSelectChange(fixtureName: string): void {
    const record = this.fixtureStore.fixturesByName()[fixtureName];
    if (record) this.selectFixture(record);
  }

  protected selectFixture(record: FixtureRecord): void {
    // Diagnostic breadcrumb for fixture-selection mismatch investigations.
    console.log('[cmdr][selectFixture]', { fixture_name: record.fixture_name, plan_name: record.plan_name });
    this.fixtureStore.setSelectedFixture(record.fixture_name);
    this.fixtureName.set(record.fixture_name);
    this.openFixtureModal();
    if (!this.autoQueriedFixtures.has(record.fixture_name) && !this.modalQueryLoading()) {
      this.autoQueriedFixtures.add(record.fixture_name);
      this.runModalFixtureQuery();
    }
    // Load tracks on open if fixture already has a player in the store and tracks aren't cached yet.
    const caps = record.raw['capabilities'] as { player?: { attached?: boolean } } | null | undefined;
    if (caps?.player?.attached && record.plan_name) {
      this.loadTracksForPlan(record.plan_name);
    }
  }

  protected removeFixture(record: FixtureRecord, event: Event): void {
    event.stopPropagation();
    const wasSelected = this.selectedFixtureName() === record.fixture_name;
    this.fixtureStore.removeFixture(record.fixture_name);

    if (wasSelected) {
      this.fixtureName.set('');
      this.closeFixtureModal();
    }
  }

  protected removePlan(planName: string, event: Event): void {
    event.stopPropagation();
    const selected = this.selectedFixture();
    this.fixtureStore.removePlan(planName);

    if (selected?.plan_name === planName) {
      this.fixtureName.set('');
      this.closeFixtureModal();
    }
  }

  protected closeFixtureModal(): void {
    this.fixtureModalVisible.set(false);
    this.resetFixtureModalState();
  }

  protected onFixtureDialogVisibleChange(visible: boolean): void {
    this.fixtureModalVisible.set(visible);
    if (!visible) {
      this.resetFixtureModalState();
    }
  }

  private loadTracksForPlan(planName: string): void {
    if (this.planTracksCache().has(planName)) return;
    this.commanderApi.getPlanPlayerTracks(planName).subscribe({
      next: (data) => {
        this.planTracksCache.update(cache => new Map(cache).set(planName, data.tracks));
      },
      error: () => {},
    });
  }

  private resetFixtureModalState(): void {
    this.modalQuerySub?.unsubscribe();
    this.modalQuerySub = null;
    this.modalQueryLoading.set(false);
    this.modalQueryError.set(null);
    this.fixtureActionMessage.set(null);
    this.fixtureActionDurationMs.set(null);
    this.fixtureActionTone.set('info');
    this.fixtureAckEnabled.set(false);
    this.rebootConfirmPending.set(false);
    this.fixtureModalTab.set('status');
  }

  protected rebootFixture(): void {
    if (!this.rebootConfirmPending()) {
      this.rebootConfirmPending.set(true);
      return;
    }
    this.rebootConfirmPending.set(false);
    const fixture = this.selectedFixture()?.fixture_name;
    if (!fixture) return;
    this.sendCommand(fixture, 'cmd;reboot;', 'force_ack');
  }

  protected runModalFixtureQuery(onComplete?: (result: CmdrVersionsResponse) => void): void {
    const selected = this.selectedFixture();
    const fixture = (selected?.fixture_name ?? this.fixtureName()).trim();
    if (!fixture) {
      this.modalQueryError.set('No fixture selected.');
      return;
    }

    this.modalQuerySub?.unsubscribe();
    this.modalQueryLoading.set(true);
    this.modalQueryError.set(null);
    const startedAt = performance.now();

    this.modalQuerySub = this.commanderApi.getFixtureVersion(fixture).subscribe({
      next: (result) => {
        this.modalQuerySub = null;
        const durationMs = performance.now() - startedAt;
        this.queryResult.set(result);
        // Pass the selected fixture's store key so the record is updated under
        // the correct name even when the API summary reports a different
        // fixture_name (CMDR alias vs fixture self-identity).
        this.ingestQueryResult(result, 'fixture_query', fixture);
        this.modalQueryLoading.set(false);
        const fwVersion = result.summary?.fw_version;
        const message = fwVersion
          ? `Query complete for ${fixture} · fw v${fwVersion}`
          : `Query complete for ${fixture}`;
        this.setFixtureModalFeedback(message, 'success', durationMs);
        onComplete?.(result);
        // Load player tracks if the fixture has an attached player and tracks aren't cached yet.
        // Use selectedFixturePlayer() — ingestQueryResult above already updated the store.
        const planName = result.plan_name ?? this.selectedFixture()?.plan_name ?? null;
        if (this.selectedFixturePlayer()?.attached === true && planName) {
          this.loadTracksForPlan(planName);
        }
      },
      error: (err: unknown) => {
        this.modalQuerySub = null;
        const text = this.formatError('Fixture query failed', err);
        const compact = text.length > 180 ? `${text.slice(0, 177)}...` : text;
        this.modalQueryError.set(compact);
        this.modalQueryLoading.set(false);
      },
    });
  }

  protected runModalPlanAction(action: 'trigger' | 'stop'): void {
    const selected = this.selectedFixture();
    const fixture = (selected?.fixture_name ?? this.fixtureName()).trim();
    if (!fixture) {
      this.setFixtureModalFeedback('No fixture selected. Select a fixture before running a plan action.', 'warn');
      return;
    }

    this.fixtureActionLoading.set(true);
    this.fixtureActionResult.set(null);

    const command = `cmd;plan;action=${action};`;
    const expectedState: PlanState = action === 'trigger' ? 'RUNNING' : 'STOPPED';
    this.sendCommand(fixture, command, 'default', () => {
      this.optimisticPlanState.set(expectedState);
    });
  }

  protected onPlayerCommand(command: string): void {
    const fixture = (this.selectedFixture()?.fixture_name ?? this.fixtureName()).trim();
    if (!fixture) return;
    this.sendCommand(fixture, command);
  }

  protected onConfigCommand(command: string): void {
    const fixture = (this.selectedFixture()?.fixture_name ?? this.fixtureName()).trim();
    if (!fixture) return;
    this.sendCommand(fixture, command);
  }

  protected runRawCommand(): void {
    const command = this.rawCommand().trim();
    if (!command) return;

    this.rawCommandLoading.set(true);
    this.rawCommandError.set(null);
    this.rawCommandResult.set(null);

    this.commanderApi.postRawCommand(command).subscribe({
      next: (result) => {
        this.rawCommandResult.set(result);
        this.rawCommandLoading.set(false);
      },
      error: (err: unknown) => {
        this.rawCommandError.set(this.formatError('Raw command failed', err));
        this.rawCommandLoading.set(false);
      },
    });
  }

  protected runManualCommand(): void {
    const selected = this.selectedFixture();
    const fixture = (selected?.fixture_name ?? this.fixtureName()).trim();
    const command = this.manualCommand().trim();

    if (!fixture) {
      this.setFixtureModalFeedback('No fixture selected. Select a fixture before sending a manual command.', 'warn');
      return;
    }
    if (!command) {
      this.setFixtureModalFeedback('Command required. Enter a command before pressing Send.', 'warn');
      return;
    }

    this.sendCommand(fixture, command);
  }

  protected onFixtureCustomArgChanged(event: FixtureCustomArgChangedEvent): void {
    this.updateCustomCommandArg(event.commandId, event.arg, event.rawValue);
  }

  protected onFixtureCustomCommandRunRequested(command: CmdrCustomCommandUiItem): void {
    this.runCustomCommand(command);
  }

  protected onFixtureCustomSliderReleased(command: CmdrCustomCommandUiItem): void {
    this.onCustomCommandSliderRelease(command);
  }

  protected onFixtureCustomMasterPreviewChanged(events: FixtureCustomArgChangedEvent[]): void {
    for (const event of events) {
      this.updateCustomCommandArg(event.commandId, event.arg, event.rawValue);
    }
  }

  protected onFixtureCustomMasterReleased(event: FixtureCustomMasterReleasedEvent): void {
    for (const change of event.changes) {
      this.updateCustomCommandArg(change.commandId, change.arg, change.rawValue);
    }
    for (const command of event.commands) {
      this.runCustomCommand(command);
    }
  }

  protected onFixtureSharedRgbChanged(events: FixtureCustomArgChangedEvent[]): void {
    for (const event of events) {
      this.updateCustomCommandArg(event.commandId, event.arg, event.rawValue);
    }
  }

  protected updateCustomCommandArg(commandId: string, arg: CmdrCustomCommandUiArg, rawValue: unknown): void {
    const nextValue = this.normalizeArgValue(arg, rawValue);
    this.customCommandValues.update((current) => {
      const commandValues = { ...(current[commandId] ?? {}) };
      commandValues[arg.name] = nextValue;
      return {
        ...current,
        [commandId]: commandValues,
      };
    });
  }

  protected onCustomCommandSliderRelease(command: CmdrCustomCommandUiItem): void {
    if (!this.commandSendOnRelease(command)) return;
    this.runCustomCommand(command);
  }

  protected runCustomCommand(command: CmdrCustomCommandUiItem): void {
    const selected = this.selectedFixture();
    const fixture = (selected?.fixture_name ?? this.fixtureName()).trim();
    if (!fixture) {
      this.setFixtureModalFeedback('No fixture selected. Select a fixture before running a custom command.', 'warn');
      return;
    }
    const wireTemplate = (command.wire_template ?? '').trim();
    if (!wireTemplate) {
      this.setFixtureModalFeedback(`Command template missing for "${command.label}".`, 'warn');
      return;
    }
    const unknownPlaceholders = this.findUnknownTemplatePlaceholders(
      wireTemplate,
      command.args ?? [],
    );
    if (unknownPlaceholders.length > 0) {
      this.setFixtureModalFeedback(
        `Template placeholders missing for "${command.label}": ${unknownPlaceholders.join(', ')}`,
        'warn',
      );
      return;
    }

    const commandValues = this.hydrateCommandValues(command, this.customCommandValues()[command.id] ?? {});
    const wireCommand = this.buildCommandFromTemplate(wireTemplate, commandValues);
    this.sendCommand(fixture, wireCommand);
  }

  private openFixtureModal(): void {
    if (!this.fixtureModalVisible()) {
      this.fixtureAckEnabled.set(false);
      this.fixtureModalVisible.set(true);
    }
  }

  private ingestQueryResult(
    result: CommanderQueryResponse,
    source: FixtureSource,
    storeKeyOverride?: string,
  ): { added: number; updated: number } | null {
    const fixtures = this.extractFixtures(result, source, storeKeyOverride);
    if (!fixtures.length) {
      return null;
    }

    return this.fixtureStore.upsertFixtures(fixtures);
  }

  private formatUpsertStats(stats: { added: number; updated: number }): string {
    const parts: string[] = [];
    if (stats.added > 0) parts.push(`${stats.added} added`);
    if (stats.updated > 0) parts.push(`${stats.updated} updated`);
    if (!parts.length) return 'No fixtures found';
    return parts.join(', ');
  }

  private showQueryResultToast(
    stats: { added: number; updated: number } | null,
    durationS?: number,
    includeDiscoveryAverages = false,
  ): void {
    let summary = stats ? this.formatUpsertStats(stats) : 'No fixtures found in response';
    if (durationS !== undefined) {
      summary += ` - ${durationS.toFixed(1)}s`;
      if (includeDiscoveryAverages) {
        const avg = this.discoveryAvgS();
        const cnt = this.discoveryTimings().length;
        if (cnt >= 2 && avg !== null) summary += ` - avg ${avg.toFixed(1)}s`;
      }
    }
    this.messageService.add({ key: 'app', severity: 'success', summary, life: 3000 });
  }

  private addDiscoveryTiming(durationS: number): void {
    this.discoveryTimings.set([...this.discoveryTimings(), durationS].slice(-10));
  }

  private showErrorToast(message: string): void {
    // Suppress redundant errors when cmdr-offline toast already covers the unavailable state.
    if (this.commanderUnavailable()) return;
    this.messageService.add({ key: 'app', severity: 'error', summary: message, life: 6000 });
  }

  /** Returns false if the API is known to be unreachable (cmdr-offline toast covers the state). */
  private checkApiReachable(): boolean {
    return !this.healthError();
  }

  private extractFixtures(
    result: CommanderQueryResponse,
    source: FixtureSource,
    /** When querying a single fixture from the modal, pass its store key so the
     *  record is always updated under the correct name even if the fixture
     *  self-reports a different fixture_name in the response summary. */
    storeKeyOverride?: string,
  ): FixtureRecord[] {
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
    const existingByName = this.fixtureStore.fixturesByName();

    for (const item of extracted) {
      // Use the store key override for single-fixture modal queries so the
      // existing record is updated even when the fixture self-reports a
      // different fixture_name (e.g. CMDR alias vs self-reported identity).
      const reported_fixture_name = this.readString(item, 'fixture_name');
      const fixture_name = storeKeyOverride ?? reported_fixture_name;
      const payload_plan_name = this.readString(item, 'plan_name');
      const existing_record = fixture_name ? existingByName[fixture_name] : undefined;
      const plan_name =
        storeKeyOverride && existing_record?.plan_name
          ? existing_record.plan_name
          : payload_plan_name;

      if (!fixture_name) {
        this.error.set(`Fixture payload missing fixture_name: ${JSON.stringify(item)}`);
        continue;
      }
      if (!plan_name) {
        this.error.set(`Fixture payload missing plan_name for ${fixture_name}.`);
        continue;
      }
      if (storeKeyOverride && reported_fixture_name && reported_fixture_name !== fixture_name) {
        console.warn('[cmdr][extractFixtures] storeKeyOverride identity mismatch', {
          store_fixture_name: fixture_name,
          payload_fixture_name: reported_fixture_name,
          payload_plan_name: payload_plan_name ?? null,
          preserved_plan_name: existing_record?.plan_name ?? null,
        });
      }

      // Preserve discovery-only fields (e.g. config from BK_CONFIG) that single-
      // fixture queries don't populate. Without this, a Run Query would clobber
      // the config populated by a previous full discovery.
      const existingRaw = existing_record?.raw;
      const mergedRaw: Record<string, unknown> = { ...item, fixture_name };
      if (mergedRaw['config'] == null && existingRaw?.['config'] != null) {
        mergedRaw['config'] = existingRaw['config'];
      }
      // Preserve plan_state from cache when a query returns null — plan_state is only
      // populated when the commander has a recent BK_PLAN_STATE serial message.
      if (mergedRaw['plan_state'] == null && existingRaw?.['plan_state'] != null) {
        mergedRaw['plan_state'] = existingRaw['plan_state'];
      }

      records.push({
        fixture_name,
        plan_name,
        raw: mergedRaw,
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

  private runRecoveryCallbacks(): void {
    for (const cb of this.recoveryCallbacks) {
      cb();
    }
  }

  private loadExposedPlans(): void {
    this.planListLoading.set(true);
    this.commanderApi.getExposedPlans().subscribe({
      next: (result) => {
        const plans = Array.isArray(result.plans) ? result.plans : [];
        this.exposedPlans.set(plans);
        this.syncSelectedPlan(plans);
        this.planListLoading.set(false);
      },
      error: (err: unknown) => {
        this.exposedPlans.set([]);
        this.planListLoading.set(false);
        this.showErrorToast(this.formatError('Plan list load failed', err));
      },
    });
  }

  private loadLanGroups(): void {
    this.lanGroupListLoading.set(true);
    this.commanderApi.getLanGroups().subscribe({
      next: (result) => {
        const groups = Array.isArray(result.lan_groups) ? result.lan_groups : [];
        this.lanGroups.set(groups);
        this.syncSelectedPlanGroup(groups);
        this.syncSelectedFixture(groups);
        this.lanGroupListLoading.set(false);
      },
      error: (err: unknown) => {
        this.lanGroups.set([]);
        this.lanGroupListLoading.set(false);
        this.showErrorToast(this.formatError('Plan group list load failed', err));
      },
    });
  }

  private syncSelectedPlan(plans: CommanderExposedPlan[]): void {
    if (!plans.length) {
      this.planName.set('');
      return;
    }
    const current = this.planName().trim();
    if (!current || !plans.some((item) => item.plan_name === current)) {
      this.planName.set(plans[0].plan_name);
    }
  }

  private syncSelectedPlanGroup(groups: CommanderLanGroup[]): void {
    if (!groups.length) {
      this.planGroupName.set('');
      return;
    }
    const current = this.planGroupName().trim();
    if (!current || !groups.some((item) => item.plan_group === current)) {
      this.planGroupName.set(groups[0].plan_group);
    }
  }

  private syncSelectedFixture(groups: CommanderLanGroup[]): void {
    const allFixtures = groups.flatMap((g) => g.fixtures ?? []).sort();
    if (!allFixtures.length) {
      this.fixtureName.set('');
      return;
    }
    const current = this.fixtureName().trim();
    if (!current || !allFixtures.includes(current)) {
      this.fixtureName.set(allFixtures[0]);
    }
  }

  private sendCommand(
    fixture: string,
    command: string,
    mode: SendCommandMode = 'default',
    onSuccess?: () => void,
  ): void {
    const wireCommand = this.buildModalWireCommand(fixture, command, mode);

    this.fixtureActionLoading.set(true);
    this.fixtureActionResult.set(null);
    this.fixtureActionMessage.set(null);
    this.fixtureActionDurationMs.set(null);
    this.fixtureActionTone.set('info');
    const startedAt = performance.now();

    this.commanderApi.runFixtureCommand(fixture, wireCommand).subscribe({
      next: (result) => {
        const durationMs = performance.now() - startedAt;
        this.fixtureActionResult.set(result);

        const response = result as Record<string, unknown>;
        const routingMode =
          typeof response['routing_mode'] === 'string' ? (response['routing_mode'] as string) : 'direct';
        const ackRequested = response['ack_requested'] === true;
        const commandResult =
          response['command_result'] && typeof response['command_result'] === 'object'
            ? (response['command_result'] as Record<string, unknown>)
            : null;
        const dispatchedWireCommand =
          commandResult && typeof commandResult['command'] === 'string'
            ? (commandResult['command'] as string)
            : wireCommand;
        const acceptedLabel = ackRequested ? 'Fixture ACK confirmed' : 'Dispatch accepted';

        this.setFixtureModalFeedback(
          `${acceptedLabel} (${routingMode}) for ${fixture}: ${dispatchedWireCommand}`,
          'success',
          durationMs,
        );
        this.fixtureActionLoading.set(false);
        onSuccess?.();
      },
      error: (err: unknown) => {
        const durationMs = performance.now() - startedAt;
        this.fixtureActionResult.set(null);
        this.setFixtureModalFeedback(
          `Command failed for ${fixture}: ${this.formatError('', err)}`,
          'error',
          durationMs,
        );
        this.fixtureActionLoading.set(false);
      },
    });
  }

  private buildModalWireCommand(fixture: string, command: string, mode: SendCommandMode): string {
    const trimmedCommand = command.trim();
    const normalized = this.normalizeToWireTcmd(fixture, trimmedCommand);
    const shouldRequireAck =
      mode === 'force_ack' ? true : mode === 'force_no_ack' ? false : this.fixtureAckEnabled();
    if (shouldRequireAck) {
      return normalized.startsWith('ack;tcmd;') ? normalized : `ack;${normalized}`;
    }
    return normalized.startsWith('ack;tcmd;') ? normalized.slice(4) : normalized;
  }

  private normalizeToWireTcmd(fixture: string, command: string): string {
    let payload = command;
    let hadAckPrefix = false;
    if (payload.startsWith('ack;') && !payload.startsWith('ack;tcmd;')) {
      payload = payload.slice(4);
      hadAckPrefix = true;
    }

    const wire =
      payload.startsWith('tcmd;') || payload.startsWith('ack;tcmd;')
        ? payload
        : `tcmd;${fixture};${payload}`;

    if (hadAckPrefix && wire.startsWith('tcmd;')) {
      return `ack;${wire}`;
    }
    return wire;
  }

  private setFixtureModalFeedback(
    message: string,
    tone: FixtureModalFeedbackTone,
    durationMs: number | null = null,
  ): void {
    this.fixtureActionMessage.set(message);
    this.fixtureActionTone.set(tone);
    this.fixtureActionDurationMs.set(durationMs);
  }

  private extractPastableWireCommand(message: string | null): string | null {
    if (!message) return null;
    const colonIndex = message.indexOf(':');
    if (colonIndex < 0) return null;
    const candidate = message.slice(colonIndex + 1).trim();
    if (!candidate.startsWith('tcmd;') && !candidate.startsWith('ack;tcmd;')) return null;

    // Remove generated request ids so copied commands are manually reusable.
    let cleaned = candidate.replace(/(^|;)rid=[^;]*(?=;|$)/g, '$1');
    cleaned = cleaned.replace(/;;+/g, ';').replace(/^;/, '').trim();
    cleaned = cleaned.replace(/;+$/, '');

    return cleaned || null;
  }

  private buildInitialCustomCommandValues(
    commands: CmdrCustomCommandUiItem[],
  ): Record<string, Record<string, CustomCommandValue>> {
    const initial: Record<string, Record<string, CustomCommandValue>> = {};
    for (const command of commands) {
      const commandValues: Record<string, CustomCommandValue> = {};
      for (const arg of command.args ?? []) {
        commandValues[arg.name] = this.defaultValueForArg(arg);
      }
      initial[command.id] = commandValues;
    }
    this.syncSharedRgbDefaults(initial, commands);
    return initial;
  }

  private syncSharedRgbDefaults(
    initial: Record<string, Record<string, CustomCommandValue>>,
    commands: CmdrCustomCommandUiItem[],
  ): void {
    for (const channel of ['r', 'g', 'b'] as const) {
      let shared: CustomCommandValue | null = null;
      for (const command of commands) {
        const hasChannel = (command.args ?? []).some(
          (arg) => arg.name.trim().toLowerCase() === channel,
        );
        if (!hasChannel) continue;
        const value = initial[command.id]?.[channel];
        if (value !== undefined) {
          shared = value;
          break;
        }
      }
      if (shared === null) continue;
      for (const command of commands) {
        const hasChannel = (command.args ?? []).some(
          (arg) => arg.name.trim().toLowerCase() === channel,
        );
        if (!hasChannel) continue;
        if (!initial[command.id]) initial[command.id] = {};
        initial[command.id][channel] = shared;
      }
    }
  }

  private syncStateBackedCustomCommandValues(commands: CmdrCustomCommandUiItem[]): void {
    this.customCommandValues.update((current) => {
      let changed = false;
      const next: Record<string, Record<string, CustomCommandValue>> = { ...current };

      for (const command of commands) {
        let commandValues = next[command.id] ?? {};
        let commandChanged = false;

        for (const arg of command.args ?? []) {
          if (!this.hasStatePath(arg)) continue;
          const desired = this.defaultValueForArg(arg);
          if (commandValues[arg.name] === desired) continue;
          if (!commandChanged) {
            commandValues = { ...commandValues };
            commandChanged = true;
          }
          commandValues[arg.name] = desired;
        }

        if (commandChanged) {
          next[command.id] = commandValues;
          changed = true;
        }
      }

      return changed ? next : current;
    });
  }

  private hydrateCommandValues(
    command: CmdrCustomCommandUiItem,
    values: Record<string, CustomCommandValue>,
  ): Record<string, CustomCommandValue> {
    const hydrated: Record<string, CustomCommandValue> = { ...values };
    for (const arg of command.args ?? []) {
      if (hydrated[arg.name] === undefined || hydrated[arg.name] === null || hydrated[arg.name] === '') {
        hydrated[arg.name] = this.defaultValueForArg(arg);
      }
    }
    return hydrated;
  }

  private buildCommandFromTemplate(
    wireTemplate: string,
    values: Record<string, CustomCommandValue>,
  ): string {
    return wireTemplate.replace(/\{([a-zA-Z0-9_]+)\}/g, (_full, key: string) => {
      const value = values[key];
      return this.serializeTemplateValue(value);
    });
  }

  private findUnknownTemplatePlaceholders(
    wireTemplate: string,
    args: CmdrCustomCommandUiArg[],
  ): string[] {
    const declaredNames = new Set((args ?? []).map((arg) => arg.name));
    const missing = new Set<string>();
    const pattern = /\{([a-zA-Z0-9_]+)\}/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(wireTemplate)) !== null) {
      const key = match[1];
      if (!declaredNames.has(key)) {
        missing.add(key);
      }
    }
    return Array.from(missing);
  }

  private serializeTemplateValue(value: CustomCommandValue | undefined): string {
    if (typeof value === 'boolean') return value ? '1' : '0';
    if (typeof value === 'number' && Number.isFinite(value)) return `${value}`;
    if (typeof value === 'string') return value;
    return '';
  }

  private defaultValueForArg(arg: CmdrCustomCommandUiArg): CustomCommandValue {
    if (arg.control === 'checkbox') {
      return this.toBoolean(arg.default ?? false);
    }
    if (arg.control === 'select') {
      const options = this.readSelectOptions(arg);
      if (options.length > 0 && arg.default == null) {
        return options[0].value;
      }
      const fallback = options.length > 0 ? options[0].value : '';
      return this.normalizeSelectValue(arg, arg.default, fallback);
    }
    if (arg.control === 'slider' || arg.control === 'number') {
      const fallback = typeof arg.min === 'number' ? arg.min : 0;
      return this.toNumber(arg.default, fallback);
    }
    if (typeof arg.default === 'string') return arg.default;
    return '';
  }

  private normalizeArgValue(arg: CmdrCustomCommandUiArg, rawValue: unknown): CustomCommandValue {
    if (arg.control === 'checkbox') {
      return this.toBoolean(rawValue);
    }
    if (arg.control === 'select') {
      const options = this.readSelectOptions(arg);
      const fallback = options.length > 0 ? options[0].value : '';
      return this.normalizeSelectValue(arg, rawValue, fallback);
    }
    if (arg.control === 'slider' || arg.control === 'number') {
      const fallback = typeof arg.min === 'number' ? arg.min : 0;
      return this.toNumber(rawValue, fallback);
    }
    return typeof rawValue === 'string' ? rawValue : `${rawValue ?? ''}`;
  }

  private normalizeSelectValue(
    arg: CmdrCustomCommandUiArg,
    rawValue: unknown,
    fallback: CustomCommandValue,
  ): CustomCommandValue {
    const options = this.readSelectOptions(arg);
    if (typeof rawValue === 'number' || typeof rawValue === 'string' || typeof rawValue === 'boolean') {
      const matched = options.find((option) => option.value === rawValue);
      if (matched) return matched.value;
    }
    if (typeof rawValue === 'string') {
      const asNumber = Number(rawValue);
      if (Number.isFinite(asNumber)) {
        const matched = options.find((option) => option.value === asNumber);
        if (matched) return matched.value;
      }
    }
    return fallback;
  }

  private hasStatePath(arg: CmdrCustomCommandUiArg): boolean {
    const statePath = (arg as { state_path?: unknown }).state_path;
    return typeof statePath === 'string' && statePath.trim().length > 0;
  }

  private readSelectOptions(
    arg: CmdrCustomCommandUiArg,
  ): Array<{ label: string; value: CustomCommandValue }> {
    const rawOptions = (arg as unknown as { options?: unknown }).options;
    if (!Array.isArray(rawOptions)) return [];
    const options: Array<{ label: string; value: CustomCommandValue }> = [];
    for (const option of rawOptions) {
      if (!option || typeof option !== 'object') continue;
      const label = String((option as { label?: unknown }).label ?? '').trim();
      const value = (option as { value?: unknown }).value;
      if (!label) continue;
      if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') continue;
      options.push({ label, value });
    }
    return options;
  }

  private toNumber(rawValue: unknown, fallback: number): number {
    if (typeof rawValue === 'number' && Number.isFinite(rawValue)) return rawValue;
    if (typeof rawValue === 'string') {
      const parsed = Number(rawValue);
      if (Number.isFinite(parsed)) return parsed;
    }
    return fallback;
  }

  private toBoolean(rawValue: unknown): boolean {
    if (typeof rawValue === 'boolean') return rawValue;
    if (typeof rawValue === 'number') return rawValue !== 0;
    if (typeof rawValue === 'string') {
      const lowered = rawValue.trim().toLowerCase();
      return lowered === '1' || lowered === 'true' || lowered === 'yes' || lowered === 'on';
    }
    return false;
  }

  protected commandSendOnRelease(command: CmdrCustomCommandUiItem): boolean {
    const value = (command as Record<string, unknown>)['send_on_release'];
    return value === true;
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
        return `${prefix}: unreachable`;
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
