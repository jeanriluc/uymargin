import { useDialog } from "@/lib/hooks/useDialog";
import {
  Brain,
  Loader2,
  Send,
  Sparkles,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { MultichannelAnalysis } from "@/lib/finance/engine";
import type { AnalysisInputs } from "@/lib/finance/types";
import { formatPct, formatUyu } from "@/lib/format";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  modelUsed?: string;
  thinkingMode?: boolean;
}

interface AiAdvisorProps {
  isOpen: boolean;
  onClose: () => void;
  inputs: AnalysisInputs;
  analysis: MultichannelAnalysis;
}

const MODELS = [
  { id: "gemini-3.8-flash", name: "Gemini 3.8 Flash (Recomendado)", desc: "Razonamiento financiero y velocidad", icon: Zap },
  { id: "gemini-3.5-flash-lite", name: "Gemini 3.5 Flash Lite", desc: "Respuestas ultrarrápidas", icon: Sparkles },
];

export function AiAdvisor({ isOpen, onClose, inputs, analysis }: AiAdvisorProps) {
  const dialogRef = useDialog(isOpen, onClose);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      content: `¡Hola! Soy tu Asesor Financiero IA para E-commerce en Uruguay.
Analizo en tiempo real tu estructura de costos, comisiones de Mercado Libre UY, pasarelas de pago y la normativa tributaria de DGI (Literal E vs Régimen General).

¿En qué puedo ayudarte con este producto?`,
    },
  ]);
  const [inputPrompt, setInputPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedModel, setSelectedModel] = useState("gemini-3.8-flash");
  const [enableThinking, setEnableThinking] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [isOpen, messages]);

  const handleModelChange = (modelId: string) => {
    setSelectedModel(modelId);
    if (modelId === "gemini-3.1-pro-preview") {
      setEnableThinking(true);
    }
  };

  const handleSend = async (textToSend?: string) => {
    const text = (textToSend ?? inputPrompt).trim();
    if (!text || loading) return;

    const userMsg: Message = {
      id: String(Date.now()),
      role: "user",
      content: text,
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputPrompt("");
    setLoading(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          history: messages.map((m) => ({ role: m.role, content: m.content })),
          model: selectedModel,
          enableThinking: selectedModel === "gemini-3.1-pro-preview" && enableThinking,
          context: {
            productName: inputs.productName || inputs.query || "Producto genérico",
            wholesaleCost: `${inputs.cost.currency} ${inputs.cost.amount}`,
            landedCostUyu: formatUyu(analysis.costs.landed),
            simulatedSalePriceUyu: formatUyu(inputs.salePrice),
            exchangeRate: inputs.exchangeRate,
            taxRegime: inputs.tax.regime === "literal_e" ? "Literal E (Pequeña Empresa)" : "Régimen General (IVA 22%)",
            ml: {
              netProfit: formatUyu(analysis.ml.netProfit),
              netMargin: formatPct(analysis.ml.netMargin),
              roi: formatPct(analysis.ml.roi),
              viability: analysis.ml.viability,
              breakEven: formatUyu(analysis.ml.breakEvenPrice ?? 0),
            },
            direct: {
              netProfit: formatUyu(analysis.direct.netProfit),
              netMargin: formatPct(analysis.direct.netMargin),
              roi: formatPct(analysis.direct.roi),
              viability: analysis.direct.viability,
              breakEven: formatUyu(analysis.direct.breakEvenPrice ?? 0),
            },
          },
        }),
      });

      const data = await response.json();
      if (data.ok && data.reply) {
        setMessages((prev) => [
          ...prev,
          {
            id: String(Date.now() + 1),
            role: "assistant",
            content: data.reply,
            modelUsed: selectedModel,
            thinkingMode: selectedModel === "gemini-3.1-pro-preview" && enableThinking,
          },
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          {
            id: String(Date.now() + 1),
            role: "assistant",
            content: `Lo siento, ocurrió un error al consultar el asesor IA: ${data.error || "Intente nuevamente."}`,
          },
        ]);
      }
    } catch (err) {
      console.error("AI Advisor error:", err);
      setMessages((prev) => [
        ...prev,
        {
          id: String(Date.now() + 1),
          role: "assistant",
          content: "No se pudo conectar con el servidor de inteligencia artificial. Verifique su conexión.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const QUICK_QUESTIONS = [
    "¿Me conviene vender en Mercado Libre o en mi web propia?",
    "¿Cuál es el precio óptimo considerando mi costo y la comisión?",
    "¿Cómo impacta el régimen tributario de DGI en mi ganancia?",
    "¿Cómo puedo absorber el envío gratis sin ir a pérdida?",
  ];

  if (!isOpen) return null;

  return (
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Copiloto de inteligencia artificial" className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="flex flex-col w-full max-w-2xl h-[85vh] max-h-[780px] rounded-xl border border-zinc-300 dark:border-zinc-700 bg-surface shadow-2xl overflow-hidden">
        {/* Top Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 bg-[#fafafa] dark:bg-zinc-900/60">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center bg-black text-white dark:bg-white dark:text-black font-black text-sm">
              AI
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="heading-grotesk text-sm font-black uppercase tracking-tight text-zinc-900 dark:text-zinc-100">
                  Asesor Financiero IA UyMargin
                </h3>
                <span className="rounded bg-black text-white dark:bg-white dark:text-black px-1.5 py-0.5 text-[11px] font-black uppercase tracking-wider">
                  GEMINI
                </span>
              </div>
              <p className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-400 uppercase tracking-wider">
                Especialista en Márgenes, Comisiones de ML y Tributación DGI
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setMessages(messages.slice(0, 1))}
              title="Limpiar conversación"
              className="size-8 rounded border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:text-black dark:hover:text-white flex items-center justify-center transition-colors cursor-pointer"
            >
              <Trash2 className="size-3.5" />
            </button>
            <button
              type="button"
              aria-label="Cerrar"
              onClick={onClose}
              className="size-8 rounded border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:text-black dark:hover:text-white flex items-center justify-center transition-colors cursor-pointer"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        {/* Model Bar & Live Context Ribbon */}
        <div className="px-6 py-2.5 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/30 flex flex-wrap items-center justify-between gap-3 text-xs">
          {/* Model picker */}
          <div className="flex items-center gap-2">
            <span className="text-zinc-600 dark:text-zinc-400 text-[11px] font-black uppercase tracking-wider">MODELO:</span>
            <select
              aria-label="Modelo de inteligencia artificial"
              value={selectedModel}
              onChange={(e) => handleModelChange(e.target.value)}
              className="h-8 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 text-xs font-bold text-zinc-800 dark:text-zinc-200 outline-none focus:border-black dark:focus:border-white cursor-pointer"
            >
              {MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>

            {selectedModel === "gemini-3.1-pro-preview" && (
              <label className="flex items-center gap-1.5 ml-2 cursor-pointer text-black dark:text-white font-black text-[11px] uppercase tracking-wider">
                <input
                  type="checkbox"
                  checked={enableThinking}
                  onChange={(e) => setEnableThinking(e.target.checked)}
                  className="size-3.5 rounded border-black dark:border-white accent-black"
                />
                <span>High Thinking</span>
              </label>
            )}
          </div>

          {/* Current product badge */}
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
            <span>SIMULANDO:</span>
            <span className="text-black dark:text-white truncate max-w-[150px]">
              {inputs.productName || inputs.query || "Producto"}
            </span>
            <span className="num font-black text-black dark:text-white">
              VENTA {formatUyu(inputs.salePrice)}
            </span>
          </div>
        </div>

        {/* Message Thread */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {messages.map((m) => (
            <div
              key={m.id}
              className={`flex flex-col ${m.role === "user" ? "items-end" : "items-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-md p-4 text-xs sm:text-sm leading-relaxed ${
                  m.role === "user"
                    ? "bg-black text-white dark:bg-white dark:text-black font-semibold shadow-sm"
                    : "bg-[#fafafa] dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 border border-zinc-200 dark:border-zinc-800 whitespace-pre-line"
                }`}
              >
                {m.content}
              </div>

              {m.modelUsed && (
                <div className="flex items-center gap-1.5 mt-1 text-[11px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 px-1">
                  <span>Generado con {m.modelUsed}</span>
                  {m.thinkingMode && (
                    <span className="text-black dark:text-white font-black">
                      · High Thinking
                    </span>
                  )}
                </div>
              )}
            </div>
          ))}

          {loading && (
            <div className="flex items-center gap-2 text-xs font-bold text-zinc-500 dark:text-zinc-400 p-2 uppercase tracking-wider">
              <Loader2 className="size-4 animate-spin text-black dark:text-white" />
              <span>
                {selectedModel === "gemini-3.1-pro-preview" && enableThinking
                  ? "Pensando y analizando escenarios financieros..."
                  : "Generando recomendación..."}
              </span>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Suggested Prompt Chips */}
        {messages.length <= 2 && (
          <div className="px-6 py-2 border-t border-zinc-100 dark:border-zinc-900 flex flex-wrap gap-1.5">
            {QUICK_QUESTIONS.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => handleSend(q)}
                disabled={loading}
                className="rounded border border-zinc-200 dark:border-zinc-800 bg-[#fafafa] dark:bg-zinc-900 px-2.5 py-1 text-[11px] font-semibold text-zinc-700 dark:text-zinc-300 hover:border-black hover:text-black dark:hover:border-white dark:hover:text-white transition-colors cursor-pointer text-left"
              >
                {q}
              </button>
            ))}
          </div>
        )}

        {/* Input Bar */}
        <div className="p-4 border-t border-zinc-200 dark:border-zinc-800 bg-[#fafafa] dark:bg-zinc-900/50">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
            className="flex items-center gap-2"
          >
            <input
              type="text"
              aria-label="Tu pregunta para el copiloto"
              placeholder="Preguntale al asesor sobre márgenes, precios o impuestos DGI..."
              value={inputPrompt}
              onChange={(e) => setInputPrompt(e.target.value)}
              disabled={loading}
              className="flex-1 h-12 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 text-xs sm:text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-500 dark:placeholder:text-zinc-400 outline-none focus:border-black dark:focus:border-white focus:ring-1 focus:ring-black dark:focus:ring-white"
            />
            <button
              type="submit"
              disabled={loading || !inputPrompt.trim()}
              className="size-12 rounded-md bg-black hover:bg-zinc-800 text-white dark:bg-white dark:text-black dark:hover:bg-zinc-200 flex items-center justify-center transition-all cursor-pointer shadow-sm disabled:opacity-40 disabled:pointer-events-none active:scale-95 shrink-0"
            >
              <Send className="size-4" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
