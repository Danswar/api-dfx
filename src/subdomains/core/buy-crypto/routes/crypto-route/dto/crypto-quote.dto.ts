import { ApiProperty } from '@nestjs/swagger';

export class CryptoQuoteDto {
  @ApiProperty({ description: 'Fee amount in source asset' })
  feeAmount: number;

  @ApiProperty({ description: 'Exchange rate in source/target' })
  exchangeRate: number;

  @ApiProperty({ description: 'Estimated amount in target asset' })
  estimatedAmount: number;
}