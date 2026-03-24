import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { MetricsService } from '../services/metrics.service';

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metricsService: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const { method } = request;
    const route = request.route?.path || request.url;
    const start = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const duration = Date.now() - start;
          const statusCode = context.switchToHttp().getResponse().statusCode;
          this.metricsService.recordRequest(method, route, statusCode, duration);
        },
        error: () => {
          const duration = Date.now() - start;
          this.metricsService.recordRequest(method, route, 500, duration);
        },
      }),
    );
  }
}
