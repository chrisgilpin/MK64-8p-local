/** Placeable props that RegisterActors / HM64 Labs understand. */

export type ActorPaletteEntry = {
  name: string;
  label: string;
  category: 'item' | 'foliage' | 'obstacle' | 'sign';
  /** Marker colour in the 2D layout. */
  color: string;
  /** Short glyph for the map. */
  glyph: string;
};

export const ACTOR_PALETTE: ActorPaletteEntry[] = [
  { name: 'mk:item_box', label: 'Item Box', category: 'item', color: '#6cf', glyph: '□' },
  { name: 'mk:fake_item_box', label: 'Fake Item Box', category: 'item', color: '#f66', glyph: '□' },
  {
    name: 'mk:tree_mario_raceway',
    label: 'Tree (Mario Raceway)',
    category: 'foliage',
    color: '#3a8',
    glyph: '♣',
  },
  {
    name: 'mk:tree_luigi_raceway',
    label: 'Tree (Luigi Raceway)',
    category: 'foliage',
    color: '#2a6',
    glyph: '♣',
  },
  {
    name: 'mk:tree_royal_raceway',
    label: 'Tree (Royal Raceway)',
    category: 'foliage',
    color: '#4b7',
    glyph: '♣',
  },
  {
    name: 'mk:tree_yoshi_valley',
    label: 'Tree (Yoshi Valley)',
    category: 'foliage',
    color: '#5c5',
    glyph: '♣',
  },
  {
    name: 'mk:tree_moo_moo_farm',
    label: 'Tree (Moo Moo Farm)',
    category: 'foliage',
    color: '#6a4',
    glyph: '♣',
  },
  {
    name: 'mk:tree_peach_castle',
    label: 'Tree (Peach Castle)',
    category: 'foliage',
    color: '#383',
    glyph: '♣',
  },
  {
    name: 'mk:tree_frappe_snowland',
    label: 'Tree (Frappe Snowland)',
    category: 'foliage',
    color: '#9bd',
    glyph: '♣',
  },
  { name: 'mk:palm_tree', label: 'Palm Tree', category: 'foliage', color: '#2a5', glyph: '♣' },
  {
    name: 'mk:bush_bowsers_castle',
    label: 'Bush (Bowser)',
    category: 'foliage',
    color: '#363',
    glyph: '▪',
  },
  {
    name: 'mk:cactus1_kalamari_desert',
    label: 'Cactus 1',
    category: 'foliage',
    color: '#6a3',
    glyph: '‡',
  },
  {
    name: 'mk:cactus2_kalamari_desert',
    label: 'Cactus 2',
    category: 'foliage',
    color: '#7b4',
    glyph: '‡',
  },
  {
    name: 'mk:cactus3_kalamari_desert',
    label: 'Cactus 3',
    category: 'foliage',
    color: '#8c5',
    glyph: '‡',
  },
  {
    name: 'mk:piranha_plant',
    label: 'Piranha Plant',
    category: 'obstacle',
    color: '#d35',
    glyph: '♠',
  },
  { name: 'mk:mario_sign', label: 'Mario Sign', category: 'sign', color: '#e55', glyph: 'T' },
  { name: 'mk:wario_sign', label: 'Wario Sign', category: 'sign', color: '#c8e', glyph: 'T' },
];

export function paletteEntry(name: string): ActorPaletteEntry | undefined {
  return ACTOR_PALETTE.find((e) => e.name === name);
}
