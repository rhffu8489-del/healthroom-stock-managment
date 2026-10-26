import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const ZXing = require('html5-qrcode/third_party/zxing-js.umd.js');
async function loadTS(file) {
  let source = await readFile(new URL(file, import.meta.url), 'utf8');
  source = source.replaceAll('html5-qrcode/third_party/zxing-js.umd.js', pathToFileURL(require.resolve('html5-qrcode/third_party/zxing-js.umd.js')).href);
  const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
}
const { CAMERA_PREFERENCE, CAMERA_SCAN_CONFIG, normalizeBarcode, normalizeScannedValue, readScannedCode, applyScannedCode, findBarcodeMatches, cameraErrorMessage } = await loadTS('../lib/barcode.ts');
const { ScannerSession } = await loadTS('../lib/scanner-session.ts');
const { matrixFrameSize, decodeMatrixCanvas, startMatrixCameraScan, readMatrixPhoto } = await loadTS('../lib/matrix-camera.ts');
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }

class Engine {
  isScanning = false;
  starts = 0;
  stops = 0;
  clears = 0;
  photos = 0;
  onStart = async () => {};
  onPhoto = async () => '001234';
  decoded = () => {};
  async start(decoded) { this.starts++; this.decoded = decoded; await this.onStart(); this.isScanning = true; }
  async stop() { this.stops++; this.isScanning = false; }
  async scanFile(file) { assert.equal(this.isScanning, false); this.photos++; return this.onPhoto(file); }
  clear() { assert.equal(this.isScanning, false); this.clears++; }
}

test('codes preserve leading zeros and URL contents; invalid or oversized QR payloads are rejected', () => {
  assert.equal(normalizeBarcode(' 001234 '), '001234');
  assert.equal(normalizeBarcode('https://example.test/item/001234'), 'https://example.test/item/001234');
  assert.throws(() => normalizeBarcode(' '), /입력/);
  assert.throws(() => normalizeBarcode('x'.repeat(101)), /100자/);
  assert.throws(() => normalizeBarcode('item\n001234'), /식별 코드/);
});

test('exact code matching returns every expiry/unit variant, without numeric/prefix collisions', () => {
  const items = [{ barcode: '001234', expiry: '2027-01-01' }, { barcode: '001234', expiry: '2028-01-01' }, { barcode: '0012345' }, { barcode: '1234' }, { barcode: '' }];
  assert.deepEqual(findBarcodeMatches(items, '001234'), items.slice(0, 2));
  assert.deepEqual(findBarcodeMatches(items, 'not-registered'), []);
});

test('camera denial, missing camera and busy camera provide separate fallback instructions', () => {
  assert.match(cameraErrorMessage(new Error('NotAllowedError Permission denied')), /권한/);
  assert.match(cameraErrorMessage('NotFoundError'), /사진 선택/);
  assert.match(cameraErrorMessage('NotReadableError'), /다른 앱/);
});

test('the rear-camera preference is accepted by the shipped camera adapter', () => {
  const { Html5Qrcode } = require('html5-qrcode');
  const constraints = Html5Qrcode.prototype.createVideoConstraints(CAMERA_PREFERENCE);
  assert.equal(constraints.facingMode, 'environment');
  const { VideoConstraintsUtil } = require('html5-qrcode/cjs/utils.js');
  assert.equal(VideoConstraintsUtil.isMediaStreamConstraintsValid(CAMERA_SCAN_CONFIG.videoConstraints, { logError: assert.fail }), true);
  assert.equal(CAMERA_SCAN_CONFIG.videoConstraints.width.ideal, 1920);
  assert.equal(CAMERA_SCAN_CONFIG.videoConstraints.height.ideal, 1080);
  assert.equal('qrbox' in CAMERA_SCAN_CONFIG, false);
  assert.equal('aspectRatio' in CAMERA_SCAN_CONFIG, false);
});

test('opening/closing without starting never loads a decoder or requests a camera', async () => {
  let loads = 0;
  const session = new ScannerSession(async () => { loads++; return new Engine(); });
  await session.stop();
  await session.destroy();
  assert.equal(loads, 0);
});

