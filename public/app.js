document.querySelectorAll("[data-pick]").forEach((button) => {
  button.addEventListener("click", () => {
    const id = button.getAttribute("data-pick");
    document.querySelectorAll("[data-pick]").forEach((item) => item.classList.toggle("on", item.getAttribute("data-pick") === id));
    document.querySelectorAll("[data-panel]").forEach((panel) => { panel.hidden = panel.getAttribute("data-panel") !== id; });
  });
});
document.querySelectorAll("[data-tip]").forEach((button) => {
  button.addEventListener("click", () => {
    const readout = button.closest("[data-panel]")?.querySelector(".readout");
    if (readout) readout.textContent = button.getAttribute("data-tip") || "";
  });
});
