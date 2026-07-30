import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Gneiss from "../gneiss-prototype.jsx";
import "./index.css";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <Gneiss />
  </StrictMode>
);