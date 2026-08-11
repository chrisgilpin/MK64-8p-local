/**
 * O2R / zip texture catalogue + N64 texture decode for the picker.
 * OTEX layout (LUS): 64-byte header, then type:u32, width:u32, height:u32, dataSize:u32, pixels.
 * Magic is 'OTEX' as little-endian u32 at offset 4 (bytes often appear as XETO).
 */

import { unzipSync } from 'fflate';
import type { TextureRef } from '../model/types';

export type TextureType =
  | 'RGBA32'
  | 'RGBA16'
  | 'CI4'
  | 'CI8'
  | 'I4'
  | 'I8'
  | 'IA4'
  | 'IA8'
  | 'IA16'
  | 'unknown';

/** Matches libultraship TextureType. */
const TYPE_MAP: Record<number, TextureType> = {
  1: 'RGBA32',
  2: 'RGBA16',
  3: 'CI4',
  4: 'CI8',
  5: 'I4',
  6: 'I8',
  7: 'IA4',
  8: 'IA8',
  9: 'IA16',
};

export type CatalogEntry = {
  path: string;
  width: number;
  height: number;
  type: TextureType;
  bpp: number;
  /** Byte offset of pixel data in the resource. */
  dataOffset: number;
  pickerFriendly: boolean;
  /** Short label for UI. */
  label: string;
};

export type O2rCatalog = {
  textures: CatalogEntry[];
  entryCount: number;
  /** path → full resource bytes (for lazy thumbnail decode). */
  blobs: Map<string, Uint8Array>;
};

function bppFor(type: TextureType): number {
  switch (type) {
    case 'RGBA32':
      return 32;
    case 'RGBA16':
    case 'IA16':
      return 16;
    case 'I8':
    case 'IA8':
    case 'CI8':
      return 8;
    case 'I4':
    case 'IA4':
    case 'CI4':
      return 4;
    default:
      return 16;
  }
}

function isPickerFriendly(type: TextureType): boolean {
  return (
    type === 'RGBA16' ||
    type === 'RGBA32' ||
    type === 'I4' ||
    type === 'I8' ||
    type === 'IA4' ||
    type === 'IA8' ||
    type === 'IA16'
  );
}

function isPow2(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0;
}

function labelFromPath(path: string): string {
  const base = path.split('/').pop() ?? path;
  return base.replace(/^gTexture/i, '').replace(/_/g, ' ');
}

/**
 * Parse a single texture resource body (64-byte OTR header + type/w/h/size).
 */
export function parseTextureResource(
  path: string,
  data: Uint8Array,
): CatalogEntry | null {
  if (data.length < 80) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  // Magic OTEX as LE u32 at offset 4
  const magic = view.getUint32(4, true);
  if (magic !== 0x4f544558) {
    // Also accept raw string scan
    const s = String.fromCharCode(data[4], data[5], data[6], data[7]);
    if (s !== 'OTEX' && s !== 'XETO') return null;
  }

  const base = 64;
  const typeId = view.getUint32(base, true);
  const width = view.getUint32(base + 4, true);
  const height = view.getUint32(base + 8, true);
  const dataSize = view.getUint32(base + 12, true);
  if (width <= 0 || width > 2048 || height <= 0 || height > 2048) return null;

  const type = TYPE_MAP[typeId] ?? 'unknown';
  const dataOffset = 80;
  if (dataOffset + dataSize > data.length + 16) {
    // still try if pixels fit
  }
  const expected = (width * height * bppFor(type)) / 8;
  const okSize =
    data.length - dataOffset >= Math.min(expected, dataSize || expected) * 0.9;

  return {
    path,
    width,
    height,
    type,
    bpp: bppFor(type),
    dataOffset,
    pickerFriendly:
      isPickerFriendly(type) && isPow2(width) && isPow2(height) && okSize,
    label: labelFromPath(path),
  };
}

export function catalogFromZip(bytes: Uint8Array): O2rCatalog {
  const files = unzipSync(bytes);
  const textures: CatalogEntry[] = [];
  const blobs = new Map<string, Uint8Array>();
  let entryCount = 0;

  for (const [name, data] of Object.entries(files)) {
    entryCount++;
    if (!name.startsWith('textures/')) continue;
    if (name.endsWith('.xml') || name.endsWith('.json')) continue;
    // Skip TLUT / palette-only helpers
    if (/TLUT|Palette|gTLUT/i.test(name)) continue;

    const entry = parseTextureResource(name, data);
    if (entry) {
      textures.push(entry);
      blobs.set(name, data);
    }
  }

  textures.sort((a, b) => a.path.localeCompare(b.path));
  return { textures, entryCount, blobs };
}

export function decodeRgba16(
  raw: Uint8Array,
  width: number,
  height: number,
  dataOffset = 0,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4);
  let si = dataOffset;
  let di = 0;
  for (let i = 0; i < width * height; i++) {
    const hi = raw[si++] ?? 0;
    const lo = raw[si++] ?? 0;
    // N64 RGBA16 is big-endian in ROM; LUS host extract often stores native.
    // Try BE first (common for N64 assets); if looks wrong user can still pick.
    const px = (hi << 8) | lo;
    const r = ((px >> 11) & 0x1f) * 8;
    const g = ((px >> 6) & 0x1f) * 8;
    const b = ((px >> 1) & 0x1f) * 8;
    const a = px & 1 ? 255 : 0;
    out[di++] = r;
    out[di++] = g;
    out[di++] = b;
    out[di++] = a;
  }
  return out;
}

