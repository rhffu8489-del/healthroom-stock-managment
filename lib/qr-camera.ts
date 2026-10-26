import * as bundledDecoder from 'html5-qrcode/third_party/zxing-js.umd.js';

// Use the decoder already shipped with html5-qrcode. Its bundled declarations
// omit these public QR/luminance classes, so keep that adapter surface here.
interface LuminanceSource { invert(): LuminanceSource }
interface QrDecoderLibrary {
  HTMLCanvasElementLuminanceSource: new (canvas: HTMLCanvasElement) => LuminanceSource;
  HybridBinarizer: new (source: LuminanceSource) => unknown;
  BinaryBitmap: new (binarizer: unknown) => unknown;
  QRCodeReader: new () => { decode(bitmap: unknown): { getText(): string } };
}
const ZXing = bundledDecoder as unknown as QrDecoderLibrary;

export function qrFrameSize(width: number, height: number) {
  if (width <= 0 || height <= 0) return null;
  const scale = Math.min(1, 1600 / Math.max(width, height), Math.sqrt(1_250_000 / (width * height)));
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
}

export function decodeQrCanvas(canvas: HTMLCanvasElement): string | null {
  const source = new ZXing.HTMLCanvasElementLuminanceSource(canvas);
  const reader = new ZXing.QRCodeReader();
  // Some labels have white modules on a dark background. Mirroring a frame
  // does not fix inverted colours, so try both luminance polarities.
  for (const luminance of [source, source.invert()]) {
    try {
      return reader.decode(new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(luminance))).getText();
    } catch { /* No QR in this frame/polarity. */ }
  }
  return null;
}

/** Decode above preview resolution without changing the visible video size. */
export function startQrCameraScan(video: HTMLVideoElement, onDecoded: (value: string) => void, canvas = document.createElement('canvas')) {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  let stopped = !context;
  let timer: ReturnType<typeof setTimeout> | undefined;
  function stop() {
    stopped = true;
    clearTimeout(timer);
    canvas.width = canvas.height = 0;
  }
  function scan() {
    if (stopped) return;
    if (!video.isConnected) { stop(); return; }
    let code: string | null = null;
    const size = qrFrameSize(video.videoWidth, video.videoHeight);
    if (context && size && video.readyState >= 2 && !video.paused) {
      try {
        if (canvas.width !== size.width || canvas.height !== size.height) {
          canvas.width = size.width;
          canvas.height = size.height;
        }
        context.drawImage(video, 0, 0, size.width, size.height);
        code = decodeQrCanvas(canvas);
      } catch { /* A frame may become unavailable while closing/switching. */ }
    }
    if (code !== null) {
      stop();
      onDecoded(code);
    } else if (!stopped) {
      // Bound work on mobile: one QR-only pass per 450 ms after decoding.
      timer = setTimeout(scan, 450);
    }
  }
  if (!stopped) timer = setTimeout(scan, 450);
  return stop;
}
