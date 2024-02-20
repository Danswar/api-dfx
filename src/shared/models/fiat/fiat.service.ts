import { Injectable } from '@nestjs/common';
import { FiatRepository } from 'src/shared/models/fiat/fiat.repository';
import { AsyncCache } from 'src/shared/utils/async-cache';
import { Fiat } from './fiat.entity';

@Injectable()
export class FiatService {
  private readonly cache = new AsyncCache<Fiat>(60);

  constructor(private fiatRepo: FiatRepository) {}

  async getAllFiat(): Promise<Fiat[]> {
    return this.fiatRepo.find();
  }

  async getFiat(id: number): Promise<Fiat> {
    return this.cache.get(`${id}`, () => this.fiatRepo.findOneBy({ id }));
  }

  async getFiatByName(name: string): Promise<Fiat> {
    return this.cache.get(name, () => this.fiatRepo.findOneBy({ name }));
  }
}
