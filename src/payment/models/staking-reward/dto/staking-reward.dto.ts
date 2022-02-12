import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsOptional, IsDate, IsString, IsNumber, IsInt } from 'class-validator';

export abstract class StakingRewardDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  inputAmount: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  inputAsset: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  inputReferenceAmount: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  inputReferenceAsset: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  fee: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  outputReferenceAmount: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  outputReferenceAsset: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  outputAmount: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  outputAsset: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  apr: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  apy: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  txid: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDate()
  @Type(() => Date)
  inputDate: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDate()
  @Type(() => Date)
  outputDate: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  recipientMail: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  mailSendDate: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  amountInChf: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  amountInEur: number;
}
