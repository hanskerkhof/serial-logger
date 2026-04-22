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
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { TooltipModule } from 'primeng/tooltip';
import { MessageService, MenuItem } from 'primeng/api';
import { SplitButtonModule } from 'primeng/splitbutton';
import { TabsModule } from 'primeng/tabs';
import { DrawerModule } from 'primeng/drawer';
import { ProgressBarModule } from 'primeng/progressbar';
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
  CmdrFixturePlanStatusResponse,
  CmdrVersionsResponse,
} from '../../api/cmdr-models';
import { FixturePlanGroup, FixtureRecord, FixtureSource, FixtureStoreService } from '../../fixture-store.service';
import { CommanderConsoleComponent } from './commander-console/commander-console.component';
import {
  FixturePlayerCommandRequest,
  FixturePlayerControlsComponent,
  VolumeSyncResultEvent,
} from '../../shared/fixture-player-controls/fixture-player-controls.component';
import { FixturePlanControlComponent, PlanState } from '../../shared/fixture-plan-control/fixture-plan-control.component';
import {
  FixtureCustomArgChangedEvent,
  FixtureCustomControlComponent,
  FixtureCustomMasterReleasedEvent,
} from '../../shared/fixture-custom-control/fixture-custom-control.component';
import { FixtureConfigControlComponent } from '../../shared/fixture-config-control/fixture-config-control.component';
import { FixtureDocsComponent } from '../../shared/fixture-docs/fixture-docs.component';
import { CopyToClipboardComponent } from '../../shared/copy-to-clipboard/copy-to-clipboard.component';
import { DiscoveryWsMessage, FixtureSeenWsMessage, HealthPollService, PlanStateWsMessage } from '../../health-poll.service';
import {
  QrScannedCommandService,
  ScannedFixtureCommand,
} from '../../shared/qr-scanner-demo/qr-scanned-command.service';
import { DurationPipe } from '../../shared/pipes/duration.pipe';

interface SelectOption {
  label: string;
  value: string;
}

interface PollIntervalOption {
  label: string;
  value: number;
}

type CustomCommandValue = string | number | boolean | Record<string, unknown>;
type FixtureModalFeedbackTone = 'info' | 'success' | 'warn' | 'error';
type SendCommandMode = 'default' | 'force_ack' | 'force_no_ack';

interface LiveUpdateTimingSample {
  phase: string | null;
  queryElapsedMs: number | null;
  sincePrevEmitMs: number | null;
  targetIntervalMs: number | null;
  headroomMs: number | null;
  overBudget: boolean | null;
  spike: boolean | null;
}

interface AutoStabilizeStatus {
  fromIntervalMs: number;
  toIntervalMs: number;
  atMs: number;
}

interface DiscoveryTimingRow {
  fixtureName: string;
  completeMs: number;
}

interface CustomCommandPostRunSyncToken {
  targets: string[];
  baselineByCommand: Record<string, Record<string, CustomCommandValue>>;
  baselineDraftByCommand: Record<string, Record<string, CustomCommandValue>>;
  queuedAtMs: number;
}

