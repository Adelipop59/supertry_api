# Push Notification Provider

## Not Yet Implemented

This is a placeholder for push notification functionality.

## How to Implement

### Option 1: Firebase Cloud Messaging (Recommended)

```bash
pnpm add firebase-admin
```

```typescript
import * as admin from 'firebase-admin';

export class FirebaseProvider implements INotificationProvider {
  private app: admin.app.App;

  constructor(private configService: ConfigService) {
    this.app = admin.initializeApp({
      credential: admin.credential.cert({
        projectId: configService.get('notification.push.projectId'),
        clientEmail: configService.get('notification.push.clientEmail'),
        privateKey: configService.get('notification.push.privateKey'),
      }),
    });
  }

  async send(options: NotificationOptions): Promise<NotificationResult> {
    const message = {
      notification: {
        title: options.variables?.title,
        body: options.variables?.body,
      },
      tokens: Array.isArray(options.to) ? options.to : [options.to],
    };

    const response = await admin.messaging().sendMulticast(message);
    
    return {
      success: response.successCount > 0,
      messageId: response.responses[0]?.messageId,
      provider: 'firebase',
      type: NotificationType.PUSH,
      sentAt: new Date(),
    };
  }
}
```

### Option 2: OneSignal

```bash
pnpm add onesignal-node
```

### Configuration

Add to `.env`:
```env
# Firebase FCM
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=your-client-email
FIREBASE_PRIVATE_KEY=your-private-key

# Or OneSignal
ONESIGNAL_APP_ID=your-app-id
ONESIGNAL_API_KEY=your-api-key
```

Add to `notification.config.ts`:
```typescript
push: {
  provider: process.env.PUSH_PROVIDER || 'firebase',
  firebase: {
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY,
  },
}
```

### Register in NotificationsModule

```typescript
providers: [
  // ...
  FirebaseProvider, // Add here
],
```

### Usage

```typescript
await notificationsService.sendPush({
  to: ['device-token-1', 'device-token-2'],
  template: NotificationTemplate.NEW_MESSAGE,
  variables: {
    title: 'New Message',
    body: 'You have a new message',
  },
});
```
