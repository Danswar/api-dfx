import { Buy } from 'src/user/models/buy/buy.entity';
import {
  Entity,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Column,
  ManyToOne,
  OneToOne,
  JoinColumn,
} from 'typeorm';
import { BankTx } from '../bank-tx/bank-tx.entity';

export enum AmlCheck {
  PASS = 'Pass',
  FAIL = 'Fail',
}

@Entity()
export class CryptoBuy {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 256, nullable: true })
  date: string;

  @Column({ type: 'float', nullable: true })
  amount: number;

  @Column({ length: 256, nullable: true })
  currency: string;

  @Column({ type: 'float', nullable: true })
  amountInChf: number;

  @Column({ length: 256, nullable: true })
  name: string;

  @Column({ length: 256, nullable: true })
  addressLine1: string;

  @Column({ length: 256, nullable: true })
  addressLine2: string;

  @ManyToOne(() => Buy, (buy) => buy.cryptoBuys, { nullable: true })
  buy: Buy;

  @Column({ length: 256, nullable: true })
  amlCheck: AmlCheck;

  @Column({ type: 'float', nullable: true })
  cryptoAmount: number;

  @Column({ length: 256, nullable: true })
  cryptoAsset: string;

  @Column({ type: 'float', nullable: true })
  fee: number;

  @Column({ type: 'float', nullable: true })
  outputAmount: number;

  @Column({ length: 256, nullable: true })
  txId: string;

  @Column({ length: 256, nullable: true })
  usedRef: string;

  @Column({ type: 'datetime2', nullable: true })
  timeStamp: Date;

  @Column({ length: 256, nullable: true })
  recipientMail: string;

  @OneToOne(() => BankTx, { nullable: false })
  @JoinColumn()
  bankTx: BankTx;

  @UpdateDateColumn()
  updated: Date;

  @CreateDateColumn()
  created: Date;
}
