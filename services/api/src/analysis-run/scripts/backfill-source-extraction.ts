import { NestFactory } from '@nestjs/core';

import { AppModule } from '../../app.module';
import { SourceExtractionBackfillService } from '../source-extraction-backfill.service';
import {
  BACKFILL_EXIT,
  BACKFILL_SOURCE_EXTRACTION_HELP_TEXT,
  backfillExitCode,
  formatBackfillSourceExtractionSummary,
  parseBackfillSourceExtractionArgs
} from './backfill-source-extraction.utils';

/**
 * Entrada de OPERADOR para el backfill de slots de extraccion F1.
 *
 * DRY-RUN POR DEFECTO. Sin `--execute` inspecciona y no escribe. Pasar ids no
 * alcanza para mutar nada: el flag es la unica autorizacion.
 *
 * El entorno lo aporta el operador por el mecanismo de siempre —`--env-file=.env`
 * en el script de npm—. Este archivo no conoce ninguna URL, ninguna credencial y
 * ningun `.env` alternativo, y no imprime valores de entorno.
 */

async function main(): Promise<number> {
  const args = parseBackfillSourceExtractionArgs(process.argv.slice(2));

  if (args.help) {
    console.log(BACKFILL_SOURCE_EXTRACTION_HELP_TEXT);
    return BACKFILL_EXIT.OK;
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log']
  });

  try {
    const backfill = app.get(SourceExtractionBackfillService);
    const summary = await backfill.run(args.analysisRunSourceIds, {
      execute: args.execute
    });
    console.log(formatBackfillSourceExtractionSummary(summary));
    return backfillExitCode(summary);
  } finally {
    await app.close();
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    // Un argumento invalido y un fallo de arranque se distinguen por codigo, no
    // por el texto. No se vuelca el stack: puede llevar rutas y configuracion.
    console.error(error instanceof Error ? error.message : 'Fallo inesperado.');
    process.exitCode = BACKFILL_EXIT.INVALID_ARGUMENTS;
  });
