import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SharedModule } from 'src/shared/shared.module';
import { BuyCryptoModule } from '../buy-crypto/buy-crypto.module';
import { SellCryptoModule } from '../sell-crypto/sell-crypto.module';
import { RouteController } from './route.controller';
import { Route } from './route.entity';
import { RouteRepository } from './route.repository';
import { RouteService } from './route.service';

@Module({
  imports: [TypeOrmModule.forFeature([Route]), SharedModule, BuyCryptoModule, SellCryptoModule],
  controllers: [RouteController],
  providers: [RouteService, RouteRepository],
  exports: [],
})
export class RouteModule {}