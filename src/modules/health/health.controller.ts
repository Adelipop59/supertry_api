import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { PrismaService } from '../../database/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @Public()
  health() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  }

  @Get('ready')
  @Public()
  async ready() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return {
        status: 'ok',
        timestamp: new Date().toISOString(),
        checks: { database: 'connected' },
      };
    } catch {
      throw new HttpException(
        { status: 'error', checks: { database: 'disconnected' } },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
}
