import {
  Controller,
  Get,
  INestApplication,
  MiddlewareConsumer,
  Module,
  NestModule,
  Post,
  RequestMethod,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { I18nService } from 'nestjs-i18n';
import cookieParser from 'cookie-parser';
import { createHmac } from 'crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { MaintenanceMiddleware } from './maintenance.middleware';

const CODE = 'code-de-test';

/** Fabrique un pass au format du site (supertry_saas/src/lib/maintenance.ts). */
function makePass(code = CODE, exp = Math.floor(Date.now() / 1000) + 3600) {
  const sig = createHmac('sha256', code)
    .update(`mt:${exp}`)
    .digest('base64url');
  return `${exp}.${sig}`;
}

@Controller()
class DummyController {
  @Get('campaigns') campaigns() {
    return { ok: true };
  }
  @Get('health') health() {
    return { ok: true };
  }
  @Post('stripe/webhooks') webhook() {
    return { ok: true };
  }
  @Post('auth/login') login() {
    return { ok: true };
  }
}

@Module({
  controllers: [DummyController],
  providers: [
    MaintenanceMiddleware,
    { provide: I18nService, useValue: { t: () => 'maintenance' } },
  ],
})
class TestModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Même enregistrement que AppModule
    consumer
      .apply(MaintenanceMiddleware)
      .forRoutes({ path: '*path', method: RequestMethod.ALL });
  }
}

describe('MaintenanceMiddleware', () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer() as App);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [TestModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  afterAll(() => app.close());
  afterEach(() => {
    delete process.env.MAINTENANCE_MODE;
    delete process.env.MAINTENANCE_CODE;
  });

  it('laisse tout passer hors maintenance', async () => {
    await http().get('/api/v1/campaigns').expect(200);
  });

  describe('MAINTENANCE_MODE=true', () => {
    beforeEach(() => {
      process.env.MAINTENANCE_MODE = 'true';
      process.env.MAINTENANCE_CODE = CODE;
    });

    it('bloque toute requête sans pass, même avec une session', async () => {
      const res = await http()
        .get('/api/v1/campaigns')
        .set('Cookie', 'auth_session=admin; user_role=ADMIN')
        .expect(503);
      expect((res.body as { errorCode: string }).errorCode).toBe('MAINTENANCE');
      await http().post('/api/v1/auth/login').expect(503);
    });

    it('accepte un pass valide en cookie ou en en-tête', async () => {
      await http()
        .get('/api/v1/campaigns')
        .set('Cookie', `mt_pass=${makePass()}`)
        .expect(200);
      await http()
        .post('/api/v1/auth/login')
        .set('x-maintenance-pass', makePass())
        .expect(201);
    });

    it('refuse un pass falsifié, signé avec un autre code ou expiré', async () => {
      const exp = Math.floor(Date.now() / 1000) + 3600;
      await http()
        .get('/api/v1/campaigns')
        .set('x-maintenance-pass', `${exp}.fake`)
        .expect(503);
      await http()
        .get('/api/v1/campaigns')
        .set('x-maintenance-pass', makePass('mauvais-code'))
        .expect(503);
      await http()
        .get('/api/v1/campaigns')
        .set('x-maintenance-pass', makePass(CODE, exp - 7200))
        .expect(503);
    });

    it('reste fermée si aucun code n’est configuré', async () => {
      const pass = makePass();
      delete process.env.MAINTENANCE_CODE;
      await http()
        .get('/api/v1/campaigns')
        .set('x-maintenance-pass', pass)
        .expect(503);
    });

    it('garde ouverts health et webhooks Stripe', async () => {
      await http().get('/api/v1/health').expect(200);
      await http().post('/api/v1/stripe/webhooks').expect(201);
    });
  });
});
