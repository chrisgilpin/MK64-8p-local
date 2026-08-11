import type { TextureRef, Vec3 } from '../model/types';
import { CLIP, LAYER, UP_NORMAL, VTX_BATCH } from './constants';

export type MeshVertex = {
  x: number;
  y: number;
  z: number;
  s: number;
  t: number;
};

export type Triangle = { v: [MeshVertex, MeshVertex, MeshVertex] };

export type MeshResources = {
  files: [string, string][];
  gfxPath: string;
  vertexCount: number;
  triangleCount: number;
};

const log2 = (n: number) => Math.round(Math.log2(n));

export function materialXml(
  _name: string,
  tex: TextureRef,
  opts: { translucent?: boolean } = {},
): string {
  const line = (tex.width * tex.bpp) / 8 / 8;
  const lrs = tex.width * tex.height - 1;
  const renderMode = opts.translucent
    ? 'Mode1="G_RM_AA_ZB_XLU_SURF" Mode2="G_RM_AA_ZB_XLU_SURF2"'
    : 'Mode1="G_RM_PASS" Mode2="G_RM_AA_ZB_OPA_SURF2"';
  const primA = opts.translucent ? 180 : 255;
  return `<DisplayList Version="0">
\t<SetGeometryMode G_FOG="1" />
\t<ClearGeometryMode G_CLIPPING="1" />
\t<ClearGeometryMode G_CULL_BOTH="1" />
\t<PipeSync/>
\t<SetCombineLERP A0="G_CCMUX_TEXEL0" B0="G_CCMUX_0" C0="G_CCMUX_SHADE" D0="G_CCMUX_0" Aa0="G_ACMUX_0" Ab0="G_ACMUX_0" Ac0="G_ACMUX_0" Ad0="G_ACMUX_1" A1="G_CCMUX_COMBINED" B1="G_CCMUX_0" C1="G_CCMUX_PRIMITIVE" D1="G_CCMUX_0" Aa1="G_ACMUX_0" Ab1="G_ACMUX_0" Ac1="G_ACMUX_0" Ad1="G_ACMUX_COMBINED"/>
\t<SetRenderMode ${renderMode} />
\t<Texture S="65535" T="65535" Level="0" Tile="0" On="1"/>
\t<SetPrimColor M="0" L="0" R="255" G="255" B="255" A="${primA}"/>
\t<SetTextureImage Path="${tex.path}" Format="G_IM_FMT_RGBA" Size="G_IM_SIZ_16b_LOAD_BLOCK" Width="1"/>
\t<SetTile Format="G_IM_FMT_RGBA" Size="G_IM_SIZ_16b_LOAD_BLOCK" Line="0" TMem="0" Tile="7" Palette="0" Cms0="G_TX_WRAP" Cms1="G_TX_NOMIRROR" Cmt0="G_TX_WRAP" Cmt1="G_TX_NOMIRROR" MaskS="0" ShiftS="0" MaskT="0" ShiftT="0"/>
\t<LoadBlock Tile="7" Uls="0" Ult="0" Lrs="${lrs}" Dxt="256"/>
\t<SetTile Format="G_IM_FMT_RGBA" Size="G_IM_SIZ_16b" Line="${line}" TMem="0" Tile="0" Palette="0" Cms0="G_TX_WRAP" Cms1="G_TX_NOMIRROR" Cmt0="G_TX_WRAP" Cmt1="G_TX_NOMIRROR" MaskS="${log2(tex.width)}" ShiftS="0" MaskT="${log2(tex.height)}" ShiftT="0"/>
\t<SetTileSize T="0" Uls="0" Ult="0" Lrs="${(tex.width - 1) << 2}" Lrt="${(tex.height - 1) << 2}"/>
\t<EndDisplayList/>
</DisplayList>`;
}

export function materialRevertXml(): string {
  return `<DisplayList Version="0">
\t<ClearGeometryMode G_FOG="1" />
\t<SetGeometryMode G_CLIPPING="1" />
\t<PipeSync/>
\t<EndDisplayList/>
</DisplayList>`;
}

/**
 * Emit vertex array + triangle DLs chunked to F3DEX's 32-vertex cache.
 * Vertices are not shared across triangles (correctness first).
 */
