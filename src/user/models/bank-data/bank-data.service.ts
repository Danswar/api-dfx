import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { BankDataRepository } from 'src/user/models/bank-data/bank-data.repository';
import { BankDataDto } from 'src/user/models/bank-data/dto/bank-data.dto';
import { UserData } from 'src/user/models/userData/userData.entity';
import { UserDataRepository } from 'src/user/models/userData/userData.repository';
import { KycService } from 'src/user/services/kyc/kyc.service';
import { BankData } from './bank-data.entity';

@Injectable()
export class BankDataService {
  constructor(
    private readonly userDataRepo: UserDataRepository,
    private readonly bankDataRepo: BankDataRepository,
    private readonly kycService: KycService,
  ) {}

  async addBankData(userDataId: number, dto: BankDataDto): Promise<UserData> {
    const userData = await this.userDataRepo.findOne({ where: { id: userDataId }, relations: ['bankDatas'] });
    if (!userData) throw new NotFoundException(`No user data for id ${userDataId}`);

    const bankDataCheck = await this.bankDataRepo.findOne({
      iban: dto.iban,
      location: dto.location ?? null,
      name: dto.name,
    });
    if (bankDataCheck) throw new ConflictException('Bank data with duplicate key');

    const bankData = this.bankDataRepo.create({ ...dto, userData });
    await this.bankDataRepo.save(bankData);

    // create customer, if not existing
    await this.kycService.createCustomer(userData.id, bankData.name);

    userData.bankDatas.push(bankData);
    return userData;
  }

  async updateBankData(id: number, dto: BankDataDto): Promise<BankData> {
    const bankData = await this.bankDataRepo.findOne({ id });
    if (!bankData) throw new NotFoundException('No matching bank data for ID found');

    return this.bankDataRepo.save({ ...bankData, ...dto });
  }

  async deleteBankData(id: number): Promise<void> {
    await this.bankDataRepo.delete(id);
  }
}
