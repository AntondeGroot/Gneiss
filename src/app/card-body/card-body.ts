import { NgTemplateOutlet } from "@angular/common";
import { Component, computed, inject, input, resource } from "@angular/core";

import { splitCard } from "../../vault";
import { AttachmentService } from "../services/attachment.service";

/**
 * A card's answer, images included.
 *
 * Embeds have always survived parsing — `parseNote` passes `![[diagram.png]]`
 * through the same way it passes through fenced code — so the text arrives here
 * carrying its pictures. This is the part that goes and fetches them.
 *
 * Prose keeps its own formatting: whitespace is preserved so code blocks and
 * indentation look the way they were written.
 */
@Component({
  selector: "gn-card-body",
  imports: [NgTemplateOutlet],
  templateUrl: "./card-body.html",
  styleUrl: "./card-body.scss",
})
export class CardBody {
  readonly text = input.required<string>();

  private readonly attachments = inject(AttachmentService);

  protected readonly segments = computed(() => splitCard(this.text()));

  /** Every image on this card, resolved together and re-fetched when it changes. */
  protected readonly images = resource({
    params: () => this.segments(),
    loader: async ({ params }) => {
      const targets = params.filter((segment) => segment.kind === "embed");
      const urls = await Promise.all(targets.map((image) => this.attachments.load(image.target)));
      return new Map(targets.map((image, index) => [image.target, urls[index] ?? ""]));
    },
  });

  protected urlFor(target: string): string {
    return this.images.value()?.get(target) ?? "";
  }

  /** Whether the lookups have finished, so an empty result means absent not pending. */
  protected resolved(): boolean {
    return this.images.hasValue();
  }
}
