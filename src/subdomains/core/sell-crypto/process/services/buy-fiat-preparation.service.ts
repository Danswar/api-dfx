import { Injectable, OnModuleInit } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { AmlReason } from 'src/subdomains/core/aml/enums/aml-reason.enum';
import { AmlService } from 'src/subdomains/core/aml/services/aml.service';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { UserStatus } from 'src/subdomains/generic/user/models/user/user.entity';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { PayInStatus } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { PayInService } from 'src/subdomains/supporting/payin/services/payin.service';
import { CryptoPaymentMethod, FiatPaymentMethod } from 'src/subdomains/supporting/payment/dto/payment-method.enum';
import { FeeService } from 'src/subdomains/supporting/payment/services/fee.service';
import { TransactionHelper } from 'src/subdomains/supporting/payment/services/transaction-helper';
import { Price, PriceStep } from 'src/subdomains/supporting/pricing/domain/entities/price';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { In, IsNull, Not } from 'typeorm';
import { CheckStatus } from '../../../aml/enums/check-status.enum';
import { BuyFiatRepository } from '../buy-fiat.repository';
import { BuyFiatService } from './buy-fiat.service';

@Injectable()
export class BuyFiatPreparationService implements OnModuleInit {
  private readonly logger = new DfxLogger(BuyFiatPreparationService);
  private chf: Fiat;
  private eur: Fiat;

  constructor(
    private readonly buyFiatRepo: BuyFiatRepository,
    private readonly transactionHelper: TransactionHelper,
    private readonly pricingService: PricingService,
    private readonly fiatService: FiatService,
    private readonly feeService: FeeService,
    private readonly buyFiatService: BuyFiatService,
    private readonly amlService: AmlService,
    private readonly userService: UserService,
    private readonly payInService: PayInService,
    private readonly userDataService: UserDataService,
  ) {}

  onModuleInit() {
    void this.fiatService.getFiatByName('CHF').then((f) => (this.chf = f));
    void this.fiatService.getFiatByName('EUR').then((f) => (this.eur = f));
  }

  async doAmlCheck(): Promise<void> {
    const request = { inputAmount: Not(IsNull()), inputAsset: Not(IsNull()), isComplete: false };
    const entities = await this.buyFiatRepo.find({
      where: [
        {
          amlCheck: IsNull(),
          amlReason: IsNull(),
          ...request,
        },
        { amlCheck: CheckStatus.PENDING, amlReason: Not(AmlReason.MANUAL_CHECK), ...request },
      ],
      relations: {
        cryptoInput: true,
        sell: true,
        transaction: { user: { wallet: true, userData: { users: true } } },
        bankData: true,
      },
    });
    if (entities.length === 0) return;

    this.logger.verbose(
      `AmlCheck for ${entities.length} buy-fiat transaction(s). Transaction ID(s): ${entities.map((t) => t.id)}`,
    );

    for (const entity of entities) {
      try {
        if (!entity.cryptoInput.isConfirmed) continue;

        const amlCheckBefore = entity.amlCheck;

        const inputReferenceCurrency = entity.cryptoInput.asset;

        const isPayment = entity.cryptoInput.isPayment;
        const minVolume = await this.transactionHelper.getMinVolume(
          entity.cryptoInput.asset,
          entity.outputAsset,
          entity.cryptoInput.asset,
          false,
          isPayment,
        );

        const referenceChfPrice = await this.pricingService.getPrice(inputReferenceCurrency, this.chf, false);

        const last24hVolume = await this.transactionHelper.getVolumeChfSince(
          entity.inputReferenceAmount,
          inputReferenceCurrency,
          false,
          Util.daysBefore(1, entity.transaction.created),
          Util.daysAfter(1, entity.transaction.created),
          entity.userData.users,
        );

        const last30dVolume = await this.transactionHelper.getVolumeChfSince(
          entity.inputReferenceAmount,
          inputReferenceCurrency,
          false,
          Util.daysBefore(30, entity.transaction.created),
          Util.daysAfter(30, entity.transaction.created),
          entity.userData.users,
        );

        const last365dVolume = await this.transactionHelper.getVolumeChfSince(
          entity.inputReferenceAmount,
          inputReferenceCurrency,
          false,
          Util.daysBefore(365, entity.transaction.created),
          Util.daysAfter(365, entity.transaction.created),
          entity.userData.users,
        );

        const { bankData, blacklist } = await this.amlService.getAmlCheckInput(entity, last24hVolume);
        if (bankData && !bankData.comment) continue;

        await this.buyFiatRepo.update(
          ...entity.amlCheckAndFillUp(
            inputReferenceCurrency,
            minVolume,
            referenceChfPrice.convert(entity.inputReferenceAmount),
            last24hVolume,
            last30dVolume,
            last365dVolume,
            bankData,
            blacklist,
          ),
        );

        await this.payInService.updatePayInAction(entity.cryptoInput.id, entity.amlCheck);

        if (amlCheckBefore !== entity.amlCheck) {
          await this.buyFiatService.triggerWebhook(entity);
          if (entity.amlReason === AmlReason.VIDEO_IDENT_NEEDED)
            await this.userDataService.triggerVideoIdent(entity.userData);
        }

        if (entity.amlCheck === CheckStatus.PASS && entity.user.status === UserStatus.NA)
          await this.userService.activateUser(entity.user);
      } catch (e) {
        this.logger.error(`Error during buy-fiat ${entity.id} AML check:`, e);
      }
    }
  }

