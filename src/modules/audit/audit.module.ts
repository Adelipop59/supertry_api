import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { AuditController } from './audit.controller';
import { AuditScheduler } from './audit.scheduler';

@Global() // Rend le service disponible partout sans import
@Module({
  controllers: [AuditController],
  providers: [AuditService, AuditScheduler],
  exports: [AuditService], // Export pour utilisation dans d'autres modules
})
export class AuditModule {}
