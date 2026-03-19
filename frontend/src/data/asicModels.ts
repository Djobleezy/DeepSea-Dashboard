/** ASIC miner models with efficiency (J/TH) and typical hashrate (TH/s).
 *  Kept in sync with backend _MINER_PATTERNS in worker_service.py.
 *  Last verified: 2026-03-19 from manufacturer specs + d-central.tech + asicminervalue.com */
export interface AsicModel {
  id: string;
  brand: string;
  model: string;
  efficiency: number;   // J/TH (joules per terahash)
  typicalThs: number;   // typical hashrate in TH/s
  cooling: 'air' | 'hydro' | 'immersion' | 'passive';
  year: number;         // release year
}

export const ASIC_MODELS: AsicModel[] = [
  // ══════════════════════════════════════════════════════════════════════════
  // Bitmain Antminer — S-series (performance) & T-series (value)
  // ══════════════════════════════════════════════════════════════════════════

  // S21 generation (BM1370 chip, 2024–2025)
  { id: 's21-xp-hyd',    brand: 'Bitmain',   model: 'Antminer S21 XP Hyd',     efficiency: 12.0,  typicalThs: 473,  cooling: 'hydro',     year: 2024 },
  { id: 's21-xp',        brand: 'Bitmain',   model: 'Antminer S21 XP',          efficiency: 13.5,  typicalThs: 270,  cooling: 'air',       year: 2024 },
  { id: 's21-pro',       brand: 'Bitmain',   model: 'Antminer S21 Pro',         efficiency: 15.0,  typicalThs: 234,  cooling: 'air',       year: 2024 },
  { id: 's21-plus',      brand: 'Bitmain',   model: 'Antminer S21+',            efficiency: 16.5,  typicalThs: 216,  cooling: 'air',       year: 2025 },
  { id: 's21-hyd',       brand: 'Bitmain',   model: 'Antminer S21 Hyd',         efficiency: 16.0,  typicalThs: 335,  cooling: 'hydro',     year: 2024 },
  { id: 's21',           brand: 'Bitmain',   model: 'Antminer S21',             efficiency: 17.5,  typicalThs: 200,  cooling: 'air',       year: 2024 },
  { id: 't21',           brand: 'Bitmain',   model: 'Antminer T21',             efficiency: 19.0,  typicalThs: 190,  cooling: 'air',       year: 2024 },

  // S19 generation (BM1397/BM1366/BM1368, 2020–2023)
  { id: 's19-xp',        brand: 'Bitmain',   model: 'Antminer S19 XP',          efficiency: 21.5,  typicalThs: 140,  cooling: 'air',       year: 2022 },
  { id: 's19k-pro',      brand: 'Bitmain',   model: 'Antminer S19k Pro',        efficiency: 23.0,  typicalThs: 120,  cooling: 'air',       year: 2023 },
  { id: 's19j-pro-plus', brand: 'Bitmain',   model: 'Antminer S19j Pro+',       efficiency: 22.0,  typicalThs: 122,  cooling: 'air',       year: 2023 },
  { id: 's19-pro-plus',  brand: 'Bitmain',   model: 'Antminer S19 Pro+',        efficiency: 23.0,  typicalThs: 120,  cooling: 'air',       year: 2022 },
  { id: 's19-pro-hyd',   brand: 'Bitmain',   model: 'Antminer S19 Pro+ Hyd',    efficiency: 27.5,  typicalThs: 198,  cooling: 'hydro',     year: 2022 },
  { id: 's19-pro',       brand: 'Bitmain',   model: 'Antminer S19 Pro',         efficiency: 29.5,  typicalThs: 110,  cooling: 'air',       year: 2020 },
  { id: 's19j-pro',      brand: 'Bitmain',   model: 'Antminer S19j Pro',        efficiency: 30.0,  typicalThs: 104,  cooling: 'air',       year: 2021 },
  { id: 's19j',          brand: 'Bitmain',   model: 'Antminer S19j',            efficiency: 34.5,  typicalThs:  90,  cooling: 'air',       year: 2021 },
  { id: 's19',           brand: 'Bitmain',   model: 'Antminer S19',             efficiency: 34.5,  typicalThs:  95,  cooling: 'air',       year: 2020 },

  // ══════════════════════════════════════════════════════════════════════════
  // MicroBT Whatsminer — M60/M66/M63 (current gen) & M50/M30 (previous)
  // ══════════════════════════════════════════════════════════════════════════

  // M66 series (immersion, 2024)
  { id: 'm66s-plus-plus', brand: 'MicroBT',  model: 'Whatsminer M66S++',        efficiency: 15.5,  typicalThs: 356,  cooling: 'immersion', year: 2024 },
  { id: 'm66s',          brand: 'MicroBT',   model: 'Whatsminer M66S',          efficiency: 18.5,  typicalThs: 290,  cooling: 'immersion', year: 2024 },
  { id: 'm66',           brand: 'MicroBT',   model: 'Whatsminer M66',           efficiency: 19.9,  typicalThs: 276,  cooling: 'immersion', year: 2024 },

  // M63 series (hydro, 2024)
  { id: 'm63s',          brand: 'MicroBT',   model: 'Whatsminer M63S',          efficiency: 16.5,  typicalThs: 390,  cooling: 'hydro',     year: 2024 },
  { id: 'm63',           brand: 'MicroBT',   model: 'Whatsminer M63',           efficiency: 17.5,  typicalThs: 336,  cooling: 'hydro',     year: 2024 },

  // M60 series (air-cooled, 2023–2024)
  { id: 'm60s',          brand: 'MicroBT',   model: 'Whatsminer M60S',          efficiency: 18.5,  typicalThs: 186,  cooling: 'air',       year: 2023 },
  { id: 'm60',           brand: 'MicroBT',   model: 'Whatsminer M60',           efficiency: 19.9,  typicalThs: 172,  cooling: 'air',       year: 2023 },

  // M56/M50 series (2022–2023)
  { id: 'm56s-plus',     brand: 'MicroBT',   model: 'Whatsminer M56S+',         efficiency: 22.0,  typicalThs: 230,  cooling: 'immersion', year: 2023 },
  { id: 'm50s-plus',     brand: 'MicroBT',   model: 'Whatsminer M50S+',         efficiency: 23.0,  typicalThs: 148,  cooling: 'air',       year: 2023 },
  { id: 'm50s',          brand: 'MicroBT',   model: 'Whatsminer M50S',          efficiency: 25.0,  typicalThs: 140,  cooling: 'air',       year: 2022 },
  { id: 'm50',           brand: 'MicroBT',   model: 'Whatsminer M50',           efficiency: 29.0,  typicalThs: 126,  cooling: 'air',       year: 2022 },

  // M30 series (2020–2021)
  { id: 'm30s-plus-plus', brand: 'MicroBT',  model: 'Whatsminer M30S++',        efficiency: 31.0,  typicalThs: 112,  cooling: 'air',       year: 2021 },
  { id: 'm30s-plus',     brand: 'MicroBT',   model: 'Whatsminer M30S+',         efficiency: 34.0,  typicalThs: 100,  cooling: 'air',       year: 2020 },
  { id: 'm30s',          brand: 'MicroBT',   model: 'Whatsminer M30S',          efficiency: 38.0,  typicalThs:  86,  cooling: 'air',       year: 2020 },

  // ══════════════════════════════════════════════════════════════════════════
  // Canaan Avalon — A16 (current gen) & A15 (previous)
  // ══════════════════════════════════════════════════════════════════════════
  { id: 'a16-xp',        brand: 'Canaan',    model: 'Avalon A16 XP',            efficiency: 12.8,  typicalThs: 300,  cooling: 'air',       year: 2026 },
  { id: 'a16',           brand: 'Canaan',    model: 'Avalon A16',               efficiency: 13.8,  typicalThs: 282,  cooling: 'air',       year: 2026 },
  { id: 'a15-pro',       brand: 'Canaan',    model: 'Avalon A15 Pro',           efficiency: 16.8,  typicalThs: 218,  cooling: 'air',       year: 2025 },
  { id: 'a15',           brand: 'Canaan',    model: 'Avalon A15',               efficiency: 18.5,  typicalThs: 195,  cooling: 'air',       year: 2025 },
  { id: 'a14-pro',       brand: 'Canaan',    model: 'Avalon A14 Pro',           efficiency: 21.0,  typicalThs: 150,  cooling: 'air',       year: 2024 },
  { id: 'a1466',         brand: 'Canaan',    model: 'Avalon A1466',             efficiency: 25.0,  typicalThs: 150,  cooling: 'air',       year: 2023 },

  // ══════════════════════════════════════════════════════════════════════════
  // Bitdeer SealMiner — A2/A3 series
  // ══════════════════════════════════════════════════════════════════════════
  { id: 'seal-a2-pro-hyd', brand: 'Bitdeer', model: 'SealMiner A2 Pro Hyd',    efficiency: 16.5,  typicalThs: 446,  cooling: 'hydro',     year: 2025 },
  { id: 'seal-a2',       brand: 'Bitdeer',   model: 'SealMiner A2',             efficiency: 16.5,  typicalThs: 226,  cooling: 'air',       year: 2025 },

  // ══════════════════════════════════════════════════════════════════════════
  // Fluminer — home mining specialist
  // ══════════════════════════════════════════════════════════════════════════
  { id: 'fluminer-t3',   brand: 'Fluminer',  model: 'Fluminer T3',              efficiency: 14.8,  typicalThs: 115,  cooling: 'air',       year: 2025 },

  // ══════════════════════════════════════════════════════════════════════════
  // BitAxe / NerdQAxe — open-source solo miners
  // ══════════════════════════════════════════════════════════════════════════
  { id: 'bitaxe-supra-hex', brand: 'BitAxe',  model: 'BitAxe Supra Hex',        efficiency: 21.4,  typicalThs: 4.2,  cooling: 'air',       year: 2025 },
  { id: 'bitaxe-gamma-602', brand: 'BitAxe',  model: 'BitAxe Gamma 602',        efficiency: 14.0,  typicalThs: 1.3,  cooling: 'passive',   year: 2025 },
  { id: 'bitaxe-gamma-601', brand: 'BitAxe',  model: 'BitAxe Gamma 601',        efficiency: 14.0,  typicalThs: 1.2,  cooling: 'passive',   year: 2024 },
  { id: 'bitaxe-ultra',  brand: 'BitAxe',    model: 'BitAxe Ultra',             efficiency: 18.0,  typicalThs: 0.5,  cooling: 'passive',   year: 2024 },
  { id: 'nerdqaxe',      brand: 'BitAxe',    model: 'NerdQAxe',                 efficiency: 20.0,  typicalThs: 0.5,  cooling: 'passive',   year: 2024 },
];

/** Group models by brand for display */
export function groupedModels(): Record<string, AsicModel[]> {
  const groups: Record<string, AsicModel[]> = {};
  for (const m of ASIC_MODELS) {
    (groups[m.brand] ??= []).push(m);
  }
  return groups;
}
