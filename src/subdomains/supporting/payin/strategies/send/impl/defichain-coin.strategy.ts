import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { CryptoInput } from '../../../entities/crypto-input.entity';
import { PayInRepository } from '../../../repositories/payin.repository';
import { PayInDeFiChainService } from '../../../services/payin-defichain.service';
import { JellyfishStrategy } from './base/jellyfish.strategy';
import { SendType } from './base/send.strategy';

@Injectable()
export class DeFiChainCoinStrategy extends JellyfishStrategy {
  constructor(
    protected readonly deFiChainService: PayInDeFiChainService,
    protected readonly payInRepo: PayInRepository,
  ) {
    super(deFiChainService, payInRepo, 60, Blockchain.DEFICHAIN);
  }

  async doSend(payIns: CryptoInput[], type: SendType): Promise<void> {
    console.log(
      `${type === SendType.FORWARD ? 'Forwarding' : 'Returning'} ${payIns.length} DeFiChain Coin input(s).`,
      payIns.map((p) => p.id),
    );

    const currentHeight = await this.deFiChainService.getCurrentHeight();

    for (const payIn of payIns) {
      try {
        // only forward block rewards, which are older than 100 blocks
        if (payIn.txType === 'blockReward' && currentHeight <= payIn.blockHeight + 100) continue;

        this.designateSend(payIn, type);

        const { outTxId, feeAmount } = await this.deFiChainService.sendUtxo(payIn);
        this.updatePayInWithSendData(payIn, type, outTxId, feeAmount);

        await this.payInRepo.save(payIn);
      } catch (e) {
        console.error(`Failed to send DeFiChain coin input ${payIn.id} of type ${type}`, e);
      }
    }
  }

  protected getForwardAddress(): BlockchainAddress {
    return BlockchainAddress.create(Config.blockchain.default.dexWalletAddress, Blockchain.DEFICHAIN);
  }
}