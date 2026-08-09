import { NestFactory } from '@nestjs/core';

import { AppModule } from '../../app.module';
import { AnalysisRunBackfillService } from '../analysis-run-backfill.service';
import {
  formatBackfillSummary,
  parseReprocessDocumentsArgs,
  REPROCESS_DOCUMENTS_HELP_TEXT
} from './reprocess-documents.utils';

async function main() {
  const args = parseReprocessDocumentsArgs(process.argv.slice(2));

  if (args.help) {
    console.log(REPROCESS_DOCUMENTS_HELP_TEXT);
    return;
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log']
  });

  try {
    const backfillService = app.get(AnalysisRunBackfillService);
    const summary = await backfillService.run(
      {
        holderEmail: args.holderEmail ?? undefined,
        credentialId: args.credentialId ?? undefined
      },
      {
        force: args.force,
        execute: args.execute,
        rebuildProfile: args.rebuildProfile,
        limit: args.limit
      }
    );

    console.log(
      args.execute
        ? 'Reprocess run finished.'
        : 'Dry-run finished. No writes were performed and the AI Service was not called.'
    );
    console.log(formatBackfillSummary(summary));
  } finally {
    await app.close();
  }
}

// Fallas globales (argumentos invalidos, holder/credencial inexistente,
// error de configuracion) terminan con exit 1. Fallas de UNA credencial
// dentro del batch quedan reportadas en summary.results y NO llegan aca --
// el batch continua y el proceso termina con exit 0.
void main().catch((error: unknown) => {
  console.error('Analysis reprocess script failed.');
  console.error(getErrorMessage(error));
  process.exitCode = 1;
});

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
