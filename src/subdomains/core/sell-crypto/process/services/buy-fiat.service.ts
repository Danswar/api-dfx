import { BadRequestException, forwardRef, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { txExplorerUrl } from 'src/integration/blockchain/shared/util/blockchain.util';
import { Util } from 'src/shared/utils/util';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { WebhookService } from 'src/subdomains/generic/user/services/webhook/webhook.service';
import { BankTxService } from 'src/subdomains/supporting/bank-tx/bank-tx/bank-tx.service';
import { Between, In } from 'typeorm';
import { FiatOutputService } from '../../../../supporting/fiat-output/fiat-output.service';
import { CheckStatus } from '../../../buy-crypto/process/enums/check-status.enum';
import { BuyCryptoService } from '../../../buy-crypto/process/services/buy-crypto.service';
import { PaymentStatus } from '../../../history/dto/history.dto';
import { TransactionDetailsDto } from '../../../statistic/dto/statistic.dto';
import { SellHistoryDto } from '../../route/dto/sell-history.dto';
import { Sell } from '../../route/sell.entity';
import { SellRepository } from '../../route/sell.repository';
import { SellService } from '../../route/sell.service';
import { BuyFiat } from '../buy-fiat.entity';
import { BuyFiatRepository } from '../buy-fiat.repository';
import { UpdateBuyFiatDto } from '../dto/update-buy-fiat.dto';

@Injectable()
export class BuyFiatService {
  constructor(
    private readonly buyFiatRepo: BuyFiatRepository,
    @Inject(forwardRef(() => BuyCryptoService))
    private readonly buyCryptoService: BuyCryptoService,
    private readonly userService: UserService,
    private readonly sellRepo: SellRepository,
    private readonly sellService: SellService,
    @Inject(forwardRef(() => BankTxService))
    private readonly bankTxService: BankTxService,
    private readonly fiatOutputService: FiatOutputService,
    private readonly webhookService: WebhookService,
  ) {}

  async update(id: number, dto: UpdateBuyFiatDto): Promise<BuyFiat> {
    let entity = await this.buyFiatRepo.findOne({
      where: { id },
      relations: ['sell', 'sell.user', 'sell.user.wallet', 'sell.user.userData', 'fiatOutput', 'bankTx', 'cryptoInput'],
    });
    if (!entity) throw new NotFoundException('Buy-fiat not found');

    const sellIdBefore = entity.sell?.id;
    const usedRefBefore = entity.usedRef;

    const update = this.buyFiatRepo.create(dto);

    // buy
    if (dto.sellId) update.sell = await this.getSell(dto.sellId);

    // bank tx
    if (dto.bankTxId) {
      update.bankTx = await this.bankTxService.getBankTxRepo().findOneBy({ id: dto.bankTxId });
      if (!update.bankTx) throw new BadRequestException('Bank TX not found');
      await this.bankTxService.getBankTxRepo().setNewUpdateTime(dto.bankTxId);
    }

    Util.removeNullFields(entity);

    const forceUpdate = {
      ...(entity.amlCheck === CheckStatus.PENDING && update.amlCheck && update.amlCheck !== CheckStatus.PENDING
        ? { amlCheck: update.amlCheck, mailSendDate: null }
        : undefined),
      isComplete: dto.isComplete,
    };
    entity = await this.buyFiatRepo.save(Object.assign(new BuyFiat(), { ...update, ...entity, ...forceUpdate }));

    // activate user
    if (entity.amlCheck === CheckStatus.PASS && entity.sell?.user) {
      await this.userService.activateUser(entity.sell.user);
    }

    // payment webhook
    if (
      (dto.inputAmount && dto.inputAsset) ||
      dto.isComplete ||
      (dto.amlCheck && dto.amlCheck !== CheckStatus.PASS) ||
      dto.outputReferenceAsset ||
      dto.cryptoReturnDate
    )
      await this.triggerWebhook(entity);

    if (dto.amountInChf) await this.updateSellVolume([sellIdBefore, entity.sell?.id]);
    if (dto.usedRef || dto.amountInEur) await this.updateRefVolume([usedRefBefore, entity.usedRef]);

    return entity;
  }

  async getBuyFiatByKey(key: string, value: any): Promise<BuyFiat> {
    return this.buyFiatRepo
      .createQueryBuilder('buyFiat')
      .select('buyFiat')
      .leftJoinAndSelect('buyFiat.sell', 'sell')
      .leftJoinAndSelect('sell.user', 'user')
      .leftJoinAndSelect('user.userData', 'userData')
      .leftJoinAndSelect('userData.users', 'users')
      .leftJoinAndSelect('userData.kycSteps', 'kycSteps')
      .leftJoinAndSelect('userData.country', 'country')
      .leftJoinAndSelect('userData.nationality', 'nationality')
      .leftJoinAndSelect('userData.organizationCountry', 'organizationCountry')
      .leftJoinAndSelect('userData.language', 'language')
      .leftJoinAndSelect('users.wallet', 'wallet')
      .where(`${key.includes('.') ? key : `buyFiat.${key}`} = :param`, { param: value })
      .getOne();
  }

  async triggerWebhookManual(id: number): Promise<void> {
    const buyFiat = await this.buyFiatRepo.findOne({
      where: { id },
      relations: ['sell', 'sell.user', 'sell.user.wallet', 'sell.user.userData', 'bankTx', 'cryptoInput'],
    });
    if (!buyFiat) throw new NotFoundException('BuyFiat not found');

    await this.triggerWebhook(buyFiat);
  }

  async triggerWebhook(buyFiat: BuyFiat): Promise<void> {
    // TODO add fiatFiatUpdate here
    buyFiat.sell ? await this.webhookService.cryptoFiatUpdate(buyFiat.sell.user, buyFiat) : undefined;
  }

  async resetAmlCheck(id: number): Promise<void> {
    const entity = await this.buyFiatRepo.findOne({ where: { id }, relations: { fiatOutput: true } });
    if (!entity) throw new NotFoundException('BuyFiat not found');
    if (entity.isComplete || entity.fiatOutput.isComplete) throw new BadRequestException('BuyFiat is already complete');
    if (!entity.amlCheck) throw new BadRequestException('BuyFiat amlcheck is not set');

    const fiatOutputId = entity.fiatOutput.id;

    await this.buyFiatRepo.update(...entity.resetAmlCheck());
    await this.fiatOutputService.delete(fiatOutputId);
  }

  async updateVolumes(start = 1, end = 100000): Promise<void> {
    const sellIds = await this.buyFiatRepo
      .find({
        where: { id: Between(start, end) },
        relations: { sell: true },
      })
      .then((l) => l.map((b) => b.sell.id));

    await this.updateSellVolume([...new Set(sellIds)]);
  }

  async updateRefVolumes(start = 1, end = 100000): Promise<void> {
    const refs = await this.buyFiatRepo
      .createQueryBuilder('buyFiat')
      .select('usedRef')
      .groupBy('usedRef')
      .where('buyFiat.id BETWEEN :start AND :end', { start, end })
      .getRawMany<{ usedRef: string }>()
      .then((refs) => refs.map((r) => r.usedRef));

    await this.updateRefVolume([...new Set(refs)]);
  }

  async getUserTransactions(
    userId: number,
    dateFrom: Date = new Date(0),
    dateTo: Date = new Date(),
  ): Promise<BuyFiat[]> {
    return this.buyFiatRepo.find({
      where: { sell: { user: { id: userId } }, outputDate: Between(dateFrom, dateTo) },
      relations: ['cryptoInput', 'bankTx', 'sell', 'sell.user', 'fiatOutput', 'fiatOutput.bankTx'],
    });
  }

  async getAllUserTransactions(userIds: number[]): Promise<BuyFiat[]> {
    return this.buyFiatRepo.find({
      where: { sell: { user: { id: In(userIds) } } },
      relations: ['cryptoInput', 'bankTx', 'sell', 'sell.user', 'fiatOutput', 'fiatOutput.bankTx'],
      order: { id: 'DESC' },
    });
  }

  async getSellHistory(userId: number, sellId?: number): Promise<SellHistoryDto[]> {
    const where = { user: { id: userId }, id: sellId };
    Util.removeNullFields(where);
    return this.buyFiatRepo
      .find({
        where: { sell: where },
        relations: ['sell', 'sell.user', 'cryptoInput', 'fiatOutput'],
      })
      .then((buyFiats) => buyFiats.map(this.toHistoryDto));
  }

  // --- HELPER METHODS --- //

  private toHistoryDto(buyFiat: BuyFiat): SellHistoryDto {
    return {
      inputAmount: buyFiat.inputAmount,
      inputAsset: buyFiat.inputAsset,
      outputAmount: buyFiat.outputAmount,
      outputAsset: buyFiat.outputAsset,
      txId: buyFiat.cryptoInput.inTxId,
      txUrl: txExplorerUrl(buyFiat.cryptoInput.asset.blockchain, buyFiat.cryptoInput.inTxId),
      date: buyFiat.fiatOutput?.outputDate,
      amlCheck: buyFiat.amlCheck,
      isComplete: buyFiat.isComplete,
      status: buyFiat.isComplete ? PaymentStatus.COMPLETE : PaymentStatus.PENDING,
    };
  }

  private async getSell(sellId: number): Promise<Sell> {
    // sell
    const sell = await this.sellRepo.findOne({ where: { id: sellId }, relations: ['user', 'user.wallet'] });
    if (!sell) throw new BadRequestException('Sell route not found');

    return sell;
  }

  async updateSellVolume(sellIds: number[]): Promise<void> {
    sellIds = sellIds.filter((u, j) => sellIds.indexOf(u) === j).filter((i) => i); // distinct, not null

    for (const id of sellIds) {
      const { volume } = await this.buyFiatRepo
        .createQueryBuilder('buyFiat')
        .select('SUM(amountInChf)', 'volume')
        .where('sellId = :id', { id: id })
        .andWhere('amlCheck = :check', { check: CheckStatus.PASS })
        .getRawOne<{ volume: number }>();

      const newYear = new Date(new Date().getFullYear(), 0, 1);
      const { annualVolume } = await this.buyFiatRepo
        .createQueryBuilder('buyFiat')
        .select('SUM(amountInChf)', 'annualVolume')
        .leftJoin('buyFiat.cryptoInput', 'cryptoInput')
        .where('buyFiat.sellId = :id', { id: id })
        .andWhere('buyFiat.amlCheck = :check', { check: CheckStatus.PASS })
        .andWhere('cryptoInput.created >= :year', { year: newYear })
        .getRawOne<{ annualVolume: number }>();

      await this.sellService.updateVolume(id, volume ?? 0, annualVolume ?? 0);
    }
  }

  async updateRefVolume(refs: string[]): Promise<void> {
    refs = refs.filter((u, j) => refs.indexOf(u) === j).filter((i) => i); // distinct, not null

    for (const ref of refs) {
      const { volume: buyFiatVolume, credit: buyFiatCredit } = await this.getRefVolume(ref);
      const { volume: buyCryptoVolume, credit: buyCryptoCredit } = await this.buyCryptoService.getRefVolume(ref);

      await this.userService.updateRefVolume(ref, buyFiatVolume + buyCryptoVolume, buyFiatCredit + buyCryptoCredit);
    }
  }

  async getRefVolume(ref: string): Promise<{ volume: number; credit: number }> {
    const { volume, credit } = await this.buyFiatRepo
      .createQueryBuilder('buyFiat')
      .select('SUM(amountInEur * refFactor)', 'volume')
      .addSelect('SUM(amountInEur * refFactor * refProvision * 0.01)', 'credit')
      .where('usedRef = :ref', { ref })
      .andWhere('amlCheck = :check', { check: CheckStatus.PASS })
      .getRawOne<{ volume: number; credit: number }>();

    return { volume: volume ?? 0, credit: credit ?? 0 };
  }

  // Statistics

  async getTransactions(dateFrom: Date = new Date(0), dateTo: Date = new Date()): Promise<TransactionDetailsDto[]> {
    const buyFiats = await this.buyFiatRepo.find({
      where: { outputDate: Between(dateFrom, dateTo), amlCheck: CheckStatus.PASS },
      relations: ['cryptoInput', 'cryptoInput.asset'],
      loadEagerRelations: false,
    });

    return buyFiats.map((v) => ({
      id: v.id,
      fiatAmount: v.amountInEur,
      fiatCurrency: 'EUR',
      date: v.outputDate,
      cryptoAmount: v.cryptoInput?.amount,
      cryptoCurrency: v.cryptoInput?.asset?.name,
    }));
  }
}