import { ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { generateSecret, verifyToken } from 'node-2fa';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { Lock } from 'src/shared/utils/lock';
import { Util } from 'src/shared/utils/util';
import { KycLogType } from 'src/subdomains/generic/kyc/enums/kyc.enum';
import { TfaLogRepository } from 'src/subdomains/generic/kyc/repositories/tfa-log.repository';
import { MoreThan } from 'typeorm';
import { UserData } from '../../user/models/user-data/user-data.entity';
import { UserDataService } from '../../user/models/user-data/user-data.service';
import { Setup2faDto } from '../dto/output/setup-2fa.dto';

const TfaValidityHours = 24;

interface SecretCacheEntry {
  secret: string;
  creationTime: number;
}

enum TfaComment {
  VERIFIED = 'Verified',
  DELETED = 'Deleted',
}

@Injectable()
export class TfaService {
  private secretCache: Map<number, SecretCacheEntry> = new Map();

  constructor(private readonly tfaRepo: TfaLogRepository, private readonly userDataService: UserDataService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  @Lock()
  processCleanupSecretCache() {
    if (DisabledProcess(Process.TFA_CACHE)) return;

    const before5MinTime = Util.minutesBefore(5).getTime();

    const keysToBeDeleted = Array.from(this.secretCache.entries())
      .filter(([_, v]) => v.creationTime < before5MinTime)
      .map(([k, _]) => k);

    keysToBeDeleted.forEach((k) => this.secretCache.delete(k));
  }

  async setup(kycHash: string): Promise<Setup2faDto> {
    const user = await this.getUser(kycHash);
    if (user.totpSecret) throw new ConflictException('2FA already set up');

    const { secret, uri } = generateSecret({ name: 'DFX.swiss', account: user.mail ?? '' });

    this.secretCache.set(user.id, {
      secret,
      creationTime: Date.now(),
    });

    return { secret, uri };
  }

  async delete(kycHash: string, ip: string): Promise<void> {
    const user = await this.getUser(kycHash);
    await this.userDataService.updateTotpSecret(user, null);

    await this.createTfaLog(user, ip, TfaComment.DELETED);
  }

  async verify(kycHash: string, token: string, ip: string): Promise<void> {
    const user = await this.getUser(kycHash);

    const secret = user.totpSecret ?? this.secretCache.get(user.id)?.secret;
    if (!secret) throw new NotFoundException('2FA not set up');

    this.verifyOrThrow(secret, token);

    if (!user.totpSecret) {
      await this.userDataService.updateTotpSecret(user, secret);
      this.secretCache.delete(user.id);
    }

    await this.createTfaLog(user, ip, TfaComment.VERIFIED);
  }

  async checkVerification(user: UserData, ip: string) {
    const isVerified = await this.tfaRepo.exist({
      where: {
        userData: { id: user.id },
        ipAddress: ip,
        comment: TfaComment.VERIFIED,
        created: MoreThan(Util.hoursBefore(TfaValidityHours)),
      },
    });
    if (!isVerified) throw new UnauthorizedException('2FA required');
  }

  // --- HELPER METHODS --- //
  private verifyOrThrow(secret: string, token: string): void {
    const result = verifyToken(secret, token);
    if (!result || result.delta !== 0) throw new UnauthorizedException('Invalid or expired 2FA token');
  }

  private async createTfaLog(userData: UserData, ipAddress: string, comment: TfaComment) {
    const logEntity = this.tfaRepo.create({
      type: KycLogType.TFA,
      ipAddress,
      userData,
      comment,
    });

    await this.tfaRepo.save(logEntity);
  }

  private async getUser(kycHash: string): Promise<UserData> {
    return this.userDataService.getByKycHashOrThrow(kycHash, { users: true });
  }
}