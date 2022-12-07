import { CryptoInput } from 'src/mix/models/crypto-input/crypto-input.entity';
import { CryptoStaking } from 'src/mix/models/crypto-staking/crypto-staking.entity';
import { StakingRefReward } from 'src/mix/models/staking-ref-reward/staking-ref-reward.entity';
import { StakingReward } from 'src/mix/models/staking-reward/staking-reward.entity';
import { BuyCrypto } from 'src/subdomains/core/buy-crypto/process/entities/buy-crypto.entity';
import { RefReward } from 'src/subdomains/core/referral/reward/ref-reward.entity';
import { BuyFiat } from 'src/subdomains/core/sell-crypto/buy-fiat/buy-fiat.entity';

export class SupportReturnData {
  buyCrypto: BuyCrypto[];
  buyFiat: BuyFiat[];
  ref: BuyCrypto[];
  refReward: RefReward[];
  staking: CryptoStaking[];
  stakingReward: StakingReward[];
  stakingRefReward: StakingRefReward[];
  cryptoInput: CryptoInput[];
}