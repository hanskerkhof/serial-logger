import { Injectable } from '@angular/core';
import { Observable, Subject } from 'rxjs';

export interface ScannedFixtureCommand {
  raw: string;
  fixtureName: string;
  wireCommand: string;
  requiresAck: boolean;
}

@Injectable({ providedIn: 'root' })
export class QrScannedCommandService {
  private readonly scannedCommandSubject = new Subject<ScannedFixtureCommand>();
  readonly scannedCommand$: Observable<ScannedFixtureCommand> = this.scannedCommandSubject.asObservable();

  publish(command: ScannedFixtureCommand): void {
    this.scannedCommandSubject.next(command);
  }

  parse(rawValue: string): ScannedFixtureCommand | null {
    const trimmed = rawValue.trim();
    if (!trimmed) return null;

    const requiresAck = trimmed.startsWith('ack;tcmd;');
    const wireCommand = requiresAck ? trimmed : trimmed.startsWith('tcmd;') ? trimmed : '';
    if (!wireCommand) return null;

    const payload = requiresAck ? wireCommand.slice(4) : wireCommand;
    const segments = payload.split(';');
    if (segments.length < 4) return null;
    if (segments[0] !== 'tcmd') return null;

    const fixtureName = segments[1]?.trim() ?? '';
    const commandToken = segments[2]?.trim() ?? '';
    const actionToken = segments[3]?.trim() ?? '';
    if (!fixtureName || commandToken !== 'cmd' || !actionToken) return null;

    return {
      raw: trimmed,
      fixtureName,
      wireCommand: requiresAck ? `ack;${payload}` : payload,
      requiresAck,
    };
  }
}
