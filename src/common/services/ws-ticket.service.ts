import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

/**
 * Ticket WebSocket éphémère et signé (HMAC, sans état).
 *
 * Objectif sécurité (SEC-C3) : ne plus exposer le token de session (JWT 30 j)
 * au JavaScript client pour authentifier le socket. À la place, le client
 * demande un ticket court (≈60 s) qui n'identifie que l'utilisateur pour le
 * handshake WS. Un vol de ce ticket n'a quasiment aucune valeur (expire vite,
 * ne donne aucun accès HTTP).
 *
 * Stateless volontairement : aucune dépendance Redis/DB ajoutée. La courte
 * durée de vie limite le rejeu.
 */
const TICKET_TTL_SECONDS = 60;

@Injectable()
export class WsTicketService {
  private readonly logger = new Logger(WsTicketService.name);

  constructor(private readonly configService: ConfigService) {}

  private getSecret(): string {
    return (
      this.configService.get<string>('WS_TICKET_SECRET') ||
      this.configService.get<string>('SESSION_SECRET') ||
      ''
    );
  }

  /** Émet un ticket signé `base64url(payload).signature` valable TICKET_TTL_SECONDS. */
  issue(userId: string): string {
    const secret = this.getSecret();
    const exp = Math.floor(Date.now() / 1000) + TICKET_TTL_SECONDS;
    const nonce = randomBytes(8).toString('hex');
    const payload = `${userId}.${exp}.${nonce}`;
    const sig = createHmac('sha256', secret).update(payload).digest('base64url');
    const payloadB64 = Buffer.from(payload).toString('base64url');
    return `${payloadB64}.${sig}`;
  }

  /** Retourne l'userId si le ticket est valide et non expiré, sinon null. */
  verify(ticket: string): string | null {
    try {
      const secret = this.getSecret();
      if (!secret || !ticket || !ticket.includes('.')) return null;

      const [payloadB64, sig] = ticket.split('.');
      if (!payloadB64 || !sig) return null;

      const payload = Buffer.from(payloadB64, 'base64url').toString('utf8');
      const expectedSig = createHmac('sha256', secret)
        .update(payload)
        .digest('base64url');

      const sigBuf = Buffer.from(sig);
      const expectedBuf = Buffer.from(expectedSig);
      if (sigBuf.length !== expectedBuf.length) return null;
      if (!timingSafeEqual(sigBuf, expectedBuf)) return null;

      const [userId, expStr] = payload.split('.');
      const exp = parseInt(expStr, 10);
      if (!userId || !exp || Math.floor(Date.now() / 1000) > exp) return null;

      return userId;
    } catch {
      return null;
    }
  }
}
