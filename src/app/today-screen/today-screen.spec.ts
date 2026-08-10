import { TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";

import { DEFAULT_CONFIG, addDays } from "../../vault";
import { DeckService } from "../services/deck.service";
import { today } from "../services/clock.service";
import { TodayScreen } from "./today-screen";

/** The screen with a streak of five, last reviewed on the given day. */
async function withStreak(lastReviewedOn: string) {
  await TestBed.configureTestingModule({
    imports: [TodayScreen],
    providers: [provideRouter([])],
  }).compileComponents();

  const deck = TestBed.inject(DeckService);
  await deck.saveConfig({ ...DEFAULT_CONFIG, streak: 5, lastReviewedOn });

  const fixture = TestBed.createComponent(TodayScreen);
  fixture.detectChanges();
  return (fixture.nativeElement as HTMLElement).querySelector(".streak");
}

describe("TodayScreen streak", () => {
  it("stays grey while today is still only carried over from yesterday", async () => {
    const streak = await withStreak(addDays(today(), -1));

    // The number is real — the streak is live — but today has not been added.
    expect(streak?.textContent).toContain("5 day streak");
    expect(streak?.classList.contains("earned")).toBe(false);
    expect(streak?.getAttribute("aria-label")).toContain("not counted yet");
  });

  it("turns gold once today is counted in it", async () => {
    const streak = await withStreak(today());

    expect(streak?.classList.contains("earned")).toBe(true);
    expect(streak?.getAttribute("aria-label")).toContain("today counted");
  });
});
