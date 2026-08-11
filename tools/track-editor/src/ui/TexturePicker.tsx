import { useEffect, useMemo, useRef, useState } from 'react';
import type { TextureRef } from '../model/types';
import {
  entryToTextureRef,
  textureToDataUrl,
  type CatalogEntry,
  type O2rCatalog,
} from '../o2r/readO2r';

type Props = {
  label: string;
  value: TextureRef;
  catalog: O2rCatalog | null;
  /** Pre-filtered list if parent already filtered. */
  entries?: CatalogEntry[];
  onChange: (tex: TextureRef) => void;
};

/**
 * Compact control showing the current texture + a modal browser with
 * searchable thumbnails decoded from the loaded mk64.o2r.
 */
export function TexturePicker({
  label,
  value,
  catalog,
  entries: entriesProp,
  onChange,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [thumb, setThumb] = useState<string | null>(null);
  const cacheRef = useRef<Map<string, string>>(new Map());

  const entries = useMemo(() => {
    if (entriesProp) return entriesProp;
    if (!catalog) return [];
    return catalog.textures.filter((t) => t.pickerFriendly);
  }, [catalog, entriesProp]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      (e) =>
        e.path.toLowerCase().includes(q) || e.label.toLowerCase().includes(q),
    );
  }, [entries, query]);

  // Current selection thumbnail
  useEffect(() => {
    if (!catalog) {
      setThumb(null);
      return;
    }
    const hit = catalog.textures.find((t) => t.path === value.path);
    const blob = catalog.blobs.get(value.path);
    if (!hit || !blob) {
      setThumb(null);
      return;
    }
    const cached = cacheRef.current.get(value.path);
    if (cached) {
      setThumb(cached);
      return;
    }
    const url = textureToDataUrl(hit, blob, 48);
    if (url) {
      cacheRef.current.set(value.path, url);
      setThumb(url);
    } else setThumb(null);
  }, [catalog, value.path]);

  const shortName = value.path.split('/').pop() ?? value.path;

  return (
    <div className="tex-picker">
      <div className="tex-picker-label">{label}</div>
      <button
        type="button"
        className="tex-picker-current"
        onClick={() => setOpen(true)}
        title={value.path}
      >
        <span className="tex-picker-swatch">
          {thumb ? (
            <img src={thumb} alt="" width={40} height={40} />
          ) : (
            <span className="tex-picker-missing">?</span>
          )}
        </span>
        <span className="tex-picker-meta">
          <span className="tex-picker-name">{shortName}</span>
          <span className="tex-picker-path">
            {catalog
              ? `${value.width}×${value.height}`
              : 'Load mk64.o2r for previews'}
          </span>
        </span>
        <span className="tex-picker-action">Browse…</span>
      </button>

      {open && (
        <div
          className="tex-modal-backdrop"
          role="presentation"
          onClick={() => setOpen(false)}
        >
          <div
            className="tex-modal"
            role="dialog"
            aria-label={`Choose ${label}`}
            onClick={(e) => e.stopPropagation()}
          >
            <header className="tex-modal-head">
              <h3>Choose texture — {label}</h3>
              <button type="button" onClick={() => setOpen(false)}>
                Close
              </button>
            </header>
            {!catalog && (
              <p className="hint">
                Load <strong>mk64.o2r</strong> (header button) first so textures
                can be listed and previewed.
              </p>
            )}
            <input
              className="tex-search"
              type="search"
              placeholder="Search (grass, road, sand, brick…)"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
            <p className="hint">
              {filtered.length} texture{filtered.length === 1 ? '' : 's'}
              {query ? ' matching' : ''} · click a tile to apply
            </p>
            <div className="tex-grid">
              {filtered.map((entry) => (
                <TextureTile
                  key={entry.path}
                  entry={entry}
                  selected={entry.path === value.path}
                  catalog={catalog}
                  cache={cacheRef.current}
                  onPick={() => {
                    onChange(entryToTextureRef(entry));
                    setOpen(false);
                  }}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TextureTile({
  entry,
  selected,
  catalog,
  cache,
  onPick,
}: {
  entry: CatalogEntry;
  selected: boolean;
  catalog: O2rCatalog | null;
  cache: Map<string, string>;
  onPick: () => void;
}) {
  const [src, setSrc] = useState<string | null>(
    () => cache.get(entry.path) ?? null,
  );
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (src || !catalog) return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (obs) => {
        if (!obs[0]?.isIntersecting) return;
        io.disconnect();
        const blob = catalog.blobs.get(entry.path);
        if (!blob) return;
        const url = textureToDataUrl(entry, blob, 64);
        if (url) {
          cache.set(entry.path, url);
          setSrc(url);
        }
      },
      { rootMargin: '120px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [src, catalog, entry, cache]);

  return (
    <button
      ref={ref}
      type="button"
      className={`tex-tile${selected ? ' selected' : ''}`}
      onClick={onPick}
      title={entry.path}
    >
      <span className="tex-tile-img">
        {src ? (
          <img src={src} alt="" />
        ) : (
          <span className="tex-tile-ph">…</span>
        )}
      </span>
      <span className="tex-tile-name">{entry.label}</span>
    </button>
  );
}
