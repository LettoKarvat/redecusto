import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Barcode,
  ScanLine,
  Flashlight,
  FlashlightOff,
  Settings,
  X,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Play,
  ZoomIn,
} from "lucide-react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import {
  BarcodeFormat,
  DecodeHintType,
  NotFoundException,
} from "@zxing/library";

/* ========================= Utils ========================= */
const isNgrokUrl = (u: string) =>
  /(^https?:\/\/)?([^.]+\.)?ngrok(-free)?\.(app|dev)/i.test(u) ||
  /(^https?:\/\/)?[a-z0-9-]+\.ngrok\.io/i.test(u);

const normalizeUrl = (u: string) => {
  if (!u) return "";
  const t = u.trim();
  if (/^https?:\/\//i.test(t)) return t;
  return isNgrokUrl(t) ? `https://${t}` : `http://${t}`;
};

const fmtBRL = (n: number | null | undefined) =>
  typeof n === "number"
    ? n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
    : "-";

const fmtDate = (iso: string | null) => {
  if (!iso) return "-";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "-";
    return d.toLocaleDateString("pt-BR");
  } catch {
    return "-";
  }
};

// Não-EANs passam direto; numéricos de 8/12/13/14 dígitos validam check digit.
const isValidEan = (code: string): boolean => {
  if (!/^\d{8}$|^\d{12}$|^\d{13}$|^\d{14}$/.test(code)) return true;
  const digits = code.split("").map(Number);
  const check = digits.pop()!;
  const sum = digits
    .reverse()
    .reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0);
  const calc = (10 - (sum % 10)) % 10;
  return calc === check;
};

/* ========================= Types ========================= */
type ProdDetail = {
  CODAUXILIAR: number | string;
  CODFILIAL: number;
  CODPROD: number;
  DESCRICAO: string;
  ESTOQUE_ATUAL: number;
  BLOQUEADO: number;
  AVARIA: number;
  ESTOQUE_DISPONIVEL: number;
  CODFORNEC: number;
  FORNECEDOR: string;
  DTULTENT: string | null;
  CUSTOULTENT: number | null;
  PRECO_VAREJO?: number | null;
};

