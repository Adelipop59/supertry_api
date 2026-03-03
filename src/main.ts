import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import cookieParser from 'cookie-parser';
import { json } from 'express';

async function bootstrap() {
  // Disable default body parser so we can configure rawBody for Stripe webhooks only
  const app = await NestFactory.create(AppModule, { bodyParser: false });

  // JSON body parser with rawBody capture for Stripe webhook signature verification
  app.use(
    json({
      verify: (req: any, _res: any, buf: Buffer) => {
        // Only store rawBody for Stripe webhooks (needed for signature verification)
        if (req.url?.includes('/stripe/webhooks')) {
          req.rawBody = buf;
        }
      },
    }),
  );

  // Enable CORS
  app.enableCors({
    origin: true, // Allow all origins (mobile app, web, etc.)
    credentials: true,
  });

  // Cookie parser for session cookies
  app.use(cookieParser());

  // Global exception filter is now registered via APP_FILTER in AppModule (DI-based for i18n support)

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Global prefix
  app.setGlobalPrefix('api/v1');

  // Swagger
  const config = new DocumentBuilder()
    .setTitle('SuperTry API')
    .setDescription('API documentation for SuperTry')
    .setVersion('1.0')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/v1/docs', app, document, {
    swaggerOptions: {
      withCredentials: true,
    },
    customCss: `
      #auth-status-banner {
        position: sticky;
        top: 0;
        z-index: 9999;
        padding: 8px 16px;
        color: #fff;
        font-weight: 700;
        font-size: 14px;
        text-align: center;
        letter-spacing: 0.5px;
      }
      #auth-status-banner.connected {
        background: #49cc90;
      }
      #auth-status-banner.disconnected {
        background: #f93e3e;
      }
    `,
    customJsStr: `
      function updateAuthStatus() {
        var banner = document.getElementById('auth-status-banner');
        if (!banner) return;
        fetch('/api/v1/auth/session', { credentials: 'include' })
          .then(function(r) { return r.json(); })
          .then(function(data) {
            if (data.user) {
              var role = (data.user.role || '').toUpperCase();
              var roleLabel = role === 'ADMIN' ? 'Admin' : role === 'PRO' ? 'Pro' : 'Testeur';
              banner.textContent = 'Connecte : ' + (data.user.email || '') + ' (' + roleLabel + ')';
              banner.className = 'connected';
            } else {
              banner.textContent = 'Non connecte';
              banner.className = 'disconnected';
            }
          })
          .catch(function() {
            banner.textContent = 'Non connecte';
            banner.className = 'disconnected';
          });
      }

      // Insert banner once Swagger UI is loaded
      var waitForUI = setInterval(function() {
        var wrapper = document.querySelector('.swagger-ui');
        if (wrapper) {
          clearInterval(waitForUI);
          var banner = document.createElement('div');
          banner.id = 'auth-status-banner';
          wrapper.prepend(banner);
          updateAuthStatus();
        }
      }, 200);

      // Intercept fetch to update status after each API call
      var originalFetch = window.fetch;
      window.fetch = function(input) {
        var url = typeof input === 'string' ? input : (input && input.url ? input.url : '');
        return originalFetch.apply(this, arguments).then(function(response) {
          if (!url.includes('/auth/session')) {
            setTimeout(updateAuthStatus, 300);
          }
          return response;
        });
      };
    `,
  });

  const port = process.env.PORT || 3000;
  await app.listen(port);

  console.log(`🚀 Application démarrée sur http://localhost:${port}`);
  console.log(`📡 API disponible sur http://localhost:${port}/api/v1`);
  console.log(`📚 Swagger disponible sur http://localhost:${port}/api/v1/docs`);
}
bootstrap();
