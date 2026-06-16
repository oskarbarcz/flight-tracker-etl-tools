import { readFileSync } from 'node:fs';
import { parseCsv, type CsvRow } from '../csv.ts';
import {
  CONTINENTS,
  OPERATOR_TYPES,
  type Continent,
  type CreateOperatorRequest,
  type OperatorType,
} from './operator.types.ts';

export class ValidationError extends Error {}

export type DesiredOperator = Partial<CreateOperatorRequest> & { icaoCode: string };

export function loadDesiredOperators(path: string): DesiredOperator[] {
  const rows = parseCsv(readFileSync(path, 'utf8'));
  const desired = rows.map((row, i) => rowToDesired(row, i + 2));

  const seen = new Map<string, number>();
  desired.forEach((operator, i) => {
    const previous = seen.get(operator.icaoCode);
    if (previous !== undefined) {
      throw new ValidationError(
        `Duplicate icaoCode "${operator.icaoCode}" in sheet (lines ${previous + 2} and ${i + 2}).`,
      );
    }
    seen.set(operator.icaoCode, i);
  });

  return desired;
}

function rowToDesired(row: CsvRow, line: number): DesiredOperator {
  const get = (key: string) => (row[key] ?? '').trim();
  const icaoCode = get('icaoCode').toUpperCase();
  if (!icaoCode) {
    throw new ValidationError(`Line ${line}: icaoCode is required.`);
  }

  const operator: DesiredOperator = { icaoCode };

  const iataCode = get('iataCode').toUpperCase();
  if (iataCode) operator.iataCode = iataCode;

  const shortName = get('shortName');
  if (shortName) operator.shortName = shortName;

  const fullName = get('fullName');
  if (fullName) operator.fullName = fullName;

  const callsign = get('callsign');
  if (callsign) operator.callsign = callsign;

  const avgFleetAge = get('avgFleetAge');
  if (avgFleetAge) {
    const parsed = Number(avgFleetAge);
    if (Number.isNaN(parsed)) {
      throw new ValidationError(
        `Line ${line} (${icaoCode}): avgFleetAge "${avgFleetAge}" is not a number.`,
      );
    }
    operator.avgFleetAge = parsed;
  }

  const logoUrl = get('logoUrl');
  if (logoUrl) operator.logoUrl = logoUrl;

  const backgroundUrl = get('backgroundUrl');
  if (backgroundUrl) operator.backgroundUrl = backgroundUrl;

  const type = get('type');
  if (type) {
    if (!OPERATOR_TYPES.includes(type as OperatorType)) {
      throw new ValidationError(
        `Line ${line} (${icaoCode}): type "${type}" must be one of ${OPERATOR_TYPES.join(', ')}.`,
      );
    }
    operator.type = type as OperatorType;
  }

  const continent = get('continent');
  if (continent) {
    if (!CONTINENTS.includes(continent as Continent)) {
      throw new ValidationError(
        `Line ${line} (${icaoCode}): continent "${continent}" must be one of ${CONTINENTS.join(', ')}.`,
      );
    }
    operator.continent = continent as Continent;
  }

  const hubs = get('hubs');
  if (hubs) {
    operator.hubs = hubs
      .split(/[\s,;]+/)
      .map((code) => code.trim().toUpperCase())
      .filter(Boolean);
  }

  return operator;
}
