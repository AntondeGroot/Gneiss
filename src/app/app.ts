import { Component, signal } from "@angular/core";
import { RouterOutlet } from "@angular/router";

import { parseNote, resolveTier } from "../vault";

/** Proves the vault module compiles and resolves inside the Angular bundle. */
const SAMPLE = `Redirect stdout to a file :: \`cmd > out.txt\`

#flashcards/shell
`;

@Component({
  selector: "gn-root",
  imports: [RouterOutlet],
  templateUrl: "./app.html",
  styleUrl: "./app.scss",
})
export class App {
  private readonly sample = parseNote(SAMPLE, "redirection.md");

  protected readonly cardCount = signal(this.sample.cards.length);
  protected readonly tier = signal(resolveTier(this.sample, { "#flashcards/shell": "core" }));
}
