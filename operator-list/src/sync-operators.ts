import { config } from './config.ts';
import { signIn } from './api/client.ts';
import { operatorsApi } from './api/operators.ts';
import { loadDesiredOperators } from './operator/operator.csv.ts';
import { buildPlan, type PlanItem } from './operator/operator.sync.ts';

const DEFAULT_SHEET = 'sheets/operators.csv';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const sheetPath = args.find((arg) => !arg.startsWith('--')) ?? DEFAULT_SHEET;

  const desired = loadDesiredOperators(sheetPath);
  console.log(`Loaded ${desired.length} operator(s) from ${sheetPath}`);

  const token = await signIn(config.email, config.password);
  const api = operatorsApi(token);
  const existing = await api.list();
  console.log(`Fetched ${existing.length} existing operator(s) from ${config.apiBaseUrl}\n`);

  const plan = buildPlan(desired, existing);
  printPlan(plan);

  const creates = plan.filter((item) => item.action === 'create');
  const updates = plan.filter((item) => item.action === 'update');
  const skips = plan.filter((item) => item.action === 'skip');

  if (!apply) {
    console.log(
      `\nDry run: ${creates.length} to create, ${updates.length} to update, ${skips.length} unchanged.`,
    );
    console.log('Re-run with --apply to write these changes.');
    return;
  }

  console.log('\nApplying changes...');
  let created = 0;
  let updated = 0;
  let failed = 0;
  for (const item of plan) {
    try {
      if (item.action === 'create') {
        await api.create(item.payload);
        created += 1;
        console.log(`  ✓ created ${item.icaoCode}`);
      } else if (item.action === 'update') {
        await api.update(item.id, item.payload);
        updated += 1;
        console.log(`  ✓ updated ${item.icaoCode} (${item.changes.map((c) => c.field).join(', ')})`);
      }
    } catch (error) {
      failed += 1;
      console.error(`  ✗ ${item.action} ${item.icaoCode}: ${errorMessage(error)}`);
    }
  }

  console.log(`\nDone: ${created} created, ${updated} updated, ${failed} failed.`);
  if (failed > 0) process.exitCode = 1;
}

function printPlan(plan: PlanItem[]): void {
  for (const item of plan) {
    if (item.action === 'create') {
      console.log(`CREATE ${item.icaoCode}  ${item.payload.shortName} (${item.payload.fullName})`);
    } else if (item.action === 'update') {
      console.log(`UPDATE ${item.icaoCode}`);
      for (const change of item.changes) {
        console.log(`         ${change.field}: ${format(change.from)} -> ${format(change.to)}`);
      }
    } else {
      console.log(`SKIP   ${item.icaoCode}  (unchanged)`);
    }
  }
}

function format(value: unknown): string {
  if (value === undefined) return '(unset)';
  return JSON.stringify(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

main().catch((error) => {
  console.error(errorMessage(error));
  process.exitCode = 1;
});
