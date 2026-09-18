import { state } from "./state.js";
import { view, canvasElement } from "./canvas.js";
import { seek } from "./transport.js";

export function initSeeking() {
  const canvas = canvasElement();
  const ruler = document.createElement("div");
  ruler.id = "playhead-ruler";
  ruler.tabIndex = 0;
  ruler.setAttribute("role", "slider");
  ruler.setAttribute("aria-label", "Playhead position");
  ruler.setAttribute("aria-valuemin", "0");
  ruler.setAttribute("aria-valuemax", "100");
  ruler.title =
    "Click or drag to seek. Arrow keys move one beat; Home returns to the start.";
  canvas.parentElement.append(ruler);
  let pointer = null;
  const move = (e) => {
    const rect = canvas.getBoundingClientRect();
    seek(
      ((e.clientX - rect.left - view.left) / view.width - state.pan.x) /
        state.zoom,
    );
  };
  ruler.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || pointer !== null) return;
    pointer = e.pointerId;
    ruler.focus();
    ruler.setPointerCapture(pointer);
    move(e);
    e.preventDefault();
  });
  ruler.addEventListener("pointermove", (e) => {
    if (e.pointerId === pointer) move(e);
  });
  ruler.addEventListener("pointerup", (e) => {
    if (e.pointerId === pointer) {
      move(e);
      pointer = null;
    }
  });
  ruler.addEventListener("lostpointercapture", () => {
    pointer = null;
  });
  ruler.addEventListener("pointercancel", () => {
    pointer = null;
  });
  ruler.addEventListener("keydown", (e) => {
    const step = (e.shiftKey ? 4 : 1) / (state.project.bars * 4);
    const positions = {
      ArrowLeft: state.position - step,
      ArrowDown: state.position - step,
      ArrowRight: state.position + step,
      ArrowUp: state.position + step,
      Home: 0,
      End: 1,
    };
    if (e.key in positions) {
      e.preventDefault();
      e.stopPropagation();
      seek(positions[e.key]);
    }
  });
  function update() {
    ruler.setAttribute(
      "aria-valuenow",
      String(Math.round(state.position * 1000) / 10),
    );
    ruler.setAttribute(
      "aria-valuetext",
      `Beat ${(state.position * state.project.bars * 4 + 1).toFixed(1)}`,
    );
    requestAnimationFrame(update);
  }
  update();
}