/* ========================= useCamera ========================= */
function useCamera() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mediaTrackRef = useRef<MediaStreamTrack | null>(null);
  const imageCaptureRef = useRef<any>(null);

  const [torchSupported, setTorchSupported] = useState<boolean | null>(null);
  const [torchOn, setTorchOn] = useState(false);

  const [zoomSupported, setZoomSupported] = useState(false);
  const [zoomRange, setZoomRange] = useState<{
    min: number;
    max: number;
    step: number;
  } | null>(null);
  const [zoom, setZoom] = useState<number | null>(null);

  const stopCamera = useCallback(() => {
    try {
      mediaTrackRef.current?.stop();
      if (videoRef.current) {
        videoRef.current.srcObject = null;
        videoRef.current.removeAttribute("src");
      }
    } catch {}
    mediaTrackRef.current = null;
    imageCaptureRef.current = null;
    setTorchSupported(null);
    setTorchOn(false);
    setZoomSupported(false);
    setZoomRange(null);
    setZoom(null);
  }, []);

  const ensureVideoPlay = useCallback(async () => {
    const v = videoRef.current;
    if (!v) return false;
    v.muted = true;
    v.setAttribute("muted", "");
    v.playsInline = true;
    v.setAttribute("playsinline", "true");
    v.autoplay = true;

    if (!v.paused) return true; // evita "Trying to play video that is already playing."
    for (let i = 0; i < 3; i++) {
      try {
        await v.play();
        return true;
      } catch {
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    return !v.paused;
  }, []);

  const pickBackCamera = useCallback(async () => {
    const devices = await BrowserMultiFormatReader.listVideoInputDevices();
    if (!devices.length) return undefined;
    const backs = devices.filter((d) =>
      /back|rear|trás|traseira|environment/i.test(d.label)
    );
    const pool = backs.length ? backs : devices;
    // Em alguns Androids vários "back" aparecem (wide, macro, depth). Pula esses pra pegar a principal.
    const isAux = (label: string) =>
      /wide|ultra|tele|depth|macro|infrared|\bir\b/i.test(label);
    const main = pool.find((d) => !isAux(d.label));
    return (main || pool[pool.length - 1]).deviceId;
  }, []);

  const startCamera = useCallback(
    async (deviceId?: string) => {
      stopCamera();
      const v = videoRef.current;
      if (!v) throw new Error("Video element not mounted");

      let dev = deviceId;
      if (!dev) {
        try {
          dev = await pickBackCamera();
        } catch {
          dev = undefined;
        }
      }

      const base: MediaTrackConstraints = dev
        ? { deviceId: { exact: dev } }
        : { facingMode: { ideal: "environment" } };

      const profiles: MediaStreamConstraints[] = [
        {
          audio: false,
          video: {
            ...base,
            width: { ideal: 3840 },
            height: { ideal: 2160 },
            frameRate: { ideal: 30 },
            aspectRatio: 16 / 9,
          },
        },
        {
          audio: false,
          video: {
            ...base,
            width: { ideal: 2560 },
            height: { ideal: 1440 },
            frameRate: { ideal: 30 },
            aspectRatio: 16 / 9,
          },
        },
        {
          audio: false,
          video: {
            ...base,
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            frameRate: { ideal: 30 },
            aspectRatio: 16 / 9,
          },
        },
        {
          audio: false,
          video: {
            ...base,
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30 },
          },
        },
        {
          audio: false,
          video: { ...base },
        },
      ];

      let lastErr: any = null;
      for (const p of profiles) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia(p);
          v.srcObject = stream;
          const track = stream.getVideoTracks()[0];
          mediaTrackRef.current = track;

          if (track && (window as any).ImageCapture) {
            try {
              // @ts-ignore
              imageCaptureRef.current = new (window as any).ImageCapture(track);
            } catch {
              imageCaptureRef.current = null;
            }
          }

          try {
            const caps: any = track.getCapabilities?.() || {};
            setTorchSupported(Boolean(caps.torch));

            // Foco/exposição/balanço contínuos para máxima nitidez em códigos pequenos.
            const advanced: any[] = [];
            if (
              Array.isArray(caps.focusMode) &&
              caps.focusMode.includes("continuous")
            ) {
              advanced.push({ focusMode: "continuous" });
            }
            if (
              Array.isArray(caps.exposureMode) &&
              caps.exposureMode.includes("continuous")
            ) {
              advanced.push({ exposureMode: "continuous" });
            }
            if (
              Array.isArray(caps.whiteBalanceMode) &&
              caps.whiteBalanceMode.includes("continuous")
            ) {
              advanced.push({ whiteBalanceMode: "continuous" });
            }

            if (
              typeof caps.zoom?.min === "number" &&
              typeof caps.zoom?.max === "number"
            ) {
              setZoomSupported(true);
              setZoomRange({
                min: caps.zoom.min,
                max: caps.zoom.max,
                step: caps.zoom.step ?? 0.1,
              });
              const z = caps.zoom.min + (caps.zoom.max - caps.zoom.min) * 0.3;
              setZoom(z);
              advanced.push({ zoom: z });
            } else {
              setZoomSupported(false);
              setZoomRange(null);
              setZoom(null);
            }

            if (advanced.length) {
              try {
                await track.applyConstraints({ advanced });
              } catch {}
            }
          } catch {
            setTorchSupported(false);
            setZoomSupported(false);
            setZoomRange(null);
            setZoom(null);
          }

          await new Promise((resolve) => {
            const onMeta = () => {
              v.removeEventListener("loadedmetadata", onMeta);
              resolve(null);
            };
            v.addEventListener("loadedmetadata", onMeta);
          });

          await ensureVideoPlay();
          return;
        } catch (err) {
          lastErr = err;
        }
      }
      throw lastErr || new Error("Falha ao abrir câmera");
    },
    [ensureVideoPlay, pickBackCamera, stopCamera]
  );

  const toggleTorch = useCallback(async () => {
    const track = mediaTrackRef.current;
    if (!track) return;
    try {
      // @ts-ignore
      await track.applyConstraints({ advanced: [{ torch: !torchOn }] });
      setTorchOn((v) => !v);
    } catch {
      setTorchSupported(false);
    }
  }, [torchOn]);

  const applyZoom = useCallback(async (val: number) => {
    const track = mediaTrackRef.current;
    if (!track) return;
    try {
      // @ts-ignore
      await track.applyConstraints({ advanced: [{ zoom: val }] });
      setZoom(val);
    } catch {}
  }, []);

  return {
    videoRef,
    startCamera,
    stopCamera,
    torchSupported,
    torchOn,
    toggleTorch,
    zoomSupported,
    zoomRange,
    zoom,
    applyZoom,
    imageCaptureRef,
  };
}

