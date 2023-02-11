import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { Config, Process } from 'src/config/config';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Lock } from 'src/shared/utils/lock';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { PayInEntry } from '../../../interfaces';
import { PayInRepository } from '../../../repositories/payin.repository';
import { RegisterStrategy } from './base/register.strategy';
import { PayInFactory } from '../../../factories/payin.factory';
import { HistoryAmount, PayInDeFiChainService } from '../../../services/payin-defichain.service';
import { PayInService } from '../../../services/payin.service';
import { CryptoInput } from '../../../entities/crypto-input.entity';
import { DexService } from 'src/subdomains/supporting/dex/services/dex.service';
import { CryptoRoute } from 'src/subdomains/core/buy-crypto/routes/crypto-route/crypto-route.entity';
import { AmlCheck } from 'src/subdomains/core/buy-crypto/process/enums/aml-check.enum';
import { Sell } from 'src/subdomains/core/sell-crypto/route/sell.entity';
import { KycStatus } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { Staking } from 'src/subdomains/core/staking/entities/staking.entity';
import { AccountHistory } from '@defichain/jellyfish-api-core/dist/category/account';

@Injectable()
export class DeFiChainStrategy extends RegisterStrategy {
  private readonly checkEntriesLock = new Lock(7200);
  private readonly convertTokensLock = new Lock(7200);

  constructor(
    private readonly assetService: AssetService,
    private readonly deFiChainService: PayInDeFiChainService,
    protected readonly dexService: DexService,
    @Inject(forwardRef(() => PayInService))
    protected readonly payInService: PayInService,
    protected readonly payInFactory: PayInFactory,
    protected readonly payInRepository: PayInRepository,
  ) {
    super(dexService, payInFactory, payInRepository);
  }

  //*** PUBLIC API ***//

  doAmlCheck(_: CryptoInput, route: Staking | Sell | CryptoRoute): AmlCheck {
    return route.user.userData.kycStatus === KycStatus.REJECTED ? AmlCheck.FAIL : AmlCheck.PASS;
  }

  /**
   * @note
   * accepting CryptoInput (PayIn) entities for retry mechanism (see PayInService -> #retryGettingReferencePrices())
   */
  async addReferenceAmounts(entries: PayInEntry[] | CryptoInput[]): Promise<void> {
    const btc = await this.assetService.getAssetByQuery({
      dexName: 'BTC',
      blockchain: Blockchain.DEFICHAIN,
      type: AssetType.TOKEN,
    });

    const usdt = await this.assetService.getAssetByQuery({
      dexName: 'USDT',
      blockchain: Blockchain.DEFICHAIN,
      type: AssetType.TOKEN,
    });

    for (const entry of entries) {
      try {
        const btcAmount = await this.getReferenceAmount(entry.asset, entry.amount, btc);
        const usdtAmount = await this.getReferenceAmount(entry.asset, entry.amount, usdt);

        await this.addReferenceAmountsToEntry(entry, btcAmount, usdtAmount);
      } catch (e) {
        console.error('Could not set reference amounts for DeFiChain pay-in', e);
        continue;
      }
    }
  }

  //*** JOBS ***//

  @Cron(CronExpression.EVERY_30_SECONDS)
  async checkPayInEntries(): Promise<void> {
    if (Config.processDisabled(Process.PAY_IN)) return;
    if (!this.checkEntriesLock.acquire()) return;

    try {
      await this.processNewPayInEntries();
    } catch (e) {
      console.error('Exception during DeFiChain pay in checks:', e);
    } finally {
      this.checkEntriesLock.release();
    }
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async convertTokens(): Promise<void> {
    if (Config.processDisabled(Process.PAY_IN)) return;
    if (!this.convertTokensLock.acquire()) return;

    try {
      await this.deFiChainService.convertTokens();
    } catch (e) {
      console.error('Exception during token conversion:', e);
    } finally {
      this.convertTokensLock.release();
    }
  }

  //*** HELPER METHODS ***//

  private async processNewPayInEntries(): Promise<void> {
    const log = this.createNewLogObject();
    const lastCheckedBlockHeight = await this.payInRepository
      .findOne({ where: { address: { blockchain: Blockchain.DEFICHAIN } }, order: { blockHeight: 'DESC' } })
      .then((input) => input?.blockHeight ?? 0);

    const newEntries = await this.getNewEntriesSince(lastCheckedBlockHeight);
    await this.addReferenceAmounts(newEntries);

    for (const entry of newEntries) {
      try {
        await this.createPayInAndSave(entry);
        log.newRecords.push({ address: entry.address.address, txId: entry.txId });
      } catch (e) {
        console.log('Did not register pay-in: ', e);
        continue;
      }
    }

    this.printInputLog(log, lastCheckedBlockHeight, Blockchain.DEFICHAIN);
  }

  private async getNewEntriesSince(lastHeight: number): Promise<PayInEntry[]> {
    const supportedAssets = await this.assetService.getAllAsset([Blockchain.DEFICHAIN]);
    const histories = await this.deFiChainService.getNewTransactionsHistorySince(lastHeight);

    return this.mapHistoriesToEntries(histories, supportedAssets);
  }

  private mapHistoriesToEntries(histories: AccountHistory[], supportedAssets: Asset[]): PayInEntry[] {
    const inputs = [];

    for (const history of histories) {
      try {
        const amounts = this.deFiChainService.getAmounts(history);
        for (const amount of amounts) {
          inputs.push(this.createEntry(history, amount, supportedAssets));
        }
      } catch (e) {
        console.error(`Failed to create DeFiChain input ${history.txid}:`, e);
      }
    }

    return inputs.map((h) => this.filterOutNonSellableAndPoolPairs(h)).filter((p) => p != null);
  }

  private filterOutNonSellableAndPoolPairs(_entry: PayInEntry): PayInEntry | null {
    let entry: PayInEntry | null = null;

    entry = this.filterOutNonSellable(_entry);
    entry = this.filterOutPoolPairs(entry);

    return entry;
  }

  private createEntry(
    history: AccountHistory,
    { amount, asset, type }: HistoryAmount,
    supportedAssets: Asset[],
  ): PayInEntry {
    return {
      address: BlockchainAddress.create(history.owner, Blockchain.DEFICHAIN),
      txId: history.txid,
      txType: history.type,
      blockHeight: history.blockHeight,
      amount: amount,
      asset:
        this.assetService.getByQuerySync(supportedAssets, { dexName: asset, type, blockchain: Blockchain.DEFICHAIN }) ??
        null,
    };
  }
}
