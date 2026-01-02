import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CronLog, CronLogDetail, CronLogStatus } from '../entities/cron-log.entity';

@Injectable()
export class CronLogService {
  constructor(
    @InjectRepository(CronLog)
    private cronLogRepo: Repository<CronLog>,
  ) {}

  async createLog(jobName: string): Promise<CronLog> {
    const log = this.cronLogRepo.create({
      jobName,
      status: 'running',
      startedAt: new Date(),
      positionsChecked: 0,
      stopsRaised: 0,
      failures: 0,
      details: [],
    });
    return this.cronLogRepo.save(log);
  }

  async addDetail(logId: string, detail: CronLogDetail): Promise<void> {
    const log = await this.cronLogRepo.findOneBy({ id: logId });
    if (!log) return;

    log.details.push(detail);
    log.positionsChecked++;
    if (detail.action === 'raised') log.stopsRaised++;
    if (detail.action === 'failed') log.failures++;

    await this.cronLogRepo.save(log);
  }

  async completeLog(
    logId: string,
    status: CronLogStatus,
    errorMessage?: string,
  ): Promise<void> {
    await this.cronLogRepo.update(logId, {
      status,
      completedAt: new Date(),
      errorMessage,
    });
  }

  async getLogs(jobName: string, limit = 50): Promise<CronLog[]> {
    return this.cronLogRepo.find({
      where: { jobName },
      order: { startedAt: 'DESC' },
      take: limit,
    });
  }
}
