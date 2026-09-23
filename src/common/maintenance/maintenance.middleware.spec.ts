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
import request from 'supertest';
import type { App } from 'supertest/types';
import { LuciaService } from '../../modules/lucia/lucia.service';
import { PrismaService } from '../../database/prisma.service';
import { MaintenanceMiddleware } from './maintenance.middleware';

// lucia/arctic sont ESM-only : on remplace le service par un jeton d'injection
jest.mock('../../modules/lucia/lucia.service', () => ({
  LuciaService: class LuciaService {},
}));

// Sessions de test : id de session → rôle du profil
const SESSIONS: Record<string, string> = {
  admin: 'ADMIN',
  pro: 'PRO',
  tester: 'USER',
};

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
  @Post('auth/signup') signup() {
    return { ok: true };
  }
}

@Module({
  controllers: [DummyController],
  providers: [
    MaintenanceMiddleware,
    {
      provide: LuciaService,
      useValue: {
        validateSession: (id: string) =>
          Promise.resolve(
            SESSIONS[id]
              ? { user: { id }, session: { id } }
              : { user: null, session: null },
          ),
      },
    },
    {
      provide: PrismaService,
      useValue: {
        profile: {
          findUnique: ({ where }: { where: { id: string } }) =>
            Promise.resolve({ role: SESSIONS[where.id], isActive: true }),
        },
      },
    },
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
  afterEach(() => delete process.env.MAINTENANCE_MODE);

  it('laisse tout passer hors maintenance', async () => {
    await http().get('/api/v1/campaigns').expect(200);
  });

  describe('MAINTENANCE_MODE=true', () => {
    beforeEach(() => (process.env.MAINTENANCE_MODE = 'true'));

    it('bloque un visiteur anonyme', async () => {
      const res = await http().get('/api/v1/campaigns').expect(503);
      expect((res.body as { errorCode: string }).errorCode).toBe('MAINTENANCE');
    });

    it.each(['pro', 'tester'])(
      'bloque une session %s (cookie et Bearer)',
      async (sid) => {
        await http()
          .get('/api/v1/campaigns')
          .set('Cookie', `auth_session=${sid}`)
          .expect(503);
        await http()
          .get('/api/v1/campaigns')
          .set('Authorization', `Bearer ${sid}`)
          .expect(503);
      },
    );

    it('bloque une session inconnue ou un faux cookie de rôle', async () => {
      await http()
        .get('/api/v1/campaigns')
        .set('Cookie', 'auth_session=forged; user_role=ADMIN')
        .expect(503);
    });

    it('laisse passer une session ADMIN', async () => {
      await http()
        .get('/api/v1/campaigns')
        .set('Cookie', 'auth_session=admin')
        .expect(200);
      await http()
        .get('/api/v1/campaigns')
        .set('Authorization', 'Bearer admin')
        .expect(200);
    });

    it('garde ouverts health, webhooks Stripe et login', async () => {
      await http().get('/api/v1/health').expect(200);
      await http().post('/api/v1/stripe/webhooks').expect(201);
      await http().post('/api/v1/auth/login').expect(201);
    });

    it("ferme l'inscription et les routes inconnues", async () => {
      await http().post('/api/v1/auth/signup').expect(503);
      await http().get('/api/v1/docs').expect(503);
      await http().get('/api/v1/health/../campaigns').expect(503);
    });
  });
});
