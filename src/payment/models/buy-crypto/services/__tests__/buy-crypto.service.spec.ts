import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { BankTxRepository } from 'src/payment/models/bank-tx/bank-tx.repository';
import { BuyRepository } from 'src/payment/models/buy/buy.repository';
import { BuyService } from 'src/payment/models/buy/buy.service';
import { CryptoInputType } from 'src/payment/models/crypto-input/crypto-input.entity';
import { createCustomCryptoInput } from 'src/payment/models/crypto-input/__tests__/mock/crypto-input.entity.mock';
import { CryptoRouteRepository } from 'src/payment/models/crypto-route/crypto-route.repository';
import { CryptoRouteService } from 'src/payment/models/crypto-route/crypto-route.service';
import { createCustomCryptoRouteHistory } from 'src/payment/models/crypto-route/dto/__tests__/mock/crypto-route-history.dto.mock';
import { createCustomAsset } from 'src/shared/models/asset/__tests__/mock/asset.entity.mock';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { TestSharedModule } from 'src/shared/test.shared.module';
import { UserService } from 'src/user/models/user/user.service';
import { createCustomBuyCryptoHistory } from '../../dto/__tests__/mock/buy-crypto-history.dto.mock';
import { BuyCrypto } from '../../entities/buy-crypto.entity';
import { createCustomBuyCrypto } from '../../entities/__tests__/mock/buy-crypto.entity.mock';
import { BuyCryptoRepository } from '../../repositories/buy-crypto.repository';
import { BuyCryptoBatchService } from '../buy-crypto-batch.service';
import { BuyCryptoDexService } from '../buy-crypto-dex.service';
import { BuyCryptoNotificationService } from '../buy-crypto-notification.service';
import { BuyCryptoOutService } from '../buy-crypto-out.service';
import { BuyCryptoService } from '../buy-crypto.service';

enum MockBuyData {
  DEFAULT,
  BUY_HISTORY_EMPTY,
  BUY_HISTORY,
  BUY_HISTORY_SMALL,
  CRYPTO_HISTORY_EMPTY,
  CRYPTO_HISTORY,
}