  async refreshFee(): Promise<void> {
    const entities = await this.buyFiatRepo.find({
      where: {
        amlCheck: CheckStatus.PASS,
        isComplete: false,
        percentFee: IsNull(),
        inputReferenceAmount: Not(IsNull()),
        cryptoInput: { paymentLinkPayment: { id: IsNull() } },
      },
      relations: {
        sell: true,
        cryptoInput: true,
        transaction: { user: { wallet: true, userData: true } },
      },
    });

    for (const entity of entities) {
      try {
        const inputCurrency = entity.cryptoInput.asset;

        const eurPrice = await this.pricingService.getPrice(inputCurrency, this.eur, false);
        const chfPrice = await this.pricingService.getPrice(inputCurrency, this.chf, false);

        const amountInChf = chfPrice.convert(entity.inputAmount, 2);

        const fee = await this.transactionHelper.getTxFeeInfos(
          entity.inputAmount,
          amountInChf,
          inputCurrency,
          inputCurrency,
          entity.outputAsset,
          CryptoPaymentMethod.CRYPTO,
          FiatPaymentMethod.BANK,
          entity.user,
        );

        await this.buyFiatRepo.update(
          ...entity.setFeeAndFiatReference(
            eurPrice.convert(entity.inputAmount, 2),
            amountInChf,
            fee,
            eurPrice.convert(fee.min, 2),
            chfPrice.convert(fee.total, 2),
          ),
        );

        if (entity.amlCheck === CheckStatus.FAIL) return;

        for (const feeId of fee.fees) {
          await this.feeService.increaseTxUsages(amountInChf, feeId, entity.user.userData);
        }

        await this.buyFiatService.updateSellVolume([entity.sell?.id]);
        await this.buyFiatService.updateRefVolume([entity.usedRef]);
      } catch (e) {
        this.logger.error(`Error during buy-fiat ${entity.id} fee and fiat reference refresh:`, e);
      }
    }
  }

  async fillPaymentLinkPayments(): Promise<void> {
    const entities = await this.buyFiatRepo.find({
      where: {
        amlCheck: CheckStatus.PASS,
        isComplete: false,
        percentFee: IsNull(),
        inputReferenceAmount: Not(IsNull()),
        cryptoInput: { paymentLinkPayment: { id: Not(IsNull()) } },
      },
      relations: {
        sell: true,
        cryptoInput: { paymentLinkPayment: { link: { route: { user: { userData: true } } } }, paymentQuote: true },
        transaction: { user: { wallet: true, userData: true } },
      },
    });

    for (const entity of entities) {
      try {
        const inputCurrency = entity.cryptoInput.asset;
        const outputCurrency = entity.outputAsset;
        const outputReferenceAmount = Util.roundReadable(entity.paymentLinkPayment.amount, true);

        if (outputCurrency.id !== entity.paymentLinkPayment.currency.id) throw new Error('Payment currency mismatch');

        // fees
        const feeRate = Config.payment.fee(entity.cryptoInput.paymentQuote.standard, outputCurrency, inputCurrency);
        const totalFee = entity.inputReferenceAmount * feeRate;
        const inputReferenceAmountMinusFee = entity.inputReferenceAmount - totalFee;

        const { fee: paymentLinkFee } = entity.cryptoInput.paymentLinkPayment.link.configObj;

        // prices
        const eurPrice = await this.pricingService.getPrice(inputCurrency, this.eur, false);
        const chfPrice = await this.pricingService.getPrice(inputCurrency, this.chf, false);

        const conversionPrice = Price.create(
          inputCurrency.name,
          outputCurrency.name,
          inputReferenceAmountMinusFee / outputReferenceAmount,
        );
        const priceStep = PriceStep.create(
          'Payment',
          conversionPrice.source,
          conversionPrice.target,
          conversionPrice.price,
        );

        await this.buyFiatRepo.update(
          ...entity.setPaymentLinkPayment(
            eurPrice.convert(entity.inputAmount, 2),
            chfPrice.convert(entity.inputAmount, 2),
            feeRate,
            totalFee,
            chfPrice.convert(totalFee, 5),
            inputReferenceAmountMinusFee,
            outputReferenceAmount,
            paymentLinkFee,
            [priceStep],
          ),
        );

        if (entity.amlCheck === CheckStatus.FAIL) return;

        await this.buyFiatService.updateSellVolume([entity.sell?.id]);
      } catch (e) {
        this.logger.error(`Error during buy-fiat ${entity.id} fill paymentLinkPayments:`, e);
      }
    }
  }

  async setOutput(): Promise<void> {
    const entities = await this.buyFiatRepo.find({
      where: {
        amlCheck: CheckStatus.PASS,
        isComplete: false,
        inputReferenceAmountMinusFee: Not(IsNull()),
        outputAmount: IsNull(),
        priceDefinitionAllowedDate: Not(IsNull()),
        cryptoInput: { status: In([PayInStatus.FORWARD_CONFIRMED, PayInStatus.COMPLETED]) },
      },
      relations: { sell: true, cryptoInput: true },
    });

    for (const entity of entities) {
      try {
        const asset = entity.cryptoInput.asset;
        const currency = entity.outputAsset;
        const price = await this.pricingService.getPrice(asset, currency, false);

        await this.buyFiatRepo.update(
          ...entity.setOutput(price.convert(entity.inputReferenceAmountMinusFee), price.steps),
        );
      } catch (e) {
        this.logger.error(`Error during buy-fiat ${entity.id} output setting:`, e);
      }
    }
  }
}
