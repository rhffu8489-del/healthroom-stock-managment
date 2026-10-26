'use client';

import { useEffect, useId, useRef, useState, type ChangeEvent } from 'react';
import { Camera, CameraOff, Check, ImagePlus, ScanLine, X } from 'lucide-react';
import { CAMERA_PREFERENCE, CAMERA_SCAN_CONFIG, cameraErrorMessage, normalizeBarcode } from '@/lib/barcode';
import { ScannerSession } from '@/lib/scanner-session';

type Props = { open: boolean; onClose: () => void; onDetected: (value: string) => void };
type Phase = 'idle' | 'starting' | 'camera' | 'photo' | 'stopping';

export default function CodeScanner({ open, onClose, onDetected }: Props) {
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
  const busy = phase === 'starting' || phase === 'photo' || phase === 'stopping';

  function getSession() {
    if (!sessionRef.current) {
      const root = readerRef.current;
      sessionRef.current = new ScannerSession(async () => {
        const [{ Html5Qrcode, Html5QrcodeSupportedFormats: F }, { startQrCameraScan }] = await Promise.all([
          import('html5-qrcode'), import('@/lib/qr-camera'),
        ]);
        if (!root?.isConnected) throw new Error('Scanner closed');
        const reader = new Html5Qrcode(readerId, {
          verbose: false,
          useBarCodeDetectorIfSupported: false,
          formatsToSupport: [F.QR_CODE, F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.CODE_128, F.CODE_39, F.CODE_93, F.ITF, F.CODABAR, F.DATA_MATRIX, F.PDF_417],
        });
        let stopQrScan: (() => void) | undefined;
        function stopQr() { stopQrScan?.(); stopQrScan = undefined; }
        return {
          get isScanning() { return reader.isScanning; },
          start: async (decoded) => {
            stopQr();
            await reader.start(CAMERA_PREFERENCE, CAMERA_SCAN_CONFIG, decoded, () => {});
            const video = root.querySelector('video');
            if (video && reader.isScanning) stopQrScan = startQrCameraScan(video, decoded);
          },
          stop: async () => { stopQr(); await reader.stop(); },
          scanFile: (file) => reader.scanFile(file, false),
          clear: () => { stopQr(); reader.clear(); },
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
      setMessage('아직 코드를 찾지 못했어요. 코드 전체와 흰 여백이 보이게 하고, 거리를 조금씩 바꿔 주세요. 반사가 있으면 사진 찍기나 사진 선택도 이용할 수 있어요.');
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
      setValue(normalizeBarcode(raw));
      setMessage('코드를 읽었어요. 아래 값을 확인하고 이 코드 사용을 눌러 주세요.');
    } catch (cause) {
      setError((cause as Error).message);
      setMessage('QR은 인식했지만 물품 코드로 등록할 수 없는 내용이에요. 100자 이하의 한 줄 식별 코드를 사용해 주세요.');
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
    setPhase('photo');
    setMessage('사진에서 코드를 읽고 있어요.');
    try {
      const raw = await getSession().read(file);
      if (!current(generation) || raw === null) return;
      try { setValue(normalizeBarcode(raw)); }
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
    if (busyRef.current || liveRef.current) return;
    let code: string;
    try { code = normalizeBarcode(value); } catch (cause) { setError((cause as Error).message); return; }
    const generation = ++generationRef.current;
    busyRef.current = true;
    setPhase('stopping');
    await sessionRef.current?.stop();
    if (!current(generation)) return;
    busyRef.current = false;
    setPhase('idle');
    onDetected(code);
  }

  return <dialog ref={dialogRef} className="code-scanner-dialog" aria-labelledby={`scan-title-${id}`} onCancel={event => { event.preventDefault(); close(); }} onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <div className="dialog-inner">
      <div className="dialog-header"><div><p className="eyebrow">보건실 살림</p><h2 id={`scan-title-${id}`}>바코드 · QR 스캔</h2></div><button type="button" className="icon-button" aria-label="스캔 닫기" onClick={close}><X size={21} /></button></div>
      <p className="scanner-description">코드를 읽은 다음 물품 정보를 확인하고 등록하세요.</p>
      <div className="scanner-view"><div id={readerId} ref={readerRef} />{phase !== 'camera' && phase !== 'starting' && <div className="scanner-placeholder"><ScanLine size={45} /><span>바코드와 QR 코드를 읽을 수 있어요</span></div>}</div>
      <p className="scanner-status" role="status" aria-live="polite">{message}</p>
      {error && <p className="auth-message error" role="alert">{error}</p>}
      <div className="scanner-actions">
        {phase === 'camera' ? <button type="button" className="button secondary" onClick={() => void stopCamera()}><CameraOff size={17} />카메라 끄기</button> : <button type="button" className="button primary" disabled={busy} onClick={() => void startCamera()}><Camera size={17} />{phase === 'starting' ? '카메라 여는 중…' : '카메라 시작'}</button>}
        <label className={`button secondary scanner-file ${busy ? 'disabled' : ''}`}><Camera size={17} />사진 찍기<input type="file" accept="image/*" capture="environment" disabled={busy} onChange={event => void readPhoto(event)} aria-label="사진 찍어서 코드 읽기" /></label>
        <label className={`button secondary scanner-file ${busy ? 'disabled' : ''}`}><ImagePlus size={17} />사진 선택<input type="file" accept="image/*" disabled={busy} onChange={event => void readPhoto(event)} aria-label="사진 선택해서 코드 읽기" /></label>
      </div>
      <label className="scanner-code">코드 확인 / 직접 입력<input type="text" value={value} maxLength={100} autoComplete="off" autoCapitalize="none" spellCheck={false} disabled={busy || phase === 'camera'} placeholder="읽은 코드가 여기에 표시됩니다" onChange={event => { setValue(event.target.value); setError(''); }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void useCode(); } }} /></label>
      <p className="scanner-note">사진은 서버에 업로드하지 않고 이 기기에서 읽어요. 코드의 앞자리 0도 그대로 저장합니다.</p>
      <div className="dialog-actions"><button type="button" className="button secondary" onClick={close}>취소</button><button type="button" className="button primary" disabled={busy || phase === 'camera' || !value.trim()} onClick={() => void useCode()}><Check size={16} />이 코드 사용</button></div>
    </div>
  </dialog>;
}
