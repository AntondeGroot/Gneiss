import { Injectable } from "@angular/core";
import { LocalNotifications } from "@capacitor/local-notifications";

import type { GneissConfig } from "../../vault";

/** Two notifications, replaced rather than stacked on every change. */
const DAILY_ID = 1;
const BACKUP_ID = 2;

/**
 * The review reminders.
 *
 * On-device only — Capacitor's Local Notifications, no push server and no
 * account, which is what lets the whole app stay backendless.
 */
@Injectable({ providedIn: "root" })
export class ReminderService {
  /**
   * Cancels both reminders, then schedules whichever are enabled.
   *
   * Cancel-then-schedule rather than reschedule: changing a time would otherwise
   * leave the old notification in place alongside the new one.
   *
   * `sessionDoneToday` is what makes the backup conditional. A notification cannot
   * ask a question when it fires — it is set ahead of time and goes off
   * regardless — so the decision is made *now*, while the answer is known, by
   * pointing it at the next evening that still needs one.
   */
  async apply(config: GneissConfig, sessionDoneToday: boolean): Promise<void> {
    await LocalNotifications.cancel({
      notifications: [{ id: DAILY_ID }, { id: BACKUP_ID }],
    });
    if (!config.reminderOn && !config.backupReminderOn) return;

    await this.requirePermission();
    const notifications = [];

    if (config.reminderOn) {
      const { hour, minute } = parseTime(config.reminderAt);
      notifications.push({
        id: DAILY_ID,
        title: "Gneiss",
        body: "Cards are due for review.",
        schedule: { on: { hour, minute }, allowWhileIdle: true },
      });
    }

    if (config.backupReminderOn) {
      notifications.push({
        id: BACKUP_ID,
        title: "Gneiss",
        body: "No review yet today — a short session still counts.",
        // A single date, not a repeat: the next one is worked out again as soon
        // as a session is finished, so a day that went well stays quiet.
        schedule: {
          at: nextBackup(config.backupReminderAt, sessionDoneToday),
          allowWhileIdle: true,
        },
      });
    }

    await LocalNotifications.schedule({ notifications });
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

/**
 * The next evening that should be nudged.
 *
 * Tomorrow once today's session has been finished, and tomorrow when tonight's
 * time has passed — arriving at 20:01 to say the evening was missed helps
 * nobody, and the day gets reconsidered anyway.
 */
export function nextBackup(at: string, sessionDoneToday: boolean, now = new Date()): Date {
  const { hour, minute } = parseTime(at);
  const when = new Date(now);
  when.setHours(hour, minute, 0, 0);

  if (sessionDoneToday || when.getTime() <= now.getTime()) {
    when.setDate(when.getDate() + 1);
  }
  return when;
}

function parseTime(at: string): { hour: number; minute: number } {
  const [hour, minute] = at.split(":").map(Number);
  return { hour: hour ?? 0, minute: minute ?? 0 };
}
