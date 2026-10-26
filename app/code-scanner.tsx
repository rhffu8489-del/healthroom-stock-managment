'use client';

import { useEffect, useId, useRef, useState, type ChangeEvent } from 'react';
import { Camera, CameraOff, Check, ImagePlus, ScanLine, X } from 'lucide-react';
import { CAMERA_PREFERENCE, CAMERA_SCAN_CONFIG, cameraErrorMessage, normalizeScannedValue, readScannedCode, findBarcodeMatches, getProductGtin, type ScannedCode } from '@/lib/barcode';
import { ScannerSession } from '@/lib/scanner-session';
import type { ProductLookup } from '@/lib/product-lookup';

type Props = { open: boolean; knownItems: readonly { barcode: string; name: string }[]; onClose: () => void; onDetected: (value: ScannedCode) => void };
type Phase = 'idle' | 'starting' | 'camera' | 'photo' | 'stopping';

export default function CodeScanner({ open, knownItems, onClose, onDetected }: Props) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const readerId = `code-reader-${id}`;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const readerRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<ScannerSession | null>(null);
  const openRef = useRef(false);
  const liveRef = useRef(false);
  const busyRef = useRef(false);
  const generationRef = useRef(0);
  const [phase, setPhase] = useState<Phase>('idle');
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('카메라를 켜거나 코드가 보이는 사진을 선택해 주세요.');
  const [lookup, setLookup] = useState<({ gtin: string } & (ProductLookup | { status: 'loading' })) | null>(null);
  const [lookupAttempt, setLookupAttempt] = useState(0);
  const [nameChoice, setNameChoice] = useState({ code: '', name: '' });
  const busy = phase === 'starting' || phase === 'photo' || phase === 'stopping';
  let details: ReturnType<typeof readScannedCode> | null = null;
  try { if (value) details = readScannedCode(value); } catch { /* Validate on confirmation. */ }
  const localNames = details ? [...new Set(findBarcodeMatches(knownItems, value).map(item => item.name).filter(Boolean))] : [];
  const localNamesKey = localNames.join('\x1f');
  const gtin = details ? getProductGtin(value) : null;
  const activeLookup = lookup?.gtin === gtin ? lookup : null;
  const product = activeLookup?.status === 'found' ? activeLookup.product : null;
  const selectedLocalName = localNames.length === 1 ? localNames[0] : nameChoice.code === value && localNames.includes(nameChoice.name) ? nameChoice.name : '';
  const suggestedName = localNames.length ? selectedLocalName : product?.name || '';
  const lookupLoading = !!(open && phase === 'idle' && gtin && !localNames.length && (!activeLookup || activeLookup.status === 'loading'));

  useEffect(() => {
    if (!open || phase !== 'idle' || !gtin || localNamesKey) { setLookup(null); return; }
    const controller = new AbortController();
    let cancelled = false;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    setLookup({ gtin, status: 'loading' });
    const timer = setTimeout(async () => {
      deadline = setTimeout(() => controller.abort(), 10000);
      try {
        const response = await fetch(`/api/products?code=${gtin}`, { signal: controller.signal, cache: 'no-store' });
        const result: ProductLookup = response.ok ? await response.json() : { status: 'unavailable' };
        if (!cancelled) setLookup({ ...result, gtin });
      } catch {
        if (!cancelled) setLookup({ gtin, status: 'unavailable' });
      } finally { clearTimeout(deadline); }
    }, 350);
    return () => { cancelled = true; clearTimeout(timer); clearTimeout(deadline); controller.abort(); };
  }, [open, phase, gtin, localNamesKey, lookupAttempt]);

  function getSession() {
    if (!sessionRef.current) {
      const root = readerRef.current;
      sessionRef.current = new ScannerSession(async () => {
        const [{ Html5Qrcode, Html5QrcodeSupportedFormats: F }, { startMatrixCameraScan, readMatrixPhoto }] = await Promise.all([
          import('html5-qrcode'), import('@/lib/matrix-camera'),
        ]);
        if (!root?.isConnected) throw new Error('Scanner closed');
        const reader = new Html5Qrcode(readerId, {
          verbose: false,
          useBarCodeDetectorIfSupported: false,
          formatsToSupport: [F.QR_CODE, F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.CODE_128, F.CODE_39, F.CODE_93, F.ITF, F.CODABAR, F.DATA_MATRIX, F.PDF_417],
        });
        let stopMatrixScan: (() => void) | undefined;
        function stopMatrix() { stopMatrixScan?.(); stopMatrixScan = undefined; }
        return {
          get isScanning() { return reader.isScanning; },
          start: async (decoded) => {
            stopMatrix();
            await reader.start(CAMERA_PREFERENCE, CAMERA_SCAN_CONFIG, decoded, () => {});
            const video = root.querySelector('video');
            if (video && reader.isScanning) stopMatrixScan = startMatrixCameraScan(video, decoded);
          },
          stop: async () => { stopMatrix(); await reader.stop(); },
          scanFile: async (file) => {
            try { return await reader.scanFile(file, false); }
            catch (error) {
              const value = await readMatrixPhoto(file);
              if (value !== null) return value;
              throw error;
            }
          },
          clear: () => { stopMatrix(); reader.clear(); },
        };
      }, () => {
        root?.querySelectorAll('video').forEach(video => {
          const stream = video.srcObject as MediaStream | null;
          stream?.getTracks().forEach(track => track.stop());
        });
      });
    }
    return sessionRef.current;
  }

  useEffect(() => {
    openRef.current = open;
    ++generationRef.current;
    liveRef.current = false;
    busyRef.current = false;
    setPhase('idle');
    if (open) {
      setValue('');
      setError('');
      setMessage('카메라를 켜거나 코드가 보이는 사진을 선택해 주세요.');
      if (!dialogRef.current?.open) dialogRef.current?.showModal();
    } else {
      dialogRef.current?.close();
      void sessionRef.current?.stop();
    }
  }, [open]);

  useEffect(() => {
    if (!open || phase !== 'camera') return;
    const timer = setTimeout(() => {
      setMessage('아직 코드를 찾지 못했어요. 코드 전체와 주변 여백이 보이게 하고, 거리를 조금씩 바꿔 주세요. 작은 점으로 인쇄된 코드는 더 가까이 비추거나 사진 선택을 이용해 주세요.');
    }, 8000);
    return () => clearTimeout(timer);
  }, [open, phase]);

  useEffect(() => {
    function pauseCamera() {
      if (!liveRef.current) return;
      ++generationRef.current;
      liveRef.current = false;
      busyRef.current = false;
      void sessionRef.current?.stop();
      if (openRef.current) {
        setPhase('idle');
        setMessage('카메라를 껐어요. 다시 시작하려면 카메라 시작을 눌러 주세요.');
      }
    }
    function hidden() { if (document.hidden) pauseCamera(); }
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('pagehide', pauseCamera);
    return () => {
      openRef.current = false;
      ++generationRef.current;
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('pagehide', pauseCamera);
      void sessionRef.current?.destroy();
      sessionRef.current = null;
    };
  }, []);

  function current(generation: number) { return openRef.current && generation === generationRef.current; }

  function close() {
    openRef.current = false;
    ++generationRef.current;
    liveRef.current = false;
    void sessionRef.current?.stop();
    onClose();
  }

  async function capture(raw: string, cameraGeneration: number) {
    if (!current(cameraGeneration) || !liveRef.current) return;
    liveRef.current = false;
    const generation = ++generationRef.current;
    busyRef.current = true;
    setPhase('stopping');
    await getSession().stop();
    if (!current(generation)) return;
    try {
      setValue(normalizeScannedValue(raw));
      setMessage('코드를 읽었어요. 아래 값을 확인하고 이 코드 사용을 눌러 주세요.');
    } catch (cause) {
      setError((cause as Error).message);
      setMessage('코드는 인식했지만 물품 코드로 등록할 수 없는 내용이에요. 지원하는 GS1 제품 코드 또는 100자 이하의 한 줄 식별 코드를 사용해 주세요.');
    }
    busyRef.current = false;
    setPhase('idle');
  }

  async function startCamera() {
    if (busyRef.current || liveRef.current) return;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError('이 브라우저에서 카메라를 열 수 없어요. 사진 찍기나 사진 선택을 이용해 주세요.');
      return;
    }
    const generation = ++generationRef.current;
    busyRef.current = true;
    liveRef.current = true;
    setValue('');
    setError('');
    setPhase('starting');
    setMessage('카메라 사용 요청이 나오면 허용해 주세요.');
    try {
      const started = await getSession().start(raw => { void capture(raw, generation); });
      if (!current(generation)) return;
      setPhase(started ? 'camera' : 'idle');
      setMessage('화면 전체에서 코드를 찾고 있어요. 코드와 주변 여백이 선명하게 보이도록 비춰 주세요.');
    } catch (cause) {
      if (!current(generation)) return;
      liveRef.current = false;
      setPhase('idle');
      setError(cameraErrorMessage(cause));
    } finally { if (current(generation)) busyRef.current = false; }
  }

  async function stopCamera() {
    const generation = ++generationRef.current;
    liveRef.current = false;
    busyRef.current = true;
    setPhase('stopping');
    await getSession().stop();
    if (!current(generation)) return;
    busyRef.current = false;
    setPhase('idle');
    setMessage('카메라를 껐어요. 사진을 선택하거나 코드를 직접 입력할 수 있어요.');
  }

  async function readPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || busyRef.current) return;
    setError('');
    if (file.size > 15 * 1024 * 1024) { setError('15MB 이하의 사진을 선택해 주세요.'); return; }
    if (file.type && !file.type.startsWith('image/')) { setError('이미지 파일을 선택해 주세요.'); return; }
    const generation = ++generationRef.current;
    liveRef.current = false;
    busyRef.current = true;
    setValue('');
    setPhase('photo');
    setMessage('사진에서 코드를 읽고 있어요.');
    try {
      const raw = await getSession().read(file);
      if (!current(generation) || raw === null) return;
      try { setValue(normalizeScannedValue(raw)); }
      catch (cause) { setError((cause as Error).message); setMessage('물품 코드값을 확인하거나 다른 코드를 읽어 주세요.'); return; }
      setMessage('사진에서 코드를 읽었어요. 값을 확인하고 이 코드 사용을 눌러 주세요.');
    } catch {
      if (current(generation)) {
        setError('사진에서 코드를 찾지 못했어요. 코드 하나가 크게 보이도록 다시 찍거나 JPG·PNG 사진을 선택해 주세요.');
        setMessage('다른 사진을 선택하거나 코드값을 직접 입력해 주세요.');
      }
    } finally {
      if (current(generation)) { busyRef.current = false; setPhase('idle'); }
    }
  }

  async function useCode() {
    if (busyRef.current || liveRef.current || lookupLoading) return;
    let code: string;
    try { code = normalizeScannedValue(value); } catch (cause) { setError((cause as Error).message); return; }
    const generation = ++generationRef.current;
    busyRef.current = true;
    setPhase('stopping');
    await sessionRef.current?.stop();
    if (!current(generation)) return;
    busyRef.current = false;
    setPhase('idle');
    onDetected({ ...readScannedCode(code), ...(suggestedName ? { name: suggestedName } : {}) });
  }

  return <dialog ref={dialogRef} className="code-scanner-dialog" aria-labelledby={`scan-title-${id}`} onCancel={event => { event.preventDefault(); close(); }} onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <div className="dialog-inner">
      <div className="dialog-header"><div><p className="eyebrow">보건실 살림</p><h2 id={`scan-title-${id}`}>바코드 · 2D 코드 스캔</h2></div><button type="button" className="icon-button" aria-label="스캔 닫기" onClick={close}><X size={21} /></button></div>
      <p className="scanner-description">코드를 읽은 다음 물품 정보를 확인하고 등록하세요.</p>
      <div className="scanner-view"><div id={readerId} ref={readerRef} />{phase !== 'camera' && phase !== 'starting' && <div className="scanner-placeholder"><ScanLine size={45} /><span>바코드 · QR · 데이터 매트릭스</span></div>}</div>
      <p className="scanner-status" role="status" aria-live="polite">{message}</p>
      {error && <p className="auth-message error" role="alert">{error}</p>}
      <div className="scanner-actions">
        {phase === 'camera' ? <button type="button" className="button secondary" onClick={() => void stopCamera()}><CameraOff size={17} />카메라 끄기</button> : <button type="button" className="button primary" disabled={busy} onClick={() => void startCamera()}><Camera size={17} />{phase === 'starting' ? '카메라 여는 중…' : '카메라 시작'}</button>}
        <label className={`button secondary scanner-file ${busy ? 'disabled' : ''}`}><Camera size={17} />사진 찍기<input type="file" accept="image/*" capture="environment" disabled={busy} onChange={event => void readPhoto(event)} aria-label="사진 찍어서 코드 읽기" /></label>
        <label className={`button secondary scanner-file ${busy ? 'disabled' : ''}`}><ImagePlus size={17} />사진 선택<input type="file" accept="image/*" disabled={busy} onChange={event => void readPhoto(event)} aria-label="사진 선택해서 코드 읽기" /></label>
      </div>
      <label className="scanner-code">코드 확인 / 직접 입력<input type="text" value={value} maxLength={100} autoComplete="off" autoCapitalize="none" spellCheck={false} disabled={busy || phase === 'camera'} placeholder="읽은 코드가 여기에 표시됩니다" onChange={event => { setValue(event.target.value); setError(''); }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void useCode(); } }} /></label>
      {details && phase === 'idle' && <div className="scanner-metadata" aria-live="polite"><strong>물품 정보 확인</strong><dl>
        <dt>제품 코드</dt><dd>{details.barcode}</dd>
        <dt>물품명</dt><dd>{localNames.length > 1 ? <select aria-label="등록된 물품명 선택" value={selectedLocalName} onChange={event => setNameChoice({ code: value, name: event.target.value })}><option value="">물품명을 선택해 주세요</option>{localNames.map(name => <option key={name}>{name}</option>)}</select> : suggestedName || (lookupLoading ? '제품 정보 조회 중…' : activeLookup?.status === 'unavailable' ? '제품 DB 연결 실패 · 이름을 직접 입력할 수 있어요.' : gtin ? '제품 DB에서 찾지 못했어요. 이름을 직접 입력해 주세요.' : '자동 조회할 수 없는 코드예요. 이름을 직접 입력해 주세요.')}</dd>
        <dt>유효기간</dt><dd>{details.expiry || '코드에서 유효기간을 읽지 못했어요.'}</dd>
        {details.lot && <><dt>제조번호 (LOT)</dt><dd>{details.lot}</dd></>}{details.productionDate && <><dt>제조일</dt><dd>{details.productionDate}</dd></>}{details.serial && <><dt>일련번호</dt><dd>{details.serial}</dd></>}
        {!localNames.length && product?.manufacturer && <><dt>제조사</dt><dd>{product.manufacturer}</dd></>}
      </dl>
      {localNames.length ? <p>내 계정에 등록된 물품명이에요. 이번 포장의 유효기간은 별도로 확인해 주세요.</p> : <><p>조회 범위: 미국 등록 의료기기(AccessGUDID). 국내 의약품·일반 소모품은 조회되지 않을 수 있어요.</p>{product && <p>{product.description}<br/><a href={product.sourceUrl} target="_blank" rel="noopener noreferrer">공식 제품 정보 확인</a></p>}</>}
      {!details.expiry && <p>제품번호만으로 이번 물품의 유효기간을 알 수는 없어요. 같은 포장의 GS1 2D 코드를 스캔하거나, 등록 화면에서 포장에 인쇄된 날짜를 입력해 주세요.</p>}
      <p>포장 표기와 비교한 뒤 이 코드 사용을 누르면 비어 있는 물품명·유효기간·메모에 반영돼요. 처음 등록하는 제품은 이름을 저장하면 다음 스캔부터 내 재고에서 찾을 수 있어요.</p>
      {activeLookup?.status === 'unavailable' && !localNames.length && <button type="button" className="text-button" onClick={() => setLookupAttempt(attempt => attempt + 1)}>제품 정보 다시 조회</button>}
      </div>}
      <p className="scanner-note">사진은 서버에 업로드하지 않고 이 기기에서 읽어요. 외부 제품 DB에는 제품번호만 조회하며, 코드의 앞자리 0도 유지합니다.</p>
      <div className="dialog-actions"><button type="button" className="button secondary" onClick={close}>취소</button><button type="button" className="button primary" disabled={busy || phase === 'camera' || lookupLoading || !value.trim()} onClick={() => void useCode()}><Check size={16} />{lookupLoading ? '제품 정보 조회 중…' : '이 코드 사용'}</button></div>
    </div>
  </dialog>;
}
