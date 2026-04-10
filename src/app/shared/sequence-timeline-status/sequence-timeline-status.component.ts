import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BadgeModule } from 'primeng/badge';

interface SequenceRuntimeState {
  i?: number;
  p?: number | boolean;
  as?: number;
}

interface SequenceTimelineStep {
  index: number;
  title: string;
  start_ms: number;
  duration_ms: number;
}

interface SequenceTimelineDefinition {
  sq?: string;
  ts?: number;
  td?: number;
  steps?: SequenceTimelineStep[];
}

interface SequenceTimelineEntry {
  key: string;
  definition: SequenceTimelineDefinition;
  runtime: SequenceRuntimeState;
}

@Component({
  selector: 'app-sequence-timeline-status',
  standalone: true,
  imports: [CommonModule, BadgeModule],
  templateUrl: './sequence-timeline-status.component.html',
  styleUrl: './sequence-timeline-status.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SequenceTimelineStatusComponent {
  private readonly destroyRef = inject(DestroyRef);
  readonly runtime = input<Record<string, SequenceRuntimeState> | null | undefined>({});
  readonly definitions = input<Record<string, SequenceTimelineDefinition> | null | undefined>({});
  private readonly nowMs = signal(Date.now());
  private readonly elapsedAnchors = signal<
    Record<string, { stepIndex: number; stepAnchorMs: number; wallAnchorMs: number; stepStartTag: number }>
  >({});

  protected readonly entries = computed<SequenceTimelineEntry[]>(() => {
    const definitions = this.definitions() ?? {};
    const runtime = this.runtime() ?? {};
    const keys = Object.keys(definitions);
    return keys.map((key) => ({
      key,
      definition: definitions[key] ?? {},
      runtime: runtime[key] ?? {},
    }));
  });

  constructor() {
    const timer = window.setInterval(() => this.nowMs.set(Date.now()), 50);
    this.destroyRef.onDestroy(() => window.clearInterval(timer));

    effect(() => {
      const next = { ...this.elapsedAnchors() };
      let changed = false;
      for (const entry of this.entries()) {
        if (!this.sequencePlaying(entry)) {
          if (next[entry.key]) {
            delete next[entry.key];
            changed = true;
          }
          continue;
        }
        const step = this.sequenceCurrentStep(entry);
        if (!step) continue;
        const stepStartTag = Number(entry.runtime.as ?? -1);
        const existing = next[entry.key];
        if (!existing || existing.stepIndex !== step.index || existing.stepStartTag !== stepStartTag) {
          next[entry.key] = {
            stepIndex: step.index,
            stepAnchorMs: Math.max(0, Math.trunc(step.start_ms)),
            wallAnchorMs: Date.now(),
            stepStartTag: stepStartTag,
          };
          changed = true;
        }
      }
      if (changed) this.elapsedAnchors.set(next);
    });
  }

  protected sequenceTitle(entry: SequenceTimelineEntry): string {
    return String(entry.definition.sq || entry.key);
  }

  protected sequenceTotalSteps(entry: SequenceTimelineEntry): number {
    if (typeof entry.definition.ts === 'number' && Number.isFinite(entry.definition.ts)) {
      return Math.max(0, Math.trunc(entry.definition.ts));
    }
    return Array.isArray(entry.definition.steps) ? entry.definition.steps.length : 0;
  }

  protected sequenceTotalDuration(entry: SequenceTimelineEntry): number {
    if (typeof entry.definition.td === 'number' && Number.isFinite(entry.definition.td)) {
      return Math.max(0, Math.trunc(entry.definition.td));
    }
    return 0;
  }

  protected sequencePlaying(entry: SequenceTimelineEntry): boolean {
    const raw = entry.runtime.p;
    return raw === 1 || raw === true;
  }

  protected sequenceActiveIndex(entry: SequenceTimelineEntry): number {
    const raw = Number(entry.runtime.i);
    return Number.isFinite(raw) ? Math.trunc(raw) : -1;
  }

  protected isStepActive(entry: SequenceTimelineEntry, step: SequenceTimelineStep): boolean {
    return this.sequencePlaying(entry) && this.sequenceActiveIndex(entry) === step.index;
  }

  protected sequenceCurrentStep(entry: SequenceTimelineEntry): SequenceTimelineStep | null {
    const steps = entry.definition.steps ?? [];
    if (!Array.isArray(steps) || !steps.length) return null;
    const activeIndex = this.sequenceActiveIndex(entry);
    return steps.find((step) => step.index === activeIndex) ?? null;
  }

  protected sequenceCurrentStepLabel(entry: SequenceTimelineEntry): string {
    const step = this.sequenceCurrentStep(entry);
    if (!step) return '-';
    return `${step.index} · ${step.title}`;
  }

  protected sequenceCurrentStepIndex(entry: SequenceTimelineEntry): number {
    const step = this.sequenceCurrentStep(entry);
    return step ? step.index : -1;
  }

  protected sequenceCurrentStepTitle(entry: SequenceTimelineEntry): string {
    const step = this.sequenceCurrentStep(entry);
    return step ? step.title : '-';
  }

  protected sequenceCurrentMarkerStartMs(entry: SequenceTimelineEntry): number {
    const step = this.sequenceCurrentStep(entry);
    if (!step) return -1;
    const raw = Number(step.start_ms);
    if (!Number.isFinite(raw) || raw < 0) return -1;
    return Math.trunc(raw);
  }

  protected sequenceTotalDurationLabel(entry: SequenceTimelineEntry): string {
    const total = this.sequenceTotalDuration(entry);
    return total > 0 ? this.formatMs(total) : '-';
  }

  protected sequenceCueLabel(entry: SequenceTimelineEntry): string {
    const cue = this.sequenceCurrentMarkerStartMs(entry);
    return cue >= 0 ? this.formatMs(cue) : '-';
  }

  protected sequenceStateBadgeSeverity(entry: SequenceTimelineEntry): 'success' | 'secondary' {
    return this.sequencePlaying(entry) ? 'success' : 'secondary';
  }

  protected sequenceElapsedMs(entry: SequenceTimelineEntry): number {
    if (!this.sequencePlaying(entry)) return 0;
    const anchor = this.elapsedAnchors()[entry.key];
    if (!anchor) return Math.max(0, this.sequenceCurrentMarkerStartMs(entry));
    const delta = this.nowMs() - anchor.wallAnchorMs;
    return Math.max(0, anchor.stepAnchorMs + delta);
  }

  protected sequenceElapsedLabel(entry: SequenceTimelineEntry): string {
    if (!this.sequencePlaying(entry)) return '-';
    return this.formatElapsedHhMmSsMs(this.sequenceElapsedMs(entry));
  }

  protected formatMs(rawValue: number): string {
    const safeValue = Number.isFinite(rawValue) ? Math.max(0, Math.trunc(rawValue)) : 0;
    const seconds = Math.floor(safeValue / 1000);
    const milliseconds = safeValue % 1000;
    const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
    const ss = String(seconds % 60).padStart(2, '0');
    const mmm = String(milliseconds).padStart(3, '0');
    return `${mm}:${ss}.${mmm}`;
  }

  protected formatElapsedHhMmSsMs(rawValue: number): string {
    const safeValue = Number.isFinite(rawValue) ? Math.max(0, Math.trunc(rawValue)) : 0;
    const totalSeconds = Math.floor(safeValue / 1000);
    const milliseconds = safeValue % 1000;
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const mm = String(minutes).padStart(2, '0');
    const ss = String(seconds).padStart(2, '0');
    const mmm = String(milliseconds).padStart(3, '0');
    if (hours > 0) {
      const hh = String(hours).padStart(2, '0');
      return `${hh}:${mm}:${ss}.${mmm}`;
    }
    return `${mm}:${ss}.${mmm}`;
  }

}
