import qrcode from "qrcode-generator";

const CELL_PIXELS = 6;
const QUIET_ZONE_MODULES = 4;

export function drawQrMatrix(canvas: HTMLCanvasElement, value: string): void {
  const code = qrcode(0, "Q");
  code.addData(value, "Byte");
  code.make();

  const moduleCount = code.getModuleCount();
  const size = (moduleCount + QUIET_ZONE_MODULES * 2) * CELL_PIXELS;
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("QR canvas is unavailable.");
  context.imageSmoothingEnabled = false;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, size, size);
  context.fillStyle = "#111719";
  for (let row = 0; row < moduleCount; row += 1) {
    for (let column = 0; column < moduleCount; column += 1) {
      if (!code.isDark(row, column)) continue;
      context.fillRect(
        (column + QUIET_ZONE_MODULES) * CELL_PIXELS,
        (row + QUIET_ZONE_MODULES) * CELL_PIXELS,
        CELL_PIXELS,
        CELL_PIXELS,
      );
    }
  }
  canvas.dataset.qrValue = value;
}
