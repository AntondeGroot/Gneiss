import { Component } from "@angular/core";
import { RouterOutlet } from "@angular/router";

@Component({
  selector: "gn-root",
  imports: [RouterOutlet],
  templateUrl: "./app.html",
  styleUrl: "./app.scss",
})
export class App {}
