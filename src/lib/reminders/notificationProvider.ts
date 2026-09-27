import {
  NotificationChannel,
  NotificationProvider,
  NotificationResult,
  ReminderNotification
} from "./reminderTypes";

/**
 * ConsoleNotificationProvider (Development & Server Default Provider)
 */
export class ConsoleNotificationProvider implements NotificationProvider {
  name = "Console Notification Provider";
  channel: NotificationChannel = "CONSOLE";

  isAvailable(): boolean {
    return true;
  }

  async send(notification: ReminderNotification): Promise<NotificationResult> {
    const timestamp = new Date().toISOString();
    console.log("--------------------------------------------------");
    console.log(`[ACADEMIC REMINDER] [${notification.priority}]`);
    console.log(notification.body);
    if (notification.submissionUrl) {
      console.log(`Submission: ${notification.submissionUrl}`);
    }
    console.log("--------------------------------------------------");

    return {
      success: true,
      channel: this.channel,
      deliveredAt: timestamp
    };
  }
}

/**
 * BrowserNotificationProvider (Optional Client-Side Browser Notifications)
 * Safely guards against SSR, missing Notification API, or denied permissions.
 */
export class BrowserNotificationProvider implements NotificationProvider {
  name = "Browser Notification Provider";
  channel: NotificationChannel = "BROWSER";

  isAvailable(): boolean {
    if (typeof window === "undefined") return false;
    return "Notification" in window;
  }

  getPermissionStatus(): "granted" | "denied" | "default" | "unsupported" {
    if (typeof window === "undefined" || !("Notification" in window)) {
      return "unsupported";
    }
    return Notification.permission;
  }

  async requestPermission(): Promise<"granted" | "denied" | "default" | "unsupported"> {
    if (typeof window === "undefined" || !("Notification" in window)) {
      return "unsupported";
    }
    try {
      const result = await Notification.requestPermission();
      return result;
    } catch (_) {
      return "unsupported";
    }
  }

  async send(notification: ReminderNotification): Promise<NotificationResult> {
    if (typeof window === "undefined" || !("Notification" in window)) {
      return {
        success: false,
        channel: this.channel,
        error: "Browser Notifications API is unsupported in this environment."
      };
    }

    if (Notification.permission !== "granted") {
      return {
        success: false,
        channel: this.channel,
        error: `Browser notification permission is '${Notification.permission}'.`
      };
    }

    try {
      const n = new Notification(notification.title, {
        body: notification.body,
        icon: "/favicon.ico",
        tag: notification.id
      });

      if (notification.submissionUrl) {
        n.onclick = () => {
          window.focus();
          window.open(notification.submissionUrl, "_blank");
        };
      }

      return {
        success: true,
        channel: this.channel,
        deliveredAt: new Date().toISOString()
      };
    } catch (err: any) {
      return {
        success: false,
        channel: this.channel,
        error: err?.message || "Failed to show browser notification."
      };
    }
  }
}

/**
 * MockNotificationProvider (Used for unit testing without side effects)
 */
export class MockNotificationProvider implements NotificationProvider {
  name = "Mock Notification Provider";
  channel: NotificationChannel = "CONSOLE";
  public sent: ReminderNotification[] = [];

  isAvailable(): boolean {
    return true;
  }

  async send(notification: ReminderNotification): Promise<NotificationResult> {
    this.sent.push(notification);
    return {
      success: true,
      channel: this.channel,
      deliveredAt: new Date().toISOString()
    };
  }

  clear() {
    this.sent = [];
  }
}

// Global active notification provider
let activeProvider: NotificationProvider = new ConsoleNotificationProvider();

export function getActiveNotificationProvider(): NotificationProvider {
  return activeProvider;
}

export function setActiveNotificationProvider(provider: NotificationProvider) {
  activeProvider = provider;
}

export async function dispatchNotification(
  notification: ReminderNotification
): Promise<NotificationResult> {
  const provider = getActiveNotificationProvider();
  return await provider.send(notification);
}