interface LiveValueChange {
  previous: CustomCommandValue;
  next: CustomCommandValue;
}

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
  imports: [FormsModule, ButtonModule, SplitButtonModule, BadgeModule, InputGroupModule, InputGroupAddonModule, InputTextModule, SelectModule, ToastModule, PanelModule, DialogModule, ToggleSwitchModule, TooltipModule, DrawerModule, TabsModule, ProgressBarModule, NgTemplateOutlet, CommanderConsoleComponent, FixturePlayerControlsComponent, FixturePlanControlComponent, FixtureCustomControlComponent, FixtureConfigControlComponent, FixtureDocsComponent, CopyToClipboardComponent, DurationPipe],
  providers: [MessageService],
  templateUrl: './commander.component.html',
  styleUrls: ['./commander.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommanderComponent implements OnInit {
  private static readonly FIXTURE_MODAL_POLL_INTERVAL_OPTIONS: readonly PollIntervalOption[] = [
    { label: '25ms', value: 25 },
    { label: '50ms', value: 50 },
    { label: '100ms', value: 100 },
    { label: '250ms', value: 250 },
    { label: '500ms', value: 500 },
    { label: '750ms', value: 750 },
    { label: '1s', value: 1000 },
    { label: '5s', value: 5000 },
  ];
  private static readonly AUTO_STABILIZE_STEPS_MS: readonly number[] = [500, 750, 1000];
  private static readonly AUTO_STABILIZE_WINDOW_SAMPLES = 8;
  private static readonly AUTO_STABILIZE_TRIGGER_COUNT = 5;
  // Throttle passive auto-queries so we do not flood commander fsf requests.
  private static readonly PASSIVE_QUERY_MIN_GAP_MS = 1000;
  private static readonly PASSIVE_QUERY_RETRY_DELAY_MS = 1500;

  protected readonly frontendVersion = APP_VERSION;
  protected readonly frontendBuildDate = BUILD_DATE;

  // Health service — injected early so signal aliases below can reference it at field-init time
  private readonly healthService = inject(HealthPollService);
  protected readonly health = this.healthService.health;
  protected readonly healthRefreshing = this.healthService.healthRefreshing;
  protected readonly healthError = this.healthService.healthError;
  protected readonly nextHealthPollCountdown = this.healthService.nextHealthPollCountdown;
  protected readonly offlineRetryStatusLabel = computed(() => {
    if (this.healthError()) {
      return `Next check in ${this.nextHealthPollCountdown()}s`;
    }
    const proxyState = String(this.health()?.commander?.proxy?.state ?? '').toLowerCase();
    if (proxyState === 'reconnecting' || proxyState === 'probing' || proxyState === 'offline') {
      return 'Auto-reprobe active';
    }
    if (proxyState === 'invalid_device') {
      return 'Commander check blocked (invalid device on port)';
    }
    return 'Auto-detection active';
  });

  protected readonly loading = signal(true);
  protected readonly fixtureQueryLoading = signal(false);
  protected readonly planQueryLoading = signal(false);
  protected readonly planGroupQueryLoading = signal(false);
  protected readonly sidebarRefreshingFixture = signal<string | null>(null);
  protected readonly sidebarRefreshingPlan = signal<string | null>(null);
  protected readonly sidebarRefreshingPlanGroup = signal<string | null>(null);
  protected readonly discoveryLoading = signal(false);
  protected readonly discoveryWsLoading = signal(false);
  protected readonly discoveryWsSessionId = signal<string | null>(null);
  protected readonly discoveryWsLatestFixture = signal<string | null>(null);
  protected readonly discoveryWsFixturesSeen = signal<number>(0);
  protected readonly discoveryWsFixturesComplete = signal<number>(0);
  protected readonly discoveryWsIdentifyCount = signal<number>(0);
  protected readonly discoveryWsConfigCount = signal<number>(0);
  protected readonly discoveryWsCapabilitiesCount = signal<number>(0);
  protected readonly discoveryWsPlanStateCount = signal<number>(0);
  protected readonly discoveryWsFixturesWithIdentify = signal<number>(0);
  protected readonly discoveryWsFixturesWithConfig = signal<number>(0);
  protected readonly discoveryWsFixturesWithCapabilities = signal<number>(0);
  protected readonly discoveryWsFixturesWithPlanState = signal<number>(0);
  protected readonly discoveryWsFixturesReportsComplete = signal<number>(0);
  protected readonly discoveryTimingDialogVisible = signal(false);
  private readonly discoveryTimingRowsByFixture = signal<Map<string, number>>(new Map());
  private readonly discoveryTimingLastSweepElapsedMs = signal<number | null>(null);
  private readonly discoveryWsUpsertedFixtureNames = new Set<string>();
  protected readonly discoverFixturesLoading = signal(false);
  protected readonly discoverFixturesCurrentFixture = signal<string | null>(null);
  protected readonly discoverFixturesElapsedS = signal<number>(0);
  protected readonly discoverFixturesLastDurationS = signal<number | null>(null);
  protected readonly discoverFixturesTotal = signal<number>(0);
  protected readonly discoverFixturesProcessed = signal<number>(0);
  protected readonly discoverFixturesProgressPct = computed(() => {
    const total = this.discoverFixturesTotal();
    if (total <= 0) return 0;
    const processed = this.discoverFixturesProcessed();
    return Math.max(0, Math.min(100, (processed / total) * 100));
  });
  protected readonly discoverFixturesProgressLabel = computed(() => {
    const processed = this.discoverFixturesProcessed();
    const total = this.discoverFixturesTotal();
    const current = this.discoverFixturesCurrentFixture();
    if (total <= 0) return 'Preparing fixture query...';
    return current ? `${processed}/${total} · ${current}` : `${processed}/${total}`;
  });
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
  protected readonly playerVolumeSyncResult = signal<VolumeSyncResultEvent | null>(null);
  protected readonly rebootConfirmPending = signal(false);
  protected readonly fixtureAckEnabled = signal(false);
  protected readonly fixtureModalTab = signal<string>('commands');
  /** Tracks cached per plan name — persists across modal opens within the session. */
  private readonly planTracksCache = signal<Map<string, { index: number; name: string; duration_ms: number }[]>>(new Map());
  /** Per-fixture docs reload key; bumping a key tells FixtureDocsComponent to re-fetch docs list/content. */
  private readonly docsReloadKeyByFixture = signal<Map<string, number>>(new Map());
  /** Tracks for the currently selected fixture's plan, null when not yet loaded. */
  protected readonly selectedFixtureTracks = computed(() => {
    const planName = this.selectedFixture()?.plan_name ?? null;
    return planName ? (this.planTracksCache().get(planName) ?? null) : null;
  });
  protected readonly selectedFixtureDocsReloadKey = computed(() => {
    const fixtureName = this.selectedFixtureName();
    if (!fixtureName) return 0;
    return this.docsReloadKeyByFixture().get(fixtureName) ?? 0;
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
  protected readonly discoveryWsButtonLabel = computed(() => {
    const last = this.discoveryLastS();
    const avg = this.discoveryAvgS();
    const cnt = this.discoveryTimings().length;
    if (this.discoveryWsLoading()) {
      return avg !== null ? `Full Discovery (WS) · ~${avg.toFixed(1)}s` : 'Full Discovery (WS)…';
    }
    if (last === null) return 'Full Discovery (WS)';
    if (cnt < 2) return `Full Discovery (WS) · ${last.toFixed(1)}s`;
    return `Full Discovery (WS) · ${last.toFixed(1)}s · avg ${avg!.toFixed(1)}s`;
  });
  protected readonly discoveryWsProgressLabel = computed<string>(() => {
    const seen = this.discoveryWsFixturesSeen();
    const complete = this.discoveryWsFixturesComplete();
    const reportsComplete = this.discoveryWsFixturesReportsComplete();
    if (seen > 0) return `Fixtures ${reportsComplete}/${seen} report-complete · ${complete}/${seen} upserted`;
    if (reportsComplete > 0) return `Fixtures ${reportsComplete} report-complete`;
    return `Completed ${complete} fixtures`;
  });
  protected readonly discoveryWsReportsLabel = computed<string>(() => {
    const identify = this.discoveryWsFixturesWithIdentify();
    const config = this.discoveryWsFixturesWithConfig();
    const capabilities = this.discoveryWsFixturesWithCapabilities();
    const planState = this.discoveryWsFixturesWithPlanState();
    return `Stage coverage: ID ${identify} · CFG ${config} · CAP ${capabilities} · PS ${planState}`;
  });
  protected readonly discoveryTimingRows = computed<DiscoveryTimingRow[]>(() => {
    const rows: DiscoveryTimingRow[] = [];
    this.discoveryTimingRowsByFixture().forEach((completeMs, fixtureName) => {
      rows.push({ fixtureName, completeMs });
    });
    rows.sort((a, b) => b.completeMs - a.completeMs);
    return rows;
  });
  protected readonly discoveryTimingTopRows = computed<DiscoveryTimingRow[]>(() =>
    this.discoveryTimingRows().slice(0, 12),
  );
  protected readonly discoveryTimingAvailable = computed<boolean>(() =>
    this.discoveryTimingRows().length > 0,
  );
  protected readonly discoveryTimingSummary = computed(() => {
    const rows = this.discoveryTimingRows();
    const sweepElapsedMs = this.discoveryTimingLastSweepElapsedMs();
    const slowest = rows.length > 0 ? rows[0] : null;
    return {
      responders: rows.length,
      sweepElapsedMs,
      slowestFixture: slowest?.fixtureName ?? null,
      slowestMs: slowest?.completeMs ?? null,
    };
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
  protected readonly customCommandLiveValues = signal<Record<string, Record<string, CustomCommandValue>>>({});
  protected readonly customCommandDraftValues = signal<Record<string, Record<string, CustomCommandValue>>>({});
  private readonly customCommandStateBackedOptimisticValues = signal<Record<string, Record<string, CustomCommandValue>>>({});
  private readonly pendingCustomCommandPostRunSync = signal<CustomCommandPostRunSyncToken[]>([]);
  private lastCustomCommandFixtureIdentity: string | null = null;
  protected readonly discoveryLockedByOtherTab = signal(false);
  protected readonly modalQueryLoading = signal(false);
  protected readonly modalQueryError = signal<string | null>(null);
  protected readonly fixtureModalVisible = signal(false);
  protected readonly fixtureModalPollingEnabled = signal(true);
  protected readonly fixtureModalPollIntervalOptions = [
    ...CommanderComponent.FIXTURE_MODAL_POLL_INTERVAL_OPTIONS,
  ];
  protected readonly fixtureModalPollIntervalMs = signal(this.loadFixtureModalPollIntervalMs());
  protected readonly fixtureModalPollIntervalLabel = computed(() =>
    this.formatPollIntervalLabel(this.fixtureModalPollIntervalMs()),
  );
  protected readonly liveTimingMovingAverageEnabled = signal(
    localStorage.getItem('cmdr.liveTiming.movingAvg') === '1',
  );
  private readonly liveTimingSamplesByFixture = signal<Map<string, LiveUpdateTimingSample[]>>(new Map());
  private readonly liveOverBudgetWindowByFixture = signal<Map<string, boolean[]>>(new Map());
  private readonly liveAutoStabilizedByFixture = signal<Map<string, AutoStabilizeStatus>>(new Map());
  private readonly fixtureManualRefreshAtByName = signal<Map<string, number>>(new Map());
  private modalQuerySub: Subscription | null = null;
  /** Fixture names that have been auto-queried on first modal open this session. */
  private readonly autoQueriedFixtures = new Set<string>();
  protected readonly rawCommand = signal('');
  protected readonly rawCommandLoading = signal(false);
  protected readonly rawCommandResult = signal<RawCommandResponse | null>(null);
  protected readonly rawCommandError = signal<string | null>(null);
  protected readonly backendBusy = computed(
    () =>
      this.discoveryLoading() ||
      this.discoveryWsLoading() ||
      this.fixtureQueryLoading() ||
      this.planQueryLoading() ||
      this.planGroupQueryLoading(),
  );
  protected readonly commanderUnavailable = computed(
    () => this.loading() || !!this.healthError() || this.health()?.commander?.detected !== true,
  );
  /** Human-readable reason shown in the fixture modal feedback strip when the commander is unavailable. */
  protected readonly commanderUnavailableReason = computed<string | null>(() => {
    if (!this.commanderUnavailable()) return null;
    if (this.loading()) return null;
    if (this.healthError()) {
      const err = String(this.healthError() ?? '').trim();
      return err ? `API unreachable (${err})` : 'API unreachable';
    }
    const commander = this.health()?.commander;
    if (!commander) return 'Commander not detected';
    if (commander['serial_hold_active'] === true) {
      const raw = String(commander['serial_hold_reason'] ?? '').trim();
      const label = raw ? raw.replace(/_/g, ' ') : 'serial hold';
      return `Serial port held (${label})`;
    }
    const proxy = commander['proxy'] as Record<string, unknown> | null | undefined;
    const proxyState = String(proxy?.['state'] ?? '').trim();
    const transitionReason = String(proxy?.['last_transition_reason'] ?? '').trim();
    const serialError = String(proxy?.['serial_error'] ?? '').trim();
    if (serialError) return `Proxy ${proxyState || 'offline'} (${serialError})`;
    if (transitionReason) {
      const label = transitionReason.replace(/_/g, ' ');
      return proxyState ? `Proxy ${proxyState} (${label})` : label;
    }
    if (proxyState) return `Proxy ${proxyState}`;
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
  private _offlineToastShown = false;
  private _lastUnavailableReason: string | null = null;
  private _unavailableToastTimer: ReturnType<typeof setTimeout> | null = null;
  private _progressToastClearTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly progressToastHoldMs = 3000;
  private _activeProgressToastMode: 'progress_full_ws' | 'progress_full' | 'progress_fixtures' | 'progress_query' | null = null;
  private _discoveryWsStartedAtMs: number | null = null;
  private _skipNextProgressHold = false;
  private _discoveryInProgressToastLastAtMs = 0;

  // TODO: auto-discovery on empty store disabled — passive heartbeat discovery replaces it.
  // private _autoDiscoveryTriggered = false;

  // Tracks fixture names currently being queried via passive discovery to avoid duplicate requests.
  private readonly _passiveQueryInFlight = new Set<string>();
  // Deduped FIFO queue for passive auto-queries (one request at a time).
  private readonly _passiveQueryQueue: string[] = [];
  private readonly _passiveQueryQueued = new Set<string>();
  private _passiveQueryDrainTimer: ReturnType<typeof setTimeout> | null = null;
  private _passiveQueryLastStartedAtMs = 0;
  protected readonly passiveQueryQueuedCount = signal(0);
  protected readonly passiveQueryInFlightCount = signal(0);
  protected readonly passiveQueryDebugLabel = computed(() =>
    `Passive query queue: ${this.passiveQueryQueuedCount()} · in-flight: ${this.passiveQueryInFlightCount()}`,
  );

  // Last-seen timestamps (ms since epoch) from the passive heartbeat cache, keyed by fixture name.
  protected readonly fixtureLastSeenMs = signal<Map<string, number>>(new Map());
  // Expected next passive heartbeat time (ms since epoch), keyed by fixture name.
  protected readonly fixtureNextSeenExpectedAtMs = signal<Map<string, number>>(new Map());
  private readonly discoveryLockStorageKey = 'cmdr.discovery.lock.v1';
  private readonly discoveryLockTtlMs = 5 * 60 * 1000;
  private readonly discoveryTabId =
    globalThis.crypto?.randomUUID?.() ?? `tab-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  private readonly commanderApi = inject(CommanderApiService);
  private readonly fixtureStore = inject(FixtureStoreService);
  private readonly messageService = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly swUpdate = inject(SwUpdate);
  private readonly qrScannedCommandService = inject(QrScannedCommandService);

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

  protected readonly selectedFixtureLastSeenAgoShort = computed<string>(() => {
    const fixture = this.selectedFixture();
    if (!fixture) return '--';
    const manual = this.fixtureManualRefreshAtByName().get(fixture.fixture_name) ?? null;
    const fallback = fixture.lastUpdatedAt ? new Date(fixture.lastUpdatedAt).getTime() : NaN;
    const ms = manual ?? fallback;
    if (!Number.isFinite(ms)) return '--';
    const seconds = Math.max(0, Math.floor((this.now() - ms) / 1000));
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h`;
  });

  protected readonly runQueryButtonLabel = computed<string>(
    () => `Run query (ago: ${this.selectedFixtureLastSeenAgoShort()})`,
  );
  protected readonly previousFixtureName = computed<string | null>(() => {
    const all = this.allFixturesOrdered();
    if (all.length <= 1) return null;
    const current = this.selectedFixture();
    const idx = current ? all.findIndex((f) => f.fixture_name === current.fixture_name) : -1;
    const prev = all[(idx - 1 + all.length) % all.length];
    return prev?.fixture_name ?? null;
  });

  protected readonly nextFixtureName = computed<string | null>(() => {
    const all = this.allFixturesOrdered();
    if (all.length <= 1) return null;
    const current = this.selectedFixture();
    const idx = current ? all.findIndex((f) => f.fixture_name === current.fixture_name) : -1;
    const next = all[(idx + 1 + all.length) % all.length];
    return next?.fixture_name ?? null;
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

  protected isProgressToastMode(mode: unknown): boolean {
    return typeof mode === 'string' && mode.startsWith('progress_');
  }

  protected shouldShowCompletedProgress(mode: unknown): boolean {
    if (mode === 'progress_full_ws') return !this.discoveryWsLoading();
    if (mode === 'progress_full') return !this.discoveryLoading();
    if (mode === 'progress_query') {
      return !this.fixtureQueryLoading() && !this.planQueryLoading() && !this.planGroupQueryLoading();
    }
    return false;
  }

  protected isProgressCancelable(mode: unknown): boolean {
    if (mode === 'progress_full_ws') return this.discoveryWsLoading();
    if (mode === 'progress_full') return this.discoveryLoading();
    if (mode === 'progress_fixtures') return this.discoverFixturesLoading();
    return false;
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
    effect(() =>
      localStorage.setItem(
        'cmdr.liveTiming.movingAvg',
        this.liveTimingMovingAverageEnabled() ? '1' : '0',
      ),
    );
    effect(() =>
      localStorage.setItem('cmdr.fixtureModalPollIntervalMs', String(this.fixtureModalPollIntervalMs())),
    );
    effect(() => {
      // Track only fixture identity so that re-queries (which update raw fixture data
      // including state_path-resolved defaults) don't overwrite the user's locally
      // edited slider values. Commands are read untracked so they don't create a
      // reactive dependency here — they will be current at the time the fixture changes.
      const selectedFixtureName = this.fixtureStore.selectedFixtureName();
      const selectedFixture = this.selectedFixture();
      const fixtureIdentity = (selectedFixture?.fixture_name ?? selectedFixtureName ?? '').trim();
      if (!fixtureIdentity) return;
      if (this.lastCustomCommandFixtureIdentity === fixtureIdentity) return;
      this.lastCustomCommandFixtureIdentity = fixtureIdentity;
      const commands = untracked(() => this.selectedFixtureCustomCommands());
      const initialValues = this.buildInitialCustomCommandValues(commands);
      this.customCommandLiveValues.set(initialValues);
      this.customCommandDraftValues.set(this.cloneCustomCommandValues(initialValues));
      this.customCommandStateBackedOptimisticValues.set({});
      this.pendingCustomCommandPostRunSync.set([]);
      // Reset any optimistic plan state when switching fixtures.
      untracked(() => this.optimisticPlanState.set(null));
    });

    effect(() => {
      // On re-query updates for the selected fixture, sync live display values only.
      // Draft values are intentionally left untouched so operators can edit safely
      // while plan_state keeps changing (for example rainbow/live effects).
      this.selectedFixture();
      const commands = this.selectedFixtureCustomCommands();
      this.syncStateBackedCustomCommandLiveValues(commands);
    });

    effect(() => {
      const visible = this.fixtureModalVisible();
      const liveUpdate = this.fixtureModalPollingEnabled();
      const intervalMs = this.fixtureModalPollIntervalMs();
      const commanderUnavailable = this.commanderUnavailable() || this.serialHoldActive();
      // Subscribe by selected fixture identity only; avoid resubscribing on every
      // fixture raw-data update (plan_state ticks), which causes WS chatter.
      const selectedName = (this.fixtureStore.selectedFixtureName() ?? this.fixtureName()).trim();
      if (!visible || !liveUpdate || !selectedName || commanderUnavailable) {
        this.healthService.unsubscribePlanState();
        return;
      }
      this.healthService.subscribePlanState(selectedName, intervalMs);
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
        const unavailableReason = this.commanderUnavailableReason();
        if (unavailable && !stillLoading && !refreshing) {
          if (unavailableReason) this._lastUnavailableReason = unavailableReason;
          // Debounce: only alarm after persistent unavailability.
          // Brief WS reconnects (sleep/wake) resolve in ~3 s — 5 s grace avoids false positives.
          if (this._unavailableToastTimer === null) {
            this._unavailableToastTimer = setTimeout(() => {
              this._unavailableToastTimer = null;
              // Snapshot at fire time: skip if WS has already started reconnecting.
              if (this.commanderUnavailable() && !this.loading() && !this.healthRefreshing() && !this._offlineToastShown) {
                this._wasUnavailable = true;
                this._offlineToastShown = true;
                this.messageService.add({
                  key: 'app',
                  severity: 'warn',
                  summary: 'Commander unavailable',
                  sticky: true,
                  data: { mode: 'offline' },
                });
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
            if (this._offlineToastShown) {
              this.messageService.clear('app');
              this._offlineToastShown = false;
            }
            // Clear stale modal errors from the outage so the feedback strip resets.
            this.modalQueryError.set(null);
            this.fixtureActionMessage.set(null);
            this.fixtureActionResult.set(null);
            const recoveryReason = this._lastUnavailableReason ? ` Reason: ${this._lastUnavailableReason}.` : '';
            this._lastUnavailableReason = null;
            this.messageService.add({
              key: 'app',
              severity: 'success',
              summary: 'Commander available',
              detail: `Connection restored.${recoveryReason}`,
              life: 4000,
              data: { mode: 'normal' },
            });
          }
        }
      }, 0);
    });

    effect(() => {
      const isDiscovery = this.discoveryLoading();
      const isDiscoveryWs = this.discoveryWsLoading();
      const isFixtureDiscovery = this.discoverFixturesLoading();
      const isFixtureQuery = this.fixtureQueryLoading();
      const isQuery = isFixtureQuery || this.planQueryLoading() || this.planGroupQueryLoading();
      const hasProgress = isDiscoveryWs || isDiscovery || isFixtureDiscovery || isQuery;

      if (this._progressToastClearTimer !== null) {
        clearTimeout(this._progressToastClearTimer);
        this._progressToastClearTimer = null;
      }

      if (!hasProgress) {
        if (this._skipNextProgressHold) {
          this._skipNextProgressHold = false;
          this._activeProgressToastMode = null;
          return;
        }
        // Hold the running toast briefly so completion toasts can stack below it first.
        this._progressToastClearTimer = setTimeout(() => {
          this._progressToastClearTimer = null;
          this.messageService.clear('app');
          this._activeProgressToastMode = null;
        }, this.progressToastHoldMs);
        return;
      }
      if (isDiscoveryWs) {
        if (this._activeProgressToastMode !== 'progress_full_ws') {
          const avg = this.discoveryAvgS();
          const summary =
            avg !== null
              ? `Full Discovery (WS) · ~${avg.toFixed(1)}s`
              : 'Full Discovery (WS) running';
          this.messageService.clear('app');
          this.messageService.add({
            key: 'app',
            severity: 'contrast',
            summary,
            sticky: true,
            closable: false,
            data: { mode: 'progress_full_ws', cancellable: 'full_ws', indeterminate: true },
          });
          this._activeProgressToastMode = 'progress_full_ws';
        }
      } else if (isDiscovery) {
        const avg = this.discoveryAvgS();
        const summary =
          avg !== null
            ? `Running full discovery… · ~${avg.toFixed(1)}s`
            : 'Running full discovery…';
        if (this._activeProgressToastMode !== 'progress_full') {
          this.messageService.clear('app');
          this.messageService.add({
            key: 'app',
            severity: 'contrast',
            summary,
            sticky: true,
            closable: false,
            data: { mode: 'progress_full', cancellable: 'full', indeterminate: true },
          });
          this._activeProgressToastMode = 'progress_full';
        }
      } else if (isFixtureDiscovery) {
        if (this._activeProgressToastMode !== 'progress_fixtures') {
          this.messageService.clear('app');
          this.messageService.add({
            key: 'app',
            severity: 'contrast',
            summary: 'Querying fixtures',
            sticky: true,
            closable: false,
            data: { mode: 'progress_fixtures', cancellable: 'fixtures' },
          });
          this._activeProgressToastMode = 'progress_fixtures';
        }
      } else if (isQuery) {
        const fixtureName = this.fixtureName().trim();
        const summary = isFixtureQuery && fixtureName
          ? `Running query for ${fixtureName}...`
          : 'Running query…';
        if (this._activeProgressToastMode !== 'progress_query') {
          this.messageService.clear('app');
          this.messageService.add({
            key: 'app',
            severity: 'contrast',
            summary,
            sticky: true,
            closable: false,
            data: { mode: 'progress_query', indeterminate: true },
          });
          this._activeProgressToastMode = 'progress_query';
        }
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
      disabled:
        this.backendBusy() ||
        this.commanderUnavailable() ||
        this.discoveryLoading() ||
        this.discoveryWsLoading() ||
        this.discoverFixturesLoading(),
      command: () => this.runFullDiscoveryThenFixtures(),
    },
  ]);
  protected readonly fullDiscoveryWsMenuItems = computed<MenuItem[]>(() => [
    {
      label: 'Full discovery (WS) + fixtures',
      icon: 'pi pi-list',
      disabled:
        this.backendBusy() ||
        this.commanderUnavailable() ||
        this.discoveryLoading() ||
        this.discoveryWsLoading() ||
        this.discoverFixturesLoading(),
      command: () => this.runFullDiscoveryWsThenFixtures(),
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
    const ps = this.selectedFixture()?.raw['plan_state'];
    if (typeof ps === 'string') {
      return ps as PlanState;
    }
    const planStatePayload = ps as Record<string, unknown> | null | undefined;
    return (planStatePayload?.['plan_state'] as string) || null;
  });

  protected readonly selectedFixtureLiveUpdateTimingLabel = computed<string | null>(() => {
    const timing = this.selectedFixture()?.raw['plan_state_timing'] as Record<string, unknown> | null | undefined;
    const fixtureName = (this.selectedFixture()?.fixture_name ?? this.fixtureName()).trim();
    const liveSample = this.parseLiveUpdateTimingSample(timing);
    const samples = fixtureName ? (this.liveTimingSamplesByFixture().get(fixtureName) ?? []) : [];
    const autoStabilized = fixtureName ? (this.liveAutoStabilizedByFixture().get(fixtureName) ?? null) : null;
    const useAvg = this.liveTimingMovingAverageEnabled();
    const avg = useAvg ? this.averageLiveUpdateTimingSamples(samples) : null;
    const sourceSample = avg ?? liveSample;
    if (!sourceSample) return null;
    const phase = sourceSample.phase;
    const queryElapsedMs = sourceSample.queryElapsedMs;
    const sincePrevEmitMs = sourceSample.sincePrevEmitMs;
    const headroomMs = sourceSample.headroomMs;
    const parts: string[] = [];
    if (useAvg && samples.length > 0) parts.push(`avg${samples.length}`);
    if (phase) parts.push(phase);
    if (queryElapsedMs !== null) parts.push(`Q ${queryElapsedMs.toFixed(1)} ms`);
    if (sincePrevEmitMs !== null) parts.push(`Δ ${sincePrevEmitMs.toFixed(1)} ms`);
    if (headroomMs !== null) parts.push(`H ${headroomMs.toFixed(1)} ms`);
    if (sourceSample.overBudget === true) parts.push('over-budget');
    if (sourceSample.spike === true) parts.push('spike');
    if (autoStabilized) parts.push(`auto-stabilized ${autoStabilized.toIntervalMs}ms`);
    return parts.length > 0 ? parts.join(' · ') : null;
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

  protected readonly selectedFixtureInfo = computed<{
    identity: { fixtureName: string; planName: string; planGroup: string | null };
    hardware: { fqbn: string | null; playerType: string | null; wifiMac: string | null };
    firmware: { version: string | null; buildDate: string | null; buildTime: string | null; uptimeSeconds: number | null };
    network: { universe: number | null; channel: number | null; rssiDbm: number | null; rssiQuality: string | null };
    meta: { source: string; lastUpdatedAt: string };
  } | null>(() => {
    const f = this.selectedFixture();
    if (!f) return null;
    const r = f.raw;
    return {
      identity: {
        fixtureName: f.fixture_name,
        planName: f.plan_name,
        planGroup: (r['plan_group'] as string | null | undefined) ?? null,
      },
      hardware: {
        fqbn: (r['fqbn'] as string | null | undefined) ?? null,
        playerType: (r['player_type'] as string | null | undefined) ?? null,
        wifiMac: (r['wifi_mac_address'] as string | null | undefined) ?? (r['target_wifi_mac'] as string | null | undefined) ?? null,
      },
      firmware: {
        version: (r['fw_version'] as string | null | undefined) ?? null,
        buildDate: (r['build_date'] as string | null | undefined) ?? null,
        buildTime: (r['build_time'] as string | null | undefined) ?? null,
        uptimeSeconds: this.resolveUptimeSeconds(r),
      },
      network: {
        universe: (r['universe'] as number | null | undefined) ?? null,
        channel: (r['channel'] as number | null | undefined) ?? null,
        rssiDbm: (r['rssi_dbm'] as number | null | undefined) ?? null,
        rssiQuality: (r['rssi_quality'] as string | null | undefined) ?? null,
      },
      meta: {
        source: f.source,
        lastUpdatedAt: f.lastUpdatedAt,
      },
    };
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

  /**
   * Resolves fixture uptime as seconds from a raw fixture record.
   * Prefers the numeric `uptime_seconds` field (single-fixture query path).
   * Falls back to parsing the `uptime` string from the discovery path (e.g. "2918s").
   */
  private resolveUptimeSeconds(r: Record<string, unknown>): number | null {
    const numeric = r['uptime_seconds'];
    if (typeof numeric === 'number') return numeric;
    const str = r['uptime'];
    if (typeof str !== 'string' || !str.trim()) return null;
    // Parse formats: "2918s", "4m 32s", "2h 10m 32s", "1d 2h 10m"
    let total = 0;
    const matches = str.matchAll(/(\d+)\s*([dhms])/g);
    for (const [, n, unit] of matches) {
      const v = parseInt(n, 10);
      if (unit === 'd') total += v * 86400;
      else if (unit === 'h') total += v * 3600;
      else if (unit === 'm') total += v * 60;
      else if (unit === 's') total += v;
    }
    return total > 0 ? total : null;
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
          severity: 'contrast',
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
      return;
    }
    this.queryFixtureByName(event.fixture_name);
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

  protected readonly commanderVersionParityWarning = computed<string | null>(() => {
    const health = this.health();
    const release = health?.api?.release_version ?? health?.release_version ?? null;
    const commanderFw = health?.commander?.fw_version ?? null;
    const explicitMismatch = health?.commander?.['fw_mismatch'] === true;
    if (!release || !commanderFw) return null;
    if (!explicitMismatch && compareVersions(commanderFw, release) === 0) return null;
    return `Commander FW v${commanderFw} differs from API release v${release}`;
  });

  // Callbacks run once when the API recovers from offline → online.
  // Add entries here to extend the recovery set.
  private readonly recoveryCallbacks: Array<() => void> = [];

  ngOnInit(): void {
    this.customUrl.set(this.activeApiUrl());
    this.refreshDiscoveryLockState();

    const onStorage = (event: StorageEvent) => {
      if (event.key && event.key !== this.discoveryLockStorageKey) return;
      this.refreshDiscoveryLockState();
    };
    window.addEventListener('storage', onStorage);

    // Register endpoints to re-fetch automatically on API recovery
    this.recoveryCallbacks.push(
      () => this.loadExposedPlans(),
      () => this.loadLanGroups(),
      () => this.pollPassiveDiscovery(),
    );

    this.loadExposedPlans();
    this.loadLanGroups();
    const timer = setInterval(() => this.now.set(Date.now()), 1000);
    this.destroyRef.onDestroy(() => clearInterval(timer));

    // Poll /fixtures/discovered every 15 s to pick up passively-seen fixtures.
    this.pollPassiveDiscovery();
    const passiveDiscoveryTimer = setInterval(() => this.pollPassiveDiscovery(), 15_000);
    this.destroyRef.onDestroy(() => clearInterval(passiveDiscoveryTimer));

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
    const qrScanSub = this.qrScannedCommandService.scannedCommand$.subscribe((scanned) => {
      this.executeScannedFixtureCommand(scanned);
    });
    const planStateSub = this.healthService.planState$.subscribe((msg: PlanStateWsMessage) => {
      const fixtureName = String(msg.fixture_name || '').trim();
      if (!fixtureName) return;
      const selectedName = (this.selectedFixture()?.fixture_name ?? this.fixtureName()).trim();
      if (!selectedName || fixtureName !== selectedName) return;
      if (!this.fixtureModalVisible() || !this.fixtureModalPollingEnabled()) return;
      const normalizedPlanState =
        (msg.summary?.plan_state as Record<string, unknown> | null | undefined) ??
        (typeof msg.plan_state === 'string' || typeof msg.state === 'object'
          ? ({
              fixture_name: fixtureName,
              plan_state: msg.plan_state ?? null,
              state: (msg.state as Record<string, unknown> | null | undefined) ?? null,
              received_at: msg.received_at ?? msg.utc ?? null,
            } as Record<string, unknown>)
          : null);
      const result = {
        ok: true,
        service: 'health_ws',
        fixture_name: fixtureName,
        summary: {
          fixture_name: fixtureName,
          plan_state: normalizedPlanState,
          source: String(msg.summary?.source ?? 'ws_live'),
          fsps: (msg.summary?.fsps as Record<string, unknown> | null | undefined) ?? null,
        },
        issued_commands: [],
        timing: (msg.timing as Record<string, unknown> | null | undefined) ?? null,
      } as CmdrFixturePlanStatusResponse;
      this.modalQueryError.set(null);
      this.applyFixturePlanStatusResult(fixtureName, result);
    });
    const planStateErrorSub = this.healthService.planStateError$.subscribe((msg) => {
      if (!this.fixtureModalVisible() || !this.fixtureModalPollingEnabled()) return;
      const reason = String(msg.reason || '').trim().toLowerCase();
      if (reason === 'overloaded') {
        const active = Number(msg.active_subscribers ?? 0);
        const max = Number(msg.max_subscribers ?? 0);
        this.modalQueryError.set(
          `Live update busy: ${active}/${max} subscribers in use. Use "Refresh plan state" or try again later.`,
        );
      }
    });
    const discoverySub = this.healthService.discovery$.subscribe((msg: DiscoveryWsMessage) => {
      const eventType = String(msg.type || '').trim();
      if (!eventType) return;
      if (eventType === 'discovery_rejected') {
        this.discoveryWsThenFixturesPending = false;
        this.discoveryWsLoading.set(false);
        this.releaseDiscoveryLock();
        this.showDiscoveryAlreadyInProgressToast();
        return;
      }
      if (eventType === 'discovery_started') {
        const sid = String(msg['session_id'] ?? '').trim();
        if (sid) this.discoveryWsSessionId.set(sid);
        this.discoveryWsLatestFixture.set(null);
        this.discoveryWsFixturesSeen.set(0);
        this.discoveryWsFixturesComplete.set(0);
        this.discoveryWsIdentifyCount.set(0);
        this.discoveryWsConfigCount.set(0);
        this.discoveryWsCapabilitiesCount.set(0);
        this.discoveryWsPlanStateCount.set(0);
        this.discoveryWsFixturesWithIdentify.set(0);
        this.discoveryWsFixturesWithConfig.set(0);
        this.discoveryWsFixturesWithCapabilities.set(0);
        this.discoveryWsFixturesWithPlanState.set(0);
        this.discoveryWsFixturesReportsComplete.set(0);
        this.discoveryWsUpsertedFixtureNames.clear();
        this.discoveryTimingRowsByFixture.set(new Map());
        this.discoveryTimingLastSweepElapsedMs.set(null);
        this._discoveryWsStartedAtMs = performance.now();
        this.discoveryWsLoading.set(true);
        return;
      }
      if (eventType === 'discovery_progress') {
        const sweepElapsedMs = Number(msg['elapsed_ms']);
        if (Number.isFinite(sweepElapsedMs) && sweepElapsedMs >= 0) {
          this.discoveryTimingLastSweepElapsedMs.set(Math.floor(sweepElapsedMs));
        }
        const counts = (msg['counts'] as Record<string, unknown> | null | undefined) ?? null;
        if (counts) {
          const seen = Number(counts['fixtures_seen']);
          const complete = Number(counts['fixtures_complete']);
          const identify = Number(counts['identify']);
          const config = Number(counts['config']);
          const capabilities = Number(counts['capabilities']);
          const planState = Number(counts['plan_state']);
          const fixturesWithIdentify = Number(counts['fixtures_with_identify']);
          const fixturesWithConfig = Number(counts['fixtures_with_config']);
          const fixturesWithCapabilities = Number(counts['fixtures_with_capabilities']);
          const fixturesWithPlanState = Number(counts['fixtures_with_plan_state']);
          const fixturesReportsComplete = Number(counts['fixtures_reports_complete']);
          if (Number.isFinite(seen) && seen >= 0) this.discoveryWsFixturesSeen.set(Math.floor(seen));
          if (Number.isFinite(complete) && complete >= 0) this.discoveryWsFixturesComplete.set(Math.floor(complete));
          if (Number.isFinite(identify) && identify >= 0) this.discoveryWsIdentifyCount.set(Math.floor(identify));
          if (Number.isFinite(config) && config >= 0) this.discoveryWsConfigCount.set(Math.floor(config));
          if (Number.isFinite(capabilities) && capabilities >= 0) this.discoveryWsCapabilitiesCount.set(Math.floor(capabilities));
          if (Number.isFinite(planState) && planState >= 0) this.discoveryWsPlanStateCount.set(Math.floor(planState));
          if (Number.isFinite(fixturesWithIdentify) && fixturesWithIdentify >= 0) this.discoveryWsFixturesWithIdentify.set(Math.floor(fixturesWithIdentify));
          if (Number.isFinite(fixturesWithConfig) && fixturesWithConfig >= 0) this.discoveryWsFixturesWithConfig.set(Math.floor(fixturesWithConfig));
          if (Number.isFinite(fixturesWithCapabilities) && fixturesWithCapabilities >= 0) this.discoveryWsFixturesWithCapabilities.set(Math.floor(fixturesWithCapabilities));
          if (Number.isFinite(fixturesWithPlanState) && fixturesWithPlanState >= 0) this.discoveryWsFixturesWithPlanState.set(Math.floor(fixturesWithPlanState));
          if (Number.isFinite(fixturesReportsComplete) && fixturesReportsComplete >= 0) this.discoveryWsFixturesReportsComplete.set(Math.floor(fixturesReportsComplete));
        }
        return;
      }
      if (eventType === 'discovery_fixture_upsert') {
        const fixture = msg['fixture'];
        if (!fixture || typeof fixture !== 'object') return;
        const fixtureName = String((fixture as { fixture_name?: unknown }).fixture_name ?? '').trim();
        if (fixtureName) {
          this.discoveryWsLatestFixture.set(fixtureName);
          this.discoveryWsUpsertedFixtureNames.add(fixtureName);
          if (this._discoveryWsStartedAtMs !== null) {
            const completeMs = performance.now() - this._discoveryWsStartedAtMs;
            const next = new Map(this.discoveryTimingRowsByFixture());
            next.set(fixtureName, completeMs);
            this.discoveryTimingRowsByFixture.set(next);
          }
        }
        const counts = (msg['counts'] as Record<string, unknown> | null | undefined) ?? null;
        if (counts) {
          const seen = Number(counts['fixtures_seen']);
          const complete = Number(counts['fixtures_complete']);
          const identify = Number(counts['identify']);
          const config = Number(counts['config']);
          const capabilities = Number(counts['capabilities']);
          const planState = Number(counts['plan_state']);
          const fixturesWithIdentify = Number(counts['fixtures_with_identify']);
          const fixturesWithConfig = Number(counts['fixtures_with_config']);
          const fixturesWithCapabilities = Number(counts['fixtures_with_capabilities']);
          const fixturesWithPlanState = Number(counts['fixtures_with_plan_state']);
          const fixturesReportsComplete = Number(counts['fixtures_reports_complete']);
          if (Number.isFinite(seen) && seen >= 0) this.discoveryWsFixturesSeen.set(Math.floor(seen));
          if (Number.isFinite(complete) && complete >= 0) this.discoveryWsFixturesComplete.set(Math.floor(complete));
          if (Number.isFinite(identify) && identify >= 0) this.discoveryWsIdentifyCount.set(Math.floor(identify));
          if (Number.isFinite(config) && config >= 0) this.discoveryWsConfigCount.set(Math.floor(config));
          if (Number.isFinite(capabilities) && capabilities >= 0) this.discoveryWsCapabilitiesCount.set(Math.floor(capabilities));
          if (Number.isFinite(planState) && planState >= 0) this.discoveryWsPlanStateCount.set(Math.floor(planState));
          if (Number.isFinite(fixturesWithIdentify) && fixturesWithIdentify >= 0) this.discoveryWsFixturesWithIdentify.set(Math.floor(fixturesWithIdentify));
          if (Number.isFinite(fixturesWithConfig) && fixturesWithConfig >= 0) this.discoveryWsFixturesWithConfig.set(Math.floor(fixturesWithConfig));
          if (Number.isFinite(fixturesWithCapabilities) && fixturesWithCapabilities >= 0) this.discoveryWsFixturesWithCapabilities.set(Math.floor(fixturesWithCapabilities));
          if (Number.isFinite(fixturesWithPlanState) && fixturesWithPlanState >= 0) this.discoveryWsFixturesWithPlanState.set(Math.floor(fixturesWithPlanState));
          if (Number.isFinite(fixturesReportsComplete) && fixturesReportsComplete >= 0) this.discoveryWsFixturesReportsComplete.set(Math.floor(fixturesReportsComplete));
        }
        const syntheticResult = {
          summary: {
            fixtures: [fixture as Record<string, unknown>],
          },
        } as CommanderQueryResponse;
        this.ingestQueryResult(syntheticResult, 'discovery_query');
        return;
      }
      if (eventType === 'discovery_completed') {
        const sweepElapsedMs = Number(msg['elapsed_ms']);
        if (Number.isFinite(sweepElapsedMs) && sweepElapsedMs >= 0) {
          this.discoveryTimingLastSweepElapsedMs.set(Math.floor(sweepElapsedMs));
        }
        const shouldQueryFixtures = this.discoveryWsThenFixturesPending;
        this.discoveryWsThenFixturesPending = false;
        this.discoveryWsLatestFixture.set(null);
        const durationS =
          this._discoveryWsStartedAtMs !== null
            ? (performance.now() - this._discoveryWsStartedAtMs) / 1000
            : undefined;
        if (durationS !== undefined) this.addDiscoveryTiming(durationS);
        this._discoveryWsStartedAtMs = null;
        const summary = msg['summary'] as Record<string, unknown> | null | undefined;
        if (summary && typeof summary === 'object') {
          const fixturesRaw = Array.isArray(summary['fixtures']) ? (summary['fixtures'] as unknown[]) : [];
          const missingFixtures = fixturesRaw.filter((item) => {
            if (!item || typeof item !== 'object') return true;
            const name = String((item as { fixture_name?: unknown }).fixture_name ?? '').trim();
            if (!name) return true;
            return !this.discoveryWsUpsertedFixtureNames.has(name);
          }) as Record<string, unknown>[];
          let stats: { added: number; updated: number } | null = null;
          if (missingFixtures.length > 0) {
            const syntheticResult = {
              summary: {
                ...summary,
                fixtures: missingFixtures,
              },
            } as CommanderQueryResponse;
            stats = this.ingestQueryResult(syntheticResult, 'discovery_query');
          }
          if (stats) {
            this.showQueryResultToast(stats, durationS, true);
          } else {
            const avg = this.discoveryAvgS();
            const cnt = this.discoveryTimings().length;
            const durationSuffix = durationS !== undefined ? ` - ${durationS.toFixed(1)}s` : '';
            const avgSuffix = cnt >= 2 && avg !== null ? ` - avg ${avg.toFixed(1)}s` : '';
            const streamedCount = this.discoveryWsUpsertedFixtureNames.size;
            this.messageService.add({
              key: 'app',
              severity: 'success',
              summary: `${streamedCount} updated${durationSuffix}${avgSuffix}`,
              life: 3000,
            });
          }
        } else {
          const avg = this.discoveryAvgS();
          const cnt = this.discoveryTimings().length;
          const durationSuffix = durationS !== undefined ? ` - ${durationS.toFixed(1)}s` : '';
          const avgSuffix = cnt >= 2 && avg !== null ? ` - avg ${avg.toFixed(1)}s` : '';
          this.messageService.add({
            key: 'app',
            severity: 'success',
            summary: `Full Discovery (WS) completed${durationSuffix}${avgSuffix}`,
            life: 3000,
          });
        }
        this.discoveryWsLoading.set(false);
        this.discoveryWsUpsertedFixtureNames.clear();
        this.releaseDiscoveryLock();
        if (shouldQueryFixtures) {
          setTimeout(() => this.runSidebarFixtureDiscovery(), 0);
        }
        return;
      }
      if (eventType === 'discovery_failed') {
        this.discoveryWsThenFixturesPending = false;
        this.discoveryWsLatestFixture.set(null);
        this.discoveryWsFixturesSeen.set(0);
        this.discoveryWsFixturesComplete.set(0);
        this.discoveryWsIdentifyCount.set(0);
        this.discoveryWsConfigCount.set(0);
        this.discoveryWsCapabilitiesCount.set(0);
        this.discoveryWsPlanStateCount.set(0);
        this.discoveryWsFixturesWithIdentify.set(0);
        this.discoveryWsFixturesWithConfig.set(0);
        this.discoveryWsFixturesWithCapabilities.set(0);
        this.discoveryWsFixturesWithPlanState.set(0);
        this.discoveryWsFixturesReportsComplete.set(0);
        this.discoveryTimingRowsByFixture.set(new Map());
        this.discoveryTimingLastSweepElapsedMs.set(null);
        this.discoveryWsUpsertedFixtureNames.clear();
        this._discoveryWsStartedAtMs = null;
        const errorText =
          typeof msg['error'] === 'string' && msg['error'].trim().length > 0
            ? msg['error'].trim()
            : 'unknown error';
        this.discoveryWsLoading.set(false);
        this.releaseDiscoveryLock();
        this.showErrorToast(`Full discovery (WS) failed: ${errorText}`);
        return;
      }
      if (eventType === 'discovery_cancelled') {
        this.discoveryWsThenFixturesPending = false;
        this.discoveryWsLatestFixture.set(null);
        this.discoveryWsFixturesSeen.set(0);
        this.discoveryWsFixturesComplete.set(0);
        this.discoveryWsIdentifyCount.set(0);
        this.discoveryWsConfigCount.set(0);
        this.discoveryWsCapabilitiesCount.set(0);
        this.discoveryWsPlanStateCount.set(0);
        this.discoveryWsFixturesWithIdentify.set(0);
        this.discoveryWsFixturesWithConfig.set(0);
        this.discoveryWsFixturesWithCapabilities.set(0);
        this.discoveryWsFixturesWithPlanState.set(0);
        this.discoveryWsFixturesReportsComplete.set(0);
        this.discoveryTimingRowsByFixture.set(new Map());
        this.discoveryTimingLastSweepElapsedMs.set(null);
        this.discoveryWsUpsertedFixtureNames.clear();
        this._discoveryWsStartedAtMs = null;
        this.discoveryWsLoading.set(false);
        this.releaseDiscoveryLock();
        return;
      }
    });
    const fixtureSeenSub = this.healthService.fixtureSeen$.subscribe((msg: FixtureSeenWsMessage) => {
      const name = String(msg.fixture_name ?? '').trim();
      if (!name) return;
      const lastSeen = typeof msg.data?.['last_seen_ms'] === 'number' ? msg.data['last_seen_ms'] : Date.now();
      this.updateFixturePassiveTiming(name, lastSeen, this.resolveNextPassiveSeenInMs(msg.data?.['next_passive_seen_in_ms']));
      const versionPatch: Record<string, unknown> = {};
      if (typeof msg.data?.['fw_version'] === 'string' && msg.data['fw_version']) versionPatch['fw_version'] = msg.data['fw_version'];
      if (typeof msg.data?.['build_date'] === 'string' && msg.data['build_date']) versionPatch['build_date'] = msg.data['build_date'];
      if (typeof msg.data?.['build_time'] === 'string' && msg.data['build_time']) versionPatch['build_time'] = msg.data['build_time'];
      if (Object.keys(versionPatch).length > 0) this.fixtureStore.patchFixtureRaw(name, versionPatch);
      this.autoQueryPassiveFixture(name);
    });
    this.destroyRef.onDestroy(() => {
      successSub.unsubscribe();
      failedSub.unsubscribe();
      pollSub.unsubscribe();
      qrScanSub.unsubscribe();
      planStateSub.unsubscribe();
      planStateErrorSub.unsubscribe();
      discoverySub.unsubscribe();
      fixtureSeenSub.unsubscribe();
      this.stopFixtureModalPolling();
      window.removeEventListener('storage', onStorage);
      this.releaseDiscoveryLock();
      if (this._progressToastClearTimer !== null) {
        clearTimeout(this._progressToastClearTimer);
        this._progressToastClearTimer = null;
      }
      if (this._passiveQueryDrainTimer !== null) {
        clearTimeout(this._passiveQueryDrainTimer);
        this._passiveQueryDrainTimer = null;
      }
      this._activeProgressToastMode = null;
    });
  }

  private handleFirstHealthSuccess(wasOffline: boolean): void {
    if (wasOffline) this.runRecoveryCallbacks();
    // TODO: auto-discovery on empty store disabled — passive heartbeat discovery replaces it.
    // if (!this._autoDiscoveryTriggered && this.fixtureStore.fixtureCount() === 0) {
    //   this._autoDiscoveryTriggered = true;
    //   setTimeout(() => {
    //     if (
    //       this.fixtureStore.fixtureCount() === 0 &&
    //       this.healthService.health()?.commander?.detected === true
    //     ) {
    //       this.runFullDiscoveryWsThenFixtures();
    //     }
    //   }, 3000);
    // }
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
    const fixture = this.normalizeKnownFixtureName(this.fixtureName());
    if (!fixture) {
      this.error.set('Valid fixture name is required.');
      this.sidebarRefreshingFixture.set(null);
      return;
    }
    if (fixture !== this.fixtureName()) {
      this.fixtureName.set(fixture);
    }

    this.fixtureQueryLoading.set(true);
    this.error.set(null);
    const startedAt = performance.now();
    this.commanderApi.getFixtureVersion(fixture, {
      preferQueryTokenAuth: true,
    }).subscribe({
      next: (result) => {
        this.queryResult.set(result);
        const stats = this.ingestQueryResult(result, 'fixture_query');
        this.refreshTracksAndDocsAfterQuery(fixture, result);
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

  protected runFullDiscoveryWs(): void {
    this.discoveryWsThenFixturesPending = false;
    this.doFullDiscoveryWs();
  }

  protected runFullDiscoveryWsThenFixtures(): void {
    this.discoveryWsThenFixturesPending = true;
    this.doFullDiscoveryWs();
  }

  private discoverySubscription: Subscription | null = null;
  private discoverFixturesCancelRequested = false;
  private discoveryWsThenFixturesPending = false;

  private parseDiscoveryLock(raw: string | null): { owner: string; startedAtMs: number } | null {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as { owner?: unknown; startedAtMs?: unknown };
      const owner = typeof parsed.owner === 'string' ? parsed.owner.trim() : '';
      const startedAtMs = typeof parsed.startedAtMs === 'number' ? parsed.startedAtMs : Number.NaN;
      if (!owner || !Number.isFinite(startedAtMs)) return null;
      return { owner, startedAtMs };
    } catch {
      return null;
    }
  }

  private isDiscoveryLockFresh(lock: { owner: string; startedAtMs: number } | null): boolean {
    if (!lock) return false;
    return Date.now() - lock.startedAtMs < this.discoveryLockTtlMs;
  }

  private hasDiscoveryLockFromAnotherTab(): boolean {
    const lock = this.parseDiscoveryLock(localStorage.getItem(this.discoveryLockStorageKey));
    return this.isDiscoveryLockFresh(lock) && lock?.owner !== this.discoveryTabId;
  }

  private refreshDiscoveryLockState(): void {
    this.discoveryLockedByOtherTab.set(this.hasDiscoveryLockFromAnotherTab());
  }

  private claimDiscoveryLock(): void {
    const payload = {
      owner: this.discoveryTabId,
      startedAtMs: Date.now(),
    };
    localStorage.setItem(this.discoveryLockStorageKey, JSON.stringify(payload));
    this.refreshDiscoveryLockState();
  }

  private releaseDiscoveryLock(): void {
    const lock = this.parseDiscoveryLock(localStorage.getItem(this.discoveryLockStorageKey));
    if (lock?.owner === this.discoveryTabId) {
      localStorage.removeItem(this.discoveryLockStorageKey);
    }
    this.refreshDiscoveryLockState();
  }

  private doFullDiscovery(then?: () => void): void {
    if (this.hasDiscoveryLockFromAnotherTab()) {
      this.messageService.add({
        key: 'app',
        severity: 'contrast',
        summary: 'Another window lock detected. Verifying with API…',
        life: 2500,
      });
      this.refreshDiscoveryLockState();
    }
    if (!this.checkApiReachable()) return;
    this.claimDiscoveryLock();
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
        this.releaseDiscoveryLock();
        this.showQueryResultToast(stats, durationS, true);
        if (then) setTimeout(then, 0);
      },
      error: (err: unknown) => {
        this.discoverySubscription = null;
        this.discoveryLoading.set(false);
        this.releaseDiscoveryLock();
        if (err instanceof HttpErrorResponse && err.status === 409) {
          this.showDiscoveryAlreadyInProgressToast();
          this.refreshDiscoveryLockState();
          return;
        }
        this.showErrorToast(this.formatError('Full discovery failed', err));
      },
    });
  }

  private doFullDiscoveryWs(): void {
    if (this.hasDiscoveryLockFromAnotherTab()) {
      this.messageService.add({
        key: 'app',
        severity: 'contrast',
        summary: 'Another window lock detected. Verifying with API…',
        life: 2500,
      });
      this.refreshDiscoveryLockState();
    }
    if (!this.checkApiReachable()) return;
    this.claimDiscoveryLock();
    this.discoveryWsLoading.set(true);
    this.discoveryWsSessionId.set(null);
    this._discoveryWsStartedAtMs = performance.now();
    this.error.set(null);
    this.commanderApi.startFixtureDiscoveryWs().subscribe({
      next: (result) => {
        this.discoveryWsSessionId.set(String(result.session_id || '').trim() || null);
        // Progress toast is managed by the discoveryWsLoading effect on the shared app toast channel.
      },
      error: (err: unknown) => {
        this.discoveryWsThenFixturesPending = false;
        this.discoveryWsLatestFixture.set(null);
        this.discoveryWsFixturesSeen.set(0);
        this.discoveryWsFixturesComplete.set(0);
        this.discoveryWsIdentifyCount.set(0);
        this.discoveryWsConfigCount.set(0);
        this.discoveryWsCapabilitiesCount.set(0);
        this.discoveryWsPlanStateCount.set(0);
        this.discoveryWsFixturesWithIdentify.set(0);
        this.discoveryWsFixturesWithConfig.set(0);
        this.discoveryWsFixturesWithCapabilities.set(0);
        this.discoveryWsFixturesWithPlanState.set(0);
        this.discoveryWsFixturesReportsComplete.set(0);
        this.discoveryWsUpsertedFixtureNames.clear();
        this._discoveryWsStartedAtMs = null;
        this.discoveryWsLoading.set(false);
        this.releaseDiscoveryLock();
        if (err instanceof HttpErrorResponse && err.status === 409) {
          this.showDiscoveryAlreadyInProgressToast();
          this.refreshDiscoveryLockState();
          return;
        }
        this.showErrorToast(this.formatError('Full discovery (WS) failed to start', err));
      },
    });
  }

  protected cancelCurrentDiscovery(): void {
    if (this.discoverySubscription) {
      this.clearProgressToastImmediately();
      this.discoverySubscription.unsubscribe();
      this.discoverySubscription = null;
      this.discoveryLoading.set(false);
      this.discoveryWsLoading.set(false);
      this.discoveryWsLatestFixture.set(null);
      this.discoveryWsFixturesSeen.set(0);
      this.discoveryWsFixturesComplete.set(0);
      this.discoveryWsIdentifyCount.set(0);
      this.discoveryWsConfigCount.set(0);
      this.discoveryWsCapabilitiesCount.set(0);
      this.discoveryWsPlanStateCount.set(0);
      this.discoveryWsFixturesWithIdentify.set(0);
      this.discoveryWsFixturesWithConfig.set(0);
      this.discoveryWsFixturesWithCapabilities.set(0);
      this.discoveryWsFixturesWithPlanState.set(0);
      this.discoveryWsFixturesReportsComplete.set(0);
      this.discoveryWsUpsertedFixtureNames.clear();
      this.discoveryWsThenFixturesPending = false;
      this.releaseDiscoveryLock();
      this.messageService.add({ key: 'app', severity: 'contrast', summary: 'Full discovery cancelled', life: 3000 });
    } else if (this.discoveryWsLoading()) {
      this.clearProgressToastImmediately();
      const currentSessionId = this.discoveryWsSessionId();
      this.commanderApi.cancelFixtureDiscoveryWs(currentSessionId).subscribe({
        next: () => {},
        error: () => {},
      });
      // WS discovery runs server-side; this cancels local waiting state only.
      this.discoveryWsLoading.set(false);
      this.discoveryWsLatestFixture.set(null);
      this.discoveryWsFixturesSeen.set(0);
      this.discoveryWsFixturesComplete.set(0);
      this.discoveryWsIdentifyCount.set(0);
      this.discoveryWsConfigCount.set(0);
      this.discoveryWsCapabilitiesCount.set(0);
      this.discoveryWsPlanStateCount.set(0);
      this.discoveryWsFixturesWithIdentify.set(0);
      this.discoveryWsFixturesWithConfig.set(0);
      this.discoveryWsFixturesWithCapabilities.set(0);
      this.discoveryWsFixturesWithPlanState.set(0);
      this.discoveryWsFixturesReportsComplete.set(0);
      this._discoveryWsStartedAtMs = null;
      this.discoveryWsThenFixturesPending = false;
      this.releaseDiscoveryLock();
      this.messageService.add({ key: 'app', severity: 'contrast', summary: 'Stopped waiting for Full Discovery (WS)', life: 3000 });
    } else if (this.discoverFixturesLoading()) {
      this.discoverFixturesCancelRequested = true;
      // Remove the running progress toast immediately on cancel.
      this.clearProgressToastImmediately();
      this.discoverFixturesLoading.set(false);
    }
  }

  private clearProgressToastImmediately(): void {
    if (this._progressToastClearTimer !== null) {
      clearTimeout(this._progressToastClearTimer);
      this._progressToastClearTimer = null;
    }
    this.messageService.clear('app');
    this._activeProgressToastMode = null;
    this._skipNextProgressHold = true;
  }

  private showDiscoveryAlreadyInProgressToast(): void {
    const now = Date.now();
    if (now - this._discoveryInProgressToastLastAtMs < 1500) return;
    this._discoveryInProgressToastLastAtMs = now;
    this.messageService.add({
      key: 'app',
      severity: 'warn',
      summary: 'Full discovery already in progress (another window/request).',
      life: 5000,
    });
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
        severity: 'contrast',
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
    this.discoverFixturesTotal.set(fixtureNames.length);
    this.discoverFixturesProcessed.set(0);
    void this.runSidebarFixtureDiscoverySequential(fixtureNames);
  }

  protected runSidebarFixtureDiscoveryOutdated(): void {
    if (!this.checkApiReachable() || this.discoverFixturesLoading()) return;

    const fixtureNames = this.outdatedFixtureNames();

    if (!fixtureNames.length) {
      this.messageService.add({
        key: 'app',
        severity: 'contrast',
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
    this.discoverFixturesTotal.set(fixtureNames.length);
    this.discoverFixturesProcessed.set(0);
    void this.runSidebarFixtureDiscoverySequential(fixtureNames);
  }

  private async runSidebarFixtureDiscoverySequential(fixtureNames: string[]): Promise<void> {
    const startedAt = performance.now();
    let successCount = 0;
    const failures: string[] = [];
    let anyAuthFailure = false;

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
          const result = await firstValueFrom(this.commanderApi.getFixtureVersion(fixtureName, {
            preferQueryTokenAuth: true,
          }));
          this.ingestQueryResult(result, 'fixture_query', fixtureName);
          this.autoQueriedFixtures.add(fixtureName);
          successCount += 1;
        } catch (err: unknown) {
          console.warn('[cmdr][discover-fixtures] fixture query failed', { fixtureName, err });
          failures.push(fixtureName);
          if (err instanceof HttpErrorResponse && err.status === 401) {
            anyAuthFailure = true;
          }
        } finally {
          this.discoverFixturesProcessed.set(successCount + failures.length);
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
      this.messageService.add({ key: 'app', severity: 'contrast', summary: `Fixture discovery cancelled — ${successCount} queried before stopping`, life: 4000 });
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
        ? `${anyAuthFailure ? 'Not authenticated — log in first. ' : ''}Failed: ${failures.slice(0, 5).join(', ')}${failedCount > 5 ? ', ...' : ''}`
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
    const normalized = this.normalizeKnownFixtureName(value);
    if (!normalized) return;
    this.fixtureName.set(normalized);
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
    const normalized = this.normalizeKnownFixtureName(event.value);
    if (!normalized) return;
    this.fixtureName.set(normalized);
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
    if (!visible) this.resetFixtureModalState();
    if (visible) this.startFixtureModalPolling();
  }

  private loadTracksForPlan(planName: string, forceRefresh = false): void {
    if (!forceRefresh && this.planTracksCache().has(planName)) return;
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
    this.stopFixtureModalPolling();
    this.modalQueryLoading.set(false);
    this.modalQueryError.set(null);
    this.fixtureActionMessage.set(null);
    this.fixtureActionDurationMs.set(null);
    this.fixtureActionTone.set('info');
    this.fixtureAckEnabled.set(false);
    this.rebootConfirmPending.set(false);
    this.fixtureModalTab.set('commands');
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
    this.runModalFixtureQueryInternal({
      refreshTracksAndDocs: true,
      successVerb: 'Query complete',
      preferQueryTokenAuth: true,
      onComplete,
    });
  }

  protected runModalFixtureUpdate(): void {
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

    this.modalQuerySub = this.commanderApi.getFixturePlanStatus(fixture, {
      preferQueryTokenAuth: true,
    }).subscribe({
      next: (result) => {
        this.modalQuerySub = null;
        this.modalQueryLoading.set(false);
        const durationMs = performance.now() - startedAt;
        this.applyFixturePlanStatusResult(fixture, result);
        this.markFixtureManualRefreshNow(fixture);
        this.setFixtureModalFeedback(`Plan state refresh complete for ${fixture}`, 'success', durationMs);
      },
      error: (err: unknown) => {
        this.modalQuerySub = null;
        const text = this.formatError('Fixture update failed', err);
        const compact = text.length > 180 ? `${text.slice(0, 177)}...` : text;
        this.modalQueryError.set(compact);
        this.modalQueryLoading.set(false);
      },
    });
  }

  protected onFixtureModalPollingToggle(value: boolean): void {
    if (value && (this.commanderUnavailable() || this.serialHoldActive())) {
      this.stopFixtureModalPolling();
      return;
    }
    this.fixtureModalPollingEnabled.set(!!value);
    if (this.fixtureModalPollingEnabled()) {
      this.startFixtureModalPolling();
    } else {
      this.stopFixtureModalPolling();
    }
  }

  protected onFixtureModalPollIntervalChange(value: number | null | undefined): void {
    const normalized = this.normalizeFixtureModalPollIntervalMs(value);
    if (normalized === this.fixtureModalPollIntervalMs()) return;
    this.fixtureModalPollIntervalMs.set(normalized);
    const fixture = (this.selectedFixture()?.fixture_name ?? this.fixtureName()).trim();
    if (fixture) this.clearAutoStabilizedStatus(fixture);
  }

  private startFixtureModalPolling(): void {
    if (!this.fixtureModalVisible() || !this.fixtureModalPollingEnabled()) return;
    const fixture = (this.selectedFixture()?.fixture_name ?? this.fixtureName()).trim();
    if (!fixture) return;
    this.healthService.subscribePlanState(fixture, this.fixtureModalPollIntervalMs());
  }

  private stopFixtureModalPolling(): void {
    this.healthService.unsubscribePlanState();
  }

  private runModalFixtureQueryInternal(options: {
    refreshTracksAndDocs: boolean;
    successVerb: 'Query complete' | 'Update complete';
    preferQueryTokenAuth: boolean;
    onComplete?: (result: CmdrVersionsResponse) => void;
  }): void {
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

    this.modalQuerySub = this.commanderApi.getFixtureVersion(fixture, {
      preferQueryTokenAuth: options.preferQueryTokenAuth,
    }).subscribe({
      next: (result) => {
        this.modalQuerySub = null;
        const durationMs = performance.now() - startedAt;
        this.queryResult.set(result);
        // Pass the selected fixture's store key so the record is updated under
        // the correct name even when the API summary reports a different
        // fixture_name (CMDR alias vs fixture self-identity).
        this.ingestQueryResult(result, 'fixture_query', fixture);
        this.markFixtureManualRefreshNow(fixture);
        this.modalQueryLoading.set(false);
        const fwVersion = result.summary?.fw_version;
        const message = fwVersion
          ? `${options.successVerb} for ${fixture} · fw v${fwVersion}`
          : `${options.successVerb} for ${fixture}`;
        this.setFixtureModalFeedback(message, 'success', durationMs);
        options.onComplete?.(result);
        if (options.refreshTracksAndDocs) {
          this.refreshTracksAndDocsAfterQuery(fixture, result);
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

  private refreshTracksAndDocsAfterQuery(requestedFixtureName: string, result: CmdrVersionsResponse): void {
    const fixture = this.fixtureStore.fixturesByName()[requestedFixtureName];
    const planName = result.plan_name ?? fixture?.plan_name ?? null;
    const playerAttached = (fixture?.raw['capabilities'] as { player?: { attached?: boolean } } | undefined)?.player?.attached === true;

    if (playerAttached && planName) {
      // Explicit query refresh should re-fetch tracks even if this plan is already cached.
      this.loadTracksForPlan(planName, true);
    }

    this.prefetchFixtureDocs(requestedFixtureName);
  }

  private applyFixturePlanStatusResult(
    fixtureName: string,
    result: CmdrFixturePlanStatusResponse,
  ): void {
    const existing = this.fixtureStore.fixturesByName()[fixtureName];
    if (!existing) return;
    const nextRaw: Record<string, unknown> = {
      ...(existing.raw ?? {}),
      plan_state: result.summary?.plan_state ?? null,
      plan_state_timing: (result.timing as Record<string, unknown> | null | undefined) ?? null,
    };
    if (nextRaw['plan_state'] != null) {
      this.optimisticPlanState.set(null);
    }
    this.recordLiveTimingSample(fixtureName, nextRaw['plan_state_timing'] as Record<string, unknown> | null | undefined);
    this.fixtureStore.upsertFixtures([{
      ...existing,
      raw: nextRaw,
      lastUpdatedAt: new Date().toISOString(),
      source: 'fixture_query',
    }]);
  }

  private queryFixtureByName(fixtureName: string): void {
    this.commanderApi.getFixtureVersion(fixtureName, {
      preferQueryTokenAuth: true,
    }).subscribe({
      next: (result) => {
        this.queryResult.set(result);
        this.ingestQueryResult(result, 'fixture_query', fixtureName);
        this.markFixtureManualRefreshNow(fixtureName);
        this.refreshTracksAndDocsAfterQuery(fixtureName, result);
      },
      error: (err: unknown) => {
        console.warn('[cmdr][queryFixtureByName] fixture query failed', { fixtureName, err });
      },
    });
  }

  private prefetchFixtureDocs(fixtureName: string): void {
    this.commanderApi.getFixtureDocs(fixtureName).subscribe({
      next: () => {
        this.bumpDocsReloadKey(fixtureName);
      },
      error: () => {},
    });
  }

  private bumpDocsReloadKey(fixtureName: string): void {
    this.docsReloadKeyByFixture.update((current) => {
      const next = new Map(current);
      const prev = next.get(fixtureName) ?? 0;
      next.set(fixtureName, prev + 1);
      return next;
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
    const expectedState: PlanState = action === 'trigger' ? 'RUNNING' : 'READY';
    this.sendCommand(fixture, command, 'default', () => {
      this.optimisticPlanState.set(expectedState);
    });
  }

  protected onPlayerCommand(request: FixturePlayerCommandRequest): void {
    const fixture = (this.selectedFixture()?.fixture_name ?? this.fixtureName()).trim();
    if (!fixture) return;
    if (request.kind === 'setVolume') {
      this.sendPlayerSetVolumeCommand(fixture, request);
      return;
    }
    this.sendCommand(fixture, request.command);
  }

  protected onPlayerVolumeSyncIssue(message: string): void {
    this.setFixtureModalFeedback(message, 'warn');
  }

  private sendPlayerSetVolumeCommand(fixture: string, request: FixturePlayerCommandRequest): void {
    const targetVolume = typeof request.volume === 'number' ? request.volume : null;
    const requestId = request.requestId ?? `vol-fallback-${Date.now().toString(36)}`;
    this.playerVolumeSyncResult.set(null);
    this.sendCommand(
      fixture,
      request.command,
      'default',
      () => {
        this.refreshPlanStatusAfterSetVolume(fixture, requestId, targetVolume);
      },
      () => {
        this.playerVolumeSyncResult.set({
          requestId,
          status: 'failed',
          authoritativeVolume: this.selectedFixturePlayerState()?.volume,
          message: `Volume command failed for ${fixture}.`,
        });
      },
    );
  }

  private refreshPlanStatusAfterSetVolume(
    fixture: string,
    requestId: string,
    targetVolume: number | null,
  ): void {
    this.commanderApi.getFixturePlanStatus(fixture, {
      preferQueryTokenAuth: true,
    }).subscribe({
      next: (result) => {
        this.applyFixturePlanStatusResult(fixture, result);
        const planStatePayload = result.summary?.plan_state as Record<string, unknown> | null | undefined;
        const state = (planStatePayload?.['state'] as Record<string, unknown> | null | undefined) ?? null;
        const authoritativeVolume = typeof state?.['volume'] === 'number' ? (state['volume'] as number) : undefined;
        const isMismatch =
          targetVolume !== null &&
          typeof authoritativeVolume === 'number' &&
          authoritativeVolume !== targetVolume;
        if (isMismatch) {
          this.playerVolumeSyncResult.set({
            requestId,
            status: 'mismatch',
            authoritativeVolume,
            message: `Volume not applied (${targetVolume} requested, ${authoritativeVolume} reported).`,
          });
          return;
        }
        this.playerVolumeSyncResult.set({
          requestId,
          status: 'confirmed',
          authoritativeVolume,
        });
      },
      error: () => {
        // Keep pending optimistic state; WS can still confirm. Timeout fallback in player controls resolves.
      },
    });
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

  protected updateCustomCommandArg(commandId: string, arg: CmdrCustomCommandUiArg, rawValue: unknown): void {
    const nextValue = this.normalizeArgValue(arg, rawValue);
    this.customCommandDraftValues.update((current) => {
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

    const commandValues = this.hydrateCommandValues(command, this.customCommandDraftValues()[command.id] ?? {});
    const wireCommand = this.buildCommandFromTemplate(wireTemplate, commandValues);
    this.sendCommand(fixture, wireCommand, 'default', () => {
      this.applyOptimisticStateBackedValues(command, commandValues);
      this.queuePostRunDraftSync(command);
    });
  }

  private openFixtureModal(): void {
    if (!this.fixtureModalVisible()) {
      this.fixtureAckEnabled.set(false);
      this.fixtureModalVisible.set(true);
      this.startFixtureModalPolling();
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

    if (source === 'fixture_query') {
      const nowMs = Date.now();
      for (const fixture of fixtures) {
        const rawLastSeenMs = fixture.raw['last_seen_ms'];
        const resolvedLastSeenMs = typeof rawLastSeenMs === 'number' ? rawLastSeenMs : nowMs;
        this.updateFixturePassiveTiming(
          fixture.fixture_name,
          resolvedLastSeenMs,
          this.resolveNextPassiveSeenInMs(fixture.raw['next_passive_seen_in_ms']),
        );
      }
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
    // Suppress redundant errors when the offline toast already covers the unavailable state.
    if (this.commanderUnavailable()) return;
    this.messageService.add({ key: 'app', severity: 'error', summary: message, life: 6000 });
  }

  /** Returns false if the API is known to be unreachable (offline toast covers the state). */
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
      // Preserve capabilities when a query intermittently returns none
      // (e.g. BK_CAPABILITIES not received in this sweep).
      if (mergedRaw['capabilities'] == null && existingRaw?.['capabilities'] != null) {
        mergedRaw['capabilities'] = existingRaw['capabilities'];
      }
      if (mergedRaw['capabilities_status'] == null && existingRaw?.['capabilities_status'] != null) {
        mergedRaw['capabilities_status'] = existingRaw['capabilities_status'];
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
    onSuccess?: (result: FixturePlanActionResponse, durationMs: number) => void,
    onError?: (err: unknown, durationMs: number) => void,
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
        onSuccess?.(result, durationMs);
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
        onError?.(err, durationMs);
      },
    });
  }

  private executeScannedFixtureCommand(scanned: ScannedFixtureCommand): void {
    const fixture = scanned.fixtureName;
    const mode: SendCommandMode = scanned.requiresAck ? 'force_ack' : 'force_no_ack';

    this.sendCommand(fixture, scanned.wireCommand, mode, (result, durationMs) => {
      const response = result as Record<string, unknown>;
      const commandResult =
        response['command_result'] && typeof response['command_result'] === 'object'
          ? (response['command_result'] as Record<string, unknown>)
          : null;
      const accepted = commandResult?.['accepted'] !== false;
      if (!accepted) {
        this.messageService.add({
          key: 'app',
          severity: 'warn',
          summary: `Scanned command not accepted for ${fixture}`,
          detail: scanned.wireCommand,
          life: 5000,
        });
        return;
      }

      const acceptedLabel = scanned.requiresAck ? 'Fixture ACK confirmed' : 'Dispatch accepted';
      const roundTripMs = this.extractCommandRoundTripMs(response, durationMs);
      this.messageService.add({
        key: 'app',
        severity: 'success',
        summary: `${acceptedLabel} for ${fixture}`,
        detail: `Round-trip: ${Math.round(roundTripMs)} ms`,
        life: 4500,
      });
    });
  }

  private extractCommandRoundTripMs(response: Record<string, unknown>, fallbackMs: number): number {
    const commandResult =
      response['command_result'] && typeof response['command_result'] === 'object'
        ? (response['command_result'] as Record<string, unknown>)
        : null;

    const timingCandidates: unknown[] = [
      response['round_trip_ms'],
      response['roundtrip_ms'],
      commandResult?.['round_trip_ms'],
      commandResult?.['roundtrip_ms'],
    ];

    const commandTiming = commandResult?.['timing'];
    if (commandTiming && typeof commandTiming === 'object') {
      const timing = commandTiming as Record<string, unknown>;
      timingCandidates.push(
        timing['round_trip_ms'],
        timing['roundtrip_ms'],
        timing['duration_ms'],
        timing['elapsed_ms'],
      );
    }

    for (const candidate of timingCandidates) {
      const parsed = this.readNumber(candidate);
      if (parsed !== null) return parsed;
    }

    return fallbackMs;
  }

  private readNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return null;
  }

  private parseLiveUpdateTimingSample(
    timing: Record<string, unknown> | null | undefined,
  ): LiveUpdateTimingSample | null {
    if (!timing || typeof timing !== 'object') return null;
    const phase = typeof timing['phase'] === 'string' ? String(timing['phase']) : null;
    const queryElapsedMs = this.readNumber(timing['query_elapsed_ms']);
    const sincePrevEmitMs = this.readNumber(timing['since_prev_emit_ms']);
    const targetIntervalMs = this.readNumber(timing['target_interval_ms']);
    const headroomMs =
      queryElapsedMs !== null && targetIntervalMs !== null
        ? targetIntervalMs - queryElapsedMs
        : null;
    const overBudget =
      this.parseBoolean(timing['over_budget']) ??
      (headroomMs !== null ? headroomMs < 0 : null);
    const spike = this.parseBoolean(timing['spike']);
    if (
      phase === null &&
      queryElapsedMs === null &&
      sincePrevEmitMs === null &&
      targetIntervalMs === null &&
      headroomMs === null &&
      overBudget === null &&
      spike === null
    ) {
      return null;
    }
    return {
      phase,
      queryElapsedMs,
      sincePrevEmitMs,
      targetIntervalMs,
      headroomMs,
      overBudget,
      spike,
    };
  }

  private markFixtureManualRefreshNow(fixtureName: string): void {
    const key = fixtureName.trim();
    if (!key) return;
    const nowMs = Date.now();
    this.fixtureManualRefreshAtByName.update((current) => {
      const next = new Map(current);
      next.set(key, nowMs);
      return next;
    });
  }

  private averageLiveUpdateTimingSamples(samples: LiveUpdateTimingSample[]): LiveUpdateTimingSample | null {
    if (samples.length === 0) return null;
    const averageOf = (values: Array<number | null>): number | null => {
      const filtered = values.filter((value): value is number => value !== null);
      if (filtered.length === 0) return null;
      const sum = filtered.reduce((acc, value) => acc + value, 0);
      return sum / filtered.length;
    };
    const latest = samples[samples.length - 1] ?? null;
    if (!latest) return null;
    return {
      phase: latest.phase,
      queryElapsedMs: averageOf(samples.map((sample) => sample.queryElapsedMs)),
      sincePrevEmitMs: averageOf(samples.map((sample) => sample.sincePrevEmitMs)),
      targetIntervalMs: averageOf(samples.map((sample) => sample.targetIntervalMs)),
      headroomMs: averageOf(samples.map((sample) => sample.headroomMs)),
      overBudget: latest.overBudget,
      spike: latest.spike,
    };
  }

  private recordLiveTimingSample(
    fixtureName: string,
    timing: Record<string, unknown> | null | undefined,
  ): void {
    const key = fixtureName.trim();
    if (!key) return;
    const sample = this.parseLiveUpdateTimingSample(timing);
    if (!sample) return;
    const maxSamples = 10;
    this.liveTimingSamplesByFixture.update((current) => {
      const next = new Map(current);
      const samples = [...(next.get(key) ?? []), sample];
      next.set(key, samples.slice(-maxSamples));
      return next;
    });
    this.applyAutoStabilizationIfNeeded(key, sample);
  }

  private parseBoolean(value: unknown): boolean | null {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (normalized === 'true') return true;
      if (normalized === 'false') return false;
    }
    return null;
  }

  private clearAutoStabilizedStatus(fixtureName: string): void {
    this.liveAutoStabilizedByFixture.update((current) => {
      if (!current.has(fixtureName)) return current;
      const next = new Map(current);
      next.delete(fixtureName);
      return next;
    });
  }

  private applyAutoStabilizationIfNeeded(fixtureName: string, sample: LiveUpdateTimingSample): void {
    if (!this.fixtureModalVisible() || !this.fixtureModalPollingEnabled()) return;
    const selectedName = (this.selectedFixture()?.fixture_name ?? this.fixtureName()).trim();
    if (!selectedName || selectedName !== fixtureName) return;
    const overloaded = sample.overBudget === true || sample.spike === true;
    const maxWindow = CommanderComponent.AUTO_STABILIZE_WINDOW_SAMPLES;
    let overloadWindow: boolean[] = [];
    this.liveOverBudgetWindowByFixture.update((current) => {
      const next = new Map(current);
      const window = [...(next.get(fixtureName) ?? []), overloaded].slice(-maxWindow);
      next.set(fixtureName, window);
      overloadWindow = window;
      return next;
    });
    const overloadedCount = overloadWindow.filter(Boolean).length;
    if (overloadedCount < CommanderComponent.AUTO_STABILIZE_TRIGGER_COUNT) return;
    const currentInterval = this.fixtureModalPollIntervalMs();
    const nextInterval = this.nextAutoStabilizedInterval(currentInterval);
    if (nextInterval === null || nextInterval === currentInterval) return;
    this.fixtureModalPollIntervalMs.set(nextInterval);
    this.liveAutoStabilizedByFixture.update((current) => {
      const next = new Map(current);
      next.set(fixtureName, {
        fromIntervalMs: currentInterval,
        toIntervalMs: nextInterval,
        atMs: Date.now(),
      });
      return next;
    });
    this.liveOverBudgetWindowByFixture.update((current) => {
      const next = new Map(current);
      next.set(fixtureName, []);
      return next;
    });
  }

  private nextAutoStabilizedInterval(currentIntervalMs: number): number | null {
    const steps = CommanderComponent.AUTO_STABILIZE_STEPS_MS;
    if (!steps.includes(currentIntervalMs)) return null;
    const currentIndex = steps.indexOf(currentIntervalMs);
    if (currentIndex < 0 || currentIndex >= steps.length - 1) return null;
    return steps[currentIndex + 1] ?? null;
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

  private loadFixtureModalPollIntervalMs(): number {
    const raw = localStorage.getItem('cmdr.fixtureModalPollIntervalMs');
    const parsed = Number(raw);
    return this.normalizeFixtureModalPollIntervalMs(parsed);
  }

  private normalizeFixtureModalPollIntervalMs(value: unknown): number {
    const validValues = new Set(
      CommanderComponent.FIXTURE_MODAL_POLL_INTERVAL_OPTIONS.map((option) => option.value),
    );
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) && validValues.has(parsed) ? parsed : 500;
  }

  private formatPollIntervalLabel(intervalMs: number): string {
    if (intervalMs % 1000 === 0) {
      const seconds = intervalMs / 1000;
      return `${seconds}s`;
    }
    return `${intervalMs}ms`;
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
        commandValues[arg.name] = this.defaultDraftValueForArg(command, arg);
      }
      initial[command.id] = commandValues;
    }
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

  private syncSharedDimmerDefaults(
    initial: Record<string, Record<string, CustomCommandValue>>,
    commands: CmdrCustomCommandUiItem[],
  ): void {
    const runCommand = this.selectSharedDimmerRunCommand(commands);

    let shared: CustomCommandValue | null = null;
    if (runCommand) {
      const runValue = initial[runCommand.id]?.['dimmer'];
      if (runValue !== undefined) {
        shared = runValue;
      }
    }

    if (shared === null) {
      for (const command of commands) {
        const hasDimmer = (command.args ?? []).some(
          (arg) => arg.name.trim().toLowerCase() === 'dimmer',
        );
        if (!hasDimmer) continue;
        const value = initial[command.id]?.['dimmer'];
        if (value !== undefined) {
          shared = value;
          break;
        }
      }
    }

    if (shared === null) return;

    for (const command of commands) {
      const hasDimmer = (command.args ?? []).some(
        (arg) => arg.name.trim().toLowerCase() === 'dimmer',
      );
      if (!hasDimmer) continue;
      if (!initial[command.id]) initial[command.id] = {};
      initial[command.id]['dimmer'] = shared;
    }
  }

  private selectSharedDimmerRunCommand(commands: CmdrCustomCommandUiItem[]): CmdrCustomCommandUiItem | null {
    const sharedArgName = (name: string): 'r' | 'g' | 'b' | 'dimmer' | null => {
      const normalized = name.trim().toLowerCase();
      if (normalized === 'r' || normalized === 'g' || normalized === 'b' || normalized === 'dimmer') {
        return normalized;
      }
      return null;
    };

    const candidates = commands.filter((command) => {
      const args = command.args ?? [];
      if (!args.length) return false;
      const names = args.map((arg) => sharedArgName(arg.name));
      const hasDimmer = names.includes('dimmer');
      const sharedOnly = names.every((name) => name !== null);
      return hasDimmer && sharedOnly;
    });
    if (!candidates.length) return null;

    const score = (command: CmdrCustomCommandUiItem): number => {
      const args = command.args ?? [];
      const dimmerArg = args.find((arg) => arg.name.trim().toLowerCase() === 'dimmer');
      const statePath = String((dimmerArg as { state_path?: unknown } | undefined)?.state_path ?? '')
        .trim()
        .toLowerCase();
      let value = 0;
      if (statePath === 'dimmer') value += 100;
      else if (statePath.includes('dimmer')) value += 80;
      else if (statePath.includes('master')) value -= 10;
      if (args.length === 1) value += 20;
      return value - args.length;
    };

    return [...candidates].sort((a, b) => score(b) - score(a))[0];
  }

  private syncStateBackedCustomCommandLiveValues(commands: CmdrCustomCommandUiItem[]): void {
    const optimisticByCommand = this.customCommandStateBackedOptimisticValues();
    let optimisticChanged = false;
    const nextOptimisticByCommand: Record<string, Record<string, CustomCommandValue>> = { ...optimisticByCommand };
    const changedLiveValues: Record<string, Record<string, LiveValueChange>> = {};

    this.customCommandLiveValues.update((current) => {
      let changed = false;
      const next: Record<string, Record<string, CustomCommandValue>> = { ...current };

      for (const command of commands) {
        let commandValues = next[command.id] ?? {};
        let commandChanged = false;

        for (const arg of command.args ?? []) {
          if (!this.hasStatePath(arg)) continue;
          const optimisticValue = this.getOptimisticStateBackedValue(command.id, arg.name);
          const desired = optimisticValue ?? this.defaultValueForArg(arg);
          if (commandValues[arg.name] === desired) continue;
          if (!commandChanged) {
            commandValues = { ...commandValues };
            commandChanged = true;
          }
          changedLiveValues[command.id] ??= {};
          changedLiveValues[command.id][arg.name] = {
            previous: commandValues[arg.name],
            next: desired,
          };
          commandValues[arg.name] = desired;

          const metadataDesired = this.defaultValueForArg(arg);
          if (optimisticValue !== undefined && metadataDesired === desired) {
            this.clearOptimisticStateBackedValue(command.id, arg.name, nextOptimisticByCommand);
            optimisticChanged = true;
          }
        }

        if (commandChanged) {
          next[command.id] = commandValues;
          changed = true;
        }
      }

      return changed ? next : current;
    });

    if (optimisticChanged) {
      this.customCommandStateBackedOptimisticValues.set(nextOptimisticByCommand);
    }
    this.applyMetadataLiveDraftSync(commands, changedLiveValues);
    this.applyPendingPostRunDraftSync(commands);
  }

  private commandLiveDraftSyncConfig(command: CmdrCustomCommandUiItem): { mode: 'if_pristine' | 'always'; args: Set<string> } | null {
    const raw = (command as Record<string, unknown>)['live_draft_sync'];
    if (!raw || typeof raw !== 'object') return null;
    const mode = String((raw as { mode?: unknown }).mode ?? '').trim().toLowerCase();
    if (mode !== 'if_pristine' && mode !== 'always') return null;
    const argsRaw = (raw as { args?: unknown }).args;
    if (!Array.isArray(argsRaw)) return null;
    const names = new Set<string>();
    for (const argRaw of argsRaw) {
      const name = String(argRaw ?? '').trim();
      if (!name) continue;
      names.add(name);
    }
    if (!names.size) return null;
    return { mode, args: names };
  }

  private applyMetadataLiveDraftSync(
    commands: CmdrCustomCommandUiItem[],
    changedLiveValues: Record<string, Record<string, LiveValueChange>>,
  ): void {
    if (!Object.keys(changedLiveValues).length) return;
    const draftSnapshot = this.customCommandDraftValues();
    const draftUpdates: Record<string, Record<string, CustomCommandValue>> = {};

    for (const command of commands) {
      const commandChanges = changedLiveValues[command.id];
      if (!commandChanges) continue;
      const syncConfig = this.commandLiveDraftSyncConfig(command);
      if (!syncConfig) continue;
      const currentDraft = draftSnapshot[command.id] ?? {};

      for (const arg of command.args ?? []) {
        if (!this.isInputArg(arg) || !this.hasStatePath(arg)) continue;
        if (!syncConfig.args.has(arg.name)) continue;
        const change = commandChanges[arg.name];
        if (!change) continue;
        if (syncConfig.mode === 'if_pristine') {
          // Sync only when the user has not diverged from the previous live value.
          if (currentDraft[arg.name] !== change.previous) continue;
        }
        draftUpdates[command.id] ??= {};
        draftUpdates[command.id][arg.name] = change.next;
      }
    }

    if (!Object.keys(draftUpdates).length) return;
    this.customCommandDraftValues.update((current) => {
      let changed = false;
      const next: Record<string, Record<string, CustomCommandValue>> = { ...current };
      for (const [commandId, updates] of Object.entries(draftUpdates)) {
        const existing = next[commandId] ?? {};
        let nextCommand = existing;
        let commandChanged = false;
        for (const [argName, value] of Object.entries(updates)) {
          if (nextCommand[argName] === value) continue;
          if (!commandChanged) {
            nextCommand = { ...existing };
            commandChanged = true;
          }
          nextCommand[argName] = value;
        }
        if (commandChanged) {
          next[commandId] = nextCommand;
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }

  private cloneCustomCommandValues(
    values: Record<string, Record<string, CustomCommandValue>>,
  ): Record<string, Record<string, CustomCommandValue>> {
    const clone: Record<string, Record<string, CustomCommandValue>> = {};
    for (const [commandId, commandValues] of Object.entries(values)) {
      clone[commandId] = { ...commandValues };
    }
    return clone;
  }

  private hydrateCommandValues(
    command: CmdrCustomCommandUiItem,
    values: Record<string, CustomCommandValue>,
  ): Record<string, CustomCommandValue> {
    const hydrated: Record<string, CustomCommandValue> = { ...values };
    for (const arg of command.args ?? []) {
      if (hydrated[arg.name] === undefined || hydrated[arg.name] === null || hydrated[arg.name] === '') {
        hydrated[arg.name] = this.defaultDraftValueForArg(command, arg);
      }
    }
    return hydrated;
  }

  private commandUiMode(command: CmdrCustomCommandUiItem): 'control' | 'status' | 'action' | null {
    const mode = String((command.ui_mode ?? '')).trim().toLowerCase();
    if (mode === 'control' || mode === 'status' || mode === 'action') {
      return mode;
    }
    return null;
  }

  private commandUiControl(command: CmdrCustomCommandUiItem): string | null {
    const control = String((command.control ?? '')).trim().toLowerCase();
    return control || null;
  }

  private isInputArg(arg: CmdrCustomCommandUiArg): boolean {
    const control = String(arg.control ?? '').trim().toLowerCase();
    return control === 'slider' || control === 'number' || control === 'select' || control === 'checkbox';
  }

  private commandPostRunSyncTargets(command: CmdrCustomCommandUiItem): string[] {
    if (this.commandUiMode(command) !== 'action') return [];
    const raw = (command as Record<string, unknown>)['post_run_sync'];
    if (!raw || typeof raw !== 'object') return [];
    const mode = String((raw as { mode?: unknown }).mode ?? '').trim().toLowerCase();
    if (mode !== 'from_live_once') return [];
    const targetsRaw = (raw as { targets?: unknown }).targets;
    if (!Array.isArray(targetsRaw)) return [];
    const targets: string[] = [];
    for (const targetRaw of targetsRaw) {
      const target = String(targetRaw ?? '').trim().toLowerCase();
      if (!target || targets.includes(target)) continue;
      targets.push(target);
    }
    return targets;
  }

  private targetControlCommandsForPostRunSync(
    commands: CmdrCustomCommandUiItem[],
    targets: string[],
  ): CmdrCustomCommandUiItem[] {
    if (targets.length === 0) return [];
    return commands.filter((candidate) => {
      if (this.commandUiMode(candidate) !== 'control') return false;
      const block = this.commandUiControl(candidate);
      return !!block && targets.includes(block);
    });
  }

  private queuePostRunDraftSync(command: CmdrCustomCommandUiItem): void {
    const targets = this.commandPostRunSyncTargets(command);
    if (!targets.length) return;
    const commands = this.selectedFixtureCustomCommands();
    const targetCommands = this.targetControlCommandsForPostRunSync(commands, targets);
    if (!targetCommands.length) return;

    const liveValues = this.customCommandLiveValues();
    const draftValues = this.customCommandDraftValues();
    const baselineByCommand: Record<string, Record<string, CustomCommandValue>> = {};
    const baselineDraftByCommand: Record<string, Record<string, CustomCommandValue>> = {};
    for (const targetCommand of targetCommands) {
      let commandBaseline: Record<string, CustomCommandValue> | null = null;
      let commandDraftBaseline: Record<string, CustomCommandValue> | null = null;
      for (const arg of targetCommand.args ?? []) {
        if (!this.isInputArg(arg) || !this.hasStatePath(arg)) continue;
        const liveValue = liveValues[targetCommand.id]?.[arg.name];
        if (liveValue === undefined) continue;
        if (!commandBaseline) commandBaseline = {};
        commandBaseline[arg.name] = liveValue;
        if (!commandDraftBaseline) commandDraftBaseline = {};
        commandDraftBaseline[arg.name] = draftValues[targetCommand.id]?.[arg.name] ?? this.defaultDraftValueForArg(targetCommand, arg);
      }
      if (commandBaseline) {
        baselineByCommand[targetCommand.id] = commandBaseline;
      }
      if (commandDraftBaseline) {
        baselineDraftByCommand[targetCommand.id] = commandDraftBaseline;
      }
    }

    this.pendingCustomCommandPostRunSync.update((current) => [
      ...current,
      {
        targets,
        baselineByCommand,
        baselineDraftByCommand,
        queuedAtMs: Date.now(),
      },
    ]);
  }

  private applyPendingPostRunDraftSync(commands: CmdrCustomCommandUiItem[]): void {
    const pending = this.pendingCustomCommandPostRunSync();
    if (!pending.length) return;

    const now = Date.now();
    const timeoutMs = 700;
    const liveValues = this.customCommandLiveValues();
    const draftValues = this.customCommandDraftValues();
    const draftUpdates: Record<string, Record<string, CustomCommandValue>> = {};
    const remaining: CustomCommandPostRunSyncToken[] = [];

    for (const token of pending) {
      const targetCommands = this.targetControlCommandsForPostRunSync(commands, token.targets);
      if (!targetCommands.length) continue;

      let hasLiveState = false;
      const tokenUpdates: Record<string, Record<string, CustomCommandValue>> = {};

      for (const targetCommand of targetCommands) {
        let commandUpdates: Record<string, CustomCommandValue> | null = null;
        for (const arg of targetCommand.args ?? []) {
          if (!this.isInputArg(arg) || !this.hasStatePath(arg)) continue;
          const liveValue = liveValues[targetCommand.id]?.[arg.name];
          if (liveValue === undefined) continue;
          hasLiveState = true;
          if (!commandUpdates) commandUpdates = {};
          commandUpdates[arg.name] = liveValue;
        }
        if (commandUpdates) tokenUpdates[targetCommand.id] = commandUpdates;
      }

      const timedOut = now - token.queuedAtMs >= timeoutMs;
      if (!hasLiveState || !timedOut) {
        remaining.push(token);
        continue;
      }

      for (const [commandId, updates] of Object.entries(tokenUpdates)) {
        if (!draftUpdates[commandId]) draftUpdates[commandId] = {};
        const draftBaseline = token.baselineDraftByCommand[commandId] ?? {};
        const currentDraft = draftValues[commandId] ?? {};
        for (const [argName, liveValue] of Object.entries(updates)) {
          if (currentDraft[argName] !== draftBaseline[argName]) continue;
          draftUpdates[commandId][argName] = liveValue;
        }
      }
    }

    if (remaining.length !== pending.length) {
      this.pendingCustomCommandPostRunSync.set(remaining);
    }
    if (!Object.keys(draftUpdates).length) return;

    this.customCommandDraftValues.update((current) => {
      let changed = false;
      const next: Record<string, Record<string, CustomCommandValue>> = { ...current };
      for (const [commandId, updates] of Object.entries(draftUpdates)) {
        const commandDraft = next[commandId] ?? {};
        let commandChanged = false;
        let nextCommandDraft = commandDraft;
        for (const [argName, value] of Object.entries(updates)) {
          if (nextCommandDraft[argName] === value) continue;
          if (!commandChanged) {
            nextCommandDraft = { ...commandDraft };
            commandChanged = true;
          }
          nextCommandDraft[argName] = value;
        }
        if (commandChanged) {
          next[commandId] = nextCommandDraft;
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }

  private defaultDraftValueForArg(
    command: CmdrCustomCommandUiItem,
    arg: CmdrCustomCommandUiArg,
  ): CustomCommandValue {
    // Draft state for interactive controls must remain independent from live plan_state.
    // Therefore, control-mode commands use only metadata defaults/fallbacks here.
    if (this.commandUiMode(command) === 'control') {
      if (arg.control === 'checkbox') {
        return this.toBoolean(arg.default ?? false);
      }
      if (arg.control === 'select') {
        const options = this.readSelectOptions(arg);
        if (options.length > 0 && arg.default == null) return options[0].value;
        const fallback = options.length > 0 ? options[0].value : '';
        return this.normalizeSelectValue(arg, arg.default, fallback);
      }
      if (arg.control === 'slider' || arg.control === 'number') {
        const fallback = typeof arg.min === 'number' ? arg.min : 0;
        return this.toNumber(arg.default, fallback);
      }
      if (typeof arg.default === 'string') return arg.default;
      if (typeof arg.default === 'number' && Number.isFinite(arg.default)) return arg.default;
      if (typeof arg.default === 'boolean') return arg.default;
      return '';
    }
    return this.defaultValueForArg(arg);
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
    const liveStateValue = this.resolveStateBackedArgValue(arg);
    const control = String(arg.control ?? '').toLowerCase();
    if (control === 'sequence_timeline' || control === 'sequence-timeline') {
      if (liveStateValue && typeof liveStateValue === 'object' && !Array.isArray(liveStateValue)) {
        return liveStateValue as Record<string, unknown>;
      }
      return {};
    }
    if (control === 'dot') {
      return this.toBoolean(liveStateValue ?? arg.default ?? false);
    }
    if (control === 'display') {
      const value = liveStateValue ?? arg.default;
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      if (typeof value === 'boolean') return value;
      if (typeof value === 'string') return value;
      return '';
    }
    if (arg.control === 'checkbox') {
      return this.toBoolean(arg.default ?? false);
    }
    if (arg.control === 'select') {
      const options = this.readSelectOptions(arg);
      if (options.length > 0 && arg.default == null) {
        return options[0].value;
      }
      const fallback = options.length > 0 ? options[0].value : '';
      return this.normalizeSelectValue(arg, liveStateValue ?? arg.default, fallback);
    }
    if (arg.control === 'slider' || arg.control === 'number') {
      const fallback = typeof arg.min === 'number' ? arg.min : 0;
      return this.toNumber(liveStateValue ?? arg.default, fallback);
    }
    if (typeof liveStateValue === 'string') return liveStateValue;
    if (typeof liveStateValue === 'number' && Number.isFinite(liveStateValue)) return liveStateValue;
    if (typeof liveStateValue === 'boolean') return liveStateValue;
    if (typeof arg.default === 'string') return arg.default;
    return '';
  }

  private normalizeArgValue(arg: CmdrCustomCommandUiArg, rawValue: unknown): CustomCommandValue {
    const control = String(arg.control ?? '').toLowerCase();
    if (control === 'sequence_timeline' || control === 'sequence-timeline') {
      if (rawValue && typeof rawValue === 'object' && !Array.isArray(rawValue)) {
        return rawValue as Record<string, unknown>;
      }
      return {};
    }
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
    if (typeof rawValue === 'number' || typeof rawValue === 'string' || typeof rawValue === 'boolean') {
      const canonicalRaw = String(rawValue).trim();
      const matched = options.find((option) => String(option.value).trim() === canonicalRaw);
      if (matched) return matched.value;
    }
    return fallback;
  }

  private resolveStateBackedArgValue(arg: CmdrCustomCommandUiArg): unknown {
    const statePathRaw = (arg as { state_path?: unknown }).state_path;
    if (typeof statePathRaw !== 'string') return undefined;
    const statePath = statePathRaw.trim();
    if (!statePath) return undefined;

    const ps = this.selectedFixture()?.raw['plan_state'] as Record<string, unknown> | null | undefined;
    const state = ps?.['state'];
    if (!state || typeof state !== 'object') return undefined;

    let current: unknown = state;
    for (const segmentRaw of statePath.split('.')) {
      const segment = segmentRaw.trim();
      if (!segment) return undefined;
      if (Array.isArray(current)) {
        const index = Number(segment);
        if (!Number.isInteger(index) || index < 0 || index >= current.length) return undefined;
        current = current[index];
        continue;
      }
      if (current && typeof current === 'object') {
        current = (current as Record<string, unknown>)[segment];
        continue;
      }
      return undefined;
    }
    return current;
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

  private applyOptimisticStateBackedValues(
    command: CmdrCustomCommandUiItem,
    commandValues: Record<string, CustomCommandValue>,
  ): void {
    const updates: Record<string, CustomCommandValue> = {};
    for (const arg of command.args ?? []) {
      if (!this.hasStatePath(arg)) continue;
      const value = commandValues[arg.name];
      if (value === undefined) continue;
      updates[arg.name] = value;
    }
    if (Object.keys(updates).length === 0) return;
    this.customCommandStateBackedOptimisticValues.update((current) => ({
      ...current,
      [command.id]: {
        ...(current[command.id] ?? {}),
        ...updates,
      },
    }));
  }

  private getOptimisticStateBackedValue(
    commandId: string,
    argName: string,
  ): CustomCommandValue | undefined {
    const byCommand = this.customCommandStateBackedOptimisticValues()[commandId];
    if (!byCommand) return undefined;
    return byCommand[argName];
  }

  private clearOptimisticStateBackedValue(
    commandId: string,
    argName: string,
    target: Record<string, Record<string, CustomCommandValue>>,
  ): void {
    const byCommand = target[commandId];
    if (!byCommand || !(argName in byCommand)) return;
    const nextByCommand = { ...byCommand };
    delete nextByCommand[argName];
    if (Object.keys(nextByCommand).length === 0) {
      delete target[commandId];
      return;
    }
    target[commandId] = nextByCommand;
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

      if (err.status === 401) {
        return `${prefix}: not authenticated — enable auth in .env.cmdr or log in first`;
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

  /** Human-readable status: elapsed since last passive heartbeat + expected-next countdown. */
  protected fixtureSeenStatusLabel(fixtureName: string): string | null {
    const lastSeen = this.fixtureLastSeenLabel(fixtureName);
    if (lastSeen == null) return null;
    const expected = this.fixtureExpectedNextLabel(fixtureName);
    // return expected ? `${lastSeen} / ${expected}` : lastSeen;
    return expected ? `${lastSeen}` : lastSeen;
  }

  /** Human-readable elapsed time since the fixture last sent a passive heartbeat (e.g. "5s", "2m3s"). */
  protected fixtureLastSeenLabel(fixtureName: string): string | null {
    const lastSeenMs = this.fixtureLastSeenMs().get(fixtureName);
    if (lastSeenMs == null) return null;
    const elapsedMs = Math.max(0, this.now() - lastSeenMs);
    return this.formatElapsedMs(elapsedMs);
  }

  /** Human-readable countdown until the next expected passive heartbeat. */
  protected fixtureExpectedNextLabel(fixtureName: string): string | null {
    const expectedAtMs = this.fixtureNextSeenExpectedAtMs().get(fixtureName);
    if (expectedAtMs == null) return null;
    const remainingMs = Math.max(0, expectedAtMs - this.now());
    return this.formatElapsedMs(remainingMs);
  }

  /** True when the fixture passed its expected heartbeat time + 2 s margin. */
  protected fixtureHeartbeatOverdue(fixtureName: string): boolean {
    const expectedAtMs = this.fixtureNextSeenExpectedAtMs().get(fixtureName);
    if (expectedAtMs != null) {
      return this.now() > (expectedAtMs + 2_000);
    }
    const lastSeenMs = this.fixtureLastSeenMs().get(fixtureName);
    if (lastSeenMs == null) return false;
    return (this.now() - lastSeenMs) > 35_000;
  }

  private formatElapsedMs(elapsedMs: number): string {
    const totalS = Math.max(1, Math.floor(elapsedMs / 1000));
    if (totalS < 60) return `${totalS}s`;
    const m = Math.floor(totalS / 60);
    const s = totalS % 60;
    if (totalS < 3600) return s > 0 ? `${m}m${s}s` : `${m}m`;
    const h = Math.floor(m / 60);
    const rem = m % 60;
    return rem > 0 ? `${h}h${rem}m` : `${h}h`;
  }

  /**
   * Polls GET /fixtures/discovered and fires autoQueryPassiveFixture() for any
   * fixture name that is not yet in the local store.
   */
  private pollPassiveDiscovery(): void {
    if (this.healthError()) return;
    this.commanderApi.getFixturesDiscovered().subscribe({
      next: (response) => {
        if (!response.ok || !Array.isArray(response.fixtures)) return;
        for (const entry of response.fixtures) {
          const name = this.normalizeKnownFixtureName(entry['fixture_name']);
          if (!name) continue;
          const lastSeen = typeof entry['last_seen_ms'] === 'number' ? entry['last_seen_ms'] : null;
          if (lastSeen !== null) {
            this.updateFixturePassiveTiming(
              name,
              lastSeen,
              this.resolveNextPassiveSeenInMs(entry['next_passive_seen_in_ms']),
            );
          }
          // Patch fw_version / build_date / build_time into the store from
          // heartbeat data so the fixture list reflects the latest version
          // without requiring a full query.
          const versionPatch: Record<string, unknown> = {};
          if (typeof entry['fw_version'] === 'string' && entry['fw_version']) versionPatch['fw_version'] = entry['fw_version'];
          if (typeof entry['build_date'] === 'string' && entry['build_date']) versionPatch['build_date'] = entry['build_date'];
          if (typeof entry['build_time'] === 'string' && entry['build_time']) versionPatch['build_time'] = entry['build_time'];
          if (Object.keys(versionPatch).length > 0) this.fixtureStore.patchFixtureRaw(name, versionPatch);
          this.autoQueryPassiveFixture(name);
        }
      },
      error: () => {/* silently ignore — passive discovery is best-effort */},
    });
  }

  private updateFixtureLastSeen(fixtureName: string, lastSeenMs: number): void {
    this.fixtureLastSeenMs.update((map) => {
      const next = new Map(map);
      next.set(fixtureName, lastSeenMs);
      return next;
    });
  }

  private updateFixturePassiveTiming(
    fixtureName: string,
    lastSeenMs: number,
    nextPassiveSeenInMs: number | null,
  ): void {
    this.updateFixtureLastSeen(fixtureName, lastSeenMs);
    this.fixtureNextSeenExpectedAtMs.update((map) => {
      const next = new Map(map);
      if (nextPassiveSeenInMs === null) {
        next.delete(fixtureName);
      } else {
        next.set(fixtureName, lastSeenMs + nextPassiveSeenInMs);
      }
      return next;
    });
  }

  private resolveNextPassiveSeenInMs(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    const rounded = Math.round(value);
    // Heartbeat throttle is expected in a bounded seconds/minutes window.
    if (rounded < 1000 || rounded > 600000) return null;
    return rounded;
  }

  /**
   * Fires a full fixture version query for a passively-discovered fixture name.
   * Skips if a query is already in flight, or if the fixture is already in the
   * store with complete data (capabilities + plan_state both present).
   */
  private autoQueryPassiveFixture(fixtureName: string): void {
    const normalizedFixtureName = this.normalizeKnownFixtureName(fixtureName);
    if (!normalizedFixtureName) return;
    // Skip the connected commander itself — it appears in the passive cache via fpc bootstrap
    // but cannot respond to fsf queries while acting as the active commander.
    // Other commanders (e.g. BKLK_CMDR_2 seen from CMDR_1's API) are treated as normal fixtures.
    const selfName = this.health()?.commander?.detected_fixture_name ?? null;
    if (selfName && normalizedFixtureName.toUpperCase() === selfName.toUpperCase()) return;
    if (this._passiveQueryInFlight.has(normalizedFixtureName)) return;
    if (this._passiveQueryQueued.has(normalizedFixtureName)) return;
    const existing = this.fixtureStore.fixturesByName()[normalizedFixtureName];
    if (existing) {
      const hasCapabilities = existing.raw['capabilities'] != null;
      const hasPlanState = existing.raw['plan_state'] != null;
      if (hasCapabilities && hasPlanState) return;
    }
    this._passiveQueryQueued.add(normalizedFixtureName);
    this._passiveQueryQueue.push(normalizedFixtureName);
    this.syncPassiveQueryDebugCounts();
    this.schedulePassiveQueryDrain(0);
  }

  private schedulePassiveQueryDrain(delayMs: number): void {
    if (this._passiveQueryDrainTimer !== null) return;
    this._passiveQueryDrainTimer = setTimeout(() => {
      this._passiveQueryDrainTimer = null;
      this.drainPassiveQueryQueue();
    }, Math.max(0, delayMs));
  }

  private drainPassiveQueryQueue(): void {
    if (this._passiveQueryInFlight.size > 0) return;
    if (this._passiveQueryQueue.length === 0) return;
    if (this.healthError()) {
      this.schedulePassiveQueryDrain(CommanderComponent.PASSIVE_QUERY_RETRY_DELAY_MS);
      return;
    }

    const nowMs = Date.now();
    const elapsedMs = nowMs - this._passiveQueryLastStartedAtMs;
    if (elapsedMs < CommanderComponent.PASSIVE_QUERY_MIN_GAP_MS) {
      this.schedulePassiveQueryDrain(CommanderComponent.PASSIVE_QUERY_MIN_GAP_MS - elapsedMs);
      return;
    }

    const nextFixtureName = this._passiveQueryQueue.shift() ?? null;
    if (!nextFixtureName) return;
    this._passiveQueryQueued.delete(nextFixtureName);
    this.syncPassiveQueryDebugCounts();

    const existing = this.fixtureStore.fixturesByName()[nextFixtureName];
    if (existing) {
      const hasCapabilities = existing.raw['capabilities'] != null;
      const hasPlanState = existing.raw['plan_state'] != null;
      if (hasCapabilities && hasPlanState) {
        this.schedulePassiveQueryDrain(0);
        return;
      }
    }

    this._passiveQueryInFlight.add(nextFixtureName);
    this.syncPassiveQueryDebugCounts();
    this._passiveQueryLastStartedAtMs = Date.now();
    this.commanderApi.getFixtureVersion(nextFixtureName, { preferQueryTokenAuth: true }).subscribe({
      next: (result) => {
        this.ingestQueryResult(result, 'fixture_query', nextFixtureName);
        this._passiveQueryInFlight.delete(nextFixtureName);
        this.syncPassiveQueryDebugCounts();
        this.schedulePassiveQueryDrain(0);
      },
      error: () => {
        this._passiveQueryInFlight.delete(nextFixtureName);
        this.syncPassiveQueryDebugCounts();
        this.schedulePassiveQueryDrain(CommanderComponent.PASSIVE_QUERY_RETRY_DELAY_MS);
      },
    });
  }

  private syncPassiveQueryDebugCounts(): void {
    this.passiveQueryQueuedCount.set(this._passiveQueryQueue.length);
    this.passiveQueryInFlightCount.set(this._passiveQueryInFlight.size);
  }

  private normalizeKnownFixtureName(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const name = value.trim();
    if (!name) return null;
    if (!/^[A-Za-z0-9_-]{2,64}$/.test(name)) return null;
    if (!/[A-Za-z]/.test(name)) return null;
    const match = this.fixtureOptions().find((item) => item.value.toUpperCase() === name.toUpperCase());
    return match?.value ?? null;
  }
}
