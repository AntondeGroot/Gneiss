import { Injectable } from "@angular/core";
import { LocalNotifications } from "@capacitor/local-notifications";

/** One repeating notification, replaced rather than stacked on every change. */
const DAILY_ID = 1;

/**
 * The daily review reminder.
 *
 * On-device only — Capacitor's Local Notifications, no push server and no
 * account, which is what lets the whole app stay backendless.
 */
@Injectable({ providedIn: "root" })
export class ReminderService {
  /**
   * Cancels any existing reminder, then schedules a new one if enabled.
   *
   * Cancel-then-schedule rather than reschedule: changing the time would
   * otherwise leave the old notification in place alongside the new one.
   */
  async apply(enabled: boolean, at: string): Promise<void> {
    await LocalNotifications.cancel({ notifications: [{ id: DAILY_ID }] });
    if (!enabled) return;

    await this.requirePermission();
    const { hour, minute } = parseTime(at);

    await LocalNotifications.schedule({
      notifications: [
        {
          id: DAILY_ID,
          title: "Gneiss",
          body: "Cards are due for review.",
          schedule: { on: { hour, minute }, allowWhileIdle: true },
        },
      ],
    });
  }

  private async requirePermission(): Promise<void> {
    const current = await LocalNotifications.checkPermissions();
    const granted =
      current.display === "granted" ? current : await LocalNotifications.requestPermissions();

    if (granted.display !== "granted") {
      throw new Error("notification permission was declined");
    }
  }
}

function parseTime(at: string): { hour: number; minute: number } {
  const [hour, minute] = at.split(":").map(Number);
  return { hour: hour ?? 0, minute: minute ?? 0 };
}