test('closing during a permission request stops the camera when permission resolves and ignores late results', async () => {
  const engine = new Engine();
  const permission = deferred();
  engine.onStart = () => permission.promise;
  let received = 0;
  let releases = 0;
  const session = new ScannerSession(async () => engine, () => { releases++; });
  const starting = session.start(() => received++);
  await tick();
  assert.equal(engine.starts, 1);
  const closing = session.stop();
  engine.decoded('late-code');
  permission.resolve();
  assert.equal(await starting, false);
  await closing;
  assert.equal(engine.isScanning, false);
  assert.equal(engine.stops, 1);
  assert.equal(received, 0);
  assert.ok(releases > 0);
});

test('switching from live camera to a photo stops the stream before decoding and ignores camera callbacks', async () => {
  const engine = new Engine();
  const session = new ScannerSession(async () => engine);
  let received = 0;
  await session.start(() => received++);
  assert.equal(engine.isScanning, true);
  const photo = session.read(new File(['sample'], 'sample.png', { type: 'image/png' }));
  engine.decoded('late-camera-code');
  assert.equal(await photo, '001234');
  assert.equal(engine.isScanning, false);
  assert.equal(engine.stops, 1);
  assert.equal(engine.photos, 1);
  assert.equal(received, 0);
  await session.destroy();
});

test('photo scanning needs no camera permission; a closed photo task returns no result', async () => {
  const engine = new Engine();
  const decoding = deferred();
  engine.onPhoto = () => decoding.promise;
  const session = new ScannerSession(async () => engine);
  const photo = session.read(new File(['photo'], 'photo.jpg', { type: 'image/jpeg' }));
  await tick();
  const closing = session.stop();
  decoding.resolve('001234');
  assert.equal(await photo, null);
  await closing;
  assert.equal(engine.starts, 0);
  assert.equal(engine.isScanning, false);
});

test('a denied camera may be retried explicitly; old callbacks stay invalid after a restart', async () => {
  const engine = new Engine();
  engine.onStart = async () => { throw new Error('NotAllowedError'); };
  const session = new ScannerSession(async () => engine);
  await assert.rejects(session.start(() => {}), /NotAllowed/);
  engine.onStart = async () => {};
  const received = [];
  assert.equal(await session.start(value => received.push(value)), true);
  const oldCallback = engine.decoded;
  await session.stop();
  assert.equal(await session.start(value => received.push(value)), true);
  oldCallback('old');
  engine.decoded('new');
  assert.deepEqual(received, ['new']);
  await session.destroy();
  assert.equal(engine.isScanning, false);
});

test('rapid duplicate start requests leave only the latest scan active', async () => {
  const engine = new Engine();
  const session = new ScannerSession(async () => engine);
  const first = session.start(() => {});
  const second = session.start(() => {});
  assert.equal(await first, false);
  assert.equal(await second, true);
  assert.equal(engine.starts, 1);
  await session.destroy();
});

function decode(luminance, width, height) {
  const source = new ZXing.RGBLuminanceSource(luminance, width, height);
  const bitmap = new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(source));
  return new ZXing.MultiFormatReader().decode(bitmap, new Map()).getText();
}

test('the shipped QR decoder reads a QR bitmap and preserves its leading zeros', () => {
  const value = '001234567890';
  const matrix = new ZXing.QRCodeWriter().encode(value, ZXing.BarcodeFormat.QR_CODE, 240, 240, new Map());
  const width = matrix.getWidth(), height = matrix.getHeight();
  const pixels = new Uint8ClampedArray(width * height).fill(255);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (matrix.get(x, y)) pixels[y * width + x] = 0;
  assert.equal(decode(pixels, width, height), value);
});

test('the shipped barcode decoder reads an independently generated EAN-13 fixture', async () => {
  const fixture = JSON.parse(await readFile(new URL('./fixtures/ean13.json', import.meta.url), 'utf8'));
  const width = fixture.width, height = fixture.height + 20;
  const pixels = new Uint8ClampedArray(width * height).fill(255);
  for (const [left, barWidth] of fixture.bars) {
    for (let y = 10; y < height - 10; y++) for (let x = left; x < left + barWidth; x++) pixels[y * width + x] = 0;
  }
  assert.equal(decode(pixels, width, height), fixture.text);
});