/* ========================= useScanner ========================= */
function useScanner({
  videoRef,
  imageCaptureRef,
  onDetected,
}: {
  videoRef: React.RefObject<HTMLVideoElement>;
  imageCaptureRef: React.RefObject<any>;
  onDetected: (code: string) => void;
}) {
  // Tunáveis
  const DETECTION_COOLDOWN_MS = 1200; // pausa após detectar
  const BD_INTERVAL_MS = 100; // ~10 fps

  const bdRef = useRef<any>(null);
  const [scanning, setScanning] = useState(false);
  const lastTextRef = useRef<string>("");
  const idleRef = useRef<number>(Date.now());

  // Locks e utilitários
  const processingRef = useRef(false);
  const snoozeUntilRef = useRef(0);

  // ZXing reader e controle do loop
  const zxingReaderRef = useRef<BrowserMultiFormatReader | null>(null);
  const zxingLoopStopRef = useRef<() => void>(() => {});

  const initBarcodeDetector = useCallback(async () => {
    const W: any = window as any;
    if (!("BarcodeDetector" in W)) return null;

    const desired = [
      "ean_13",
      "ean_8",
      "upc_a",
      "upc_e",
      "code_128",
      "code_39",
      "code_93",
      "itf",
      "codabar",
      "qr_code",
      "data_matrix",
      "pdf417",
      "aztec",
    ];
    try {
      const supported: string[] =
        (await W.BarcodeDetector.getSupportedFormats?.()) || [];
      const fmts = supported.length
        ? desired.filter((f) => supported.includes(f))
        : desired;
      if (!fmts.length) return null;
      return new W.BarcodeDetector({ formats: fmts });
    } catch {
      return null;
    }
  }, []);

  const ensureZXing = useCallback(() => {
    if (zxingReaderRef.current) return zxingReaderRef.current;
    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [
      BarcodeFormat.EAN_13,
      BarcodeFormat.EAN_8,
      BarcodeFormat.UPC_A,
      BarcodeFormat.UPC_E,
      BarcodeFormat.CODE_128,
      BarcodeFormat.ITF,
      BarcodeFormat.CODE_39,
      BarcodeFormat.CODABAR,
    ]);
    hints.set(DecodeHintType.TRY_HARDER, true);
    // @ts-ignore
    hints.set(DecodeHintType.ALSO_INVERTED, true);
    // @ts-ignore
    hints.set(DecodeHintType.ASSUME_GS1, true);
    zxingReaderRef.current = new BrowserMultiFormatReader(hints, 150);
    return zxingReaderRef.current;
  }, []);

  const captureHQ = useCallback(async () => {
    if (!scanning) return;
    const ic = imageCaptureRef.current;
    if (!ic) return;

    try {
      let blob: Blob;
      try {
        blob = await ic.takePhoto({ imageWidth: 1600, imageHeight: 1200 });
      } catch {
        blob = await ic.takePhoto();
      }
      const bitmap = await createImageBitmap(blob);

      if (bdRef.current) {
        try {
          const codes = await bdRef.current.detect(bitmap);
          if (codes?.length) {
            const code = (codes[0].rawValue || "").trim();
            if (code && code !== lastTextRef.current && isValidEan(code)) {
              lastTextRef.current = code;
              idleRef.current = Date.now();
              snoozeUntilRef.current = Date.now() + DETECTION_COOLDOWN_MS;
              onDetected(code);
            }
          }
        } catch {}
      }
      bitmap.close();
    } catch {}
  }, [imageCaptureRef, onDetected, scanning]);

  useEffect(() => {
    let bdTimer: any = null;
    let hqTimer: any = null;
    let aborted = false;

    const acceptCode = (code: string): boolean => {
      if (!code || code.length < 4) return false;
      if (code === lastTextRef.current) return false;
      return isValidEan(code);
    };

    // ZXing — sempre roda em paralelo com BD para máxima cobertura.
    const startZxingLoop = () => {
      const reader = ensureZXing();
      let stopped = false;
      let running = false;

      const zxingLoop = async () => {
        if (aborted || stopped || !videoRef.current) return;
        if (Date.now() < snoozeUntilRef.current) {
          setTimeout(zxingLoop, BD_INTERVAL_MS);
          return;
        }
        if (running) {
          setTimeout(zxingLoop, BD_INTERVAL_MS);
          return;
        }
        running = true;
        try {
          const res = await reader.decodeOnceFromVideoElement(
            videoRef.current!
          );
          const txt = res?.getText?.()?.trim?.();
          if (txt && acceptCode(txt)) {
            lastTextRef.current = txt;
            idleRef.current = Date.now();
            snoozeUntilRef.current = Date.now() + DETECTION_COOLDOWN_MS;
            onDetected(txt);
          }
        } catch (err: any) {
          if (!(err instanceof NotFoundException)) {
            // outros erros, segue o loop
          }
        } finally {
          running = false;
          setTimeout(zxingLoop, BD_INTERVAL_MS);
        }
      };

      zxingLoopStopRef.current = () => {
        stopped = true;
      };
      zxingLoop();
    };

    // BarcodeDetector — passa o <video> direto pra manter resolução nativa.
    const bdTick = async () => {
      if (aborted || !bdRef.current || !videoRef.current) return;
      if (Date.now() < snoozeUntilRef.current) {
        bdTimer = setTimeout(bdTick, BD_INTERVAL_MS);
        return;
      }
      if (processingRef.current) {
        bdTimer = setTimeout(bdTick, BD_INTERVAL_MS);
        return;
      }
      const v = videoRef.current!;
      if (v.readyState < 2 || !v.videoWidth || !v.videoHeight) {
        bdTimer = setTimeout(bdTick, BD_INTERVAL_MS);
        return;
      }

      processingRef.current = true;
      try {
        const codes = await bdRef.current!.detect(v);
        if (codes?.length) {
          const code = (codes[0].rawValue || "").trim();
          if (acceptCode(code)) {
            lastTextRef.current = code;
            idleRef.current = Date.now();
            snoozeUntilRef.current = Date.now() + DETECTION_COOLDOWN_MS;
            onDetected(code);
          }
        }
      } catch {
        // silencioso
      } finally {
        processingRef.current = false;
        bdTimer = setTimeout(bdTick, BD_INTERVAL_MS);
      }
    };

    const start = async () => {
      bdRef.current = await initBarcodeDetector();
      // Sempre roda ZXing em paralelo — fallback robusto quando BD existe mas falha.
      startZxingLoop();
      if (bdRef.current) {
        bdTimer = setTimeout(bdTick, BD_INTERVAL_MS);
      }

      // HQ raríssima e só se ficou muito tempo sem detectar
      hqTimer = setInterval(() => {
        const idleFor = Date.now() - idleRef.current;
        if (idleFor > 15000) captureHQ();
      }, 8000);
    };

    const onVis = () => {
      if (document.hidden) {
        try {
          zxingLoopStopRef.current?.();
        } catch {}
        clearTimeout(bdTimer);
      } else {
        startZxingLoop();
        if (bdRef.current) bdTimer = setTimeout(bdTick, BD_INTERVAL_MS);
      }
    };

    if (scanning) {
      start();
      document.addEventListener("visibilitychange", onVis);
    }

    return () => {
      aborted = true;
      document.removeEventListener("visibilitychange", onVis);
      clearTimeout(bdTimer);
      clearInterval(hqTimer);
      try {
        zxingLoopStopRef.current?.();
      } catch {}
    };
  }, [
    BD_INTERVAL_MS,
    DETECTION_COOLDOWN_MS,
    captureHQ,
    ensureZXing,
    initBarcodeDetector,
    onDetected,
    scanning,
    videoRef,
  ]);

  return { scanning, setScanning };
}