export function meshToResources(
  dir: string,
  name: string,
  tris: Triangle[],
  tex: TextureRef,
  opts: { translucent?: boolean } = {},
): MeshResources {
  const verts: MeshVertex[] = [];
  const batches: { offset: number; count: number; tris: number }[] = [];
  const trisPerBatch = Math.floor(VTX_BATCH / 3);

  for (let i = 0; i < tris.length; i += trisPerBatch) {
    const chunk = tris.slice(i, i + trisPerBatch);
    const base = verts.length;
    for (const t of chunk) verts.push(...t.v);
    batches.push({ offset: base, count: chunk.length * 3, tris: chunk.length });
  }

  const { r, g, b, a } = UP_NORMAL;
  const vtxXml = [
    '<Vertex Version="0">',
    ...verts.map(
      (v) =>
        `\t<Vtx X="${Math.round(v.x)}" Y="${Math.round(v.y)}" Z="${Math.round(v.z)}" S="${Math.round(v.s)}" T="${Math.round(v.t)}" R="${r}" G="${g}" B="${b}" A="${a}"/>`,
    ),
    '</Vertex>',
  ].join('\n');

  const triLines = ['<DisplayList Version="0">'];
  for (const batch of batches) {
    if (batch.count > VTX_BATCH) {
      throw new Error(`batch count ${batch.count} exceeds F3DEX limit ${VTX_BATCH}`);
    }
    triLines.push(
      `\t<LoadVertices Path="${dir}/${name}_vtx_0" VertexBufferIndex="0" VertexOffset="${batch.offset}" Count="${batch.count}"/>`,
    );
    let t = 0;
    while (t + 1 < batch.tris) {
      const a0 = t * 3;
      const c0 = (t + 1) * 3;
      triLines.push(
        `\t<Triangles2 V00="${a0}" V01="${a0 + 1}" V02="${a0 + 2}" Flag0="0" V10="${c0}" V11="${c0 + 1}" V12="${c0 + 2}" Flag1="0"/>`,
      );
      t += 2;
    }
    if (t < batch.tris) {
      const a0 = t * 3;
      triLines.push(
        `\t<Triangle1 V00="${a0}" V01="${a0 + 1}" V02="${a0 + 2}" Flag0="0"/>`,
      );
    }
  }
  triLines.push('\t<EndDisplayList/>', '</DisplayList>');

  const rootXml = `<DisplayList Version="0">
\t<ClearGeometryMode G_LIGHTING="1" />
\t<SetGeometryMode G_LIGHTING="1" />
\t<CallDisplayList Path="${dir}/mat_${name}"/>
\t<CallDisplayList Path="${dir}/${name}_tri_0"/>
\t<CallDisplayList Path="${dir}/mat_revert_${name}"/>
\t<EndDisplayList/>
</DisplayList>`;

  return {
    files: [
      [`${dir}/${name}_vtx_0`, vtxXml],
      [`${dir}/${name}_tri_0`, triLines.join('\n')],
      [`${dir}/${name}_mesh`, rootXml],
      [`${dir}/mat_${name}`, materialXml(name, tex, opts)],
      [`${dir}/mat_revert_${name}`, materialRevertXml()],
    ],
    gfxPath: `${dir}/${name}_mesh`,
    vertexCount: verts.length,
    triangleCount: tris.length,
  };
}

export type SectionRow = {
  gfx: string;
  surface: number;
  clip: number;
  layer: number;
};

export function sectionsXml(sections: SectionRow[]): string {
  return [
    '<TrackSections XMLSucks="1">',
    ...sections.map(
      (s) =>
        `\t<Section gfx_path="${s.gfx}" surface="${s.surface}" section="0xff" flags="${s.clip}" drawlayer="${s.layer}" x="0" y="0" z="0" />`,
    ),
    '</TrackSections>',
  ].join('\n');
}

export function pathsXml(points: Vec3[]): string {
  return [
    '<Paths XMLSucks="1">',
    '\t<TrackWaypoint>',
    ...points.map(
      (p) =>
        `\t\t<Point X="${Math.round(p.x)}" Y="${Math.round(p.y)}" Z="${Math.round(p.z)}" ID="0"/>`,
    ),
    '\t\t<Point X="-32768" Y="-32768" Z="-32768" ID="0"/>',
    '\t</TrackWaypoint>',
    '</Paths>',
  ].join('\n');
}

export { CLIP, LAYER };
