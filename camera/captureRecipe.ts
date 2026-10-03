/**
 * Builds the non-destructive recipe stored with a captured photo: aspect-ratio
 * framing and digital zoom become a geometry.crop, selfie mirroring becomes
 * geometry.flipH, and software corrections (exposure/WB) are recipe values.
 * The original captured bytes are never altered.
 */

import { defaultRecipe, type CropRect, type EditRecipe } from "@/types/edit";
import { aspectCropRect, type AspectRatioChoice } from "./capture";

/** Centered crop for a digital (software) zoom factor; null at 1×. */
export function digitalZoomCrop(zoom: number): CropRect | null {
  if (!(zoom > 1.001)) return null;
  const s = 1 / zoom;
  return { x: (1 - s) / 2, y: (1 - s) / 2, width: s, height: s };
}

/** Compose an inner crop (relative to `outer`) into image-normalized coordinates. */
export function composeCrop(outer: CropRect | null, inner: CropRect | null): CropRect | null {
  if (!outer) return inner;
  if (!inner) return outer;
  return {
    x: outer.x + inner.x * outer.width,
    y: outer.y + inner.y * outer.height,
    width: inner.width * outer.width,
    height: inner.height * outer.height,
  };
}

export interface CaptureRecipeInput {
  width: number;
  height: number;
  aspect: AspectRatioChoice;
  digitalZoom: number;
  mirror: boolean;
  /** Recipe holding software corrections (light/color); geometry is overwritten here. */
  corrections?: EditRecipe | null;
}

export function buildCaptureRecipe(input: CaptureRecipeInput): EditRecipe {
  const recipe = input.corrections ? structuredClone(input.corrections) : defaultRecipe();
  const zoomCrop = digitalZoomCrop(input.digitalZoom);
  const zw = input.width * (zoomCrop?.width ?? 1);
  const zh = input.height * (zoomCrop?.height ?? 1);
  const aspectCrop = aspectCropRect(Math.round(zw), Math.round(zh), input.aspect);
  let crop = composeCrop(zoomCrop, aspectCrop);
  // The crop is defined on the unmirrored image; flipping mirrors it about the centre, which is symmetric here.
  if (crop) crop = { x: round6(crop.x), y: round6(crop.y), width: round6(crop.width), height: round6(crop.height) };
  recipe.geometry = { ...recipe.geometry, crop, flipH: input.mirror };
  return recipe;
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
