import "./styles.css";
import type { Report } from "./api/Report.ts";
import { renderBody } from "./render/page.ts";

/** Season switch and the pairing readout. */
function wire(): void {
  document.querySelectorAll("[data-pick]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.getAttribute("data-pick");
      document.querySelectorAll("[data-pick]").forEach((item) => item.classList.toggle("on", item.getAttribute("data-pick") === id));
      document.querySelectorAll<HTMLElement>("[data-panel]").forEach((panel) => { panel.hidden = panel.getAttribute("data-panel") !== id; });
    });
  });
  document.querySelectorAll("[data-tip]").forEach((button) => {
    button.addEventListener("click", () => {
      const readout = button.closest("[data-panel]")?.querySelector(".readout");
      if (readout) readout.textContent = button.getAttribute("data-tip") || "";
    });
  });
}

async function main(): Promise<void> {
  try {
    const res = await fetch("/api/report");
    if (!res.ok) throw new Error(`/api/report answered ${res.status}`);
    document.body.innerHTML = renderBody((await res.json()) as Report);
    wire();
  } catch (error) {
    console.error(error);
    document.body.textContent = "Something went wrong.";
  }
}

void main();
