import { useEffect, useRef, useState, type DragEvent, type FormEvent, type KeyboardEvent } from "react";
import { AlertCircle, Camera, Globe, ImagePlus, Loader2, ScanSearch, Search, Sparkles, X } from "lucide-react";
import { StepHeader } from "@/components/ui/StepHeader";
import { apiFetch } from "@/lib/api";
import { NameSearchResults, WebSellersPanel, useWebSellers, webCandidates } from "@/components/search/WebSellers";
import { VisualMatchesPanel, needsAiFallback, needsAutoName, useVisualSearch, visualCandidates } from "@/components/search/VisualMatches";
import { useSiteVerification } from "@/components/search/SiteVerification";
import { VISUAL_MESSAGES, shouldAutoSearchByName } from "@/lib/photo/visual";
import {
  CONFIDENCE_PHRASES,
  PHOTO_LIMITS,
  PHOTO_MESSAGES,
  PHOTO_NAME_MAX,
  PHOTO_TYPES,
  checkPhotoFile,
  fitWithin,
  parseIdentification,
  type IdentifiedProduct,
  type PhotoConfidence,
} from "@/lib/photo/identify";

interface PhotoAnalyzerProps {
  /** Busca en el Radar con el nombre confirmado. Es la misma búsqueda de la pestaña Radar MLU. */
  onSearch: (name: string) => void;
  searchLoading: boolean;
  /** Nombre de la última búsqueda del Radar que no encontró ningún producto, o null. */
  marketEmptyFor?: string | null;
}

/** "foto": lo que encontró la búsqueda visual. "web": búsqueda en Google Uruguay por el nombre. */
type View = "foto" | "web";
const VIEWS: { id: View; label: string }[] = [
  { id: "foto", label: "Según la foto" },
  { id: "web", label: "En la web (Uruguay)" },
];

interface Photo {
  blob: Blob;
  url: string;
  width: number;
  height: number;
}

type Phase = "idle" | "preparing" | "analyzing";

const CONFIDENCE_STYLES: Record<PhotoConfidence, string> = {
  alta: "border-emerald-600/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300",
  media: "border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200",
  baja: "border-red-500/40 bg-red-500/10 text-red-800 dark:text-red-300",
};

const SECONDARY_BUTTON =
  "inline-flex items-center justify-center gap-2 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white hover:bg-zinc-100 dark:bg-zinc-900 dark:hover:bg-zinc-800 px-3.5 py-2.5 text-xs font-black uppercase tracking-wider text-zinc-800 dark:text-zinc-200 transition-colors cursor-pointer disabled:opacity-40 disabled:pointer-events-none";
const PRIMARY_BUTTON =
  "h-12 px-6 rounded-md bg-black hover:bg-zinc-800 text-white dark:bg-white dark:text-black dark:hover:bg-zinc-200 font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all cursor-pointer shadow-sm disabled:opacity-40 disabled:pointer-events-none active:scale-95 shrink-0";

/** Achica la foto en el navegador: lado mayor acotado y JPEG. De paso, la foto sale sin sus metadatos. */
async function shrinkPhoto(file: Blob): Promise<Omit<Photo, "url">> {
  const bitmap = await createImageBitmap(file);
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height, PHOTO_LIMITS.maxSide);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx || width === 0) throw new Error("canvas");
    // Fondo blanco: un PNG transparente no queda negro al pasar a JPEG.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", PHOTO_LIMITS.jpegQuality));
    if (!blob) throw new Error("toBlob");
    return { blob, width, height };
  } finally {
    bitmap.close();
  }
}

