import { ApiProperty } from '@nestjs/swagger';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { AssetDto } from 'src/shared/models/asset/dto/asset.dto';
import { MinAmount } from 'src/shared/payment/dto/min-amount.dto';

export class CryptoPaymentInfoDto {
  @ApiProperty()
  routeId: number;

  @ApiProperty()
  depositAddress: string;

  @ApiProperty()
  blockchain: Blockchain;

  @ApiProperty({ type: MinAmount, deprecated: true })
  minDeposit: MinAmount;

  @ApiProperty({ description: 'Fee in percentage' })
  fee: number;

  @ApiProperty({ description: 'Minimum fee in source asset' })
  minFee: number;

  @ApiProperty({ description: 'Minimum volume in source asset' })
  minVolume: number;

  @ApiProperty({ description: 'Minimum fee in target asset' })
  minFeeTarget: number;

  @ApiProperty({ description: 'Minimum volume in target asset' })
  minVolumeTarget: number;

  @ApiProperty({ description: 'Estimated amount in target asset' })
  estimatedAmount: number;

  @ApiProperty({ type: AssetDto, description: 'Target asset' })
  targetAsset: AssetDto;
}