/* ========================= App ========================= */
export default function App() {
  const DEFAULT_API_BASE = "https://inward-pied-katerine.ngrok-free.dev";
  const CONFIG_PASSWORD = "F@ives25";

  // Config
  const [apiBase, setApiBase] = useState(() =>
    normalizeUrl(localStorage.getItem("apiBase") || DEFAULT_API_BASE)
  );
  const [filial, setFilial] = useState(
    () => localStorage.getItem("filial") || "1"
  );
  const [numReg, setNumReg] = useState(
    () => localStorage.getItem("numregiao") || "1"
  );

  const [showCfg, setShowCfg] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [pwd, setPwd] = useState("");
  const [pwdErr, setPwdErr] = useState("");
  const [tmpApi, setTmpApi] = useState(apiBase);
  const [tmpFil, setTmpFil] = useState(filial);
  const [tmpReg, setTmpReg] = useState(numReg);

  useEffect(() => {
    localStorage.setItem("apiBase", apiBase);
    localStorage.setItem("filial", filial);
    localStorage.setItem("numregiao", numReg);
  }, [apiBase, filial, numReg]);

  // Câmera
  const {
    videoRef,
    startCamera,
    stopCamera,
    torchSupported,
    torchOn,
    toggleTorch,
    zoomSupported,
    zoomRange,
    zoom,
    applyZoom,
    imageCaptureRef,
  } = useCamera();

  // Scanner
  const [lastCode, setLastCode] = useState<string>("");
  const [animKey, setAnimKey] = useState(0);
  const { scanning, setScanning } = useScanner({
    videoRef,
    imageCaptureRef,
    onDetected: (code) => {
      setLastCode(code);
      fetchProduct(code);
    },
  });

  // Consulta
  const [manualCode, setManualCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [product, setProduct] = useState<ProdDetail | null>(null);

  const fetchProduct = useCallback(
    async (code: string) => {
      const c = (code || "").trim();
      if (!c) return;

      setLoading(true);
      setError("");
      setProduct(null);
      setAnimKey((k) => k + 1);

      const url =
        `${apiBase}/test-api/product/details` +
        `?produto=${encodeURIComponent(c)}` +
        `&codfilial=${encodeURIComponent(filial)}` +
        `&numregiao=${encodeURIComponent(numReg)}` +
        `&with_price=1`;

      try {
        const headers: Record<string, string> = {};
        if (isNgrokUrl(apiBase)) headers["ngrok-skip-browser-warning"] = "true";

        const res = await fetch(url, { headers });
        const body = await res.text();

        if (!res.ok)
          throw new Error(`${res.status} ${res.statusText}\n${body}`);

        const data = JSON.parse(body);
        const row: ProdDetail = Array.isArray(data) ? data[0] : data;
        setProduct(row || null);
      } catch (e: any) {
        setError(e?.message || "Erro ao buscar produto");
      } finally {
        setLoading(false);
      }
    },
    [apiBase, filial, numReg]
  );

  // Start/stop camera
  useEffect(() => {
    (async () => {
      try {
        await startCamera();
        setScanning(true);
      } catch (e: any) {
        setError(e?.message || "Falha ao iniciar câmera");
      }
    })();

    return () => {
      setScanning(false);
      stopCamera();
    };
  }, [startCamera, stopCamera, setScanning]);

  // Gesto para play
  const [needsGesture, setNeedsGesture] = useState(false);
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onPlay = () => setNeedsGesture(false);
    const onPause = () => setNeedsGesture(true);
    v.addEventListener("playing", onPlay);
    v.addEventListener("pause", onPause);
    return () => {
      v.removeEventListener("playing", onPlay);
      v.removeEventListener("pause", onPause);
    };
  }, [videoRef]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex flex-col">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-gradient-to-br from-blue-500 to-blue-600 p-2.5 rounded-xl shadow-md">
              <Barcode className="w-6 h-6 text-white" strokeWidth={2.5} />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-800 tracking-tight">
                Consulta de Produtos
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                Leitura automática (câmera)
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                setTmpApi(apiBase);
                setTmpFil(filial);
                setTmpReg(numReg);
                setShowCfg(true);
                setUnlocked(false);
                setPwd("");
                setPwdErr("");
              }}
              className="p-2.5 hover:bg-slate-100 rounded-xl transition-colors"
              aria-label="Configurações"
            >
              <Settings className="w-5 h-5 text-slate-600" />
            </button>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 flex flex-col gap-4">
        {/* Campo manual */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const v = manualCode.trim();
            if (v) fetchProduct(v);
          }}
          className="bg-white rounded-2xl shadow-lg border border-slate-200 p-4"
        >
          <label className="block text-xs font-semibold text-slate-600 mb-1">
            Teste manual (digite o código e pressione Enter)
          </label>
          <div className="flex gap-2">
            <input
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value)}
              placeholder="Ex.: 7891234567890, CODPROD ou CODFAB"
              className="flex-1 px-3 py-2 rounded-xl border-2 border-slate-300 focus:border-blue-500 focus:ring-4 focus:ring-blue-100 outline-none text-sm"
            />
            <button
              type="submit"
              className="px-4 py-2 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-700 transition"
            >
              Buscar
            </button>
          </div>
        </form>

        {/* Câmera */}
        <div className="bg-white rounded-2xl shadow-lg overflow-hidden border border-slate-200">
          <div className="relative">
            <video
              ref={videoRef}
              className="w-full h-auto bg-black"
              style={{ maxHeight: "70vh", objectFit: "contain" }}
              playsInline
              autoPlay
              muted
              onClick={() => {
                const v = videoRef.current;
                if (needsGesture && v && v.paused) v.play().catch(() => {});
              }}
            />

            {/* Moldura + status */}
            <div className="absolute inset-0 pointer-events-none">
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-48 border-4 border-blue-500 rounded-2xl shadow-2xl" />
              {!needsGesture && (
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/70 backdrop-blur-sm px-4 py-2 rounded-full flex items-center gap-2">
                  <ScanLine className="w-4 h-4 text-blue-400 animate-pulse" />
                  <span className="text-white text-sm font-medium">
                    Lendo automaticamente...
                  </span>
                </div>
              )}
            </div>

            {/* Overlay de gesto obrigatório */}
            {needsGesture && (
              <div
                className="absolute inset-0 bg-black/60 flex items-center justify-center cursor-pointer"
                onClick={() => {
                  const v = videoRef.current;
                  if (v && v.paused) v.play().catch(() => {});
                }}
                title="Toque para liberar o vídeo"
              >
                <div className="inline-flex items-center gap-2 bg-white/90 text-slate-800 font-semibold px-5 py-3 rounded-xl shadow-lg">
                  <Play className="w-5 h-5" />
                  Toque para liberar o vídeo
                </div>
              </div>
            )}

            {/* Controles mínimos */}
            <div className="absolute bottom-4 right-4 flex gap-2">
              {torchSupported && (
                <button
                  onClick={toggleTorch}
                  className="bg-black/70 backdrop-blur-sm hover:bg-black/80 text-white p-3 rounded-full transition-all shadow-lg"
                  aria-label={torchOn ? "Desligar flash" : "Ligar flash"}
                >
                  {torchOn ? (
                    <Flashlight className="w-5 h-5" />
                  ) : (
                    <FlashlightOff className="w-5 h-5" />
                  )}
                </button>
              )}
              <button
                onClick={() => {
                  setScanning(false);
                  stopCamera();
                }}
                className="bg-red-500/90 backdrop-blur-sm hover:bg-red-600 text-white p-3 rounded-full transition-all shadow-lg"
                aria-label="Parar câmera"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Zoom */}
            {zoomSupported && zoomRange && (
              <div className="absolute bottom-4 left-4 bg-black/70 backdrop-blur-sm rounded-xl px-3 py-2 shadow-lg">
                <div className="flex items-center gap-2">
                  <ZoomIn className="w-4 h-4 text-white" />
                  <input
                    type="range"
                    min={zoomRange.min}
                    max={zoomRange.max}
                    step={zoomRange.step}
                    value={zoom ?? zoomRange.min}
                    onChange={(e) => applyZoom(Number(e.target.value))}
                    className="w-40 accent-white"
                    aria-label="Zoom"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Último código */}
        {lastCode && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-center gap-3">
            <div className="bg-blue-500 p-2 rounded-lg">
              <Barcode className="w-5 h-5 text-white" />
            </div>
            <div className="flex-1">
              <p className="text-xs font-medium text-blue-700 uppercase tracking-wide">
                Código detectado automaticamente
              </p>
              <p className="text-lg font-bold text-blue-900 mt-0.5">
                {lastCode}
              </p>
            </div>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="bg-white rounded-xl shadow-md p-8 flex flex-col items-center justify-center">
            <Loader2 className="w-12 h-12 text-blue-500 animate-spin mb-4" />
            <p className="text-slate-600 font-medium">Consultando produto...</p>
          </div>
        )}

        {/* Erro */}
        {error && !loading && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-5 flex items-start gap-3">
            <AlertCircle className="w-6 h-6 text-red-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-base font-semibold text-red-800">
                Erro na consulta
              </p>
              <p className="text-sm text-red-600 mt-1">{error}</p>
            </div>
          </div>
        )}

        {/* Resultado */}
        {product && !loading && (
          <div
            key={animKey}
            className="bg-white rounded-2xl shadow-lg border border-slate-200 overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500"
          >
            {/* Cabeçalho verde */}
            <div className="bg-gradient-to-r from-green-500 to-green-600 px-6 py-5 flex items-center gap-3">
              <div className="bg-white/20 p-2 rounded-lg">
                <CheckCircle2
                  className="w-6 h-6 text-white"
                  strokeWidth={2.5}
                />
              </div>
              <div className="flex-1">
                <p className="text-green-50 text-sm font-medium">
                  Produto Encontrado
                </p>
                <p className="text-white text-lg font-bold mt-0.5">
                  {product.DESCRICAO}
                </p>
              </div>
            </div>

            {/* Conteúdo */}
            <div className="p-6 space-y-4">
              {/* Códigos */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
                    Código Produto
                  </p>
                  <p className="text-xl font-bold text-slate-900">
                    {product.CODPROD}
                  </p>
                </div>
                <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
                    Código Auxiliar
                  </p>
                  <p className="text-xl font-bold text-slate-900">
                    {product.CODAUXILIAR}
                  </p>
                </div>
              </div>

              {/* Estoque */}
              <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-xl p-5 border border-blue-200">
                <h3 className="text-sm font-bold text-blue-900 mb-4 flex items-center gap-2">
                  <div className="w-1 h-4 bg-blue-500 rounded-full" />
                  Informações de Estoque
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs text-blue-700 font-medium mb-1">
                      Estoque Atual
                    </p>
                    <p className="text-2xl font-bold text-blue-900">
                      {product.ESTOQUE_ATUAL}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-blue-700 font-medium mb-1">
                      Disponível
                    </p>
                    <p className="text-2xl font-bold text-green-600">
                      {product.ESTOQUE_DISPONIVEL}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-blue-700 font-medium mb-1">
                      Bloqueado
                    </p>
                    <p className="text-lg font-semibold text-orange-600">
                      {product.BLOQUEADO}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-blue-700 font-medium mb-1">
                      Avaria
                    </p>
                    <p className="text-lg font-semibold text-red-600">
                      {product.AVARIA}
                    </p>
                  </div>
                </div>
              </div>

              {/* Preços */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="bg-green-50 rounded-xl p-4 border border-green-200">
                  <p className="text-xs font-semibold text-green-700 uppercase tracking-wide mb-2">
                    Preço Varejo
                  </p>
                  <p className="text-2xl font-bold text-green-800">
                    {fmtBRL(product.PRECO_VAREJO)}
                  </p>
                </div>
                <div className="bg-amber-50 rounded-xl p-4 border border-amber-200">
                  <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-2">
                    Custo Últ. Entrada
                  </p>
                  <p className="text-2xl font-bold text-amber-800">
                    {fmtBRL(product.CUSTOULTENT)}
                  </p>
                </div>
              </div>

              {/* Fornecedor */}
              <div className="bg-slate-50 rounded-xl p-5 border border-slate-200">
                <h3 className="text-sm font-bold text-slate-900 mb-3 flex items-center gap-2">
                  <div className="w-1 h-4 bg-slate-500 rounded-full" />
                  Fornecedor
                </h3>
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-slate-600 font-medium">
                      Nome:
                    </span>
                    <span className="text-sm text-slate-900 font-semibold">
                      {product.FORNECEDOR}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-slate-600 font-medium">
                      Código:
                    </span>
                    <span className="text-sm text-slate-900 font-semibold">
                      {product.CODFORNEC}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-slate-600 font-medium">
                      Última Entrada:
                    </span>
                    <span className="text-sm text-slate-900 font-semibold">
                      {fmtDate(product.DTULTENT)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Rodapé com Filial/Região */}
              <div className="grid grid-cols-2 gap-3 pt-2">
                <div className="text-center py-2">
                  <p className="text-xs text-slate-500 font-medium mb-1">
                    Filial
                  </p>
                  <p className="text-base font-bold text-slate-700">
                    {product.CODFILIAL}
                  </p>
                </div>
                <div className="text-center py-2">
                  <p className="text-xs text-slate-500 font-medium mb-1">
                    Região
                  </p>
                  <p className="text-base font-bold text-slate-700">{numReg}</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Modal de Configurações */}
      {showCfg && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto animate-in zoom-in-95 duration-200">
            <div className="bg-gradient-to-r from-slate-700 to-slate-800 px-6 py-5 flex items-center justify-between rounded-t-2xl">
              <div className="flex items-center gap-3">
                <div className="bg-white/20 p-2 rounded-lg">
                  <Settings className="w-5 h-5 text-white" />
                </div>
                <h2 className="text-xl font-bold text-white">Configurações</h2>
              </div>
              <button
                onClick={() => {
                  setShowCfg(false);
                  setUnlocked(false);
                  setPwd("");
                  setPwdErr("");
                }}
                className="p-1.5 hover:bg-white/20 rounded-lg transition-colors"
                aria-label="Fechar"
              >
                <X className="w-5 h-5 text-white" />
              </button>
            </div>

            <div className="p-6">
              {!unlocked ? (
                <div className="space-y-4">
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-amber-800">
                      Digite a senha para acessar as configurações
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-2">
                      Senha
                    </label>
                    <input
                      type="password"
                      value={pwd}
                      onChange={(e) => setPwd(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          if (pwd === CONFIG_PASSWORD) {
                            setUnlocked(true);
                            setPwdErr("");
                          } else {
                            setPwdErr("Senha incorreta");
                          }
                        }
                      }}
                      className="w-full px-4 py-3 border-2 border-slate-300 rounded-xl focus:border-blue-500 focus:ring-4 focus:ring-blue-100 outline-none transition-all"
                      placeholder="Digite a senha"
                      autoFocus
                    />
                    {pwdErr && (
                      <p className="text-sm text-red-600 mt-2 font-medium">
                        {pwdErr}
                      </p>
                    )}
                  </div>

                  <button
                    onClick={() => {
                      if (pwd === CONFIG_PASSWORD) {
                        setUnlocked(true);
                        setPwdErr("");
                      } else setPwdErr("Senha incorreta");
                    }}
                    className="w-full bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white px-6 py-3.5 rounded-xl font-semibold shadow-lg hover:shadow-xl transition-all"
                  >
                    Desbloquear
                  </button>
                </div>
              ) : (
                <div className="space-y-5">
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-2">
                      URL da API
                    </label>
                    <input
                      type="text"
                      value={tmpApi}
                      onChange={(e) => setTmpApi(e.target.value)}
                      className="w-full px-4 py-3 border-2 border-slate-300 rounded-xl focus:border-blue-500 focus:ring-4 focus:ring-blue-100 outline-none transition-all text-sm"
                      placeholder="https://exemplo.ngrok-free.dev"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-2">
                      Código da Filial
                    </label>
                    <input
                      type="text"
                      value={tmpFil}
                      onChange={(e) => setTmpFil(e.target.value)}
                      className="w-full px-4 py-3 border-2 border-slate-300 rounded-xl focus:border-blue-500 focus:ring-4 focus:ring-blue-100 outline-none transition-all"
                      placeholder="1"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-2">
                      Número da Região
                    </label>
                    <input
                      type="text"
                      value={tmpReg}
                      onChange={(e) => setTmpReg(e.target.value)}
                      className="w-full px-4 py-3 border-2 border-slate-300 rounded-xl focus:border-blue-500 focus:ring-4 focus:ring-blue-100 outline-none transition-all"
                      placeholder="1"
                    />
                  </div>
                  <div className="flex gap-3 pt-2">
                    <button
                      onClick={() => {
                        setShowCfg(false);
                        setUnlocked(false);
                        setPwd("");
                        setTmpApi(apiBase);
                        setTmpFil(filial);
                        setTmpReg(numReg);
                      }}
                      className="flex-1 bg-slate-200 hover:bg-slate-300 text-slate-700 px-6 py-3.5 rounded-xl font-semibold transition-all"
                    >
                      Cancelar
                    </button>
                    <button
                      onClick={() => {
                        setApiBase(normalizeUrl(tmpApi));
                        setFilial(tmpFil);
                        setNumReg(tmpReg);
                        setShowCfg(false);
                        setUnlocked(false);
                        setPwd("");
                      }}
                      className="flex-1 bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white px-6 py-3.5 rounded-xl font-semibold shadow-lg hover:shadow-xl transition-all"
                    >
                      Salvar
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
