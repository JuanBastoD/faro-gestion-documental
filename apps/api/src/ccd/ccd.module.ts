import { Module } from '@nestjs/common';
import { SeriesController } from './series.controller.js';
import { SeriesRepository } from './series.repository.js';
import { SeriesService } from './series.service.js';

@Module({
  controllers: [SeriesController],
  providers: [SeriesRepository, SeriesService],
  exports: [SeriesService],
})
export class CcdModule {}