function qrFrame(value, { width = 960, height = 720, left = 240, top = 100, size = 260, inverted = false, rotated = false } = {}) {
  const matrix = new ZXing.QRCodeWriter().encode(value, ZXing.BarcodeFormat.QR_CODE, size, size, new Map());
  const pixels = new Uint8ClampedArray(width * height).fill(inverted ? 0 : 255);
  for (let y = 0; y < matrix.getHeight(); y++) for (let x = 0; x < matrix.getWidth(); x++) {
    const black = rotated ? matrix.get(y, matrix.getHeight() - 1 - x) : matrix.get(x, y);
    pixels[(top + y) * width + left + x] = black !== inverted ? 0 : 255;
  }
  return { width, height, pixels };
}

function frameCanvas(frame) {
  let pixels = frame.pixels;
  const canvas = { width: frame.width, height: frame.height, draws: 0 };
  const context = {
    getImageData() {
      const data = new Uint8ClampedArray(pixels.length * 4);
      for (let i = 0; i < pixels.length; i++) {
        data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = pixels[i];
        data[i * 4 + 3] = 255;
      }
      return { data };
    },
    drawImage(_video, x, y, width, height) {
      assert.equal(x, 0); assert.equal(y, 0);
      assert.equal(width, canvas.width); assert.equal(height, canvas.height);
      canvas.draws++;
      pixels = new Uint8ClampedArray(width * height);
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        pixels[y * width + x] = frame.pixels[Math.floor(y * frame.height / height) * frame.width + Math.floor(x * frame.width / width)];
      }
    },
  };
  canvas.getContext = () => context;
  return canvas;
}

test('QR fallback reads full frames with rotated and inverted URL labels', () => {
  for (const options of [{}, { rotated: true }, { inverted: true }, { rotated: true, inverted: true }]) {
    const value = 'https://example.test/item/001234?lot=20261026';
    assert.equal(decodeMatrixCanvas(frameCanvas(qrFrame(value, options))), value);
  }
});

test('a QR outside the old centre box is readable from the full camera frame', () => {
  const value = '001234567890';
  const frame = qrFrame(value, { width: 1920, height: 1080, left: 20, top: 20, size: 180 });
  // Previous qrbox was 90% wide and 75% tall: its top edge cut off this QR.
  const width = 1728, height = 810;
  const cropped = new Uint8ClampedArray(width * height);
  for (let y = 0; y < height; y++) cropped.set(frame.pixels.subarray((y + 135) * frame.width + 96, (y + 135) * frame.width + 96 + width), y * width);
  assert.throws(() => decode(cropped, width, height));
  assert.equal(decodeMatrixCanvas(frameCanvas(frame)), value);
});

test('camera QR sizing keeps detail above mobile preview resolution with bounded memory', () => {
  for (const [width, height] of [[1920, 1080], [1080, 1920], [4096, 2160], [640, 480]]) {
    const size = matrixFrameSize(width, height);
    assert.ok(size.width <= 1600 && size.height <= 1600);
    assert.ok(size.width * size.height <= 1_250_000);
    assert.ok(Math.abs(size.width / size.height - width / height) < .01);
  }
  assert.ok(matrixFrameSize(1920, 1080).width > 1000);
  assert.deepEqual(matrixFrameSize(640, 480), { width: 640, height: 480 });
  assert.equal(matrixFrameSize(0, 0), null);
});

test('long QR content is decoded intact so registration can explain its length limit', () => {
  const value = `https://example.test/item?data=${'a'.repeat(150)}`;
  const actual = decodeMatrixCanvas(frameCanvas(qrFrame(value, { size: 440 })));
  assert.equal(actual, value);
  assert.throws(() => normalizeBarcode(actual), /100자/);
});

test('live QR fallback reads native frames once and stops scheduling after a result', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const frame = qrFrame('000123', { width: 1920, height: 1080, left: 20, top: 20, size: 180 });
  const canvas = frameCanvas(frame);
  const video = { videoWidth: frame.width, videoHeight: frame.height, readyState: 4, paused: false, isConnected: true };
  const received = [];
  const stop = startMatrixCameraScan(video, value => received.push(value), canvas);
  context.mock.timers.tick(450);
  assert.deepEqual(received, ['000123']);
  assert.equal(canvas.draws, 1);
  assert.equal(canvas.width, 0);
  context.mock.timers.tick(5000);
  assert.equal(canvas.draws, 1);
  stop();
});

