import {
  REQUIRED_FIELDS,
  type CreateOperatorRequest,
  type Operator,
} from './operator.types.ts';
import { ValidationError, type DesiredOperator } from './operator.csv.ts';

export interface FieldChange {
  field: string;
  from: unknown;
  to: unknown;
}

export type PlanItem =
  | { action: 'create'; icaoCode: string; payload: CreateOperatorRequest }
  | {
      action: 'update';
      icaoCode: string;
      id: string;
      changes: FieldChange[];
      payload: Partial<CreateOperatorRequest>;
    }
  | { action: 'skip'; icaoCode: string };

const COMPARABLE_FIELDS: (keyof CreateOperatorRequest)[] = [
  'iataCode',
  'shortName',
  'fullName',
  'callsign',
  'avgFleetAge',
  'logoUrl',
  'backgroundUrl',
  'type',
  'continent',
  'hubs',
];

export function buildPlan(desired: DesiredOperator[], existing: Operator[]): PlanItem[] {
  const byIcao = new Map(existing.map((operator) => [operator.icaoCode.toUpperCase(), operator]));

  return desired.map((operator) => {
    const current = byIcao.get(operator.icaoCode);

    if (!current) {
      const missing = REQUIRED_FIELDS.filter((field) => operator[field] == null);
      if (missing.length > 0) {
        throw new ValidationError(
          `Cannot create ${operator.icaoCode}: missing required field(s) ${missing.join(', ')}.`,
        );
      }
      return { action: 'create', icaoCode: operator.icaoCode, payload: operator as CreateOperatorRequest };
    }

    const changes: FieldChange[] = [];
    const payload: Partial<CreateOperatorRequest> = {};
    for (const field of COMPARABLE_FIELDS) {
      if (!(field in operator)) continue;
      const to = operator[field];
      const from = current[field];
      if (!valuesEqual(from, to)) {
        changes.push({ field, from, to });
        (payload[field] as unknown) = to;
      }
    }

    if (changes.length === 0) {
      return { action: 'skip', icaoCode: operator.icaoCode };
    }
    return { action: 'update', icaoCode: operator.icaoCode, id: current.id, changes, payload };
  });
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    const left = [...((a as unknown[]) ?? [])].map(String).sort();
    const right = [...((b as unknown[]) ?? [])].map(String).sort();
    return left.length === right.length && left.every((value, i) => value === right[i]);
  }
  return a === b;
}
