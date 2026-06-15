export const OPERATOR_TYPES = [
  'legacy',
  'low_cost',
  'charter',
  'government_military',
] as const;
export type OperatorType = (typeof OPERATOR_TYPES)[number];

export const CONTINENTS = [
  'africa',
  'asia',
  'europe',
  'north_america',
  'oceania',
  'south_america',
] as const;
export type Continent = (typeof CONTINENTS)[number];

export interface CreateOperatorRequest {
  icaoCode: string;
  iataCode: string;
  shortName: string;
  fullName: string;
  callsign: string;
  avgFleetAge?: number;
  logoUrl?: string | null;
  backgroundUrl?: string | null;
  type?: OperatorType;
  continent?: Continent;
  hubs?: string[];
}

export interface Operator extends CreateOperatorRequest {
  id: string;
  fleetSize: number;
  fleetTypes: string[];
}

export const REQUIRED_FIELDS: (keyof CreateOperatorRequest)[] = [
  'icaoCode',
  'iataCode',
  'shortName',
  'fullName',
  'callsign',
];
