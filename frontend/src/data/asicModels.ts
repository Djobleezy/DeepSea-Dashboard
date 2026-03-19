/** ASIC miner models with efficiency (J/TH) and typical hashrate (TH/s).
 *  Kept in sync with backend _MINER_PATTERNS in worker_service.py. */
export interface AsicModel {
  id: string;
  brand: string;
  model: string;
  efficiency: number;   // J/TH (watts per TH/s)
  typicalThs: number;   // typical hashrate in TH/s
}

export const ASIC_MODELS: AsicModel[] = [
  // ── Bitmain Antminer ──
  { id: 's21-xp',       brand: 'Bitmain',     model: 'Antminer S21 XP',       efficiency: 12.0,  typicalThs: 270 },
  { id: 's21-pro',      brand: 'Bitmain',     model: 'Antminer S21 Pro',      efficiency: 15.0,  typicalThs: 234 },
  { id: 's21',          brand: 'Bitmain',     model: 'Antminer S21',          efficiency: 17.5,  typicalThs: 200 },
  { id: 't21',          brand: 'Bitmain',     model: 'Antminer T21',          efficiency: 19.0,  typicalThs: 190 },
  { id: 's19-xp',       brand: 'Bitmain',     model: 'Antminer S19 XP',       efficiency: 21.5,  typicalThs: 140 },
  { id: 's19j-pro-plus', brand: 'Bitmain',    model: 'Antminer S19j Pro+',    efficiency: 22.0,  typicalThs: 122 },
  { id: 's19-pro-plus', brand: 'Bitmain',     model: 'Antminer S19 Pro+',     efficiency: 23.0,  typicalThs: 120 },
  { id: 's19-pro-hyd',  brand: 'Bitmain',     model: 'Antminer S19 Pro+ Hyd', efficiency: 27.5,  typicalThs: 198 },
  { id: 's19-pro',      brand: 'Bitmain',     model: 'Antminer S19 Pro',      efficiency: 29.5,  typicalThs: 110 },
  { id: 's19j-pro',     brand: 'Bitmain',     model: 'Antminer S19j Pro',     efficiency: 30.0,  typicalThs: 104 },
  { id: 's19j',         brand: 'Bitmain',     model: 'Antminer S19j',         efficiency: 34.5,  typicalThs:  90 },
  { id: 's19',          brand: 'Bitmain',     model: 'Antminer S19',          efficiency: 34.5,  typicalThs:  95 },

  // ── MicroBT Whatsminer ──
  { id: 'm60s',         brand: 'MicroBT',     model: 'Whatsminer M60S',       efficiency: 18.5,  typicalThs: 186 },
  { id: 'm56s-plus',    brand: 'MicroBT',     model: 'Whatsminer M56S+',      efficiency: 22.0,  typicalThs: 230 },
  { id: 'm50s-plus',    brand: 'MicroBT',     model: 'Whatsminer M50S+',      efficiency: 26.0,  typicalThs: 140 },
  { id: 'm50s',         brand: 'MicroBT',     model: 'Whatsminer M50S',       efficiency: 29.0,  typicalThs: 126 },
  { id: 'm30s-plus-plus', brand: 'MicroBT',   model: 'Whatsminer M30S++',     efficiency: 31.0,  typicalThs: 112 },
  { id: 'm30s-plus',    brand: 'MicroBT',     model: 'Whatsminer M30S+',      efficiency: 34.0,  typicalThs: 100 },
  { id: 'm30s',         brand: 'MicroBT',     model: 'Whatsminer M30S',       efficiency: 38.0,  typicalThs:  86 },

  // ── Other ──
  { id: 'bitaxe',       brand: 'BitAxe',      model: 'BitAxe Gamma 601',      efficiency: 14.0,  typicalThs: 0.5 },
];

/** Group models by brand for display */
export function groupedModels(): Record<string, AsicModel[]> {
  const groups: Record<string, AsicModel[]> = {};
  for (const m of ASIC_MODELS) {
    (groups[m.brand] ??= []).push(m);
  }
  return groups;
}
