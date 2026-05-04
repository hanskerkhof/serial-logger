import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { CommanderApiService } from './commander-api.service';
import { AuthService } from './auth/auth.service';

class AuthServiceStub {
  readonly accessToken: string | null = null;
}

describe('CommanderApiService', () => {
  let service: CommanderApiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        CommanderApiService,
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useClass: AuthServiceStub },
      ],
    });
    service = TestBed.inject(CommanderApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('calls POST /fixtures/discovered/clear', () => {
    let responsePayload: unknown = null;
    service.clearFixturesDiscovered().subscribe((response) => {
      responsePayload = response;
    });

    const request = httpMock.expectOne((req) => req.method === 'POST' && req.url.endsWith('/fixtures/discovered/clear'));
    expect(request.request.body).toEqual({});
    request.flush({ ok: true, cleared_count: 3, source: 'passive_cache' });

    expect(responsePayload).toEqual({ ok: true, cleared_count: 3, source: 'passive_cache' });
  });
});
