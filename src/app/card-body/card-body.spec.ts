import { TestBed } from "@angular/core/testing";

import { CardBody } from "./card-body";
import { DeckService } from "../services/deck.service";

/** Stands in for the vault: one known image, everything else missing. */
class FakeDeck {
  readonly asked: string[] = [];

  attachment(target: string): Promise<string> {
    this.asked.push(target);
    return Promise.resolve(
      target === "Pasted image 20260104.png" ? "data:image/png;base64,AAAA" : "",
    );
  }
}

async function render(text: string) {
  const deck = new FakeDeck();
  await TestBed.configureTestingModule({
    imports: [CardBody],
    providers: [{ provide: DeckService, useValue: deck }],
  }).compileComponents();

  const fixture = TestBed.createComponent(CardBody);
  fixture.componentRef.setInput("text", text);
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, deck, html: fixture.nativeElement as HTMLElement };
}

describe("CardBody", () => {
  it("renders a pasted image as an img, with the prose either side", async () => {
    const { html, deck } = await render(
      "Stages run left to right.\n![[Pasted image 20260104.png]]\nThat is the whole flow.",
    );

    const image = html.querySelector("img");
    expect(image?.getAttribute("src")).toBe("data:image/png;base64,AAAA");
    // Resolved by what the note wrote, not by a path the note never gave.
    expect(deck.asked).toEqual(["Pasted image 20260104.png"]);
    expect(html.textContent).toContain("Stages run left to right.");
    expect(html.textContent).toContain("That is the whole flow.");
  });

  it("names an image it cannot find rather than showing a gap", async () => {
    const { html } = await render("![[missing.png]]");

    // Usually a file that moved in the vault; knowing which makes it fixable.
    expect(html.querySelector("img")).toBeNull();
    expect(html.textContent).toContain("missing.png");
  });

  it("asks for nothing when a card has no images", async () => {
    const { html, deck } = await render("Just an answer.");

    expect(deck.asked).toEqual([]);
    expect(html.querySelector("img")).toBeNull();
    expect(html.textContent).toContain("Just an answer.");
  });
});

describe("CardBody with links that are not files", () => {
  it("puts a note link back as text when the vault has no such file", async () => {
    const { html } = await render("See [[MVC]] for the rest.");

    // `[[MVC]]` points at another note, not a picture. Whether a link is an image
    // is the vault's answer, so the miss is expected rather than reported.
    expect(html.querySelector("img")).toBeNull();
    expect(html.textContent).toContain("[[MVC]]");
    expect(html.textContent).not.toContain("not found");
  });

  it("reports a miss the note actually asked for", async () => {
    const { html } = await render("![[gone.png]]");

    // The `!` said "embed this", so a missing file is worth naming.
    expect(html.textContent).toContain("Image not found");
    expect(html.textContent).toContain("gone.png");
  });

  it("shows an image whose name has the wrong extension", async () => {
    const deckHasIt = "Pasted image 20260104.png";

    // The vault decides by what it holds, not by what the name ends in.
    const { html } = await render(`[[${deckHasIt}]]`);

    expect(html.querySelector("img")).not.toBeNull();
  });
});

describe("CardBody with code", () => {
  it("renders a fenced block as code, without the fences", async () => {
    const { html } = await render("Run this:\n```sh\ngrep -r 'x' .\n```\nThen check.");

    const code = html.querySelector("pre.code code");
    expect(code?.textContent).toBe("grep -r 'x' .");
    // The fences are markup, not content.
    expect(html.textContent).not.toContain("```");
    // Prose either side stays prose.
    expect(html.querySelectorAll("p.prose")).toHaveLength(2);
  });

  it("keeps indentation inside the block", async () => {
    const { html } = await render("```java\nclass A {\n    void go() {}\n}\n```");

    expect(html.querySelector("pre.code code")?.textContent).toBe("class A {\n    void go() {}\n}");
  });

  it("does not load an image that is only an example inside code", async () => {
    const { deck, html } = await render("```md\n![[diagram.png]]\n```");

    expect(deck.asked).toEqual([]);
    expect(html.querySelector("img")).toBeNull();
  });
});

describe("CardBody with inline code", () => {
  it("renders a backticked span as inline code inside the sentence", async () => {
    const { html } = await render("The `--staged` flag unstages a file.");

    expect(html.querySelector("code.inline")?.textContent).toBe("--staged");
    // Prose is pre-wrap, so template indentation would show up as real spaces
    // in the middle of the sentence. The text must read exactly as written.
    expect(html.querySelector("p.prose")?.textContent).toBe("The --staged flag unstages a file.");
    expect(html.textContent).not.toContain("`");
  });

  it("keeps a lone backtick as the punctuation it is", async () => {
    const { html } = await render("A ` on its own is not code.");

    expect(html.querySelector("code.inline")).toBeNull();
    expect(html.querySelector("p.prose")?.textContent).toBe("A ` on its own is not code.");
  });

  it("handles several spans in one sentence", async () => {
    const { html } = await render("Use `grep` or `rg` to search.");

    expect([...html.querySelectorAll("code.inline")].map((c) => c.textContent)).toEqual([
      "grep",
      "rg",
    ]);
    expect(html.querySelector("p.prose")?.textContent).toBe("Use grep or rg to search.");
  });

  it("does not confuse an inline span with a fenced block", async () => {
    const { html } = await render("Try `ls`:\n```sh\nls -la\n```");

    expect(html.querySelector("code.inline")?.textContent).toBe("ls");
    expect(html.querySelector("pre.code code")?.textContent).toBe("ls -la");
  });
});
