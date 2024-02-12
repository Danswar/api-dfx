import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BigNumberish, ethers } from 'ethers';
import { Config, GetConfig } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { Lock } from 'src/shared/utils/lock';
import { CreateLogDto } from 'src/subdomains/supporting/log/dto/create-log.dto';
import { LogSeverity } from 'src/subdomains/supporting/log/log.entity';
import { LogService } from 'src/subdomains/supporting/log/log.service';
import {
  FrankencoinChallengeGraphDto,
  FrankencoinDelegationGraphDto,
  FrankencoinMinterGraphDto,
  FrankencoinPoolSharesDto,
  FrankencoinPositionDto,
  FrankencoinTradeGraphDto,
} from './dto/frankencoin.dto';
import { FrankencoinClient } from './frankencoin-client';

@Injectable()
export class FrankencoinService {
  private readonly logger = new DfxLogger(FrankencoinService);

  private static readonly LOG_SYSTEM = 'EvmInformation';

  private readonly client: FrankencoinClient;

  constructor(private readonly logService: LogService) {
    const { zchfGatewayUrl, zchfApiKey } = GetConfig().blockchain.frankencoin;

    this.client = new FrankencoinClient(zchfGatewayUrl, zchfApiKey);
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  @Lock()
  async processLogInfo() {
    if (DisabledProcess(Process.FRANKENCOIN_LOG_INFO)) return;

    await this.positionsLog();
    await this.fpssLog();
  }

  private async positionsLog() {
    const positions = await this.getPositions();

    const log: CreateLogDto = {
      system: FrankencoinService.LOG_SYSTEM,
      subsystem: 'FrankencoinSmartContract',
      severity: LogSeverity.INFO,
      message: JSON.stringify(positions),
    };

    await this.logService.create(log);
  }

  private async fpssLog() {
    const fpss = await this.getFPSs();

    const log: CreateLogDto = {
      system: FrankencoinService.LOG_SYSTEM,
      subsystem: 'FrankencoinPoolSharesSmartContract',
      severity: LogSeverity.INFO,
      message: JSON.stringify(fpss),
    };

    await this.logService.create(log);
  }

  async getPositions(): Promise<FrankencoinPositionDto[]> {
    const positionsResult: FrankencoinPositionDto[] = [];

    const positions = await this.client.getPositions();

    for (const position of positions) {
      try {
        const collateralContract = this.client.getCollateralContract(position.collateral);

        const symbol = await collateralContract.symbol();
        const decimals = await collateralContract.decimals();
        const positionBalance = await collateralContract.balanceOf(position.position);

        const positionContract = this.client.getPositionContract(position.position);
        const frankencoinContract = this.client.getFrankencoinContract(position.zchf);

        const price = await positionContract.price();
        const limitForClones = await positionContract.limitForClones();
        const minted = await positionContract.minted();
        const reserveContribution = await positionContract.reserveContribution();
        const calculateAssignedReserve = await frankencoinContract.calculateAssignedReserve(
          minted,
          Number(reserveContribution),
        );
        const limit = await positionContract.limit();
        const expiration = await positionContract.expiration();

        positionsResult.push({
          address: {
            position: position.position,
            frankencoin: position.zchf,
            collateral: position.collateral,
            owner: position.owner,
          },
          collateral: {
            symbol: symbol,
            amount: this.fromWeiAmount(positionBalance, decimals),
          },
          details: {
            availableAmount: this.fromWeiAmount(limitForClones),
            totalBorrowed: this.fromWeiAmount(minted),
            liquidationPrice: this.fromWeiAmount(price, 36 - decimals),
            retainedReserve: this.fromWeiAmount(calculateAssignedReserve),
            limit: this.fromWeiAmount(limit),
            expirationDate: new Date(Number(expiration) * 1000),
          },
        });
      } catch (e) {
        this.logger.error(`Error while getting position ${position.position}`, e);
      }
    }

    return positionsResult;
  }

  async getChallenges(): Promise<FrankencoinChallengeGraphDto[]> {
    return this.client.getChallenges();
  }

  async getFPSs(): Promise<FrankencoinPoolSharesDto[]> {
    const fpssResult: FrankencoinPoolSharesDto[] = [];

    const equityContract = this.client.getEquityContract(Config.blockchain.frankencoin.contractAddress.equity);
    const frankencoinContract = this.client.getFrankencoinContract(Config.blockchain.frankencoin.contractAddress.zchf);

    const fpss = await this.client.getFPS();

    for (const fps of fpss) {
      try {
        const totalSupply = await equityContract.totalSupply();
        const price = await equityContract.price();
        const frankenMinterReserve = await frankencoinContract.minterReserve();
        const frankenEquity = await frankencoinContract.equity();

        fpssResult.push({
          fpsPrice: this.fromWeiAmount(price),
          supply: this.fromWeiAmount(totalSupply),
          marketCap: this.fromWeiAmount(totalSupply) * this.fromWeiAmount(price),
          totalReserve: this.fromWeiAmount(frankenMinterReserve) + this.fromWeiAmount(frankenEquity),
          equityCapital: this.fromWeiAmount(frankenEquity),
          minterReserve: this.fromWeiAmount(frankenMinterReserve),
          totalIncome: this.fromWeiAmount(fps.profits),
          totalLosses: this.fromWeiAmount(fps.loss),
        });
      } catch (e) {
        this.logger.error(`Error while getting pool shares ${fps.id}`, e);
      }
    }

    return fpssResult;
  }

  async getFPSPrice(): Promise<number> {
    const equityContract = this.client.getEquityContract(Config.blockchain.frankencoin.contractAddress.equity);
    const price = await equityContract.price();

    return this.fromWeiAmount(price);
  }

  async getMinters(): Promise<FrankencoinMinterGraphDto[]> {
    return this.client.getMinters();
  }

  async getDelegations(): Promise<FrankencoinDelegationGraphDto[]> {
    return this.client.getDelegations();
  }

  async getTrades(): Promise<FrankencoinTradeGraphDto[]> {
    return this.client.getTrades();
  }

  // --- HELPER METHOD --- //

  private fromWeiAmount(amountWeiLike: BigNumberish, decimals?: number): number {
    const amount =
      decimals != null ? ethers.utils.formatUnits(amountWeiLike, decimals) : ethers.utils.formatEther(amountWeiLike);

    return parseFloat(amount);
  }
}