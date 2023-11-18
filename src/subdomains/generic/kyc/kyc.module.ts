import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SharedModule } from 'src/shared/shared.module';
import { UserModule } from '../user/user.module';
import { KycAdminController } from './controllers/kyc-admin.controller';
import { KycLog } from './entities/kyc-log.entity';
import { NameCheckLog } from './entities/name-check-log.entity';
import { KycLogRepository } from './repositories/kyc-log.repository';
import { NameCheckLogRepository } from './repositories/name-check-log.repository';
import { DilisenseService } from './services/dilisense.service';
import { DocumentStorageService } from './services/document-storage.service';
import { KycLogService } from './services/kyc-log.service';
import { NameCheckService } from './services/name-check.service';

@Module({
  imports: [TypeOrmModule.forFeature([/*KycStep,*/ KycLog, NameCheckLog]), SharedModule, forwardRef(() => UserModule)],
  controllers: [KycAdminController],
  providers: [
    DocumentStorageService,
    NameCheckService,
    NameCheckLogRepository,
    DilisenseService,
    KycLogService,
    KycLogRepository,
  ],
  exports: [DocumentStorageService, NameCheckService, KycLogService],
})
export class KycModule {}
