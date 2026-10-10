import { useState } from "react";
import { TrendingUp } from "lucide-react";
import { displayableProductImage } from "@/lib/productImage";

interface ProductThumbProps {
  /** Foto del producto en análisis. Lo que no sea una dirección conocida o la miniatura local se descarta. */
  image: string | null | undefined;
  /** Nombre del producto, para el texto alternativo. Vacío = imagen decorativa. */
  name: string;
}

/**
 * Cuadro a la izquierda del producto en el resumen: la foto si hay una que se pueda mostrar, o el icono de siempre.
 * El cuadro mide lo mismo con foto o sin ella, así el resumen no salta.
 */
export function ProductThumb({ image, name }: ProductThumbProps) {
  const src = displayableProductImage(image);
  // Foto que no cargó: vuelve al icono. Se recuerda por dirección, así una foto nueva se intenta de nuevo.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showImage = src !== null && src !== failedSrc;

  return (
    <div
      data-product-thumb={showImage ? "image" : "icon"}
      className={`flex size-11 sm:size-14 shrink-0 items-center justify-center overflow-hidden shadow-sm ${
        showImage
          ? "border border-zinc-300 dark:border-zinc-700 bg-white"
          : "bg-black text-white dark:bg-white dark:text-black"
      }`}
    >
      {showImage ? (
        <img
          src={src}
          alt={name ? `Foto de ${name}` : ""}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailedSrc(src)}
          className="size-full object-contain"
        />
      ) : (
        <TrendingUp className="size-6 sm:size-7" aria-hidden />
      )}
    </div>
  );
}