test('closing or detaching a QR camera cancels pending frames and callbacks', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const frame = qrFrame('001234');
  const video = { videoWidth: frame.width, videoHeight: frame.height, readyState: 4, paused: false, isConnected: true };
  const canvas = frameCanvas(frame);
  const stop = startMatrixCameraScan(video, assert.fail, canvas);
  stop();
  context.mock.timers.tick(2000);
  assert.equal(canvas.draws, 0);
  const detachedCanvas = frameCanvas(frame);
  startMatrixCameraScan({ ...video, isConnected: false }, assert.fail, detachedCanvas);
  context.mock.timers.tick(450);
  assert.equal(detachedCanvas.draws, 0);
  assert.equal(detachedCanvas.width, 0);
});

test('a QR camera waits for playable video rather than decoding an empty frame', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const frame = qrFrame('001234');
  const canvas = frameCanvas(frame);
  const video = { videoWidth: 0, videoHeight: 0, readyState: 0, paused: true, isConnected: true };
  const received = [];
  startMatrixCameraScan(video, value => received.push(value), canvas);
  context.mock.timers.tick(450);
  assert.equal(canvas.draws, 0);
  Object.assign(video, { videoWidth: frame.width, videoHeight: frame.height, readyState: 4, paused: false });
  context.mock.timers.tick(450);
  assert.deepEqual(received, ['001234']);
});

const dataMatrixFixture = JSON.parse(await readFile(new URL('./fixtures/datamatrix.json', import.meta.url), 'utf8'));
function dataMatrixFrame({ inverted = false, dotted = false, rotated = false, moduleSize = 6 } = {}) {
  const rows = [...dataMatrixFixture.rows].reverse();
  const width = 560, height = 500, left = 130, top = 100;
  const pixels = new Uint8ClampedArray(width * height).fill(inverted ? 0 : 255);
  for (let row = 0; row < rows.length; row++) for (let column = 0; column < rows.length; column++) {
    const black = rotated ? rows[column][rows.length - row - 1] === '1' : rows[row][column] === '1';
    if (!black) continue;
    for (let dy = 0; dy < moduleSize; dy++) for (let dx = 0; dx < moduleSize; dx++) {
      if (dotted && (dx + .5 - moduleSize / 2) ** 2 + (dy + .5 - moduleSize / 2) ** 2 > (moduleSize * .42) ** 2) continue;
      pixels[(top + row * moduleSize + dy) * width + left + column * moduleSize + dx] = inverted ? 255 : 0;
    }
  }
  return { width, height, pixels };
}

test('2D fallback reads independently encoded Data Matrix in both colours and orientations', () => {
  for (const options of [{}, { inverted: true }, { rotated: true }, { inverted: true, rotated: true }]) {
    assert.equal(decodeMatrixCanvas(frameCanvas(dataMatrixFrame(options))), dataMatrixFixture.text);
  }
});

test('dot repair reads an inverted dot-printed Data Matrix that the untouched decoder misses', () => {
  const canvas = frameCanvas(dataMatrixFrame({ inverted: true, dotted: true }));
  assert.equal(decodeMatrixCanvas(canvas), null);
  assert.equal(decodeMatrixCanvas(canvas, 1), dataMatrixFixture.text);
  const rotated = frameCanvas(dataMatrixFrame({ inverted: true, dotted: true, rotated: true }));
  assert.equal(decodeMatrixCanvas(rotated, 1), dataMatrixFixture.text);
});

test('live scanning retries dot repair and stops after Data Matrix success', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const frame = dataMatrixFrame({ inverted: true, dotted: true });
  const canvas = frameCanvas(frame);
  const received = [];
  startMatrixCameraScan({ videoWidth: frame.width, videoHeight: frame.height, readyState: 4, paused: false, isConnected: true }, value => received.push(value), canvas);
  context.mock.timers.tick(450);
  assert.deepEqual(received, []);
  context.mock.timers.tick(450);
  assert.deepEqual(received, [dataMatrixFixture.text]);
  assert.equal(canvas.draws, 2);
  context.mock.timers.tick(5000);
  assert.equal(canvas.draws, 2);
});

