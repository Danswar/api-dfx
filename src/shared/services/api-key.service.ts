import { BadRequestException } from '@nestjs/common';
import { Config } from 'src/config/config';
import { HistoryFilter, HistoryFilterKey } from 'src/subdomains/core/history/dto/history-filter.dto';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { Util } from '../utils/util';

export class ApiKeyService {
  private static versionLength = 1;
  private static filterLength = 3;

  private static filterCodes: { [k in keyof HistoryFilter]: number } = {
    buy: 0,
    sell: 1,
    staking: 2,
    ref: 3,
    lm: 4,
  };

  // --- SECRET HANDLING --- //
  public static getSecret(user: User | UserData): string {
    if (!user.apiKeyCT) throw new BadRequestException('API key is null');
    return Util.createHash(user.apiKeyCT + user.created, 'sha256').toUpperCase();
  }

  public static getSign(user: User | UserData, timestamp: string): string {
    const secret = this.getSecret(user);
    return Util.createHash(secret + timestamp, 'sha256').toUpperCase();
  }

  public static isValidSign(user: User | UserData, sign: string, timestamp: string): boolean {
    const userSign = this.getSign(user, timestamp);

    return sign.toUpperCase() == userSign && Util.daysDiff(new Date(timestamp)) <= 1;
  }

  // --- KEY HANDLING --- //
  public static createKey(id: number): string {
    const hash = Util.createHash(Util.createHash(`${id}` + new Date().toISOString(), 'sha256'), 'md5').toUpperCase();
    return hash.substring(0, hash.length - this.versionLength) + Config.apiKeyVersionCT;
  }

  public static getFilter(filterCode?: string): HistoryFilter {
    return filterCode ? this.codeToFilter(filterCode) : undefined;
  }

  public static getFilterArray(filterCode?: string): HistoryFilterKey[] {
    return filterCode
      ? Object.entries(this.getFilter(filterCode))
          .filter(([_, value]) => value)
          .map(([key, _]) => key as HistoryFilterKey)
      : undefined;
  }

  public static getFilterCode(filter: HistoryFilter): string {
    return this.filterToCode(filter);
  }

  // --- HELPER METHODS --- //
  private static codeToFilter(filterCode: string): HistoryFilter {
    const filter = parseInt(filterCode, 16);
    return Object.entries(this.filterCodes)
      .filter(([_, value]) => filter & Math.pow(2, value))
      .reduce((prev, [key, _]) => Object.assign(prev, { [key]: true }), new HistoryFilter());
  }

  private static filterToCode(filter: HistoryFilter): string {
    const filterCode = Util.sum(Object.keys(filter).map((key) => Math.pow(2, this.filterCodes[key])));
    return filterCode.toString(16).padStart(this.filterLength, '0');
  }
}
