import { existsSync } from 'node:fs';

if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var ${name}. Copy .env.example to .env and fill it in.`);
  }
  return value;
}

export const config = {
  apiBaseUrl: process.env.API_BASE_URL ?? 'https://api.flights.barcz.me',
  get email(): string {
    return required('FLIGHTS_EMAIL');
  },
  get password(): string {
    return required('FLIGHTS_PASSWORD');
  },
};