test('GS1 decodes the printed product, expiry, production date and lot without FNC1 rejection', () => {
  const raw = dataMatrixFixture.text;
  const expected = { barcode: '00382903249039', display: '(01)00382903249039(17)300531(11)250601(10)5129147', expiry: '2030-05-31', productionDate: '2025-06-01', lot: '5129147', serial: undefined };
  assert.deepEqual(readScannedCode(raw), expected);
  assert.deepEqual(readScannedCode(`]d2${raw}`), expected);
  assert.deepEqual(readScannedCode(expected.display), expected);
  assert.equal(normalizeScannedValue(raw), expected.display);
  assert.equal(normalizeScannedValue('000123'), '000123');
  assert.equal(normalizeScannedValue('https://example.test/item'), 'https://example.test/item');
});

test('GS1 variable fields honour separators and do not guess dates inside a lot number', () => {
  const raw = '010038290324903910BATCH17X\x1d1730053121SN001';
  const decoded = readScannedCode(raw);
  assert.equal(decoded.lot, 'BATCH17X');
  assert.equal(decoded.expiry, '2030-05-31');
  assert.equal(decoded.serial, 'SN001');
  const unseparated = readScannedCode('010038290324903910BATCH17300531');
  assert.equal(unseparated.lot, 'BATCH17300531');
  assert.equal(unseparated.expiry, undefined);
});

test('GS1 validates GTIN checksum and dates instead of silently correcting bad data', () => {
  assert.equal(readScannedCode('(01)00382903249038(17)300531').display, undefined);
  assert.equal(readScannedCode('(01)00382903249039(17)300231').display, undefined);
  assert.equal(readScannedCode('(01)00382903249039(17)301331').display, undefined);
  assert.equal(readScannedCode('(01)00382903249039(17)300531(17)310531').display, undefined);
  assert.equal(readScannedCode('(01)00382903249039(17)300500').expiry, '2030-05-31');
  assert.equal(readScannedCode('(01)00382903249039(17)280200').expiry, '2028-02-29');
  assert.throws(() => readScannedCode('010038290324903910LOT\x1d99123'), /식별 코드/);
});

test('scanning fills empty metadata, preserves the draft and finds previous GS1 records', () => {
  const scanned = readScannedCode(dataMatrixFixture.text);
  const draft = { name: '기존 입력', barcode: '', expiry: '', note: '', quantity: 2 };
  assert.deepEqual(applyScannedCode(draft, scanned), { ...draft, barcode: '00382903249039', expiry: '2030-05-31', note: '제조번호(LOT): 5129147\n제조일: 2025-06-01' });
  assert.equal(draft.barcode, '');
  const edited = { ...draft, expiry: '2031-01-01', note: '사용자가 쓴 메모' };
  assert.deepEqual(applyScannedCode(edited, scanned), { ...edited, barcode: scanned.barcode });
  const items = [{ barcode: scanned.barcode }, { barcode: scanned.display }, { barcode: '00382903249038' }];
  assert.deepEqual(findBarcodeMatches(items, dataMatrixFixture.text), items.slice(0, 2));
});

test('photo fallback decodes an inverted dot label and releases its local image URL', async context => {
  const frame = dataMatrixFrame({ inverted: true, dotted: true });
  const canvas = frameCanvas(frame);
  const previousDocument = globalThis.document, previousImage = globalThis.Image;
  const revoked = [];
  context.mock.method(URL, 'createObjectURL', () => 'blob:local-test');
  context.mock.method(URL, 'revokeObjectURL', url => revoked.push(url));
  let image;
  globalThis.document = { createElement: () => canvas };
  globalThis.Image = class {
    naturalWidth = frame.width;
    naturalHeight = frame.height;
    constructor() { image = this; }
    set src(value) { assert.equal(value, 'blob:local-test'); queueMicrotask(() => this.onload?.()); }
  };
  try {
    assert.equal(await readMatrixPhoto(new File(['sample'], 'label.png', { type: 'image/png' })), dataMatrixFixture.text);
    assert.deepEqual(revoked, ['blob:local-test']);
    assert.equal(canvas.width, 0);
    assert.equal(image.onload, null);
    assert.equal(image.onerror, null);
  } finally {
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
    if (previousImage === undefined) delete globalThis.Image; else globalThis.Image = previousImage;
  }
});
