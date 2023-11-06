import { Injectable, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { Lock } from 'src/shared/utils/lock';
import { Util } from 'src/shared/utils/util';
import { BuyPaymentMethod } from 'src/subdomains/core/buy-crypto/routes/buy/dto/get-buy-payment-info.dto';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { FeeDirectionType } from 'src/subdomains/generic/user/models/user/user.entity';
import { MinAmount } from 'src/subdomains/supporting/payment/dto/min-amount.dto';
import { FeeService } from 'src/subdomains/supporting/payment/services/fee.service';
import { Price } from 'src/subdomains/supporting/pricing/domain/entities/price';
import { PriceProviderService } from 'src/subdomains/supporting/pricing/services/price-provider.service';
import { TargetEstimation, TransactionDetails } from '../dto/transaction-details.dto';
import { TxSpec, TxSpecExtended } from '../dto/tx-spec.dto';
import { TransactionDirection, TransactionSpecification } from '../entities/transaction-specification.entity';
import { TransactionSpecificationRepository } from '../repositories/transaction-specification.repository';

export enum ValidationError {
  PAY_IN_TOO_SMALL = 'PayInTooSmall',
  PAY_IN_NOT_SELLABLE = 'PayInNotSellable',
}

export enum TransactionError {
  AMOUNT_TOO_LOW = 'AmountTooLow',
  AMOUNT_TOO_HIGH = 'AmountTooHigh',
}

@Injectable()
export class TransactionHelper implements OnModuleInit {
  private eur: Fiat;
  private chf: Fiat;
  private transactionSpecifications: TransactionSpecification[];

  constructor(
    private readonly transactionSpecificationRepo: TransactionSpecificationRepository,
    private readonly priceProviderService: PriceProviderService,
    private readonly fiatService: FiatService,
    private readonly feeService: FeeService,
  ) {}

  onModuleInit() {
    void this.fiatService.getFiatByName('EUR').then((f) => (this.eur = f));
    void this.fiatService.getFiatByName('CHF').then((f) => (this.chf = f));
    void this.updateCache();
  }

  @Cron(CronExpression.EVERY_HOUR)
  @Lock()
  async updateCache() {
    this.transactionSpecifications = await this.transactionSpecificationRepo.find();
  }

  // --- SPECIFICATIONS --- //
  async validateInput(from: Asset | Fiat, amount: number): Promise<true | ValidationError> {
    // check min. volume
    const { minVolume } = await this.getInSpecs(from);
    if (amount < minVolume * 0.5) return ValidationError.PAY_IN_TOO_SMALL;

    // check sellable
    if (!from.sellable) return ValidationError.PAY_IN_NOT_SELLABLE;

    return true;
  }

  async getInSpecs(from: Asset | Fiat): Promise<TxSpec> {
    const { system, asset } = this.getProps(from);
    const spec = this.getSpec(system, asset, TransactionDirection.IN);

    return this.convertToSource(from, spec);
  }

  getSpecs(from: Asset | Fiat, to: Asset | Fiat): TxSpec {
    const { system: fromSystem, asset: fromAsset } = this.getProps(from);
    const { system: toSystem, asset: toAsset } = this.getProps(to);

    const { minFee, minDeposit } = this.getDefaultSpecs(fromSystem, fromAsset, toSystem, toAsset);

    return { minFee: minFee.amount, minVolume: minDeposit.amount };
  }

  getDefaultSpecs(
    fromSystem: string,
    fromAsset: string,
    toSystem: string,
    toAsset: string,
  ): { minFee: MinAmount; minDeposit: MinAmount } {
    const inSpec = this.getSpec(fromSystem, fromAsset, TransactionDirection.IN);
    const outSpec = this.getSpec(toSystem, toAsset, TransactionDirection.OUT);

    return {
      minFee: { amount: outSpec.minFee + inSpec.minFee, asset: 'EUR' },
      minDeposit: { amount: Math.max(outSpec.minVolume, inSpec.minVolume), asset: 'EUR' },
    };
  }

  private getSpec(system: string, asset: string, direction: TransactionDirection): TransactionSpecification {
    return (
      this.findSpec(system, asset, direction) ??
      this.findSpec(system, undefined, direction) ??
      this.findSpec(system, asset, undefined) ??
      this.findSpec(system, undefined, undefined) ??
      TransactionSpecification.default()
    );
  }

  private findSpec(
    system: string,
    asset: string | undefined,
    direction: TransactionDirection | undefined,
  ): TransactionSpecification | undefined {
    return this.transactionSpecifications.find(
      (t) => t.system == system && t.asset == asset && t.direction == direction,
    );
  }

  // --- TARGET ESTIMATION --- //
  async getTxDetails(
    sourceAmount: number | undefined,
    targetAmount: number | undefined,
    from: Asset | Fiat,
    to: Asset | Fiat,
    userData?: UserData,
    paymentMethod?: BuyPaymentMethod,
  ): Promise<TransactionDetails> {
    const specs = this.getSpecs(from, to);
    const direction = this.getTxDirection(from, to);

    const { minVolume, minFee, maxVolume } = await this.convertToSource(from, {
      ...specs,
      maxVolume: userData?.availableTradingLimit,
    });

    const {
      minVolume: minVolumeTarget,
      minFee: minFeeTarget,
      maxVolume: maxVolumeTarget,
    } = await this.convertToTarget(to, { ...specs, maxVolume: userData?.availableTradingLimit });

    const fee = await this.getTxFee(
      userData,
      direction,
      to instanceof Asset ? to : from instanceof Asset ? from : undefined,
      targetAmount ? to : from,
      targetAmount ? targetAmount : sourceAmount,
      paymentMethod,
    );

    const target = await this.getTargetEstimation(sourceAmount, targetAmount, fee, minFee, from, to);

    const error =
      target.sourceAmount < minVolume
        ? TransactionError.AMOUNT_TOO_LOW
        : target.sourceAmount > maxVolume
        ? TransactionError.AMOUNT_TOO_HIGH
        : undefined;

    return {
      ...target,
      minFee,
      minVolume,
      minFeeTarget,
      minVolumeTarget,
      maxVolume,
      maxVolumeTarget,
      fee,
      isValid: error == null,
      error,
    };
  }

  private async getTxFee(
    userData: UserData,
    direction: FeeDirectionType,
    asset: Asset,
    txAsset: Asset | Fiat,
    txVolume: number,
    paymentMethod: BuyPaymentMethod,
  ): Promise<number> {
    const price = txAsset ? await this.priceProviderService.getPrice(txAsset, this.eur) : undefined;

    const txVolumeInEur = price ? price.convert(txVolume) : undefined;

    return paymentMethod === BuyPaymentMethod.CARD
      ? Config.buy.fee.card
      : userData
      ? this.feeService.getUserFee({ userData, direction, asset, txVolume: txVolumeInEur })
      : this.feeService.getDefaultFee({ direction, asset, txVolume: txVolumeInEur });
  }

  private async getTargetEstimation(
    inputAmount: number | undefined,
    outputAmount: number | undefined,
    fee: number,
    minFee: number,
    from: Asset | Fiat,
    to: Asset | Fiat,
  ): Promise<TargetEstimation> {
    const price = await this.priceProviderService.getPrice(from, to);

    const percentFeeAmount =
      outputAmount != null ? price.invert().convert((outputAmount * fee) / (1 - fee)) : inputAmount * fee;
    const feeAmount = Math.max(percentFeeAmount, minFee);

    const targetAmount = outputAmount != null ? outputAmount : price.convert(Math.max(inputAmount - feeAmount, 0));
    const sourceAmount = outputAmount != null ? price.invert().convert(outputAmount) + feeAmount : inputAmount;

    return {
      exchangeRate: this.round(price.price, from instanceof Fiat),
      rate: this.round(sourceAmount / targetAmount, from instanceof Fiat),
      feeAmount: this.round(feeAmount, from instanceof Fiat),
      estimatedAmount: this.round(targetAmount, to instanceof Fiat),
      sourceAmount: this.round(sourceAmount, from instanceof Fiat),
    };
  }

  // --- HELPER METHODS --- //
  private getProps(param: Asset | Fiat): { system: string; asset: string } {
    return param instanceof Fiat
      ? { system: 'Fiat', asset: param.name }
      : { system: param.blockchain, asset: param.dexName };
  }

  private async convertToSource(
    from: Asset | Fiat,
    { minFee, minVolume, maxVolume }: TxSpecExtended,
  ): Promise<TxSpecExtended> {
    const price = await this.priceProviderService.getPrice(from, this.eur).then((p) => p.invert());

    const maxVolumePrice =
      maxVolume && (await this.priceProviderService.getPrice(from, this.chf).then((p) => p.invert()));

    const maxVolumeSource = maxVolume && (from.name === 'CHF' ? maxVolume : maxVolumePrice.convert(maxVolume * 0.99)); // -1% for the conversion

    return {
      minFee: this.convert(minFee, price, from instanceof Fiat),
      minVolume: this.convert(minVolume, price, from instanceof Fiat),
      maxVolume: maxVolumeSource && this.roundMaxAmount(maxVolumeSource, from instanceof Fiat),
    };
  }

  private async convertToTarget(
    to: Asset | Fiat,
    { minFee, minVolume, maxVolume }: TxSpecExtended,
  ): Promise<TxSpecExtended> {
    const price = await this.priceProviderService.getPrice(this.eur, to);
    const maxVolumePrice = maxVolume && (await this.priceProviderService.getPrice(this.chf, to));

    const maxVolumeTarget = maxVolume && (to.name === 'CHF' ? maxVolume : maxVolumePrice.convert(maxVolume * 0.99)); // -1% for the conversion

    return {
      minFee: this.convert(minFee, price, to instanceof Fiat),
      minVolume: this.convert(minVolume, price, to instanceof Fiat),
      maxVolume: maxVolumeTarget && this.roundMaxAmount(maxVolumeTarget, to instanceof Fiat),
    };
  }

  private convert(amount: number, price: Price, isFiat: boolean): number {
    const targetAmount = price.convert(amount);
    return this.round(targetAmount, isFiat);
  }

  private round(amount: number, isFiat: boolean): number {
    return isFiat ? Util.round(amount, 2) : Util.roundByPrecision(amount, 5);
  }

  private roundMaxAmount(amount: number, isFiat: boolean): number {
    return isFiat ? Util.round(amount, -1) : Util.roundByPrecision(amount, 3);
  }

  private getTxDirection(from: Asset | Fiat, to: Asset | Fiat): FeeDirectionType {
    if (from instanceof Fiat && to instanceof Asset) return FeeDirectionType.BUY;
    if (from instanceof Asset && to instanceof Fiat) return FeeDirectionType.SELL;
    return FeeDirectionType.CONVERT;
  }
}