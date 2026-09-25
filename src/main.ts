import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { HttpErrorFilter } from './common/http-error.filter';
import { DatabaseService } from './database/database.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.setGlobalPrefix('v1');
  app.useGlobalFilters(new HttpErrorFilter());
  await app.get(DatabaseService).migrate();
  const port = Number(process.env.PORT || 8080);
  await app.listen(port);
}

void bootstrap();
