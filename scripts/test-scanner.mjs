import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const ZXing = require('html5-qrcode/third_party/zxing-js.umd.js');
async function loadTS(file) {
  const source = await readFile(new URL(file, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
}
const { CAMERA_PREFERENCE, normalizeBarcode, findBarcodeMatches, cameraErrorMessage } = await loadTS('../lib/barcode.ts');
const { ScannerSession } = await loadTS('../lib/scanner-session.ts');
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
