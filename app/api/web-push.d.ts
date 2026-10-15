// The few parts of web-push 3.6.7 that /api/notify uses. The package ships
// no types of its own.
declare module "web-push" {
  export type PushSubscription = { endpoint: string; keys: { p256dh: string; auth: string } };
  export type SendOptions = {
    TTL?: number;
    urgency?: "very-low" | "low" | "normal" | "high";
    vapidDetails: { subject: string; publicKey: string; privateKey: string };
  };
  export class WebPushError extends Error {
    statusCode: number;
  }
  const webpush: {
    sendNotification(subscription: PushSubscription, payload: string, options: SendOptions): Promise<{ statusCode: number }>;
    WebPushError: typeof WebPushError;
  };
  export default webpush;
}