export function PhotoAnalyzer({ onSearch, searchLoading, marketEmptyFor = null }: PhotoAnalyzerProps) {
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<IdentifiedProduct | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [view, setView] = useState<View>("foto");
  // Último nombre que se mandó al Radar desde acá: para saber si "sin resultados" habla de esta búsqueda.
  const [lastMlSearch, setLastMlSearch] = useState<string | null>(null);
  // Nombre con el que se lanzó sola la búsqueda por nombre para esta foto. Como mucho una vez por foto.
  const [autoWebName, setAutoWebName] = useState<string | null>(null);
  const autoWebTurnRef = useRef(-1);
  // Lo que hay en el campo ahora, para decidir sin esperar a otro render.
  const nameRef = useRef("");
  nameRef.current = name;
  const web = useWebSellers();
  const visual = useVisualSearch();
  const visualStatus = visual.state.status;
  // Cada lista de resultados nueva se verifica una vez: ¿los sitios están activos y son de Uruguay?
  const visualData = visual.state.status === "done" ? visual.state.data : null;
  const visualVerification = useSiteVerification(visualData, visualData ? visualCandidates(visualData) : []);
  const webData = web.state.status === "done" ? web.state.data : null;
  const webVerification = useSiteVerification(webData, webData ? webCandidates(webData) : []);

  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Cada foto elegida invalida lo que estuviera en curso para la anterior.
  const turnRef = useRef(0);
  const photoUrlRef = useRef<string | null>(null);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      if (photoUrlRef.current) URL.revokeObjectURL(photoUrlRef.current);
    },
    []
  );

  // Al llegar resultados o un nombre de la IA, el foco va al nombre: es lo que hay que revisar antes de buscar.
  useEffect(() => {
    if (visualStatus === "done" || result?.isProduct) nameInput.current?.focus({ preventScroll: true });
  }, [visualStatus, result]);

  function replacePhoto(next: Photo | null) {
    if (photoUrlRef.current) URL.revokeObjectURL(photoUrlRef.current);
    photoUrlRef.current = next?.url ?? null;
    setPhoto(next);
  }

  function reset() {
    turnRef.current++;
    abortRef.current?.abort();
    abortRef.current = null;
    replacePhoto(null);
    setPhase("idle");
    setResult(null);
    setName("");
    setError(null);
    setNotice(null);
    setView("foto");
    setLastMlSearch(null);
    setAutoWebName(null);
    web.reset();
    visual.reset();
  }

  async function choosePhoto(file: File | undefined) {
    if (!file) return;
    reset();
    const turn = turnRef.current;
    const problem = checkPhotoFile(file.type, file.size, PHOTO_LIMITS.maxOriginalBytes);
    if (problem) return setError(PHOTO_MESSAGES[problem]);

    setPhase("preparing");
    try {
      const shrunk = await shrinkPhoto(file);
      if (turn !== turnRef.current) return;
      if (checkPhotoFile(shrunk.blob.type, shrunk.blob.size, PHOTO_LIMITS.maxBytes)) {
        setPhase("idle");
        return setError(PHOTO_MESSAGES.size);
      }
      replacePhoto({ ...shrunk, url: URL.createObjectURL(shrunk.blob) });
      setPhase("idle");
    } catch {
      if (turn !== turnRef.current) return;
      setPhase("idle");
      setError(PHOTO_MESSAGES.unreadable);
    }
  }

  /** Búsqueda visual: es el paso principal. Cada búsqueda se paga, así que solo corre cuando se la pide. */
  async function findSellers() {
    if (!photo || phase !== "idle" || visualStatus === "loading") return;
    const turn = turnRef.current;
    setError(null);
    setNotice(null);
    const end = await visual.search(photo.blob);
    if (turn !== turnRef.current || !end) return;
    const suggested = end.status === "done" ? end.data.suggestedName : "";
    // Si ya hay un nombre escrito (por ejemplo, al reintentar), no se pisa.
    if (suggested) setName((current) => (current.trim() ? current : suggested));
    // Con poco o nada de Uruguay, el nombre se le pide a la IA sin esperar: es gratis y no gasta otra búsqueda visual.
    if (needsAutoName(end)) void analyze(suggested);
  }

  /**
   * Identificación con IA: paso secundario, para cuando la búsqueda visual no alcanza. Con el botón, el nombre
   * de la IA reemplaza al que haya. Cuando corre sola (`replaceable` definido), solo reemplaza un campo vacío
   * o el nombre que había propuesto la búsqueda visual: lo que escribió el usuario no se toca.
   */
  async function analyze(replaceable?: string) {
    if (!photo || phase !== "idle") return;
    const turn = turnRef.current;
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase("analyzing");
    setError(null);
    setNotice(null);
    setResult(null);

    try {
      const res = await apiFetch("/api/identify-product", {
        method: "POST",
        headers: { "Content-Type": photo.blob.type },
        body: photo.blob,
        signal: controller.signal,
      });
      const data = await res.json().catch(() => null);
      if (turn !== turnRef.current) return;
      if (!res.ok || !data?.ok) {
        setError(typeof data?.message === "string" && data.message ? data.message : PHOTO_MESSAGES.provider);
        return;
      }
      // La respuesta se valida de nuevo acá: a la pantalla solo llegan los campos esperados.
      const parsed = parseIdentification(JSON.stringify(data));
      if (!parsed.ok) return setError(PHOTO_MESSAGES.invalidAnswer);
      setResult(parsed.value);
      const aiName = parsed.value.name;
      if (!aiName) return;
      setName((current) => (replaceable === undefined || !current.trim() || current === replaceable ? aiName : current));
      // Con el nombre de la IA se completa con una búsqueda por nombre en Google Uruguay. Un solo intento por
      // foto, y solo si el nombre que quedó en el campo es el de la IA: si el usuario escribió otro, no.
      const launch = shouldAutoSearchByName({
        automatic: replaceable !== undefined,
        aiName,
        currentName: nameRef.current,
        visualName: replaceable ?? "",
        alreadyLaunched: autoWebTurnRef.current === turn,
      });
      if (launch) {
        autoWebTurnRef.current = turn;
        setAutoWebName(aiName);
        void web.search(aiName);
      }
    } catch {
      if (turn !== turnRef.current) return;
      if (controller.signal.aborted) return;
      setError(PHOTO_MESSAGES.network);
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setPhase("idle");
      }
    }
  }

  function cancelAnalysis() {
    abortRef.current?.abort();
    abortRef.current = null;
    setPhase("idle");
    setNotice("Cancelaste el análisis. La foto sigue cargada.");
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    void choosePhoto(e.dataTransfer.files?.[0]);
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const q = name.trim();
    if (q.length < 2) return;
    // Cada vista busca solo en lo suyo, y solo cuando el usuario lo pide.
    if (view === "web") return void web.search(q);
    setLastMlSearch(q);
    onSearch(q);
  }

  function openView(next: View) {
    setView(next);
    requestAnimationFrame(() => document.getElementById(`photo-tab-${next}`)?.focus({ preventScroll: true }));
  }

  function handleTabKey(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const index = VIEWS.findIndex((v) => v.id === view);
    const next = e.key === "Home" ? 0 : e.key === "End" ? VIEWS.length - 1 : (index + (e.key === "ArrowRight" ? 1 : -1) + VIEWS.length) % VIEWS.length;
    openView(VIEWS[next].id);
  }

  const webLoading = web.state.status === "loading";
  const suggestWeb = view === "foto" && !searchLoading && marketEmptyFor !== null && marketEmptyFor === lastMlSearch;

  const busy = phase !== "idle";
  // Hay algo para mostrar junto al nombre: la búsqueda visual terminó (bien o mal) o la IA ya respondió.
  const staged = visualStatus === "done" || visualStatus === "error" || result !== null;
  const offerAi = needsAiFallback(visual.state) && !result;
  const details = result?.isProduct
    ? [result.brand ? `Marca: ${result.brand}` : null, result.category ? `Categoría: ${result.category}` : null, ...result.attributes].filter(
        (d): d is string => Boolean(d)
      )
    : [];

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-surface p-5 sm:p-6 shadow-sm">
      <StepHeader title="Buscar por foto" aside="Opcional" />

      <p className="text-xs text-zinc-600 dark:text-zinc-400 mb-5 leading-relaxed">
        Subí una foto del producto y mirá dónde se vende en Uruguay, según Google Lens. Después revisás el nombre y
        analizás los precios reales de Mercado Libre en el Radar.{" "}
        <strong data-visual-privacy className="font-bold text-zinc-800 dark:text-zinc-200">
          {VISUAL_MESSAGES.privacy}
        </strong>
      </p>

      <input
        ref={fileInput}
        type="file"
        hidden
        accept={PHOTO_TYPES.join(",")}
        data-photo-input="file"
        onChange={(e) => {
          void choosePhoto(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <input
        ref={cameraInput}
        type="file"
        hidden
        accept="image/*"
        capture="environment"
        data-photo-input="camera"
        onChange={(e) => {
          void choosePhoto(e.target.files?.[0]);
          e.target.value = "";
        }}
      />

      {!photo ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          className={`flex flex-col items-center gap-3 rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors ${
            dragging ? "border-black dark:border-white bg-zinc-100 dark:bg-zinc-800/60" : "border-zinc-300 dark:border-zinc-700"
          }`}
        >
          {phase === "preparing" ? (
            <p role="status" className="flex items-center gap-2 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Preparando la foto…
            </p>
          ) : (
            <>
              <ImagePlus className="size-7 text-zinc-500 dark:text-zinc-400" aria-hidden />
              <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                Arrastrá una foto acá o elegila desde tu equipo.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <button type="button" onClick={() => fileInput.current?.click()} className={SECONDARY_BUTTON}>
                  <ImagePlus className="size-3.5" aria-hidden />
                  <span>Elegir foto</span>
                </button>
                {/* La cámara directa solo tiene sentido en pantallas táctiles. */}
                <button
                  type="button"
                  onClick={() => cameraInput.current?.click()}
                  className={`${SECONDARY_BUTTON} pointer-fine:hidden`}
                >
                  <Camera className="size-3.5" aria-hidden />
                  <span>Sacar foto</span>
                </button>
              </div>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">JPG, PNG o WebP.</p>
            </>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <div className="relative w-full shrink-0 sm:w-44">
            <img
              src={photo.url}
              alt="Foto que subiste"
              width={photo.width}
              height={photo.height}
              data-photo-preview
              className="h-auto max-h-56 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white object-contain"
            />
            <button
              type="button"
              onClick={reset}
              aria-label="Quitar la foto"
              title="Quitar la foto"
              className="absolute right-1.5 top-1.5 flex size-8 items-center justify-center rounded-full bg-black/80 text-white hover:bg-black cursor-pointer"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-3">
            {visualStatus === "loading" ? (
              <div className="flex flex-wrap items-center gap-3">
                <p role="status" className="flex items-center gap-2 text-sm font-bold text-zinc-800 dark:text-zinc-200">
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  {VISUAL_MESSAGES.searching}
                </p>
                <button type="button" onClick={visual.cancel} className={SECONDARY_BUTTON}>
                  Cancelar
                </button>
              </div>
            ) : !staged ? (
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={findSellers} disabled={busy} className={PRIMARY_BUTTON} data-visual-search>
                  <ScanSearch className="size-4" aria-hidden />
                  <span>Buscar dónde se vende</span>
                </button>
                <button type="button" onClick={() => fileInput.current?.click()} className={SECONDARY_BUTTON}>
                  Cambiar foto
                </button>
              </div>
            ) : null}

            {visual.state.status === "idle" && visual.state.notice && (
              <p role="status" className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                {visual.state.notice}
              </p>
            )}

            {notice && (
              <p role="status" className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                {notice}
              </p>
            )}

            {staged && visualStatus !== "loading" && (
              <form onSubmit={handleSubmit} className="flex min-w-0 flex-col gap-3" data-photo-result>
                <div
                  role="tablist"
                  aria-label="Dónde buscar el producto"
                  className="flex self-start rounded-lg border border-zinc-200 dark:border-zinc-800 p-1"
                >
                  {VIEWS.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      role="tab"
                      id={`photo-tab-${v.id}`}
                      aria-selected={view === v.id}
                      aria-controls={`photo-panel-${v.id}`}
                      tabIndex={view === v.id ? 0 : -1}
                      onClick={() => setView(v.id)}
                      onKeyDown={handleTabKey}
                      className={`rounded-md px-3 py-2 text-[11px] font-black uppercase tracking-wider transition-all cursor-pointer ${
                        view === v.id
                          ? "bg-black text-white dark:bg-white dark:text-black shadow-sm"
                          : "text-zinc-600 dark:text-zinc-400 hover:text-black dark:hover:text-white"
                      }`}
                    >
                      {v.label}
                    </button>
                  ))}
                </div>

                <div>
                  <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                    <label
                      htmlFor="photo-name-input"
                      className="text-[11px] font-black uppercase tracking-wider text-zinc-600 dark:text-zinc-400"
                    >
                      Nombre para buscar (podés corregirlo)
                    </label>
                    {result?.isProduct && (
                      <span
                        role="status"
                        data-photo-confidence={result.confidence}
                        className={`rounded border px-2 py-0.5 text-[11px] font-bold ${CONFIDENCE_STYLES[result.confidence]}`}
                      >
                        {CONFIDENCE_PHRASES[result.confidence]}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-col gap-2.5 sm:flex-row">
                    <input
                      id="photo-name-input"
                      ref={nameInput}
                      type="text"
                      required
                      minLength={2}
                      maxLength={PHOTO_NAME_MAX}
                      value={name}
                      placeholder="Escribí el nombre del producto"
                      onChange={(e) => setName(e.target.value)}
                      className="h-12 w-full min-w-0 shrink-0 sm:shrink sm:flex-1 rounded-md border border-zinc-400 dark:border-zinc-600 bg-white dark:bg-zinc-900 px-3.5 text-sm font-medium text-zinc-900 dark:text-zinc-100 outline-none transition-all hover:border-zinc-500 focus:border-black dark:focus:border-white focus:ring-1 focus:ring-black dark:focus:ring-white"
                    />
                    {view === "foto" ? (
                      <button type="submit" disabled={searchLoading || name.trim().length < 2} className={PRIMARY_BUTTON} data-radar-search>
                        {searchLoading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Search className="size-4" aria-hidden />}
                        <span>{searchLoading ? "Buscando..." : "Analizar en Radar"}</span>
                      </button>
                    ) : (
                      <button type="submit" disabled={webLoading || name.trim().length < 2} className={PRIMARY_BUTTON} data-web-search>
                        {webLoading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Globe className="size-4" aria-hidden />}
                        <span>{webLoading ? "Buscando..." : "Buscar en la web de Uruguay"}</span>
                      </button>
                    )}
                  </div>
                </div>

                {result?.isProduct && (
                  <p data-ai-name-note className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-400">
                    {VISUAL_MESSAGES.aiName}: «{result.name}».
                  </p>
                )}

                {result?.isProduct && result.alternatives.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="mr-1 text-[11px] font-black uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                      O usá:
                    </span>
                    {[result.name, ...result.alternatives]
                      .filter((option) => option !== name)
                      .map((option) => (
                        <button
                          key={option}
                          type="button"
                          data-photo-alternative
                          onClick={() => setName(option)}
                          className="max-w-full break-words rounded border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 px-2.5 py-1 text-left text-[11px] font-semibold text-zinc-700 dark:text-zinc-300 hover:border-black hover:text-black dark:hover:border-white dark:hover:text-white transition-colors cursor-pointer"
                        >
                          {option}
                        </button>
                      ))}
                  </div>
                )}

                {details.length > 0 && (
                  <ul className="flex flex-wrap gap-1.5" aria-label="Lo que se ve en la foto">
                    {details.map((detail) => (
                      <li
                        key={detail}
                        className="max-w-full break-words rounded bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-[11px] font-medium text-zinc-700 dark:text-zinc-300"
                      >
                        {detail}
                      </li>
                    ))}
                  </ul>
                )}

                {result?.isProduct && result.notes && <p className="break-words text-xs text-zinc-600 dark:text-zinc-400">{result.notes}</p>}

                <div
                  role="tabpanel"
                  id="photo-panel-foto"
                  aria-labelledby="photo-tab-foto"
                  hidden={view !== "foto"}
                  className="flex min-w-0 flex-col gap-3"
                >
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    «Analizar en Radar» busca ese nombre en Mercado Libre Uruguay y muestra los precios reales acá abajo, igual que
                    en el Radar. Corregir el nombre y buscar de nuevo no gasta otra búsqueda visual ni usa la IA.
                  </p>
                  {suggestWeb && (
                    <div
                      role="status"
                      data-web-suggestion
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200"
                    >
                      <p className="min-w-0 flex-1 break-words">
                        Mercado Libre no tiene precios para «{marketEmptyFor}». Puede que se venda en otros sitios.
                      </p>
                      <button type="button" onClick={() => openView("web")} className={SECONDARY_BUTTON}>
                        <Globe className="size-3.5" aria-hidden />
                        <span>Probá en la web de Uruguay</span>
                      </button>
                    </div>
                  )}

                  <VisualMatchesPanel name={name} state={visual.state} onRetry={() => void findSellers()} verification={visualVerification} />

                  {autoWebName && (
                    <NameSearchResults
                      name={autoWebName}
                      state={web.state}
                      canSearch={name.trim().length >= 2}
                      verification={webVerification}
                      onSearch={() => void web.search(name.trim())}
                    />
                  )}

                  {phase === "analyzing" ? (
                    <div className="flex flex-wrap items-center gap-3">
                      <p role="status" className="flex items-center gap-2 text-sm font-bold text-zinc-800 dark:text-zinc-200">
                        <Loader2 className="size-4 animate-spin" aria-hidden />
                        Analizando…
                      </p>
                      <button type="button" onClick={cancelAnalysis} className={SECONDARY_BUTTON}>
                        Cancelar
                      </button>
                    </div>
                  ) : offerAi ? (
                    <div className="flex flex-wrap items-center gap-2" data-ai-offer>
                      <button type="button" onClick={() => void analyze()} disabled={busy} className={SECONDARY_BUTTON} data-ai-identify>
                        <Sparkles className="size-3.5" aria-hidden />
                        <span>Identificar nombre con IA (gratis)</span>
                      </button>
                      <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                        {visualStatus === "done" ? "Hay pocos resultados de Uruguay: la IA puede proponer un nombre." : "La IA propone un nombre a partir de la foto."}
                      </span>
                    </div>
                  ) : null}

                  {result && !result.isProduct && (
                    <div
                      role="status"
                      data-photo-no-product
                      className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-900 dark:text-amber-200"
                    >
                      <p className="font-bold">{PHOTO_MESSAGES.noProduct}</p>
                      {result.notes && <p className="mt-1 break-words">{result.notes}</p>}
                      <button type="button" onClick={() => fileInput.current?.click()} className={`${SECONDARY_BUTTON} mt-3`}>
                        Subir otra foto
                      </button>
                    </div>
                  )}
                </div>

                <div role="tabpanel" id="photo-panel-web" aria-labelledby="photo-tab-web" hidden={view !== "web"} className="min-w-0">
                  <WebSellersPanel name={name} state={web.state} onCancel={web.cancel} onRetry={(query) => void web.search(query)} verification={webVerification} />
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {error && (
        <div
          role="alert"
          data-photo-error
          className="mt-4 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs leading-relaxed text-red-800 dark:text-red-300"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p className="min-w-0 break-words">{error}</p>
        </div>
      )}

      <p className="mt-4 border-t border-zinc-100 dark:border-zinc-800/80 pt-3 text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-400">
        <strong className="font-bold">
          La búsqueda visual y la IA pueden equivocarse con productos genéricos. Revisá el nombre antes de buscar.
        </strong>{" "}
        La foto se achica en tu navegador antes de enviarse. Si usás «Identificar nombre con IA», también se envía a Gemini
        (Google). Los precios de las tiendas los informa Google y no entran en ningún cálculo: la rentabilidad sale del costo
        que cargues y del semáforo de siempre.
      </p>
    </div>
  );
}
