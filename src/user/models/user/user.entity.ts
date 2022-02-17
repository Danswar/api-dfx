import { Buy } from 'src/payment/models/buy/buy.entity';
import { Country } from 'src/shared/models/country/country.entity';
import { Language } from 'src/shared/models/language/language.entity';
import { Log } from 'src/user/models/log/log.entity';
import { Sell } from 'src/payment/models/sell/sell.entity';
import { UserData } from 'src/user/models/user-data/user-data.entity';
import { Wallet } from 'src/user/models/wallet/wallet.entity';
import { Entity, Column, OneToMany, ManyToOne } from 'typeorm';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { Staking } from '../../../payment/models/staking/staking.entity';
import { IEntity } from 'src/shared/models/entity';
import { AccountType } from '../user-data/account-type.enum';

export enum UserStatus {
  NA = 'NA',
  ACTIVE = 'Active',
}

@Entity()
export class User extends IEntity {
  @Column({ length: 256, unique: true })
  address: string;

  @Column({ length: 256, unique: true })
  signature: string;

  @ManyToOne(() => Wallet)
  wallet: Wallet;

  @Column({ length: 256, default: '000-000' })
  usedRef: string;

  @Column({ length: 256, default: UserRole.USER })
  role: UserRole;

  @Column({ length: 256, default: UserStatus.NA })
  status: UserStatus;

  @Column({ length: 256, default: '0.0.0.0' })
  ip: string;

  @Column({ length: 'MAX', nullable: true })
  cfpVotes: string;

  @OneToMany(() => Buy, (buy) => buy.user)
  buys: Buy[];

  @OneToMany(() => Sell, (sell) => sell.user)
  sells: Sell[];

  @OneToMany(() => Staking, (staking) => staking.user)
  stakingRoutes: Staking[];

  @ManyToOne(() => UserData)
  userData: UserData;

  @OneToMany(() => Log, (logs) => logs.user)
  logs: Log[];

  // --- REF --- //
  @Column({ length: 256, unique: true })
  ref: string;

  @Column({ type: 'float', default: 0.5 })
  refFeePercent: number;

  @Column({ type: 'float', default: 0 })
  refVolume: number;

  @Column({ type: 'float', default: 0 })
  refCredit: number;

  // --- TO REMOVE --- //
  @Column({ default: AccountType.PERSONAL, length: 256 })
  accountType: AccountType;

  @Column({ length: 256, nullable: true })
  mail: string;

  @Column({ length: 256, nullable: true })
  phone: string;

  @ManyToOne(() => Language, { eager: true })
  language: Language;

  @Column({ length: 256, nullable: true })
  firstname: string;

  @Column({ length: 256, nullable: true })
  surname: string;

  @Column({ length: 256, nullable: true })
  street: string;

  @Column({ length: 256, nullable: true })
  houseNumber: string;

  @Column({ length: 256, nullable: true })
  location: string;

  @Column({ length: 256, nullable: true })
  zip: string;

  @ManyToOne(() => Country, { eager: true })
  country: Country;

  @Column({ length: 256, nullable: true })
  organizationName: string;

  @Column({ length: 256, nullable: true })
  organizationStreet: string;

  @Column({ length: 256, nullable: true })
  organizationHouseNumber: string;

  @Column({ length: 256, nullable: true })
  organizationLocation: string;

  @Column({ length: 256, nullable: true })
  organizationZip: string;

  @ManyToOne(() => Country, { eager: true })
  organizationCountry: Country;
}
