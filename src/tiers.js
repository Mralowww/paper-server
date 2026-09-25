const TIERS = [
  { id: 'HT1', points: 60 },
  { id: 'LT1', points: 45 },
  { id: 'HT2', points: 30 },
  { id: 'LT2', points: 20 },
  { id: 'HT3', points: 10 },
  { id: 'LT3', points: 6 },
  { id: 'HT4', points: 4 },
  { id: 'LT4', points: 3 },
  { id: 'HT5', points: 2 },
  { id: 'LT5', points: 1 },
];

const REGIONS = [
  { id: 'AS', name: 'Asia' },
  { id: 'NA', name: 'North America' },
  { id: 'EU', name: 'Europe' },
  { id: 'SA', name: 'South America' },
  { id: 'OC', name: 'Oceania' },
  { id: 'AF', name: 'Africa' },
];

const MODES = [{ id: 'vanilla', name: 'Vanilla' }];

const TIER_POINTS = Object.fromEntries(TIERS.map((t) => [t.id, t.points]));
const REGION_IDS = new Set(REGIONS.map((r) => r.id));

module.exports = { TIERS, REGIONS, MODES, TIER_POINTS, REGION_IDS };
