/** Handwritten fixtures for this public sample. These are not model outputs. */
export function canvasFixture(draw: boolean): Record<string, string> {
  return { "main.ts": `
    const canvas = document.getElementById("canvas") as HTMLCanvasElement;
    canvas.width = 720; canvas.height = 1280;
    const ctx = canvas.getContext("2d")!;
    function frame(t: number) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ${draw ? 'ctx.fillStyle = "#2b6cb0"; ctx.fillRect(40 + t / 30, 80, 24, 24);' : ''}
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  ` };
}
