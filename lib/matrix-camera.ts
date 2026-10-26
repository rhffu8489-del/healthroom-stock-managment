import * as bundledDecoder from 'html5-qrcode/third_party/zxing-js.umd.js';

// Use the decoder already shipped with html5-qrcode. Its bundled declarations
// omit these public QR/luminance classes, so keep that adapter surface here.
interface LuminanceSource { invert(): LuminanceSource }
interface PixelMatrix {
  getWidth(): number;
  getHeight(): number;
  get(x: number, y: number): boolean;
  set(x: number, y: number): void;
  clone(): PixelMatrix;
}
interface BinaryImage { getBlackMatrix(): PixelMatrix }
interface MatrixReader { decode(bitmap: BinaryImage): { getText(): string } }
interface MatrixDecoderLibrary {
  HTMLCanvasElementLuminanceSource: new (canvas: HTMLCanvasElement) => LuminanceSource;
  HybridBinarizer: new (source: LuminanceSource) => unknown;
  BinaryBitmap: new (binarizer: unknown) => BinaryImage;
  QRCodeReader: new () => MatrixReader;
  DataMatrixReader: new () => MatrixReader;
}
const ZXing = bundledDecoder as unknown as MatrixDecoderLibrary;

export function matrixFrameSize(width: number, height: number, maxEdge = 1600, maxPixels = 1_250_000) {
  if (width <= 0 || height <= 0) return null;
  const scale = Math.min(1, maxEdge / Math.max(width, height), Math.sqrt(maxPixels / (width * height)));
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
}

// Dot-printed labels leave gaps even along Data Matrix's L-shaped finder edge.
// Join tiny gaps on a copy, after trying the untouched pixels. Two sliding
// windows keep this linear in the number of pixels, including blank frames.
function joinPrintedDots(image: BinaryImage, radius: number): BinaryImage {
  const source = image.getBlackMatrix();
  const width = source.getWidth(), height = source.getHeight();
  const horizontal = new Uint8Array(width * height);
  const joined = source.clone();
  for (let y = 0; y < height; y++) {
    let count = 0;
    for (let x = 0; x <= radius && x < width; x++) count += Number(source.get(x, y));
    for (let x = 0; x < width; x++) {
      horizontal[y * width + x] = Number(count > 0);
      if (x - radius >= 0) count -= Number(source.get(x - radius, y));
      if (x + radius + 1 < width) count += Number(source.get(x + radius + 1, y));
    }
  }
  for (let x = 0; x < width; x++) {
    let count = 0;
    for (let y = 0; y <= radius && y < height; y++) count += horizontal[y * width + x];
    for (let y = 0; y < height; y++) {
      if (count > 0) joined.set(x, y);
      if (y - radius >= 0) count -= horizontal[(y - radius) * width + x];
      if (y + radius + 1 < height) count += horizontal[(y + radius + 1) * width + x];
    }
  }
  return { getBlackMatrix: () => joined };
}

export function decodeMatrixCanvas(canvas: HTMLCanvasElement, dotRadius = 0): string | null {
  const source = new ZXing.HTMLCanvasElementLuminanceSource(canvas);
  const readers = [new ZXing.DataMatrixReader(), new ZXing.QRCodeReader()];
  // Some labels have white modules on a dark background. Mirroring a frame
  // does not fix inverted colours, so try both luminance polarities.
  for (const luminance of [source, source.invert()]) {
    const bitmap = new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(luminance));
    for (const reader of readers) {
      try { return reader.decode(bitmap).getText(); }
      catch { /* No supported matrix in this frame/polarity. */ }
    }
    if (dotRadius > 0) {
      try { return readers[0].decode(joinPrintedDots(bitmap, Math.min(2, dotRadius))).getText(); }
      catch { /* Dot repair is an additional attempt, never a replacement. */ }
    }
  }
  return null;
}

/** Decode above preview resolution without changing the visible video size. */
export function startMatrixCameraScan(video: HTMLVideoElement, onDecoded: (value: string) => void, canvas = document.createElement('canvas')) {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  let stopped = !context;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let frame = 0;
  function stop() {
    stopped = true;
    clearTimeout(timer);
    canvas.width = canvas.height = 0;
  }
  function scan() {
    if (stopped) return;
    if (!video.isConnected) { stop(); return; }
    let code: string | null = null;
    const size = matrixFrameSize(video.videoWidth, video.videoHeight);
    if (context && size && video.readyState >= 2 && !video.paused) {
      try {
        if (canvas.width !== size.width || canvas.height !== size.height) {
          canvas.width = size.width;
          canvas.height = size.height;
        }
        context.drawImage(video, 0, 0, size.width, size.height);
        code = decodeMatrixCanvas(canvas, frame++ % 3);
      } catch { /* A frame may become unavailable while closing/switching. */ }
    }
    if (code !== null) {
      stop();
      onDecoded(code);
    } else if (!stopped) {
      // Bound work on mobile; alternate untouched and dot-repair passes.
      timer = setTimeout(scan, 450);
    }
  }
  if (!stopped) timer = setTimeout(scan, 450);
  return stop;
}

/** Preserve label detail for uploaded photos; all pixels stay on the device. */
export async function readMatrixPhoto(file: File): Promise<string | null> {
  const url = URL.createObjectURL(file);
  const image = new Image();
  const canvas = document.createElement('canvas');
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('사진을 열 수 없어요. JPG·PNG 사진을 선택해 주세요.'));
      image.src = url;
    });
    const size = matrixFrameSize(image.naturalWidth, image.naturalHeight, 2048, 3_000_000);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!size || !context) return null;
    canvas.width = size.width;
    canvas.height = size.height;
    context.drawImage(image, 0, 0, size.width, size.height);
    for (const radius of [0, 1, 2]) {
      const code = decodeMatrixCanvas(canvas, radius);
      if (code !== null) return code;
    }
    return null;
  } finally {
    URL.revokeObjectURL(url);
    image.onload = image.onerror = null;
    canvas.width = canvas.height = 0;
  }
}