export function decodeRgba32(
  raw: Uint8Array,
  width: number,
  height: number,
  dataOffset = 0,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4);
  let si = dataOffset;
  for (let i = 0; i < width * height * 4; i++) {
    out[i] = raw[si++] ?? 0;
  }
  return out;
}

export function decodeI8(
  raw: Uint8Array,
  width: number,
  height: number,
  dataOffset = 0,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4);
  let si = dataOffset;
  let di = 0;
  for (let i = 0; i < width * height; i++) {
    const v = raw[si++] ?? 0;
    out[di++] = v;
    out[di++] = v;
    out[di++] = v;
    out[di++] = 255;
  }
  return out;
}

export function decodeI4(
  raw: Uint8Array,
  width: number,
  height: number,
  dataOffset = 0,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4);
  let si = dataOffset;
  let di = 0;
  for (let i = 0; i < width * height; i += 2) {
    const byte = raw[si++] ?? 0;
    const a = (byte >> 4) * 17;
    const b = (byte & 0xf) * 17;
    out[di++] = a;
    out[di++] = a;
    out[di++] = a;
    out[di++] = 255;
    if (i + 1 < width * height) {
      out[di++] = b;
      out[di++] = b;
      out[di++] = b;
      out[di++] = 255;
    }
  }
  return out;
}

export function decodeIa16(
  raw: Uint8Array,
  width: number,
  height: number,
  dataOffset = 0,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4);
  let si = dataOffset;
  let di = 0;
  for (let i = 0; i < width * height; i++) {
    const i8 = raw[si++] ?? 0;
    const a8 = raw[si++] ?? 255;
    out[di++] = i8;
    out[di++] = i8;
    out[di++] = i8;
    out[di++] = a8;
  }
  return out;
}

export function decodeIa8(
  raw: Uint8Array,
  width: number,
  height: number,
  dataOffset = 0,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4);
  let si = dataOffset;
  let di = 0;
  for (let i = 0; i < width * height; i++) {
    const byte = raw[si++] ?? 0;
    const inten = (byte >> 4) * 17;
    const alpha = (byte & 0xf) * 17;
    out[di++] = inten;
    out[di++] = inten;
    out[di++] = inten;
    out[di++] = alpha;
  }
  return out;
}

export function decodeTexturePixels(
  entry: CatalogEntry,
  blob: Uint8Array,
): Uint8ClampedArray | null {
  const { width, height, type, dataOffset } = entry;
  try {
    switch (type) {
      case 'RGBA16':
        return decodeRgba16(blob, width, height, dataOffset);
      case 'RGBA32':
        return decodeRgba32(blob, width, height, dataOffset);
      case 'I8':
        return decodeI8(blob, width, height, dataOffset);
      case 'I4':
        return decodeI4(blob, width, height, dataOffset);
      case 'IA16':
        return decodeIa16(blob, width, height, dataOffset);
      case 'IA8':
        return decodeIa8(blob, width, height, dataOffset);
      default:
        return null;
    }
  } catch {
    return null;
  }
}

/** Build a small data-URL thumbnail (cached by caller). */
export function textureToDataUrl(
  entry: CatalogEntry,
  blob: Uint8Array,
  maxSize = 64,
): string | null {
  const pixels = decodeTexturePixels(entry, blob);
  if (!pixels) return null;
  const canvas = document.createElement('canvas');
  canvas.width = entry.width;
  canvas.height = entry.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const img = new ImageData(pixels, entry.width, entry.height);
  ctx.putImageData(img, 0, 0);

  if (entry.width > maxSize || entry.height > maxSize) {
    const scale = Math.min(maxSize / entry.width, maxSize / entry.height);
    const w = Math.max(1, Math.round(entry.width * scale));
    const h = Math.max(1, Math.round(entry.height * scale));
    const c2 = document.createElement('canvas');
    c2.width = w;
    c2.height = h;
    const ctx2 = c2.getContext('2d');
    if (!ctx2) return canvas.toDataURL('image/png');
    ctx2.imageSmoothingEnabled = false;
    ctx2.drawImage(canvas, 0, 0, w, h);
    return c2.toDataURL('image/png');
  }
  return canvas.toDataURL('image/png');
}

export function filterPickerTextures(catalog: O2rCatalog): CatalogEntry[] {
  return catalog.textures.filter((t) => {
    if (!t.pickerFriendly) return false;
    if (t.path.includes('/karts/')) return false;
    if (t.path.includes('texture_animation')) return false;
    if (t.path.includes('textures/other_textures')) return true;
    if (t.path.includes('textures/tracks/')) return true;
    if (t.path.includes('textures/common')) return true;
    return true;
  });
}

export function entryToTextureRef(entry: CatalogEntry): TextureRef {
  return {
    path: entry.path,
    width: entry.width,
    height: entry.height,
    bpp: entry.bpp,
  };
}
