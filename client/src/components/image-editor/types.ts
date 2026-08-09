export interface InitialDesignStateLayer {
  layerId?: string;
  name?: string;
  selected?: boolean;
  rotation?: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  scaleX?: number;
  scaleY?: number;
  settings?: { originalDpi?: number; [k: string]: unknown } | null;
  asset?: { url?: string; key?: string; mimeType?: string; source?: string } | null;
}

export interface InitialDesignState {
  designId?: string | null;
  version?: number | string | null;
  shop?: string | null;
  references?: { productVariantId?: string | null } | null;
  canvas?: { artboardWidthInches?: number; artboardHeightInches?: number; width?: number; height?: number } | null;
  settings?: { quantity?: number; designGap?: number } | null;
  layers?: InitialDesignStateLayer[] | null;
  gangsheet?: { size?: string } | null;
  gangsheetSize?: string;
  production?: { url?: string | null; key?: string | null; previewUrl?: string | null } | null;
}

import type { ProfileConfig } from "@/lib/profiles";
import type { DesignItem } from "@/lib/types";

/**
 * One gangsheet in the session. A customer can build several at once and
 * download them together, so designs and sheet height belong to a sheet
 * rather than to the editor.
 */
export interface SheetState {
  id: string;
  name: string;
  designs: DesignItem[];
  artboardHeight: number;
}

/** Sheets a customer can hold open at once. */
export const MAX_SHEETS = 10;

export interface ImageEditorProps {
  onDesignUploaded?: () => void;
  profile?: ProfileConfig;
  initialWidth?: number;
  initialHeight?: number;
  initialGangsheetHeights?: number[];
  initialQuantity?: number;
  shopifyVariants?: Array<{ id: string; title: string; price: string | null; height: number | null }>;
  variantId?: string | null;
  shopDomain?: string | null;
  embedFromShopify?: boolean;
  initialDesignState?: InitialDesignState | null;
  initialDesignId?: string | null;
  isEditMode?: boolean;
}