describe('BuyCryptoService', () => {
  let service: BuyCryptoService;

  let buyCryptoRepo: BuyCryptoRepository;
  let bankTxRepo: BankTxRepository;
  let cryptoRouteRepo: CryptoRouteRepository;
  let buyRepo: BuyRepository;
  let settingService: SettingService;
  let buyService: BuyService;
  let cryptoRouteService: CryptoRouteService;
  let buyCryptoBatchService: BuyCryptoBatchService;
  let buyCryptoOutService: BuyCryptoOutService;
  let buyCryptoDexService: BuyCryptoDexService;
  let buyCryptoNotificationService: BuyCryptoNotificationService;
  let userService: UserService;

  beforeEach(async () => {
    buyCryptoRepo = createMock<BuyCryptoRepository>();
    bankTxRepo = createMock<BankTxRepository>();
    cryptoRouteRepo = createMock<CryptoRouteRepository>();
    buyRepo = createMock<BuyRepository>();
    settingService = createMock<SettingService>();
    buyService = createMock<BuyService>();
    cryptoRouteService = createMock<CryptoRouteService>();
    buyCryptoBatchService = createMock<BuyCryptoBatchService>();
    buyCryptoOutService = createMock<BuyCryptoOutService>();
    buyCryptoDexService = createMock<BuyCryptoDexService>();
    buyCryptoNotificationService = createMock<BuyCryptoNotificationService>();
    userService = createMock<UserService>();

    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [
        BuyCryptoService,
        { provide: BuyCryptoRepository, useValue: buyCryptoRepo },
        { provide: BankTxRepository, useValue: bankTxRepo },
        { provide: CryptoRouteRepository, useValue: cryptoRouteRepo },
        { provide: BuyRepository, useValue: buyRepo },
        { provide: SettingService, useValue: settingService },
        { provide: BuyService, useValue: buyService },
        { provide: CryptoRouteService, useValue: cryptoRouteService },
        { provide: BuyCryptoBatchService, useValue: buyCryptoBatchService },
        { provide: BuyCryptoOutService, useValue: buyCryptoOutService },
        { provide: BuyCryptoDexService, useValue: buyCryptoDexService },
        { provide: BuyCryptoNotificationService, useValue: buyCryptoNotificationService },
        { provide: UserService, useValue: userService },
      ],
    }).compile();

    service = module.get<BuyCryptoService>(BuyCryptoService);
  });

  const txOne = {
    inputAmount: 1,
    inputAsset: 'EUR',
    outputAmount: 0.00005,
    outputAsset: 'BTC',
  };

  const txTwo = {
    inputAmount: 10,
    inputAsset: 'EUR',
    outputAmount: 0.0005,
    outputAsset: 'BTC',
  };

  const txSmallAmount = {
    inputAmount: 1,
    inputAsset: 'EUR',
    outputAmount: 3e-8,
    outputAsset: 'GOOGL',
  };

  const txCrypto = {
    inputAmount: 1,
    inputAsset: 'BTC',
    outputAmount: 0.988,
    outputAsset: 'BTC',
    txId: 'TX_ID_01',
  };

  function setup(mock: MockBuyData, date?: Date) {
    if (mock !== MockBuyData.DEFAULT) {
      let wantedData: BuyCrypto[] = [];
      switch (mock) {
        case MockBuyData.BUY_HISTORY:
          wantedData = [
            createCustomBuyCrypto({ outputDate: date, ...txOne }),
            createCustomBuyCrypto({ outputDate: date, ...txTwo }),
          ];
          break;
        case MockBuyData.BUY_HISTORY_SMALL:
          wantedData = [createCustomBuyCrypto({ outputDate: date, ...txSmallAmount })];
          break;
        case MockBuyData.CRYPTO_HISTORY:
          wantedData = [
            createCustomBuyCrypto({
              outputDate: date,
              cryptoInput: createCustomCryptoInput({
                type: CryptoInputType.BUY_CRYPTO,
              }),
              ...txCrypto,
            }),
          ];
          break;
      }

      jest.spyOn(buyCryptoRepo, 'find').mockResolvedValue(wantedData);
    }
  }

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return an empty array, if buy route has no history', async () => {
    setup(MockBuyData.BUY_HISTORY_EMPTY);

    await expect(service.getHistory(1, 1)).resolves.toStrictEqual([]);
  });

  it('should return a history, if buy route has transactions', async () => {
    const date = new Date();
    setup(MockBuyData.BUY_HISTORY, date);

    await expect(service.getHistory(1, 1)).resolves.toStrictEqual([
      createCustomBuyCryptoHistory({
        date: date,
        ...txOne,
      }),
      createCustomBuyCryptoHistory({
        date: date,
        ...txTwo,
      }),
    ]);
  });

  it('should return a history, if buy route has transactions and show small amount correctly', async () => {
    const date = new Date();
    setup(MockBuyData.BUY_HISTORY_SMALL, date);

    await expect(service.getHistory(1, 1)).resolves.toStrictEqual([
      createCustomBuyCryptoHistory({
        date: date,
        ...txSmallAmount,
      }),
    ]);
  });

  it('should return an empty history, if crypto route has no transactions', async () => {
    setup(MockBuyData.CRYPTO_HISTORY_EMPTY);

    await expect(service.getCryptoRouteHistory(1, 1)).resolves.toStrictEqual([]);
  });

  it('should return a history, if crypto route has transactions', async () => {
    const date = new Date();
    setup(MockBuyData.CRYPTO_HISTORY, date);

    await expect(service.getCryptoRouteHistory(1, 1)).resolves.toStrictEqual([
      createCustomCryptoRouteHistory({
        date: date,
        ...txCrypto,
      }),
    ]);
  });
});