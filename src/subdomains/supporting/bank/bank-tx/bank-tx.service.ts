import { ConflictException, forwardRef, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { BankTxRepository } from './bank-tx.repository';
import { BankTxBatchRepository } from './bank-tx-batch.repository';
import { BankTxBatch } from './bank-tx-batch.entity';
import { SepaParser } from './sepa-parser.service';
import { In } from 'typeorm';
import { UpdateBankTxDto } from './dto/update-bank-tx.dto';
import { BankTx, BankTxType, BankTxTypeCompleted } from './bank-tx.entity';
import { Interval } from '@nestjs/schedule';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { FrickService } from './frick.service';
import { OlkypayService } from './olkypay.service';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { MailType } from 'src/subdomains/supporting/notification/enums';
import { BankTxReturnService } from '../bank-tx-return/bank-tx-return.service';
import { BankTxRepeatService } from '../bank-tx-repeat/bank-tx-repeat.service';
import { BuyCryptoService } from 'src/subdomains/core/buy-crypto/process/services/buy-crypto.service';

@Injectable()
export class BankTxService {
  constructor(
    private readonly bankTxRepo: BankTxRepository,
    private readonly bankTxBatchRepo: BankTxBatchRepository,
    @Inject(forwardRef(() => BuyCryptoService))
    private readonly buyCryptoService: BuyCryptoService,
    private readonly notificationService: NotificationService,
    private readonly settingService: SettingService,
    private readonly frickService: FrickService,
    private readonly olkyService: OlkypayService,
    private readonly bankTxReturnService: BankTxReturnService,
    private readonly bankTxRepeatService: BankTxRepeatService,
  ) {}

  // --- TRANSACTION HANDLING --- //
  @Interval(60000)
  async checkTransactions(): Promise<void> {
    try {
      const settingKey = 'lastBankDate';
      const lastModificationTime = await this.settingService.get(settingKey, new Date(0).toISOString());

      const transactions = await Promise.all([
        this.olkyService.getOlkyTransactions(lastModificationTime),
        this.frickService.getFrickTransactions(lastModificationTime),
      ]).then(([olky, frick]) => olky.concat(frick));

      for (const bankTx of transactions) {
        try {
          await this.create(bankTx);
        } catch (e) {
          if (!(e instanceof ConflictException)) console.error(`Failed to import transaction:`, e);
        }
      }

      const newModificationTime = new Date().toISOString();
      await this.settingService.set(settingKey, newModificationTime);
    } catch (e) {
      console.error(`Failed to check bank transactions:`, e);
    }
  }

  async create(bankTx: Partial<BankTx>): Promise<Partial<BankTx>> {
    let entity = await this.bankTxRepo.findOne({ accountServiceRef: bankTx.accountServiceRef });
    if (entity)
      throw new ConflictException(`There is already a bank tx with the accountServiceRef: ${bankTx.accountServiceRef}`);

    entity = await this.bankTxRepo.create(bankTx);
    return await this.bankTxRepo.save(entity);
  }

  async storeSepaFiles(files: string[]): Promise<(BankTxBatch | Error)[]> {
    return Promise.all(files.map((f) => this.storeSepaFile(f).catch((e: Error) => e)));
  }

  async update(bankTxId: number, dto: UpdateBankTxDto): Promise<BankTx> {
    const bankTx = await this.bankTxRepo.findOne(bankTxId);
    if (!bankTx) throw new NotFoundException('BankTx not found');
    if (dto.type && dto.type != bankTx.type) {
      if (BankTxTypeCompleted(bankTx.type)) throw new ConflictException('BankTx type already set');

      switch (dto.type) {
        case BankTxType.BUY_CRYPTO:
          await this.buyCryptoService.createFromFiat(bankTxId, dto.buyId);
          break;
        case BankTxType.BANK_TX_RETURN:
          await this.bankTxReturnService.create(bankTx);
          break;
        case BankTxType.BANK_TX_REPEAT:
          await this.bankTxRepeatService.create(bankTx);
          break;
      }
    }

    return await this.bankTxRepo.save({ ...bankTx, ...dto });
  }

  // --- HELPER METHODS --- //

  private async storeSepaFile(xmlFile: string): Promise<BankTxBatch> {
    const sepaFile = SepaParser.parseSepaFile(xmlFile);

    // parse the file
    const batch = this.bankTxBatchRepo.create(SepaParser.parseBatch(sepaFile));
    const txList = this.bankTxRepo.create(SepaParser.parseEntries(sepaFile, batch.iban));

    // store the batch
    await this.bankTxBatchRepo.save(batch);

    // find duplicate entries
    const duplicates = await this.bankTxRepo
      .find({ accountServiceRef: In(txList.map((i) => i.accountServiceRef)) })
      .then((list) => list.map((i) => i.accountServiceRef));
    if (duplicates.length > 0) {
      const message = `Duplicate SEPA entries found in batch ${batch.identification}:`;
      console.log(message, duplicates);

      await this.notificationService.sendMail({
        type: MailType.ERROR_MONITORING,
        input: { subject: 'SEPA Error', errors: [message + ` ${duplicates.join(', ')}`] },
      });
    }

    // store the entries
    const newTxs = txList
      .filter((i) => !duplicates.includes(i.accountServiceRef))
      .map((tx) => ({
        batch: batch,
        type: tx.name?.includes('DFX AG') || tx.name?.includes('Payward Ltd.') ? BankTxType.INTERNAL : null,
        ...tx,
      }));
    await this.bankTxRepo.saveMany(newTxs);

    batch.transactions = txList;
    return batch;
  }

  //*** GETTERS ***//

  getBankTxRepo(): BankTxRepository {
    return this.bankTxRepo;
  }
}
